import { IncomingHttpHeaders, IncomingMessage } from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { BundlePatcher, bundleNameFromPath, findSystemFont } from '../bundles/patcher'
import { appDataDir, Logger } from '../global'
import { UserConfigs } from '../config'
import { CertificateAuthority } from '../mitm/certificate'
import {
  InterceptedResponse,
  MitmHandlers,
  MitmProxy
} from '../mitm/proxy'
import { FrameHandler } from '../mitm/websocket'
import { buildTextReplacerScript } from '../mitm/text-replacer'
import { planLongText } from './text-long'
import { ExtensionManager } from '../extension/extension'
import { ResourcePackManager } from '../resourcepack/resourcepack'
import { XOR } from '../utils'
import { loadMaxData, MaxData } from '../mod/data'
import { ModEngine } from '../mod/engine'
import { Liqi } from '../mod/liqi'
import { ModConfigStore, GetModConfigStore } from '../mod/settings'
import { checkDataUpdate } from './data-updater'
import { getEffectiveFontOptions } from './font-options'

const LOG_PREFIX = '[Majsoul]'

function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string
) {
  const text = `${LOG_PREFIX} ${message}`
  switch (level) {
    case 'debug':
      Logger.debug(text)
      break
    case 'warn':
      Logger.warning(text)
      break
    case 'error':
      Logger.error(text)
      break
    default:
      Logger.info(text)
  }
}

export interface MajsoulStatus {
  running: boolean
  port: number
  modEnabled: boolean
  dataVersion: string
}

/**
 * 雀魂本地中间人服务。
 *
 * 启动后会：
 *  1. 生成 / 载入本地 CA 证书；
 *  2. 在 127.0.0.1 上开启 HTTP CONNECT 代理；
 *  3. 解密游戏流量，修改 WebSocket 中的 protobuf 报文（mod）；
 *  4. 按资源包 / 扩展的配置替换 HTTP 资源、向页面注入脚本。
 */
export class MajsoulService {
  private proxy: MitmProxy | null = null
  private ca: CertificateAuthority | null = null
  private port = 0
  private dataVersion = ''
  private modReady = false

  private liqi: Liqi | null = null
  private store: ModConfigStore | null = null
  private maxData: MaxData | null = null
  private patcher: BundlePatcher | null = null
  /** 最近经过代理的请求，用于导出诊断日志 */
  private recentRequests: Array<{
    time: string
    host: string
    path: string
  }> = []
  /** 自动记录的请求日志路径 */
  private requestLogPath = ''

  get requestLogFile(): string {
    return this.requestLogPath
  }

  /** 记录一条请求（最多保留 5000 条，同时写入日志文件） */
  private recordRequest(host: string, urlPath: string) {
    const item = {
      time: new Date().toISOString(),
      host,
      path: urlPath
    }
    this.recentRequests.push(item)
    if (this.recentRequests.length > 5000) {
      this.recentRequests.splice(0, this.recentRequests.length - 5000)
    }
    if (this.requestLogPath) {
      try {
        fs.appendFile(
          this.requestLogPath,
          `${item.time}\t--> https://${host}${urlPath}\n`,
          () => {}
        )
      } catch {}
    }
  }

  /** 记录上游响应，便于判断请求是否卡住 */
  private recordResponse(host: string, urlPath: string, status: number) {
    if (!this.requestLogPath) return
    try {
      fs.appendFile(
        this.requestLogPath,
        `${new Date().toISOString()}\t<-- ${status} https://${host}${urlPath}\n`,
        () => {}
      )
    } catch {}
  }

  /** 文本替换计划：普通补字 + 长文本的 PUA 合成字形 */
  private getTextPlan() {
    try {
      if (
        !ResourcePackManager ||
        typeof ResourcePackManager.getTextReplacements !== 'function'
      ) {
        return { effective: [], compose: [], chars: '' }
      }
      return planLongText(ResourcePackManager.getTextReplacements())
    } catch {
      return { effective: [], compose: [], chars: '' }
    }
  }

