import * as fs from 'fs'
import { ipcMain } from 'electron'
import * as path from 'path'
import BaseManager from '../BaseManager'
import { appDataDir, GlobalPath, Logger } from '../global'
import { MajsoulPlus } from '../majsoul_plus'
import { isEncryptRes, readFile, XOR } from '../utils'
import * as schema from './schema.json'

const defaultResourcePack: MajsoulPlus.ResourcePack = {
  id: 'majsoul_plus',
  version: '2.0.0',
  name: 'Majsoul Plus',
  author: 'Majsoul Plus Team',
  description: 'No description provided.',
  preview: 'preview.png',
  dependencies: {},

  replace: []
}

Object.freeze(defaultResourcePack)

export interface Replacement {
  /** 本地文件绝对路径 */
  file: string
  /** 是否需要按 extendRes 规则异或 */
  encrypted: boolean
}

export default class ResourcePackManager extends BaseManager {
  private extensionMap: Map<string, MajsoulPlus.ResourcePack> = new Map()
  private loadedExtensions: {
    [extension: string]: {
      enabled: boolean
      sequence: number
      errors: Array<string | string[]>
      metadata: MajsoulPlus.Extension
    }
  } = {}

  constructor(configPath: string) {
    super('resourcepack', configPath, defaultResourcePack, schema)
  }

  load(id: string) {
    this.use(id, (pack: MajsoulPlus.ResourcePack) =>
      this.preprocessReplaceString(pack)
    )
  }

  loadExtensionPack(ext: MajsoulPlus.Extension) {
    if (ext.resourcepack && ext.resourcepack.length > 0) {
      const res = {
        ...ext,
        replace: ext.resourcepack
      }
      this.preprocessReplaceString(res)
      this.extensionMap.set(res.id, res)
    }
  }

  removeExtensionPack(id: string) {
    this.extensionMap.delete(id)
  }

  setLoadedExtensions(loaded: {
    [extension: string]: {
      enabled: boolean
      sequence: number
      errors: Array<string | string[]>
      metadata: MajsoulPlus.Extension
    }
  }) {
    Object.values(loaded).forEach(pack => {
      pack.metadata['replace'] = pack.metadata.resourcepack
    })
    this.loadedExtensions = loaded
  }

  clearExtensionPack() {
    this.extensionMap.clear()
    this.loadedExtensions = {}
  }

  preprocessReplaceString(pack: MajsoulPlus.ResourcePack) {
    if (!Array.isArray(pack.replace)) return
    pack.replace.forEach((rep, index) => {
      if (typeof rep === 'string') {
        pack.replace[index] = {
          from: [rep, 'jp/' + rep, 'en/' + rep],
          to: rep,
          'all-servers': true,
          replace: false
        }
      } else if (rep['all-servers']) {
        const all = []
        if (typeof rep.from === 'string') {
          rep.from = [rep.from]
        }
        rep.from.forEach(key => {
          all.push(key, 'chs_t/' + key, 'jp/' + key, 'en/' + key)
        })
        rep.from = all
      }
    })
  }

  /**
   * 收集所有启用资源包 / 扩展里的 AssetBundle 资源替换。
   * 这些替换由 BundlePatcher 打进 .majset 后再下发。
   */
  getAssetReplacements(): Array<{ target: string; file: string }> {
    const result: Array<{ target: string; file: string }> = []

    const collect = (pack: any, base: string) => {
      if (!pack || !Array.isArray(pack.assets)) return
      for (const item of pack.assets) {
        if (!item || typeof item.target !== 'string') continue
        if (typeof item.file !== 'string') continue
        const file = path.resolve(base, 'assets', item.file)
        if (fs.existsSync(file)) {
          result.push({ target: item.target, file })
        } else {
          Logger.warning(`资源替换文件不存在：${file}`)
        }
      }
    }

    // 扩展优先，资源包可以覆盖
    for (const [id, pack] of this.extensionMap) {
      const detail = this.loadedDetails[id]
      if (detail && detail.enabled) {
        collect(pack, path.join(appDataDir, GlobalPath.ExtensionDir, id))
      }
    }
    const resources = Object.keys(this.loadedDetails)
      .filter(id => id !== 'majsoul_plus' && this.loadedDetails[id].enabled)
      .sort(
        (a, b) =>
          this.loadedDetails[a].sequence - this.loadedDetails[b].sequence
      )
    for (const id of resources) {
      collect(
        this.loadedDetails[id].metadata,
        path.join(appDataDir, GlobalPath.ResourcePackDir, id)
      )
    }

    return result
  }

  /** 按「扩展优先、资源包按启用顺序」列出所有资源来源 */
  private orderedPacks(): Array<{
    id: string
    pack: MajsoulPlus.ResourcePack
    base: string
  }> {
    const ordered: Array<{
      id: string
      pack: MajsoulPlus.ResourcePack
      base: string
    }> = []

    for (const [id, pack] of this.extensionMap) {
      const detail = this.loadedDetails[id]
      if (detail && detail.enabled) {
        ordered.push({
          id,
          pack,
          base: path.join(appDataDir, GlobalPath.ExtensionDir, id)
        })
      }
    }

    const resources = Object.keys(this.loadedDetails)
      .filter(id => id !== 'majsoul_plus' && this.loadedDetails[id].enabled)
      .sort(
        (a, b) =>
          this.loadedDetails[a].sequence - this.loadedDetails[b].sequence
      )
    for (const id of resources) {
      ordered.push({
        id,
        pack: this.loadedDetails[id].metadata as MajsoulPlus.ResourcePack,
        base: path.join(appDataDir, GlobalPath.ResourcePackDir, id)
      })
    }

    return ordered
  }

