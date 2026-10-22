/* eslint-disable */
// 文本替换注入端到端测试：请求游戏首页，检查注入脚本
const { app, session, net } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')

app.commandLine.appendSwitch('ignore-certificate-errors')

setTimeout(() => app.exit(2), 60000).unref()

function get(url) {
  return new Promise(resolve => {
    const request = net.request({ url })
    const chunks = []
    let status = 0
    request.on('response', response => {
      status = response.statusCode
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status, body: Buffer.concat(chunks) }))
    })
    request.on('error', error => resolve({ status: -1, error: error.message }))
    request.end()
  })
}

function post(url, body) {
  return new Promise(resolve => {
    const request = net.request({ url, method: 'POST' })
    const chunks = []
    let status = 0
    request.on('response', response => {
      status = response.statusCode
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status, body: Buffer.concat(chunks) }))
    })
    request.on('error', error => resolve({ status: -1, error: error.message }))
    request.setHeader('Content-Type', 'application/json')
    request.write(body)
    request.end()
  })
}

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
        { from: '获得语音', to: '取得语音' },
        { from: '一姬', to: '泠鸢' }
      ],
      probe: ['一姬']
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

  const page = await get('https://game.maj-soul.com/1/')
  const html = page.body ? page.body.toString('utf-8') : ''

  const diagPayload = JSON.stringify({
    heap: { available: true, size: 1 },
    rules: [{ from: '一姬', matches: 3 }],
    probes: { 一姬: ['一姬', '一姬的契约者'] }
  })
  const diagResponse = await post(
    'https://game.maj-soul.com/majsoul_plus/text-diag',
    diagPayload
  )
  const diagFile = path.join(userData, 'text-diag.json')
  const diagSaved =
    fs.existsSync(diagFile) &&
    fs.readFileSync(diagFile, 'utf-8').includes('一姬的契约者')

  const checks = {
    status: page.status,
    hasScript: html.includes('HEAPU8'),
    hasMap: html.includes('获得语音') && html.includes('取得语音'),
    hasTitle: html.includes('<title>'),
    diagStatus: diagResponse.status,
    diagSaved
  }
  console.log('[text]', JSON.stringify(checks))
  StopMajsoul()
  app.quit()
  process.exitCode =
    checks.status === 200 &&
    checks.hasScript &&
    checks.hasMap &&
    checks.diagSaved
      ? 0
      : 1
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[text] fatal', error)
  app.exit(1)
})