  /** 记录一条注释事件（例如实际使用的补丁文件） */
  private recordEvent(message: string) {
    if (!this.requestLogPath) return
    try {
      fs.appendFile(
        this.requestLogPath,
        `# ${new Date().toISOString()}\t${message}\n`,
        () => {}
      )
    } catch {}
  }

  /** 把最近的请求写入日志文件，返回文件路径 */
  dumpRequests(): string {
    const file = path.join(
      appDataDir,
      `requests-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.log`
    )
    const lines = this.recentRequests.map(
      item => `${item.time}\thttps://${item.host}${item.path}`
    )
    fs.writeFileSync(file, lines.join('\n'), 'utf-8')
    return file
  }

  get status(): MajsoulStatus {
    return {
      running: !!this.proxy,
      port: this.port,
      modEnabled: this.modReady,
      dataVersion: this.dataVersion
    }
  }

  get certificatePath(): string | null {
    return this.ca ? this.ca.caCertificatePath : null
  }

  async start(port: number): Promise<number> {
    if (this.proxy) return this.port

    const dataDir = this.resolveDataDir()
    const liqiPath = path.join(dataDir, 'liqi.desc')
    const maxDataPath = path.join(dataDir, 'max_data.yaml')
    this.dataVersion = readVersion(dataDir)

    // 自动记录资源请求，方便定位语音 / 文本等资源路径
    this.requestLogPath = path.join(appDataDir, 'requests.log')
    try {
      fs.writeFileSync(
        this.requestLogPath,
        `# 雀魂 Plus 请求日志 ${new Date().toISOString()}\n`,
        'utf-8'
      )
    } catch {}

    try {
      const liqi = Liqi.load(liqiPath)
      const store = GetModConfigStore(path.join(appDataDir, 'config'))
      const maxData: MaxData = loadMaxData(maxDataPath, message =>
        log('warn', message)
      )
      this.liqi = liqi
      this.store = store
      this.maxData = maxData
      this.modReady = true
      log(
        'info',
        `mod 已载入（liqi 数据版本 ${this.dataVersion || '内置'}，角色 ${
          maxData.character.length
        } 个）`
      )
    } catch (error) {
      this.liqi = null
      this.store = null
      this.maxData = null
      this.modReady = false
      log('error', `mod 初始化失败，将只代理不修改：${error}`)
    }

    try {
      const ca = new CertificateAuthority(
        path.join(appDataDir, 'certificates')
      )
      ca.init()
      this.ca = ca
    } catch (error) {
      log('error', `生成根证书失败：${error}`)
      throw error
    }

    const handlers = this.createHandlers()

    // 预先载入扩展脚本，供页面注入使用
    if (ExtensionManager && typeof ExtensionManager.prepare === 'function') {
      try {
        await ExtensionManager.prepare()
      } catch (error) {
        log('warn', `载入扩展脚本失败：${error}`)
      }
    }

    this.proxy = new MitmProxy(this.ca, handlers)
    try {
      this.port = await this.proxy.start(port)
    } catch (error) {
      log('warn', `端口 ${port} 不可用，改用随机端口`)
      this.port = await this.proxy.start(0)
    }

    log('info', `代理端口：${this.port}`)
    log('info', `根证书路径：${this.ca.caCertificatePath}`)

    // 资源包里有 Unity 资源替换时，提前生成 bundle 索引
    if (!this.patcher) this.patcher = this.createPatcher()
    if (this.patcher && this.hasAssetReplacements()) {
      this.patcher.ensureIndex()
    }

    // 后台检查数据更新（liqi.desc / max_data.yaml）
    checkDataUpdate(path.join(appDataDir, 'data'), message =>
      log('info', message)
    ).catch(() => {})

    return this.port
  }

