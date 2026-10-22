import { BrowserWindowConstructorOptions } from 'electron'

declare namespace MajsoulPlus {
  /**
   * Config
   */
  export interface UserWindowConfig {
    OSTheme: 'light' | 'dark'
    gameWindowSize: string
    zoomFactor: number
    renderingMultiple: number
    isKioskModeOn: boolean
    isNoBorder: boolean
    isManagerHide: boolean
  }

  export interface UserUpdateConfig {
    prerelease: boolean
  }

  export interface UserChromiumConfig {
    isHardwareAccelerationDisable: boolean
    isInProcessGpuOn: boolean
    isIgnoreGpuBlacklist: boolean
    proxyUrl: string
  }

  export interface UserDataConfig {
    useHttpServer: boolean
    serverToPlay: number
  }

  export interface UserConfig {
    window: UserWindowConfig
    update: UserUpdateConfig
    chromium: UserChromiumConfig
    userData: UserDataConfig
    font: UserFontConfig
    portrait: UserPortraitConfig
  }

  export interface UserFontConfig {
    source: string
    scale: number
    offsetX: number
    offsetY: number
  }

  export interface UserPortraitConfig {
    /** 立绘水平偏移，单位是纹理像素（正数向右） */
    offsetX: number
    /** 立绘垂直偏移，单位是纹理像素（正数向上） */
    offsetY: number
    /** 立绘缩放，1 为原始大小 */
    scale: number
  }

  /**
   * Global
   */
  export interface Global {
    version: string
    ServerPort: number
    /** 本地中间人代理监听端口 */
    ProxyPort: number
    XOR_KEY: number
    EXTEND_RES_KEYWORD: string
    ResourcePackConfigPath: string
    ExtensionConfigPath: string
    ToolConfigPath: string
    UserConfigPath: string
    LocalCachePath: string
    ResourceFolderPath: string
    ExtensionFolderPath: string
    ToolFolderPath: string

    GameWindowConfig: BrowserWindowConstructorOptions
    ManagerWindowConfig: BrowserWindowConstructorOptions
    ToolWindowConfig: BrowserWindowConstructorOptions
    HttpGetUserAgent: string
  }

  export interface WindowWebPreferenceConfig {
    webSecurity: boolean
    allowRunningInsecureContent?: boolean
    nodeIntegration?: boolean
    plugins?: boolean
  }

  export interface GlobalPath {
    LocalDir: string
    ResourcePackDir: string
    ExtensionDir: string
    ToolsDir: string
  }

  /**
   * Common Metadata
   */
  export interface Metadata {
    id: string
    version: string
    name?: string
    author?: string | string[]
    description?: string
    preview?: string
    dependencies?: { [key: string]: string }
  }

  /**
   * 资源包(Resource Pack)
   */
  export interface ResourcePack extends Metadata {
    replace: Array<string | ResourcePackReplaceEntry>
    /** Unity AssetBundle 资源替换（立绘 / 语音 / 文字等） */
    assets?: ResourcePackAsset[]
    /** 运行时文本替换（语音台词、角色名等，Lua 表中已解密的字符串） */
    text?: ResourcePackText[]
    /** 诊断用：列出内存中包含这些关键词的字符串 */
    probe?: string[]
    /** 自动补字：选择系统字体、缩放和偏移 */
    font?: ResourcePackFont
  }

  interface ResourcePackFont {
    /** 系统字体：youyuan/kaiti/heiti/songti/yahei/fangsong/deng 或绝对路径 */
    source?: string
    /** 字形缩放，1.0 为原始大小 */
    scale?: number
    /** 水平偏移（em 比例，0.01 = 1%） */
    offsetX?: number
    /** 垂直偏移（em 比例，0.01 = 1%） */
    offsetY?: number
  }

  export interface ResourcePackText {
    /** 原文本 */
    from: string
    /** 新文本（UTF-8 字节数不能超过原文本，不足会补空格） */
    to: string
  }

  export interface ResourcePackAsset {
    /** 资源分组名或资源路径，例如 deco/character/yiji/full */
    target: string
    /** 相对资源包 assets 目录的文件名 */
    file: string
  }

  export interface ResourcePackReplaceEntry {
    from: string | string[]
    to: string
    'all-servers': boolean
    replace: boolean
  }

  /**
   * 扩展(Extension)
   */
  export interface Extension extends Metadata {
    entry?: string | string[]
    loadBeforeGame?: boolean
    applyServer?: number[]
    resourcepack?: Array<string | ResourcePackReplaceEntry>
  }

  /**
   * 工具(Tools)
   */
  export interface ToolConfig extends Metadata {
    index?: string
    windowOptions: BrowserWindowConstructorOptions
  }

  export interface WindowStatus {
    visible: boolean
    muted: boolean
  }

  export interface ResourceMap {
    res: { [key: string]: { prefix: string } }
  }
}
