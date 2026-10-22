import { spawn } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as https from 'https'
import * as path from 'path'

export interface BundleIndex {
  version: string
  bundles: string[]
  groups: { [group: string]: string[] }
  assets: { [assetPath: string]: string }
}

export interface AssetReplacement {
  /** 资源分组名或资源路径（例如 deco/character/yiji/full） */
  target: string
  /** 本地替换文件绝对路径 */
  file: string
}

type Logger = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void

const BUNDLE_HASH_URL =
  'https://game.maj-soul.com/assetbundles/DXT/bundle_hash.txt'

/**
 * 资源包补丁器。
 *
 * 雀魂 Unity 客户端把立绘 / 语音 / 文字都放进了 .majset AssetBundle，
 * 旧的「按 URL 替换文件」不再适用。这里通过随程序附带的 patcher
 * （UnityPy 打包成的独立 exe）把用户提供的图片写进对应的 bundle，
 * 再由代理按 bundle URL 下发。
 */
export class BundlePatcher {
  private readonly workDir: string
  private readonly cacheDir: string
  private readonly patchedDir: string
  private readonly indexFile: string
  private index: BundleIndex | null = null
  private indexPromise: Promise<BundleIndex | null> | null = null
  private queue: Promise<any> = Promise.resolve()

  constructor(
    private readonly executable: string,
    private readonly script: string | null,
    userDataDir: string,
    private readonly log: Logger
  ) {
    this.workDir = path.join(userDataDir, 'bundles')
    this.cacheDir = path.join(this.workDir, 'cache')
    this.patchedDir = path.join(this.workDir, 'patched')
    this.indexFile = path.join(this.workDir, 'index.json')
    fs.mkdirSync(this.cacheDir, { recursive: true })
    fs.mkdirSync(this.patchedDir, { recursive: true })
  }

  get available(): boolean {
    return fs.existsSync(this.executable) || !!this.script
  }

  /** 后台开始生成资源索引；索引没准备好时返回 null，不阻塞游戏请求 */
  ensureIndex(): BundleIndex | null {
    if (this.index) return this.index
    if (!this.indexPromise) {
      this.indexPromise = this.buildIndex().then(result => {
        if (!result) this.indexPromise = null
        return result
      })
    }
    return null
  }

