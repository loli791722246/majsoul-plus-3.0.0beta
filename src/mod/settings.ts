import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

export interface ViewSlotConfig {
  slot: number
  item_id: number
  type: number
  item_id_list: number[]
}

export interface RandomCharacterConfig {
  character_id: number
  skin_id: number
}

export interface ModConfig {
  /** 当前看板娘 */
  character: number
  /** 各角色使用的皮肤 */
  characters: { [charid: string]: number }
  /** 自定义昵称 */
  nickname: string
  /** 星标角色 */
  star_chars: number[]
  /** 强制启用便捷提示 */
  bianjietishi: boolean
  /** 当前使用的称号 */
  title: number
  /** 加载 CG */
  loading_image: number[]
  /** 解锁全部表情 */
  emoji: boolean
  /** 各装扮页的装扮 */
  views: { [index: string]: ViewSlotConfig[] }
  /** 正在使用的装扮页 */
  views_index: number
  /** 显示其他玩家所在服务器 */
  show_server: boolean
  /** 0 无标识 / 1 主播 / 2 Pro */
  verified: number
  /** 禁止将外服玩家设为默认名称 */
  anti_replace_nickname: boolean
  /** 对局随机角色皮肤 */
  random_character: {
    enabled: boolean
    pool: RandomCharacterConfig[]
  }
  /** 地铁模式 */
  safe_mode: boolean
  /** 解锁全部角色 */
  unlock_characters: boolean
  /** 解锁全部皮肤 */
  unlock_skins: boolean
  /** 解锁全部装扮（头像框 / 背景 / 桌布等） */
  unlock_views: boolean
  /** 解锁全部称号 */
  unlock_titles: boolean
  /** 解锁全部道具与加载 CG */
  unlock_items: boolean
}

const DEFAULT_CONFIG: ModConfig = {
  character: 200001,
  characters: {},
  nickname: '',
  star_chars: [],
  bianjietishi: false,
  title: 0,
  loading_image: [],
  emoji: false,
  views: {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
    7: [],
    8: [],
    9: []
  },
  views_index: 0,
  show_server: true,
  verified: 0,
  anti_replace_nickname: true,
  random_character: { enabled: false, pool: [] },
  safe_mode: false,
  unlock_characters: true,
  unlock_skins: true,
  unlock_views: true,
  unlock_titles: true,
  unlock_items: true
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

/**
 * mod 配置文件（对应 MajsoulMax 的 config/settings.mod.yaml）。
 */
export class ModConfigStore {
  readonly config: ModConfig
  private readonly file: string

  constructor(private readonly configDir: string) {
    this.file = path.join(configDir, 'settings.mod.yaml')
    this.config = clone(DEFAULT_CONFIG)
    this.load()
  }

  private load() {
    try {
      const parsed = yaml.load(fs.readFileSync(this.file, 'utf-8')) as any
      const local = parsed && parsed.config ? parsed.config : parsed
      if (local && typeof local === 'object') {
        for (const key of Object.keys(this.config) as Array<keyof ModConfig>) {
          if (local[key] !== undefined) {
            ;(this.config as any)[key] = local[key]
          }
        }
      }
    } catch {
      // 首次运行时写入默认配置
    }
    this.save()
  }

  save() {
    try {
      fs.mkdirSync(this.configDir, { recursive: true })
      fs.writeFileSync(this.file, yaml.dump({ config: this.config }), 'utf-8')
    } catch (error) {
      // ignore
    }
  }
}

let sharedStore: ModConfigStore | null = null

/** 全局共享的 mod 配置（管理器设置页与代理共用同一份） */
export function GetModConfigStore(configDir: string): ModConfigStore {
  if (!sharedStore) sharedStore = new ModConfigStore(configDir)
  return sharedStore
}
