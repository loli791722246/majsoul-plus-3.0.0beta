import * as fs from 'fs'
import * as yaml from 'js-yaml'

/**
 * 全角色 / 皮肤 / 装扮 / 称号等数据（对应 MajsoulMax 的 max_data.yaml）。
 */
export interface MaxData {
  character: number[]
  skin: number[]
  emoji: { [charid: string]: number[] }
  endings: number[]
  title: number[]
  item: number[]
  loading_image: number[]
}

const EMPTY: MaxData = {
  character: [],
  skin: [],
  emoji: {},
  endings: [],
  title: [],
  item: [],
  loading_image: []
}

export function loadMaxData(file: string, log: (msg: string) => void): MaxData {
  try {
    const parsed = (yaml.load(fs.readFileSync(file, 'utf-8')) || {}) as any
    return {
      character: toNumberArray(parsed.character),
      skin: toNumberArray(parsed.skin),
      emoji: parsed.emoji && typeof parsed.emoji === 'object' ? parsed.emoji : {},
      endings: toNumberArray(parsed.endings),
      title: toNumberArray(parsed.title),
      item: toNumberArray(parsed.item),
      loading_image: toNumberArray(parsed.loading_image)
    }
  } catch (error) {
    log(`载入 max_data 失败：${error}`)
    return EMPTY
  }
}

function toNumberArray(value: any): number[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'number')
}
