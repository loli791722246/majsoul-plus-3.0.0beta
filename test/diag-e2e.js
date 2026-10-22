/* eslint-disable */
// 验证主进程自动收集 text-diag.json
const { app, session, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')
const { collectTextDiagnostics } = require('../dist/majsoul/diagnostics')

app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('disable-direct-composition')

setTimeout(() => app.exit(2), 180000).unref()

async function main() {
  await app.whenReady()
  InitGlobal()

  const userData = app.getPath('userData')
  const packDir = path.join(userData, 'resourcepack', 'text_pack')
  fs.mkdirSync(path.join(packDir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(packDir, 'resourcepack.json'),
    JSON.stringify({
      id: 'text_pack',
      version: '1.0.0',
      name: '文本测试',
      replace: [],
      assets: [],
      text: [
        { from: '正在初始化遊戲資源', to: '正在加载自定义资源' },
        { from: '一姬', to: '泠鸢' }
      ],
      probe: ['一姬', '语音', '雀魂']
    })
  )
  fs.writeFileSync(
    path.join(userData, 'resourcepack', 'active.json'),
    JSON.stringify(['text_pack'])
  )

  LoadResourcePack()
  const port = await StartMajsoul(0)
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
  win.loadURL('https://game.maj-soul.com/1/').catch(() => {})

  await new Promise(resolve => setTimeout(resolve, 60000))

  const file = await collectTextDiagnostics()
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  console.log(
    '[diag] heap=',
    JSON.stringify(data.heap),
    'rules=',
    JSON.stringify(data.rules),
    'probes=',
    Object.keys(data.probes || {})
  )
  console.log(
    '[diag] probe samples',
    JSON.stringify(
      Object.fromEntries(
        Object.entries(data.probes || {}).map(([k, v]) => [k, v.slice(0, 3)])
      )
    )
  )

  win.destroy()
  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[diag] fatal', error)
  app.exit(1)
})
