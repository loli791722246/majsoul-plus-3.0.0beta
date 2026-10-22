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

function request(url) {
  return new Promise(resolve => {
    const req = net.request({ url })
    const chunks = []
    let status = 0
    req.on('response', response => {
      status = response.statusCode
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status, body: Buffer.concat(chunks) }))
    })
    req.on('error', error => resolve({ status: -1, error: error.message }))
    req.end()
  })
}

async function main() {
  await app.whenReady()
  InitGlobal()

  const userData = app.getPath('userData')
  const packDir = path.join(userData, 'resourcepack', 'long_pack')
  fs.mkdirSync(path.join(packDir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(packDir, 'resourcepack.json'),
    JSON.stringify({
      id: 'long_pack',
      version: '1.0.0',
      replace: [],
      assets: [],
      text: [{ from: '一姬', to: '橘爱丽丝' }]
    })
  )
  fs.writeFileSync(
    path.join(userData, 'resourcepack', 'active.json'),
    JSON.stringify(['long_pack'])
  )

  LoadResourcePack()
  const rp = require('../dist/resourcepack/resourcepack')
  const rules = rp.ResourcePackManager.getTextReplacements()
  console.log('[long] rules', JSON.stringify(rules))
  const { planLongText } = require('../dist/majsoul/text-long')
  console.log('[long] plan', JSON.stringify(planLongText(rules)))
  const port = await StartMajsoul(0)
  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  await new Promise(resolve => setTimeout(resolve, 25000))

  const bundle = 'w66--ttv17fzz1r_f545382acc7eb8a89ad8.majset'
  const result = await request('https://game.maj-soul.com/assetbundles/DXT/' + bundle)
  fs.writeFileSync(path.join(OUT, 'long-font.bundle'), result.body || Buffer.alloc(0))
  console.log('[long]', JSON.stringify({ status: result.status, size: result.body ? result.body.length : 0 }))

  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[long] fatal', error)
  app.exit(1)
})
