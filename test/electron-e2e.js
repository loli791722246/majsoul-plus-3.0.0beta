/* eslint-disable */
// Electron 端到端测试：验证 Electron 网络栈可以经由本地中间人代理由 HTTPS 访问雀魂
const { app, session, net } = require('electron')
const fs = require('fs')
const path = require('path')

const { StartMajsoul, StopMajsoul, GetMajsoul } = require('../dist/majsoul')

const OUT_DIR = path.join(__dirname, '..', 'test-output')
fs.mkdirSync(OUT_DIR, { recursive: true })

app.commandLine.appendSwitch('ignore-certificate-errors')
app.disableHardwareAcceleration()

setTimeout(() => {
  console.log('[e2e] global timeout')
  app.exit(2)
}, 60000).unref()

function requestThroughElectron(url) {
  return new Promise(resolve => {
    const request = net.request({ url, useSessionCookies: false })
    const chunks = []
    let status = 0
    request.on('response', response => {
      status = response.statusCode
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () =>
        resolve({
          status,
          body: Buffer.concat(chunks),
          headers: response.headers
        })
      )
    })
    request.on('error', error => resolve({ status: -1, error: error.message }))
    request.end()
  })
}

async function main() {
  await app.whenReady()

  const port = await StartMajsoul(0)
  console.log('[e2e] proxy port:', port)
  console.log('[e2e] status:', JSON.stringify(GetMajsoul().status))

  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  const page = await requestThroughElectron('https://game.maj-soul.com/1/')
  console.log(
    '[e2e] page:',
    page.status,
    page.body ? page.body.length : 0,
    page.error || ''
  )
  if (page.body) {
    const html = page.body.toString('utf-8')
    console.log('[e2e] title:', /<title>(.*?)<\/title>/.exec(html)?.[1])
    console.log(
      '[e2e] has unity loader:',
      html.includes('createUnityInstance')
    )
    fs.writeFileSync(path.join(OUT_DIR, 'page.html'), page.body)
  }

  const version = await requestThroughElectron(
    'https://game.maj-soul.com/1/version.json'
  )
  console.log(
    '[e2e] version.json:',
    version.status,
    version.body ? version.body.toString('utf-8').slice(0, 100) : version.error
  )

  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[e2e] fatal:', error)
  app.exit(1)
})
