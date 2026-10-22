/* eslint-disable */
// 验证完整游戏窗口：经中间人代理加载雀魂 Unity 页面并截图
const { app, session, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')

const OUT_DIR = path.join(__dirname, '..', 'test-output')
fs.mkdirSync(OUT_DIR, { recursive: true })

app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('disable-direct-composition')

setTimeout(() => {
  console.log('[e2e] global timeout')
  app.exit(2)
}, 90000).unref()

async function main() {
  await app.whenReady()

  const port = await StartMajsoul(0)
  console.log('[e2e] proxy port:', port)

  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  const errors = []
  win.webContents.on('did-fail-load', (event, code, desc, url) =>
    errors.push(`${code} ${desc} ${url}`)
  )
  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) console.log('[page]', message.slice(0, 200))
  })

  console.log('[e2e] loading game page')
  win.loadURL('https://game.maj-soul.com/1/').catch(error => {
    console.log('[e2e] loadURL error:', error.message)
  })

  await new Promise(resolve => setTimeout(resolve, 70000))

  try {
    const info = await win.webContents.executeJavaScript(`(() => ({
      url: location.href,
      title: document.title,
      hasUnity: typeof createUnityInstance === 'function',
      canvas: !!document.querySelector('#unity-canvas'),
      canvasWidth: document.querySelector('#unity-canvas') ? document.querySelector('#unity-canvas').width : 0,
      bodyLength: document.body.innerHTML.length
    }))()`)
    console.log('[e2e] page info:', JSON.stringify(info))
  } catch (error) {
    console.log('[e2e] executeJavaScript error:', error.message)
  }

  const image = await win.webContents.capturePage()
  const png = image.toPNG()
  const screenshot = path.join(OUT_DIR, 'game-window.png')
  fs.writeFileSync(screenshot, png)
  console.log('[e2e] screenshot:', screenshot, png.length, 'bytes')
  console.log('[e2e] load errors:', errors.length ? errors : 'none')

  win.destroy()
  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[e2e] fatal:', error)
  app.exit(1)
})