  /** 应用启动时预生成资源索引，尽量在游戏启动前准备好 */
  prepare() {
    if (!this.patcher) this.patcher = this.createPatcher()
    if (this.patcher && this.hasAssetReplacements()) {
      this.patcher.ensureIndex()
    }
  }

  stop() {
    if (this.proxy) {
      this.proxy.stop()
      this.proxy = null
    }
    this.port = 0
  }

  private resolveDataDir(): string {
    const userData = path.join(appDataDir, 'data')
    const bundled = path.join(__dirname, '..', 'data')
    // 优先使用更新过的数据，但必须同时存在两个文件
    if (
      fs.existsSync(path.join(userData, 'liqi.desc')) &&
      fs.existsSync(path.join(userData, 'max_data.yaml'))
    ) {
      return userData
    }
    return bundled
  }

  private hasAssetReplacements(): boolean {
    if (
      !ResourcePackManager ||
      typeof ResourcePackManager.getAssetReplacements !== 'function'
    ) {
      return false
    }
    try {
      return ResourcePackManager.getAssetReplacements().length > 0
    } catch {
      return false
    }
  }

  private createPatcher(): BundlePatcher | null {
    // dist/majsoul -> 项目根目录
    const projectRoot = path.resolve(__dirname, '..', '..')
    const candidates: Array<{ exe: string; script: string | null }> = []

    // 开发环境（相对编译产物定位，避免 app.getAppPath 指向 test 目录）
    candidates.push({
      exe: path.join(
        projectRoot,
        'runtime',
        'patcher-bin',
        'patcher',
        'patcher.exe'
      ),
      script: null
    })
    candidates.push({
      exe: path.join(
        app.getAppPath(),
        'runtime',
        'patcher-bin',
        'patcher',
        'patcher.exe'
      ),
      script: null
    })
    // 打包后：resources/patcher/patcher.exe
    if (process.resourcesPath) {
      candidates.push({
        exe: path.join(process.resourcesPath, 'patcher', 'patcher.exe'),
        script: null
      })
    }
    // 兜底：本地 Python + 源码
    const python = process.env.MAJSOUL_PYTHON
    candidates.push({
      exe: python || 'python',
      script: path.join(projectRoot, 'runtime', 'patcher', 'patcher.py')
    })

    for (const candidate of candidates) {
      if (candidate.script && !fs.existsSync(candidate.script)) continue
      if (!candidate.script && !fs.existsSync(candidate.exe)) continue
      return new BundlePatcher(
        candidate.exe,
        candidate.script,
        appDataDir,
        log
      )
    }

    log('warn', '未找到资源补丁器，立绘 / 语音等 bundle 资源替换不可用')
    return null
  }

