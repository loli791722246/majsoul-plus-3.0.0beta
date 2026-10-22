import * as fs from 'fs'
import { Global } from './global'
import { MajsoulPlus } from './majsoul_plus'
import { fillObject } from './utils'

/**
 * 默认配置
 */
const defaultWindowConfig: MajsoulPlus.UserWindowConfig = {
  OSTheme: 'light',
  gameWindowSize: '',
  zoomFactor: 1,
  renderingMultiple: 100,
  isKioskModeOn: false,
  isNoBorder: false,
  isManagerHide: false
}

const defaultUpdateConfig: MajsoulPlus.UserUpdateConfig = {
  prerelease: false
}

const defaultChromiumConfig: MajsoulPlus.UserChromiumConfig = {
  isHardwareAccelerationDisable: false,
  isInProcessGpuOn: true,
  isIgnoreGpuBlacklist: false,
  proxyUrl: ''
}

const defaultUserDataConfig: MajsoulPlus.UserDataConfig = {
  useHttpServer: false,
  serverToPlay: 0
}

const defaultFontConfig: MajsoulPlus.UserFontConfig = {
  source: 'youyuan',
  scale: 1,
  offsetX: 0,
  offsetY: 0
}

const defaultPortraitConfig: MajsoulPlus.UserPortraitConfig = {
  offsetX: 0,
  offsetY: 0,
  scale: 1
}

const defaultConfig: MajsoulPlus.UserConfig = {
  chromium: defaultChromiumConfig,
  update: defaultUpdateConfig,
  userData: defaultUserDataConfig,
  window: defaultWindowConfig,
  font: defaultFontConfig,
  portrait: defaultPortraitConfig
}

/**
 * 冻结对象使其不可更改
 */
Object.freeze(defaultWindowConfig)
Object.freeze(defaultUpdateConfig)
Object.freeze(defaultChromiumConfig)
Object.freeze(defaultUserDataConfig)
Object.freeze(defaultFontConfig)
Object.freeze(defaultPortraitConfig)
Object.freeze(defaultConfig)

/**
 * 加载配置文件 json
 */
export function LoadConfigJson(): MajsoulPlus.UserConfig {
  let config: MajsoulPlus.UserConfig
  if (!fs.existsSync(Global.UserConfigPath)) SaveConfigJson(defaultConfig)
  try {
    config = JSON.parse(
      fs.readFileSync(Global.UserConfigPath, {
        encoding: 'utf-8'
      })
    )
  } catch (e) {
    config = {} as MajsoulPlus.UserConfig
  }
  config = fillObject(config, defaultConfig) as MajsoulPlus.UserConfig
  SaveConfigJson(config)
  return config
}

export function SaveConfigJson(config: MajsoulPlus.UserConfig) {
  const text = JSON.stringify(config, null, 2)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.writeFileSync(Global.UserConfigPath, text, { encoding: 'utf-8' })
      return
    } catch (error) {
      if (attempt === 5) {
        // 杀毒 / 权限拦截时不影响程序运行，只是本次设置不落盘
        try {
          // eslint-disable-next-line no-console
          console.warn('[Majsoul Plus] 保存配置失败:', error)
        } catch {}
        return
      }
      // 杀软可能短暂锁定文件，稍等后重试
      const until = Date.now() + 200
      while (Date.now() < until) {
        // busy wait，启动阶段最多 1 秒
      }
    }
  }
}

export const UserConfigs: MajsoulPlus.UserConfig = LoadConfigJson()
