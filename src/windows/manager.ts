import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  ipcMain,
  session
} from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { SaveConfigJson, UserConfigs } from '../config'
import { Global, Logger } from '../global'
import { MajsoulPlus } from '../majsoul_plus'
import { removeDirSync, updateObject } from '../utils'

export let ManagerWindow: BrowserWindow

export const ManagerWindowStatus: MajsoulPlus.WindowStatus = {
  visible: false,
  muted: false
}

export function initManagerWindow() {
  const config: BrowserWindowConstructorOptions = {
    ...Global.ManagerWindowConfig
  }
  // macOS 专有设置，设置背景为透明色
  if (process.platform === 'darwin') {
    config.frame = false
    config.titleBarStyle = 'hidden'
    config.vibrancy = 'medium-light' as any
    config.backgroundColor = 'rgba(0,0,0,0)'
  }

  // 计算资源管理器缩放宽高
  config.width *= UserConfigs.window.zoomFactor
  config.height *= UserConfigs.window.zoomFactor

  ManagerWindow = new BrowserWindow(config)

  // 清空菜单
  ManagerWindow.removeMenu()

  ManagerWindow.once('ready-to-show', () => {
    // 根据资源管理器设置的缩放宽高进行缩放操作
    ManagerWindow.webContents.zoomFactor = UserConfigs.window.zoomFactor
    ManagerWindow.show()
  })

  // 阻止页面 title 更改
  ManagerWindow.on('page-title-updated', event => event.preventDefault())

  // 关闭窗口
  ManagerWindow.on('close', () => {
    ipcMain.emit('save-resourcepack-enabled', {})
    ipcMain.emit('save-extension-enabled', {})
    ipcMain.emit('save-tool-enabled', {})
    SaveConfigJson(UserConfigs)
  })

  ManagerWindow.once('closed', () => {
    ManagerWindow = undefined
  })

  // 载入本地页面，对于 Linux 系统 file：// 不能省略
  ManagerWindow.loadURL(
    pathToFileURL(path.join(__dirname, '../manager/index.html')).toString()
  ).catch(error => {
    Logger.error(`加载管理器页面失败: ${error}`)
  })

  // 在 debug 环境下启动会打开开发者工具
  if (process.env.NODE_ENV === 'development') {
    ManagerWindow.webContents.openDevTools({ mode: 'detach' })
  }

  ipcMain.on('clear-cache', event => {
    removeDirSync(Global.LocalCachePath)
    // Unity WebGL 的资源缓存保存在 Cache Storage / IndexedDB 中，
    // 只删本地目录无法让替换后的立绘、语音立刻生效。
    const gameSession = session.defaultSession
    gameSession
      .clearCache()
      .then(() =>
        gameSession.clearStorageData({
          storages: ['cachestorage', 'indexdb', 'shadercache', 'serviceworkers']
        })
      )
      .catch(error => Logger.error(`清理游戏缓存失败: ${error}`))
    event.returnValue = 0
  })

  ipcMain.on('update-user-config', (event, config: MajsoulPlus.UserConfig) => {
    updateObject(UserConfigs, config)

    // 缩放比例的上下限
    if (UserConfigs.window.zoomFactor < 0.2) {
      UserConfigs.window.zoomFactor = 0.2
    } else if (UserConfigs.window.zoomFactor > 10) {
      UserConfigs.window.zoomFactor = 10
    }
    SaveConfigJson(UserConfigs)

    ManagerWindow.setContentSize(
      Global.ManagerWindowConfig.width * UserConfigs.window.zoomFactor,
      Global.ManagerWindowConfig.height * UserConfigs.window.zoomFactor
    )
    ManagerWindow.webContents.zoomFactor = UserConfigs.window.zoomFactor
    event.returnValue = true
  })
}
