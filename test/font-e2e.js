/* eslint-disable */
const { app, session, net } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')

const OUT = path.join(__dirname, '..', 'test-output')
fs.mkdirSync(OUT, { recursive: true })

setTimeout(() => app.exit(2), 180000).unref()

async function main() {
  await app.whenReady()
  InitGlobal()

  const userData = app.getPath('userData')
  const packDir = path.join(userData, 'resourcepack', 'font_pack')
  fs.mkdirSync(path.join(packDir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(packDir, 'resourcepack.json'),
    JSON.stringify({
      id: 'font_pack',
      version: '1.0.0',
      replace: [],
      assets: [],
      text: [{ from: '一姬', to: '泠鸢' }]
    })
  )
  fs.writeFileSync(
    path.join(userData, 'resourcepack', 'active.json'),
    JSON.stringify(['font_pack'])
  )

  LoadResourcePack()
  const port = await StartMajsoul(0)
  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  await new Promise(resolve => setTimeout(resolve, 25000))

  const bundle =
    'w66--ttv17fzz1r_b84573722da354b271ec.majset'
  const url = 'https://game.maj-soul.com/assetbundles/DXT/' + bundle
  const result = await new Promise(resolve => {
    const request = net.request({ url })
    const chunks = []
    let status = 0
    request.on('response', response => {
      status = response.statusCode
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () =>
        resolve({ status, body: Buffer.concat(chunks) })
      )
    })
    request.on('error', error => resolve({ status: -1, error: error.message }))
    request.end()
  })

  if (result.body) {
    fs.writeFileSync(path.join(OUT, 'font.bundle'), result.body)
  }
  console.log('[font]', JSON.stringify({ status: result.status, size: result.body ? result.body.length : 0 }))

  StopMajsoul()
  app.quit()
  process.exitCode = result.status === 200 ? 0 : 1
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[font] fatal', error)
  app.exit(1)
})
