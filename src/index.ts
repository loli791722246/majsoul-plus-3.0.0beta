import { app, dialog, ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { UserConfigs } from './config'
import { LoadExtension } from './extension/extension'
import { Global, InitGlobal, Logger, appDataDir } from './global'
import i18n from './i18n'
import { StartMajsoul, StopMajsoul, PrepareMajsoul } from './majsoul'
import { GetModConfigStore } from './mod/settings'
import { ensureGameCacheFresh } from './majsoul/cache'
import { LoadResourcePack } from './resourcepack/resourcepack'
import { LoadTool } from './tool/tool'
import bossKey from './utilities/bossKey'
import openFile from './utilities/openFile'
import sandbox from './utilities/sandbox'
import screenshot from './utilities/screenshot'
import { initPlayer, AudioPlayer } from './windows/audioPlayer'
import { GameWindows, initGameWindow } from './windows/game'
import { initManagerWindow, ManagerWindow } from './windows/manager'
import { initToolManager } from './windows/tool'

// 初始化全局变量
try {
  InitGlobal()
} catch (error) {
  Logger.error(`初始化目录失败: ${error}`)
}

// 自定义补字字体目录（用户可以把自己的 ttf/ttc/otf 放进来）
function customFontDir(): string {
  const dir = path.join(appDataDir, 'fonts')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  return dir
}

ipcMain.handle('list-custom-fonts', () => {
  const dir = customFontDir()
  try {
    return fs
      .readdirSync(dir)
      .filter(name => /\.(ttf|ttc|otf)$/i.test(name))
      .map(name => ({ name, path: path.join(dir, name) }))
  } catch {
    return []
  }
})

ipcMain.handle('open-font-folder', async () => {
  const dir = customFontDir()
  await shell.openPath(dir)
  return dir
})

// 管理器设置页与代理共享同一份 mod 配置
ipcMain.handle('get-mod-config', () => {
  return GetModConfigStore(path.join(appDataDir, 'config')).config
})
ipcMain.handle('set-mod-config', (event, patch) => {
  const store = GetModConfigStore(path.join(appDataDir, 'config'))
  if (patch && typeof patch === 'object') {
    for (const key of Object.keys(patch)) {
      if (Object.prototype.hasOwnProperty.call(store.config, key)) {
        ;(store.config as any)[key] = patch[key]
      }
    }
    store.save()
  }
  return store.config
})

// 启动游戏前用同步 IPC 保存，保证 mod 引擎读到的是最新设置
ipcMain.on('set-mod-config-sync', (event, patch) => {
  const store = GetModConfigStore(path.join(appDataDir, 'config'))
  if (patch && typeof patch === 'object') {
    for (const key of Object.keys(patch)) {
      if (Object.prototype.hasOwnProperty.call(store.config, key)) {
        ;(store.config as any)[key] = patch[key]
      }
    }
    store.save()
  }
  event.returnValue = true
})

// 加载资源包 / 扩展 / 工具（被安全软件拦截时不要让主进程崩溃）
try {
  LoadResourcePack()
} catch (error) {
  Logger.error(`加载资源包失败: ${error}`)
}
try {
  LoadExtension()
} catch (error) {
  Logger.error(`加载扩展失败: ${error}`)
}
try {
  LoadTool()
} catch (error) {
  Logger.error(`加载工具失败: ${error}`)
}

// 代理设置
// 游戏流量由应用自己启动的中间人代理接管（见 src/majsoul），
// 这里仅保留用户手动指定的额外代理配置。
if (UserConfigs.chromium.proxyUrl !== '') {
  if (UserConfigs.chromium.proxyUrl !== 'system-proxy') {
    app.commandLine.appendSwitch('proxy-server', UserConfigs.chromium.proxyUrl)
  }
}

// 禁用/启用进程内 GPU 处理
if (UserConfigs.chromium.isInProcessGpuOn) {
  const osplatform = os.platform()
  switch (osplatform) {
    case 'darwin':
    case 'win32':
      app.commandLine.appendSwitch('in-process-gpu')
      break
    case 'aix':
    case 'android':
    case 'cygwin':
    case 'freebsd':
    case 'openbsd':
    case 'sunos':
    default:
      break
  }
}

// 忽略 GPU 黑名单
if (UserConfigs.chromium.isIgnoreGpuBlacklist) {
  app.commandLine.appendArgument('ignore-gpu-blacklist')
}

// 禁用 / 启用 硬件加速
if (UserConfigs.chromium.isHardwareAccelerationDisable) {
  app.disableHardwareAcceleration()
}

if (os.platform() === 'win32') {
  app.commandLine.appendSwitch('disable-direct-composition')
}

// Disable certificate validation TLS connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// 允许不安全的 localhost（中间人代理使用自签名证书）
app.commandLine.appendSwitch('ignore-certificate-errors', 'true')
app.commandLine.appendSwitch('allow-insecure-localhost', 'true')

// 允许自动播放音视频
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// 当全部窗口退出后，结束进程
app.on('window-all-closed', app.quit)

// 中间人代理会使用本地 CA 动态签发证书，这里放行雀魂相关域名的证书错误
app.on(
  'certificate-error',
  (event, webContents, url, error, certificate, callback) => {
    if (/(^|\.)(maj-soul\.com|mahjongsoul\.com|majsoul\.com|yo-star\.com|catmjstudio\.com)/i.test(url)) {
      event.preventDefault()
      callback(true)
      return
    }
    callback(false)
  }
)

app.requestSingleInstanceLock()
app.on('second-instance', (event, argv, directory) => {
  if (ManagerWindow && !ManagerWindow.isDestroyed()) {
    // ManagerWindow Mode
    if (argv.length > 2 + Number(process.env.NODE_ENV === 'development')) {
      const upath = path.resolve(
        process.argv[1 + Number(process.env.NODE_ENV === 'development')]
      )
      openFile.setPath(upath)
      openFile.register()
      ManagerWindow.webContents.send('refresh-all')
    }
  } else {
    // GameWindow Mode
    if (argv.length > 2 + Number(process.env.NODE_ENV === 'development')) {
      dialog.showMessageBox(AudioPlayer, {
        type: 'info',
        title: i18n.text.main.programName(),
        // TODO: i18n
        message: '游戏界面中无法导入雀魂 Plus 拓展!',
        buttons: ['OK']
      })
    }
  }
})

app.on('will-finish-launching', () => {
  // macOS open-file
  app.on('open-file', (event, path) => {
    event.preventDefault()
    openFile.setPath(path)
    openFile.register()
  })
})

app.on('ready', () => {
  // 初始化游戏窗口
  initGameWindow()

  // 资源管理器通知启动游戏
  ipcMain.on('start-game', () => {
    // 资源包贴图变化时先清理游戏缓存，再启动代理
    ensureGameCacheFresh()
      .catch(() => {})
      .then(() => StartMajsoul(Global.ProxyPort))
      .then(port => {
        Global.ProxyPort = port

        if (!process.env.SERVER_ONLY) {
          GameWindows.newWindow()
        } else {
          // 通过 audioPlayer 窗口阻止程序退出
          initPlayer()
        }

        if (ManagerWindow && !ManagerWindow.isDestroyed()) {
          ManagerWindow.close()
        }
      })
      .catch(error => {
        Logger.error(`启动中间人代理失败: ${error}`)
        dialog.showErrorBox(
          '启动失败',
          `无法启动本地代理服务：${error && (error as Error).message}`
        )
      })
  })

  bossKey.register() // 注册老板键功能
  screenshot.register() // 注册截图功能
  sandbox.register() // 注册工具窗口的沙盒功能

  if (process.platform !== 'darwin') {
    openFile.register() // 注册文件打开导入拓展功能
  }

  // 初始化扩展资源管理器窗口
  initManagerWindow()
  initToolManager()

  // 预生成资源索引，缩短启动游戏后的等待
  try {
    PrepareMajsoul()
  } catch (error) {
    Logger.error(`预生成资源索引失败: ${error}`)
  }

  // 渲染进程无法直接使用 app / dialog，这里提供同步 IPC
  ipcMain.on('get-app-version', event => {
    event.returnValue = app.getVersion()
  })
  ipcMain.handle('show-open-dialog', (event, options) =>
    ManagerWindow && !ManagerWindow.isDestroyed()
      ? dialog.showOpenDialog(ManagerWindow, options)
      : dialog.showOpenDialog(options)
  )
  ipcMain.handle('show-save-dialog', (event, options) =>
    ManagerWindow && !ManagerWindow.isDestroyed()
      ? dialog.showSaveDialog(ManagerWindow, options)
      : dialog.showSaveDialog(options)
  )
})

// 监听 GPU 进程崩溃事件
app.on('child-process-gone', (event, details) => {
  if (details.type === 'GPU') {
    Logger.error(`gpu-process-crashed: ${details.reason}`)
  }
})

// 退出前关闭本地代理
app.on('before-quit', () => {
  try {
    StopMajsoul()
  } catch {}
})

// uncaught exception
process.on('uncaughtException', err => {
  Logger.error(`uncaughtException ${err.name}: ${err.message}`)
})

// 未处理的 Promise 拒绝不应导致进程静默退出
process.on('unhandledRejection', reason => {
  Logger.error(`unhandledRejection: ${reason}`)
})
