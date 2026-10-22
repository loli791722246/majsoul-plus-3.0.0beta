import * as fs from 'fs'
import { ipcMain } from 'electron'
import * as path from 'path'
import BaseManager from '../BaseManager'
import { UserConfigs } from '../config'
import { appDataDir, GlobalPath, Logger } from '../global'
import { MajsoulPlus } from '../majsoul_plus'
import { ResourcePackManager } from '../resourcepack/resourcepack'
import { fetchAnySite } from '../utils'
import * as schema from './schema.json'

const defaultExtension: MajsoulPlus.Extension = {
  id: 'majsoul_plus',
  version: '2.0.0',
  name: '未命名',
  author: '未知作者',
  description: '无描述',
  preview: 'preview.png',
  dependencies: {},

  entry: 'script.js',
  loadBeforeGame: false,
  applyServer: [0, 1, 2],
  resourcepack: []
}

Object.freeze(defaultExtension)

export default class MajsoulPlusExtensionManager extends BaseManager {
  private extensionScripts: Map<string, string[]> = new Map()
  private useScriptPromises: Array<Promise<any>> = []

  constructor(configPath: string) {
    super('extension', configPath, defaultExtension, schema)
  }

  load(id: string) {
    this.use(id, (pack: MajsoulPlus.Extension) => {
      ResourcePackManager.loadExtensionPack(pack)
    })
  }

  enableFromConfig() {
    super.enableFromConfig()
    ResourcePackManager.setLoadedExtensions(this.getDetails())
  }

  clear() {
    super.clear()
    ResourcePackManager.clearExtensionPack()
    this.extensionScripts = new Map()
    this.useScriptPromises = []
  }

  addScript(id: string, script: string) {
    const scripts = this.extensionScripts.get(id) || []
    scripts.push(script)
    this.extensionScripts.set(id, scripts)
  }

  async useScript(folder: string, extension: MajsoulPlus.Extension) {
    if (!Array.isArray(extension.entry)) {
      extension.entry = [extension.entry]
    }

    const useScript = async (entry: string) => {
      // 加载远程脚本 远程脚本不缓存
      if (entry.match(/^https?:\/\//)) {
        const script = await fetchAnySite(entry, 'utf-8')
        this.addScript(extension.id, script)
        return
      }

      // 本地脚本
      const p = path.resolve(
        appDataDir,
        GlobalPath.ExtensionDir,
        folder,
        entry
      )
      if (!fs.existsSync(p)) {
        Logger.error(`extension entry ${entry} not found!`)
        return
      }

      try {
        const script = fs.readFileSync(p, { encoding: 'utf-8' })
        this.addScript(extension.id, script)
      } catch (e) {
        Logger.error(
          `failed to load extension ${extension.name} from ${p}: ${e}`
        )
        this.addScript(
          extension.id,
          `// failed to load extension ${extension.name} from ${p}: ${e}`
        )
      }
    }

    return Promise.all(extension.entry.map(useScript))
  }

  /**
   * 载入所有启用的扩展脚本。旧版本通过本地 Koa 服务器下发脚本，
   * 现在改为直接注入到游戏页面中（MITM 代理会修改 HTML）。
   */
  async prepare() {
    this.extensionScripts = new Map()
    this.useScriptPromises = []

    for (const key in this.loadedDetails) {
      const pack = this.loadedDetails[key]
      if (!pack || !pack.enabled) continue
      const extension = pack.metadata as MajsoulPlus.Extension
      const servers = extension.applyServer || [0, 1, 2]
      if (!servers.includes(UserConfigs.userData.serverToPlay)) continue
      this.useScriptPromises.push(
        this.useScript(extension.id, extension)
      )
    }

    await Promise.all(this.useScriptPromises)
  }

  /**
   * 返回需要注入到游戏页面的脚本（head 前置 / body 后置）。
   */
  getInjection(): { pre: string; post: string } {
    const pre: string[] = []
    const post: string[] = []

    for (const [id, scripts] of this.extensionScripts) {
      const detail = this.loadedDetails[id]
      if (!detail || !detail.enabled) continue
      const extension = detail.metadata as MajsoulPlus.Extension
      if (
        !(extension.applyServer || [0, 1, 2]).includes(
          UserConfigs.userData.serverToPlay
        )
      ) {
        continue
      }
      const code = this.wrap(id, extension, scripts)
      if (extension.loadBeforeGame) pre.push(code)
      else post.push(code)
    }

    return { pre: pre.join('\n'), post: post.join('\n') }
  }

  private wrap(
    id: string,
    extension: MajsoulPlus.Extension,
    scripts: string[]
  ): string {
    const body = scripts
      .map(
        script => `  try {
${script}
  } catch (e) {
    context.console.error('Unresolved Error', e);
  }`
      )
      .join('\n')

    return `/* Extension: ${id} (${extension.version || ''}) */
;(function () {
  const context = (window.Majsoul_Plus = window.Majsoul_Plus || {});
  const prefix = '[${id}]';
  const extensionConsole = new Proxy({}, {
    get: (target, name) => {
      if (typeof console[name] !== 'function') return () => undefined;
      return (...args) => {
        if (args.length === 0) return;
        if (typeof args[0] === 'string') args[0] = prefix + ' ' + args[0];
        else args = [prefix, ...args];
        return console[name].apply(console, args);
      };
    }
  });
  const fetchSelf = () => Promise.reject(new Error('extensionFetch is no longer available'));
${body}
})();`
  }

  changeEnable(event, id: string, enabled: boolean) {
    super.changeEnable(event, id, enabled)
    ResourcePackManager.setLoadedExtensions(this.loadedDetails)
  }

  removePack(event, id: string) {
    super.removePack(event, id)
    ResourcePackManager.setLoadedExtensions(this.loadedDetails)
  }
}
