import { session } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { appDataDir, Logger } from '../global'
import { UserConfigs } from '../config'
import { findSystemFont } from '../bundles/patcher'
import { ResourcePackManager } from '../resourcepack/resourcepack'
import { getEffectiveFontOptions } from './font-options'

/** 资源包 assets 的指纹（文件路径 + 大小 + 修改时间） */
function assetSignature(): string {
  try {
    const replacements =
      ResourcePackManager && typeof ResourcePackManager.getAssetReplacements === 'function'
        ? ResourcePackManager.getAssetReplacements()
        : []
    const texts =
      ResourcePackManager && typeof ResourcePackManager.getTextReplacements === 'function'
        ? ResourcePackManager.getTextReplacements()
        : []
    const chars = texts.map(item => String(item.to || '')).join('')
    if (replacements.length === 0 && !chars) return ''

    const hash = crypto.createHash('sha1')
    for (const item of replacements) {
      hash.update(item.target)
      hash.update(item.file)
      try {
        const stat = fs.statSync(item.file)
        hash.update(String(stat.size))
        hash.update(String(stat.mtimeMs))
        // 解压可能保留旧 mtime，再算一次内容哈希
        hash.update(
          crypto.createHash('sha1').update(fs.readFileSync(item.file)).digest('hex')
        )
      } catch {}
    }

    // 文本替换用到的新字会触发字体补丁，字体包也需要清缓存
    hash.update('text:' + chars)
    hash.update('long-text-v3')
    hash.update(
      'portrait:' + JSON.stringify((UserConfigs as any).portrait || {})
    )
    const fontOptions = getEffectiveFontOptions()
    hash.update(JSON.stringify(fontOptions))
    const font = findSystemFont(fontOptions.source)
    if (font) {
      hash.update(font)
      try {
        const stat = fs.statSync(font)
        hash.update(String(stat.size))
        hash.update(String(stat.mtimeMs))
      } catch {}
    }
    return hash.digest('hex')
  } catch {
    return ''
  }
}

/**
 * 资源包里的立绘 / 贴图变化后，游戏会继续使用 Cache Storage / IndexedDB 里的旧
 * bundle，导致替换不生效。这里在资源变化时自动清理一次游戏缓存。
 */
export async function ensureGameCacheFresh(): Promise<void> {
  const signature = assetSignature()
  if (!signature) return

  const file = path.join(appDataDir, 'asset-cache-signature.txt')
  let previous = ''
  try {
    previous = fs.readFileSync(file, 'utf-8').trim()
  } catch {}

  if (previous === signature) return

  try {
    const gameSession = session.defaultSession
    await gameSession.clearCache()
    await gameSession.clearStorageData({
      storages: ['cachestorage', 'indexdb', 'shadercache', 'serviceworkers']
    })
    fs.writeFileSync(file, signature, 'utf-8')
    Logger.info('[Majsoul] 检测到贴图资源变化，已清理游戏缓存')
  } catch (error) {
    Logger.error(`[Majsoul] 清理游戏缓存失败: ${error}`)
  }
}
