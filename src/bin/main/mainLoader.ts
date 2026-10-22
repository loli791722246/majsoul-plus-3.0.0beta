import { ipcRenderer, webContents as electronWebContents } from 'electron'
import { pathToFileURL } from 'url'
import i18n from '../../i18n'
import Global from '../../manager/global'
import { MajsoulPlus } from '../../majsoul_plus'

const userConfigs: MajsoulPlus.UserConfig = require(Global.UserConfigPath)

const mainWindow: Electron.WebviewTag = document.querySelector('#mainWindow')
const mainWindowBox: HTMLDivElement = document.querySelector('#mainWindowBox')
const scalePercent = userConfigs.window.renderingMultiple

let webContents: Electron.WebContents

let screenshotCounter = 0
let screenshotTimer: NodeJS.Timeout
function showScreenshotLabel(src: string) {
  const image = document.querySelector('#screenshotImage') as HTMLImageElement
  image.src = src

  const text = document.querySelector('#screenshotText') as HTMLParagraphElement
  text.innerText = screenshotCounter++
    ? i18n.text.main.screenshotsSaved(String(screenshotCounter))
    : i18n.text.main.screenshotSaved()

  const label = document.querySelector('#screenshotLabel') as HTMLDivElement
  label.classList.remove('hide')
  label.classList.add('show')

  clearTimeout(screenshotTimer)
  screenshotTimer = setTimeout(() => {
    label.classList.remove('show')
    clearTimeout(screenshotTimer)
    screenshotTimer = setTimeout(() => {
      label.classList.add('hide')
      screenshotCounter = 0
    }, 300)
  }, 8000)
}

ipcRenderer.on(
  'take-screenshot',
  (event, index: number, scaleFactor: number) => {
    if (webContents) {
      webContents
        .capturePage({
          x: 0,
          y: 0,
          width: Math.floor(mainWindow.clientWidth * scaleFactor),
          height: Math.floor(mainWindow.clientHeight * scaleFactor)
        })
        .then(image => {
          ipcRenderer.send('save-screenshot', index, image.toPNG())
        })
    }
  }
)

ipcRenderer.on('screenshot-saved', (event, filePath: string) => {
  showScreenshotLabel(pathToFileURL(filePath).toString())
})

ipcRenderer.on('open-devtools', () => {
  if (webContents) {
    mainWindow.openDevTools()
  }
})

ipcRenderer.on('set-audio-muted', (event, bool: boolean) => {
  if (webContents) {
    mainWindow.setAudioMuted(bool)
  }
})

function isGameUrl(url: string) {
  return /^https?:\/\/([^/]*\.)?(maj-soul\.com|mahjongsoul\.com|majsoul\.com|yo-star\.com|catmjstudio\.com)/i.test(
    url
  )
}

function scaleWindow(percent = scalePercent) {
  mainWindowBox.style.width = `${percent}vw`
  mainWindowBox.style.height = `${percent}vh`
  mainWindowBox.style.transform = `scale(${100 / percent}) translate(${(100 -
    percent) /
    2}%, ${(100 - percent) / 2}%)`
}

mainWindow.addEventListener('dom-ready', () => {
  if (!webContents) {
    webContents = electronWebContents.fromId(mainWindow.getWebContentsId())
    webContents.zoomFactor = 1

    if (process.env.NODE_ENV === 'development') {
      mainWindow.openDevTools()
    }
  }

  if (isGameUrl(mainWindow.src)) {
    scaleWindow(scalePercent)
    try {
      mainWindow.insertCSS('body{overflow:hidden;}')
    } catch (error) {
      console.error(error)
    }
  } else {
    scaleWindow(100)
  }

  try {
    mainWindow.setUserAgent(navigator.userAgent)
  } catch {}
})

ipcRenderer.on(
  'load-url',
  (event, url: string, port: number, http: boolean, partition?: string) => {
    console.log('[Majsoul Plus] LoadURL', { url, port, http })

    if (partition) {
      mainWindow.partition = partition
    }
    mainWindow.src = url
    mainWindowBox.style.width = '100vw'
    mainWindowBox.style.height = '100vh'
    mainWindowBox.style.transform = 'none'
  }
)