  /**
   * 在已启用的资源包 / 扩展中查找可替换的资源。
   *
   * 与 MajsoulMax 的 replace 插件一致，按 URL 路径后缀匹配，
   * 因此不需要依赖官方 resversion.json 的资源映射表。
   */
  findReplacement(urlPath: string): Replacement | null {
    for (const entry of this.orderedPacks()) {
      if (!Array.isArray(entry.pack.replace)) continue
      for (const rep of entry.pack.replace) {
        if (typeof rep === 'string') continue
        const froms = typeof rep.from === 'string' ? [rep.from] : rep.from
        for (const from of froms || []) {
          if (!from) continue
          if (!matchReplacementPath(urlPath, from)) continue
          const file = path.resolve(entry.base, 'assets', rep.to)
          if (fs.existsSync(file)) {
            return { file, encrypted: isEncryptRes(urlPath) }
          }
        }
      }
    }

    return null
  }

  /**
   * 收集所有启用资源包 / 扩展里的运行时文本替换。
   * 这些文本由注入脚本在游戏内查找已解密的字符串并就地替换。
   */
  getTextReplacements(): Array<{ from: string; to: string }> {
    const result: Array<{ from: string; to: string }> = []
    for (const entry of this.orderedPacks()) {
      const list = (entry.pack as any).text
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (!item || typeof item.from !== 'string' || !item.from) continue
        if (typeof item.to !== 'string') continue
        result.push({ from: item.from, to: item.to })
      }
    }
    return result
  }

  /** 字体补字选项（多个资源包时后者覆盖前者） */
  getFontOptions(): {
    source: string
    scale: number
    offsetX: number
    offsetY: number
  } {
    const result = { source: '', scale: 1, offsetX: 0, offsetY: 0 }
    for (const entry of this.orderedPacks()) {
      const font = (entry.pack as any).font
      if (!font || typeof font !== 'object') continue
      if (typeof font.source === 'string' && font.source) {
        result.source = font.source
      }
      if (typeof font.scale === 'number' && font.scale > 0) {
        result.scale = font.scale
      }
      if (typeof font.offsetX === 'number') result.offsetX = font.offsetX
      if (typeof font.offsetY === 'number') result.offsetY = font.offsetY
    }
    return result
  }

  /** 收集用于诊断的内存取词 */
  getTextProbes(): string[] {
    const result: string[] = []
    for (const entry of this.orderedPacks()) {
      const list = (entry.pack as any).probe
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (typeof item === 'string' && item.length > 0) {
          result.push(item)
        }
      }
    }
    return result
  }

  /**
   * 按 URL 路径自动匹配资源包 assets 下的同名文件。
   *
   * 新版语音等资源以独立文件形式下发，例如：
   *   /assetbundles/DXT/Assets/MyAssets/audio/sound/yiji/lobby/lobby_normal1.mp3
   * 用户只需要把文件放到资源包的
   *   assets/audio/sound/yiji/lobby/lobby_normal1.mp3
   * 即可自动替换，不需要写 replace 规则。
   */
  findMirroredFile(urlPath: string): Replacement | null {
    let logical = ''
    const anchor = /\/Assets\/(.+)$/i.exec(urlPath)
    if (anchor) {
      logical = anchor[1]
    } else {
      const myAssets = /\/MyAssets\/(.+)$/i.exec(urlPath)
      if (myAssets) logical = 'MyAssets/' + myAssets[1]
    }
    if (!logical) return null

    const candidates = [logical]
    if (logical.startsWith('MyAssets/')) {
      candidates.push(logical.slice('MyAssets/'.length))
    } else {
      candidates.push('MyAssets/' + logical)
    }

    for (const entry of this.orderedPacks()) {
      for (const candidate of candidates) {
        const file = path.resolve(entry.base, 'assets', candidate)
        if (fs.existsSync(file)) {
          return { file, encrypted: isEncryptRes(urlPath) }
        }
      }
    }
    return null
  }

  async readReplacement(replacement: Replacement): Promise<Buffer> {
    const data = await readFile(replacement.file)
    return replacement.encrypted ? XOR(data) : data
  }

  changeEnable(event, id: string, enabled: boolean) {
    super.changeEnable(event, id, enabled)
    this.setLoadedExtensions(this.loadedDetails)
  }

  removePack(event, id: string) {
    super.removePack(event, id)
    this.setLoadedExtensions(this.loadedDetails)
  }
}

/**
 * 判断 URL 是否命中一条 from 规则。
 *
 * 除了普通的后缀匹配，还兼容旧版语音规则：
 *   旧：audio/sound/yiji/lobby_normal1.mp3
 *   新：/assetbundles/DXT/Assets/MyAssets/audio/sound/yiji/lobby/lobby_normal1.mp3
 * 新版在角色目录下多了 lobby 之类的子目录，因此按「角色 + 文件名」再匹配一次。
 */
function matchReplacementPath(urlPath: string, from: string): boolean {
  if (urlPath.endsWith(from)) return true

  const voice = /\/audio\/sound\/([^/]+)\/(?:[^/]+\/)?([^/]+)$/i.exec(urlPath)
  if (!voice) return false
  const normalized = `audio/sound/${voice[1]}/${voice[2]}`
  return from.replace(/\\/g, '/').toLowerCase().endsWith(normalized.toLowerCase())
}