  /** 等待索引就绪（最多 timeoutMs），用于资源请求前短暂等待 */
  async waitForIndex(timeoutMs: number): Promise<BundleIndex | null> {
    if (this.index) return this.index
    this.ensureIndex()
    if (!this.indexPromise) return null
    return Promise.race([
      this.indexPromise,
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))
    ])
  }

  private async buildIndex(): Promise<BundleIndex | null> {
    try {
      const hash = await fetchText(BUNDLE_HASH_URL)
      if (fs.existsSync(this.indexFile)) {
        try {
          const cached = JSON.parse(
            fs.readFileSync(this.indexFile, 'utf-8')
          ) as BundleIndex
          if (cached.version === hash) {
            this.index = cached
            this.log('info', `资源索引已载入（${hash.slice(0, 8)}）`)
            return cached
          }
        } catch {
          // 缓存损坏，重新生成
        }
      }

      this.log('info', '正在生成雀魂资源索引，首次启动可能需要几十秒……')
      const result = await this.run([
        'index',
        '--cache',
        this.cacheDir,
        '--out',
        this.indexFile
      ])
      if (!result || !result.ok) {
        this.log('error', `资源索引生成失败：${result && result.error}`)
        return null
      }
      const index = JSON.parse(
        fs.readFileSync(this.indexFile, 'utf-8')
      ) as BundleIndex
      this.index = index
      this.log(
        'info',
        `资源索引完成：${index.bundles.length} 个包 / ${
          Object.keys(index.assets).length
        } 个资源`
      )
      return index
    } catch (error) {
      this.log('error', `资源索引生成失败：${error}`)
      return null
    }
  }

  private planCache: Map<string, AssetReplacement[]> | null = null
  private planKey = ''

  /** 计算某个 bundle 需要应用哪些替换（索引就绪后 O(1) 查询） */
  match(bundle: string, replacements: AssetReplacement[]): AssetReplacement[] {
    if (!this.index || replacements.length === 0) return []

    const key = replacements
      .map(item => `${item.target}\u0000${item.file}`)
      .join('\u0001')
    if (!this.planCache || this.planKey !== key) {
      this.planKey = key
      this.planCache = this.buildPlan(replacements)
    }
    return this.planCache.get(bundle) || []
  }

  /** 把每条替换解析成受影响的 bundle，避免每个请求都遍历 3 万条资源 */
  private buildPlan(
    replacements: AssetReplacement[]
  ): Map<string, AssetReplacement[]> {
    const plan = new Map<string, AssetReplacement[]>()
    if (!this.index) return plan

    const push = (bundle: string, replacement: AssetReplacement) => {
      const list = plan.get(bundle)
      if (list) list.push(replacement)
      else plan.set(bundle, [replacement])
    }

    for (const replacement of replacements) {
      const target = replacement.target.replace(/\\/g, '/')
      const groupBundles = this.index.groups[target]
      if (groupBundles && groupBundles.length > 0) {
        for (const bundle of groupBundles) push(bundle, replacement)
        continue
      }
      for (const [assetPath, owner] of Object.entries(this.index.assets)) {
        if (
          assetPath === target ||
          assetPath.endsWith('/' + target) ||
          assetPath.includes(target)
        ) {
          push(owner, replacement)
        }
      }
    }

    return plan
  }

  /** 确保 bundle 已打好补丁，返回补丁后的文件路径 */
  async ensurePatched(
    bundle: string,
    replacements: AssetReplacement[],
    portrait?: { offsetX: number; offsetY: number; scale?: number }
  ): Promise<string | null> {
    if (replacements.length === 0) return null
    const stamp = crypto
      .createHash('sha1')
      .update(
        JSON.stringify(
          replacements.map(item => [
            item.target,
            item.file,
            fileFingerprint(item.file)
          ])
        )
      )
      .update(JSON.stringify(portrait || null))
      // 补丁器逻辑变化时递增，强制重新生成缓存
      .update('patcher-v4-portrait-offset')
      .digest('hex')
    const output = path.join(this.patchedDir, bundle)
    const metaFile = output + '.meta'

    if (fs.existsSync(output) && fs.existsSync(metaFile)) {
      try {
        if (fs.readFileSync(metaFile, 'utf-8') === stamp) return output
      } catch {}
    }

    return this.enqueue(async () => {
      if (fs.existsSync(output) && fs.existsSync(metaFile)) {
        try {
          if (fs.readFileSync(metaFile, 'utf-8') === stamp) return output
        } catch {}
      }

      const planFile = path.join(this.patchedDir, bundle + '.plan.json')
      fs.writeFileSync(
        planFile,
        JSON.stringify(
          replacements.map(item => {
            const entry: any = { target: item.target, file: item.file }
            const isFullPortrait = /deco\/character\/[^/]+\/(full|reverse)(\/|$)/.test(
              item.target
            )
            if (portrait && isFullPortrait) {
              entry.sprite_offset_x = portrait.offsetX
              entry.sprite_offset_y = portrait.offsetY
              entry.sprite_scale =
                typeof portrait.scale === 'number' ? portrait.scale : 1
            }
            return entry
          })
        ),
        'utf-8'
      )

      this.log(
        'info',
        `正在替换 ${bundle}（${replacements
          .map(item => path.basename(item.file))
          .join(', ')}）`
      )
      const result = await this.run([
        'patch',
        '--cache',
        this.cacheDir,
        '--bundle',
        bundle,
        '--plan',
        planFile,
        '--out-dir',
        this.patchedDir
      ])

      if (!result || !result.ok) {
        this.log('error', `替换资源包失败 ${bundle}：${result && result.error}`)
        return null
      }

      fs.writeFileSync(metaFile, stamp, 'utf-8')
      try {
        fs.unlinkSync(planFile)
      } catch {}
      this.log('info', `资源替换完成：${bundle}`)
      return output
    })
  }

  private fontBundles: Set<string> | null = null
  private fontBundleVersion = ''
  private fontPatches = new Map<string, Promise<string | null>>()

  /** 判断某个 bundle 是否包含字体资源 */
  isFontBundle(bundle: string): boolean {
    if (!this.index) return false
    if (!this.fontBundles || this.fontBundleVersion !== this.index.version) {
      const set = new Set<string>()
      for (const [assetPath, owner] of Object.entries(this.index.assets)) {
        if (assetPath.includes('/fonts/')) set.add(owner)
      }
      this.fontBundles = set
      this.fontBundleVersion = this.index.version
    }
    return this.fontBundles.has(bundle)
  }

  /** 给字体 bundle 补充 chars 中缺失的字形，返回补丁后的文件 */
  ensureFontPatched(
    bundle: string,
    chars: string,
    source: string,
    scale = 1,
    offsetX = 0,
    offsetY = 0,
    compose: Array<{ code: number; text: string }> = []
  ): Promise<string | null> {
    const key = crypto
      .createHash('sha1')
      .update(bundle)
      .update(chars)
      .update(source)
      .update(String(mtime(source)))
      .update(String(scale))
      .update(String(offsetX))
      .update(String(offsetY))
      .update(JSON.stringify(compose))
      .update('font-compose-v3')
      .digest('hex')
    const output = path.join(this.cacheDir, 'fonts', key, bundle)
    if (fs.existsSync(output)) return Promise.resolve(output)

    const running = this.fontPatches.get(key)
    if (running) return running

    const task = this.enqueue(async () => {
      if (fs.existsSync(output)) return output
      const outDir = path.dirname(output)
      fs.mkdirSync(outDir, { recursive: true })
      this.log(
        'debug',
        `正在为字体包补充字形：${chars}（${bundle}，字体 ${path.basename(
          source
        )}，缩放 ${scale}）`
      )
      const result = await this.run([
        'font',
        '--cache',
        this.cacheDir,
        '--bundle',
        bundle,
        '--chars',
        chars,
        '--source',
        source,
        '--scale',
        String(scale),
        '--offset-x',
        String(offsetX),
        '--offset-y',
        String(offsetY),
        '--compose',
        JSON.stringify(compose),
        '--out-dir',
        outDir
      ])
      if (!result || !result.ok || !result.changed) {
        this.log('warn', `字体补丁未生效：${bundle}`)
        return null
      }
      this.log('debug', `字体补丁完成：${bundle}`)
      return fs.existsSync(output) ? output : null
    })
    this.fontPatches.set(key, task)
    return task
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }

  private run(args: string[]): Promise<any> {
    return new Promise(resolve => {
      if (!fs.existsSync(this.executable) && !this.script) {
        resolve({ ok: false, error: '找不到资源补丁器' })
        return
      }

      const command = this.script ? this.executable : this.executable
      const argv = this.script ? [this.script, ...args] : args
      const child = spawn(command, argv, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        resolve({ ok: false, error: '补丁器执行超时' })
      }, 300000)

      child.stdout.on('data', chunk => (stdout += chunk.toString('utf-8')))
      child.stderr.on('data', chunk => (stderr += chunk.toString('utf-8')))
      child.on('error', error => {
        clearTimeout(timer)
        resolve({ ok: false, error: error.message })
      })
      child.on('close', () => {
        clearTimeout(timer)
        const lines = stdout.trim().split('\n').filter(Boolean)
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            resolve(JSON.parse(lines[i]))
            return
          } catch {}
        }
        resolve({
          ok: false,
          error: stderr.trim().split('\n').pop() || '补丁器没有返回结果'
        })
      })
    })
  }
}