  private createHandlers(): MitmHandlers {
    const trace = process.env.MAJSOUL_LOG_REQUESTS === '1'

    return {
      handleWebSocket: (host: string, urlPath: string): FrameHandler | null => {
        if (trace) log('info', `WS  ${host}${urlPath}`)
        this.recordRequest(host, `WS ${urlPath}`)
        if (!this.modReady || !this.liqi || !this.store || !this.maxData) {
          return null
        }
        // 观战协议使用另一套报文格式，不解析
        if (urlPath === '/ob') return null
        // 游戏窗口的所有 WebSocket 都会经过本代理，这里对所有域名生效；
        // 非雀魂报文会在解码阶段被识别并原样透传。
        // 每个连接使用独立实例，避免多开时消息编号互相干扰
        return new ModEngine(
          this.liqi,
          this.store,
          this.maxData,
          log,
          app.getVersion()
        )
      },

      handleRequest: async (
        host: string,
        req: IncomingMessage
      ): Promise<InterceptedResponse | null> => {
        let urlPath = req.url || '/'
        try {
          urlPath = new URL(urlPath, `https://${host}`).pathname
        } catch {}
        if (trace) log('info', `GET ${host}${urlPath}`)
        // 记录所有域名，便于定位卡住的请求
        this.recordRequest(host, urlPath)

        if (!isMajsoulHost(host)) return null

        // 注入脚本把文本替换诊断结果 POST 回来，写入用户数据目录
        if (urlPath.indexOf('/majsoul_plus/text-diag') === 0) {
          const chunks: Buffer[] = []
          try {
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            }
            const file = path.join(appDataDir, 'text-diag.json')
            fs.writeFileSync(file, Buffer.concat(chunks))
            log('info', `文本替换诊断已保存：${file}`)
          } catch (error) {
            log('error', `保存文本诊断失败：${error}`)
          }
          return {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
            body: Buffer.from('ok')
          }
        }

        // Unity AssetBundle（立绘 / 语音 / 字体 / 文字）
        const bundleName = bundleNameFromPath(urlPath)
        if (bundleName && this.patcher) {
          try {
            const replacements = this.hasAssetReplacements()
              ? ResourcePackManager.getAssetReplacements()
              : []
            let index = this.patcher.ensureIndex()
            if (!index && bundleName !== 'bundle_info_so.majset') {
              // 资源请求前短暂等待索引，避免立绘包按原样下发后被缓存
              index = await this.patcher.waitForIndex(30000)
            }

            // 字体 bundle：补充普通字形 + 长文本的合成字形
            if (index && this.patcher.isFontBundle(bundleName)) {
              const plan = this.getTextPlan()
              const chars = plan.chars
              const options = getEffectiveFontOptions()
              const source = findSystemFont(options.source)
              if ((chars || plan.compose.length > 0) && source) {
                const fontFile = await this.patcher.ensureFontPatched(
                  bundleName,
                  chars,
                  source,
                  options.scale,
                  options.offsetX,
                  options.offsetY,
                  plan.compose
                )
                if (fontFile) {
                  return {
                    status: 200,
                    headers: {
                      'Content-Type': 'application/octet-stream'
                    },
                    body: fs.readFileSync(fontFile)
                  }
                }
              }
            }

            const matched =
              index && replacements.length > 0
                ? this.patcher.match(bundleName, replacements)
                : []
            if (matched.length > 0) {
              const portrait = (UserConfigs as any).portrait || {}
              const patched = await this.patcher.ensurePatched(
                bundleName,
                matched,
                {
                  offsetX: Number(portrait.offsetX) || 0,
                  offsetY: Number(portrait.offsetY) || 0,
                  scale:
                    typeof portrait.scale === 'number' &&
                    portrait.scale > 0
                      ? portrait.scale
                      : 1
                }
              )
              if (patched) {
                this.recordEvent(
                  `补丁 ${bundleName}: ${matched
                    .map(item => path.basename(item.file))
                    .join(', ')}`
                )
                return {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/octet-stream'
                  },
                  body: fs.readFileSync(patched)
                }
              }
            }
          } catch (error) {
            log('error', `处理 bundle 替换失败 ${bundleName}: ${error}`)
          }
        }

        if (!ResourcePackManager || typeof ResourcePackManager.findReplacement !== 'function') {
          return null
        }
        let replacement = ResourcePackManager.findReplacement(urlPath)
        if (
          !replacement &&
          typeof ResourcePackManager.findMirroredFile === 'function'
        ) {
          replacement = ResourcePackManager.findMirroredFile(urlPath)
        }
        if (!replacement) return null
        try {
          const data = fs.readFileSync(replacement.file)
          const body = replacement.encrypted ? XOR(data) : data
          log('info', `已替换资源：${urlPath}`)
          return {
            status: 200,
            headers: { 'Content-Type': mimeType(replacement.file) },
            body
          }
        } catch (error) {
          log('error', `读取替换资源失败 ${replacement.file}: ${error}`)
          return null
        }
      },

