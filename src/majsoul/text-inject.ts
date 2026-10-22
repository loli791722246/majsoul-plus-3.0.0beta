import { WebContents, webContents } from 'electron'
import { Logger } from '../global'
import { buildTextReplacerScript } from '../mitm/text-replacer'
import { ResourcePackManager } from '../resourcepack/resourcepack'

/** 读取当前资源包里的文本替换规则 */
export function getTextRules(): Array<{ from: string; to: string }> {
  try {
    if (
      ResourcePackManager &&
      typeof ResourcePackManager.getTextReplacements === 'function'
    ) {
      return ResourcePackManager.getTextReplacements()
    }
  } catch {}
  return []
}

/** 读取当前资源包里的诊断关键词 */
export function getTextProbeList(): string[] {
  try {
    if (
      ResourcePackManager &&
      typeof ResourcePackManager.getTextProbes === 'function'
    ) {
      return ResourcePackManager.getTextProbes()
    }
  } catch {}
  return []
}

/** 找到正在运行游戏的 webContents */
export function findGameContents(): WebContents | null {
  const all = webContents.getAllWebContents()
  for (const wc of all) {
    if (wc.isDestroyed()) continue
    if (
      /(maj-soul\.com|mahjongsoul\.com|majsoul\.com|yo-star\.com)/i.test(
        wc.getURL()
      )
    ) {
      return wc
    }
  }
  return null
}

/**
 * 直接从主进程把文本替换脚本注入游戏页面。
 *
 * 不依赖 HTML 改写（页面可能命中缓存，绕过代理的注入），
 * 因此比之前的方案更可靠。
 */
export function injectTextReplacer(wc: WebContents): void {
  const rules = getTextRules()
  const probes = getTextProbeList()
  if (rules.length === 0 && probes.length === 0) return

  const script = buildTextReplacerScript(rules, probes)
  wc.executeJavaScript(script, true)
    .then(() => {
      Logger.info(
        `[Majsoul] 文本替换脚本已注入（${rules.length} 条规则 / ${probes.length} 个诊断词）`
      )
    })
    .catch(error => {
      Logger.warning(`[Majsoul] 文本替换脚本注入失败: ${error}`)
    })
}
