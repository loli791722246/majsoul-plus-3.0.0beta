import { UserConfigs } from '../config'
import { ResourcePackManager } from '../resourcepack/resourcepack'

export interface EffectiveFontOptions {
  source: string
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * 合并「资源包 font 字段」与「管理器设置页的全局字体设置」。
 * 设置页里的值优先，未设置时回退到资源包。
 */
export function getEffectiveFontOptions(): EffectiveFontOptions {
  let pack = { source: '', scale: 1, offsetX: 0, offsetY: 0 }
  try {
    if (
      ResourcePackManager &&
      typeof ResourcePackManager.getFontOptions === 'function'
    ) {
      pack = ResourcePackManager.getFontOptions()
    }
  } catch {}

  const ui = (UserConfigs && (UserConfigs as any).font) || {}
  return {
    source:
      typeof ui.source === 'string' && ui.source ? ui.source : pack.source,
    scale:
      typeof ui.scale === 'number' && ui.scale > 0 ? ui.scale : pack.scale,
    offsetX:
      typeof ui.offsetX === 'number' ? ui.offsetX : pack.offsetX,
    offsetY: typeof ui.offsetY === 'number' ? ui.offsetY : pack.offsetY
  }
}