function matchAsset(
  assets: { [assetPath: string]: string },
  target: string,
  bundle: string
): boolean {
  for (const [assetPath, owner] of Object.entries(assets)) {
    if (owner !== bundle) continue
    if (
      assetPath === target ||
      assetPath.endsWith('/' + target) ||
      assetPath.includes(target)
    ) {
      return true
    }
  }
  return false
}

/** 系统字体别名，按视觉效果接近程度排序 */
const FONT_ALIASES: { [key: string]: string[] } = {
  youyuan: ['C:/Windows/Fonts/SIMYOU.TTF'],
  kaiti: ['C:/Windows/Fonts/simkai.ttf'],
  heiti: ['C:/Windows/Fonts/simhei.ttf'],
  songti: ['C:/Windows/Fonts/simsun.ttc'],
  yahei: ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc'],
  fangsong: ['C:/Windows/Fonts/simfang.ttf'],
  deng: ['C:/Windows/Fonts/Deng.ttf']
}

/**
 * 找一个可用的系统中文字体作为补字来源。
 * preferred 可以是绝对路径，也可以是 youyuan / kaiti / heiti / songti / yahei 等别名。
 */
export function findSystemFont(preferred?: string): string {
  if (preferred) {
    if (fs.existsSync(preferred)) return preferred
    const alias = FONT_ALIASES[preferred.toLowerCase()]
    if (alias) {
      for (const file of alias) {
        try {
          if (fs.existsSync(file)) return file
        } catch {}
      }
    }
  }

  // 默认优先幼圆（和游戏主字体最接近），其次楷体、雅黑、黑体、宋体
  for (const key of ['youyuan', 'kaiti', 'yahei', 'heiti', 'songti', 'fangsong', 'deng']) {
    for (const file of FONT_ALIASES[key]) {
      try {
        if (fs.existsSync(file)) return file
      } catch {}
    }
  }
  return ''
}

/** 从 /assetbundles/.../<name>.majset 中取出 bundle 文件名 */
export function bundleNameFromPath(urlPath: string): string | null {
  const match = /^\/assetbundles\/[^/]*\/([^/]+\.majset)$/i.exec(urlPath)
  return match ? match[1] : null
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

const fingerprintCache = new Map<string, string>()

/**
 * 替换文件的指纹：大小 + 修改时间 + 内容 SHA1。
 * 有些压缩包解压会保留旧 mtime，只看 mtime 会误用旧的补丁缓存。
 */
function fileFingerprint(file: string): string {
  try {
    const stat = fs.statSync(file)
    const key = `${file}:${stat.size}:${stat.mtimeMs}`
    const cached = fingerprintCache.get(key)
    if (cached) return cached
    const digest = crypto
      .createHash('sha1')
      .update(fs.readFileSync(file))
      .digest('hex')
    fingerprintCache.set(key, digest)
    return digest
  } catch {
    return '0'
  }
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'MajsoulPlus' }, timeout: 20000 },
      response => {
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        let text = ''
        response.on('data', chunk => (text += chunk))
        response.on('end', () => resolve(text.trim()))
      }
    )
    request.on('timeout', () => request.destroy(new Error('请求超时')))
    request.on('error', reject)
  })
}