      needsResponseBody: (
        host: string,
        req: IncomingMessage,
        headers: IncomingHttpHeaders
      ): boolean => {
        if (!isMajsoulHost(host)) return false
        const contentType = String(headers['content-type'] || '')
        return contentType.includes('text/html')
      },

      transformResponse: (
        host: string,
        req: IncomingMessage,
        headers: IncomingHttpHeaders,
        body: Buffer
      ): Buffer | null => {
        let html = body.toString('utf-8')
        const injection = buildInjection()

        // 运行时文本替换（语音台词 / 角色名等）
        let textScript = ''
        if (
          ResourcePackManager &&
          typeof ResourcePackManager.getTextReplacements === 'function'
        ) {
          try {
            const texts = ResourcePackManager.getTextReplacements()
            const probes =
              typeof ResourcePackManager.getTextProbes === 'function'
                ? ResourcePackManager.getTextProbes()
                : []
            if (texts.length > 0 || probes.length > 0) {
              const plan = planLongText(texts)
              textScript = buildTextReplacerScript(plan.effective, probes)
              log(
                'info',
                `文本替换规则：${texts.length} 条（长文本合成 ${plan.compose.length} 个字形），诊断关键词：${probes.length} 个`
              )
            }
          } catch (error) {
            log('error', `读取文本替换规则失败：${error}`)
          }
        }

        const preScript = (injection ? injection.pre : '') + '\n' + textScript
        const postScript = injection ? injection.post : ''
        if (!preScript.trim() && !postScript.trim()) return null

        // 移除页面内的 CSP，避免注入的内联脚本被拦截
        html = html.replace(
          /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi,
          ''
        )

        const scripts = `<script>${escapeScript(preScript)}</script>`
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `${scripts}</head>`)
        } else {
          html = scripts + html
        }

        if (postScript) {
          const post = `<script>window.addEventListener('DOMContentLoaded',function(){try{${postScript}}catch(e){console.error(e)}});</script>`
          if (/<\/body>/i.test(html)) {
            html = html.replace(/<\/body>/i, `${post}</body>`)
          } else {
            html += post
          }
        }

        log('debug', `已向 ${host} 页面注入扩展脚本`)
        return Buffer.from(html, 'utf-8')
      },

      onResponse: (host: string, urlPath: string, status: number) => {
        this.recordResponse(host, urlPath, status)
      },

      log
    }
  }
}

function buildInjection(): { pre: string; post: string } | null {
  if (!ExtensionManager || typeof ExtensionManager.getInjection !== 'function') {
    return null
  }
  try {
    const injection = ExtensionManager.getInjection()
    if (!injection.pre && !injection.post) return null
    return injection
  } catch (error) {
    log('error', `生成扩展注入脚本失败：${error}`)
    return null
  }
}

function escapeScript(script: string): string {
  return script.replace(/<\/script/gi, '<\\/script')
}

function readVersion(dataDir: string): string {
  try {
    return fs.readFileSync(path.join(dataDir, 'version.txt'), 'utf-8').trim()
  } catch {
    return ''
  }
}

export function isMajsoulHost(host: string): boolean {
  return /(^|\.)(maj-soul\.com|mahjongsoul\.com|majsoul\.com|yo-star\.com|catmjstudio\.com)$/i.test(
    host
  )
}

const MIME_TYPES: { [key: string]: string } = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
  '.xml': 'text/xml'
}

function mimeType(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

export let Majsoul: MajsoulService | null = null

export function PrepareMajsoul() {
  if (!Majsoul) Majsoul = new MajsoulService()
  Majsoul.prepare()
}

export function StartMajsoul(port: number): Promise<number> {
  if (!Majsoul) Majsoul = new MajsoulService()
  return Majsoul.start(port)
}

export function StopMajsoul() {
  if (Majsoul) {
    Majsoul.stop()
    Majsoul = null
  }
}

export function GetMajsoul(): MajsoulService | null {
  return Majsoul
}
