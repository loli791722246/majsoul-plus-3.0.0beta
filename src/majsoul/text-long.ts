import { TextReplacement } from '../mitm/text-replacer'

export interface ComposeGlyph {
  code: number
  text: string
  /** 空字形：零宽度、不绘制，用来填充字节差 */
  blank?: boolean
}

export interface LongTextPlan {
  /** 实际用于内存替换的规则（长名字会变成 PUA 字符） */
  effective: TextReplacement[]
  /** PUA 字形 → 要绘制的文字 */
  compose: ComposeGlyph[]
  /** 需要普通补字的字符（不含 PUA） */
  chars: string
}

const PUA_BASE = 0xe000
const MAX_SLOTS = 64

function collectChars(target: Set<string>, text: string) {
  for (const ch of String(text || '')) {
    if ((ch.codePointAt(0) || 0) > 0x7f) target.add(ch)
  }
}

/**
 * 长文本替换方案。
 *
 * Lua 字符串长度不能变，但「一姬」是 6 字节，可以换成 2 个 3 字节的 PUA 字符。
 * 每个 PUA 字符对应一个由多个字符合成的字形；字形的 advance 等于这些字符的
 * 自然宽度之和，所以 2 个 PUA 字符可以正常显示 4 个汉字，不需要改 Lua 长度。
 */
export function planLongText(rules: TextReplacement[]): LongTextPlan {
  const effective: TextReplacement[] = []
  const compose: ComposeGlyph[] = []
  const chars = new Set<string>()

  rules.forEach((rule, ruleIndex) => {
    const from = String((rule && rule.from) || '')
    const to = String((rule && rule.to) || '')
    if (!from) return

    const fromBytes = Buffer.byteLength(from, 'utf8')
    const toBytes = Buffer.byteLength(to, 'utf8')
    // 长文本合成只用于短名字：带换行或很长的文本（人物简介等）
    // 仍走普通替换，避免把整段文字压成一个超宽字形。
    const isShortName =
      !to.includes('\n') && Array.from(to).length <= 64
    if (toBytes <= fromBytes || fromBytes < 3 || !isShortName) {
      effective.push({ from, to })
      collectChars(chars, to)
      return
    }

    const slots = Math.floor(fromBytes / 3)
    if (slots < 1 || slots > MAX_SLOTS) {
      effective.push({ from, to })
      collectChars(chars, to)
      return
    }

    const list = Array.from(to)
    const base = Math.floor(list.length / slots)
    const extra = list.length % slots
    const chunks: string[] = []
    let cursor = 0
    for (let i = 0; i < slots; i++) {
      const take = base + (i < extra ? 1 : 0)
      chunks.push(list.slice(cursor, cursor + take).join(''))
      cursor += take
    }

    let replacement = ''
    chunks.forEach((chunk, slot) => {
      const code = PUA_BASE + ruleIndex * MAX_SLOTS + slot
      replacement += String.fromCodePoint(code)
      if (chunk) compose.push({ code, text: chunk })
    })

    // from 不是 3 的倍数时，用零宽空字形补齐剩余字节：
    // 1 字节 → U+0001，2 字节 → U+00AD（软连字符）
    const remainder = fromBytes - slots * 3
    if (remainder === 1) {
      replacement += '\u0001'
      if (!compose.some(item => item.code === 0x01)) {
        compose.push({ code: 0x01, text: '', blank: true })
      }
    } else if (remainder === 2) {
      replacement += '\u00ad'
      if (!compose.some(item => item.code === 0x00ad)) {
        compose.push({ code: 0x00ad, text: '', blank: true })
      }
    }

    effective.push({ from, to: replacement })
  })

  return { effective, compose, chars: Array.from(chars).join('') }
}
