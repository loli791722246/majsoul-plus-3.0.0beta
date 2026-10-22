/* eslint-disable */
const { app, session, net } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')

const OUT = path.join(__dirname, '..', 'test-output')
fs.mkdirSync(OUT, { recursive: true })
const INDEX = JSON.parse(fs.readFileSync('D:/Dsh_WorkSpace/scratch/index.json', 'utf-8'))

setTimeout(() => app.exit(2), 240000).unref()

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
  const packDir = path.join(userData, 'resourcepack', 'MajsoulArisu')
  fs.mkdirSync(packDir, { recursive: true })
  fs.cpSync('D:/Dsh_WorkSpace/MajsoulArisu', packDir, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'resourcepack', 'active.json'),
    JSON.stringify(['MajsoulArisu'])
  )

  LoadResourcePack()
  const port = await StartMajsoul(0)
  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  await new Promise(resolve => setTimeout(resolve, 25000))

  const skins = ['yiji', 'yiji_0', 'yiji_SP', 'yiji_haitanpaidui', 'yiji_xinnianchuzhi']
  for (const skin of skins) {
    const group = `deco/character/${skin}/full`
    const bundle = INDEX.groups[group] && INDEX.groups[group][0]
    if (!bundle) {
      console.log('[skins] missing group', group)
      continue
    }
    const result = await request('https://game.maj-soul.com/assetbundles/DXT/' + bundle)
    fs.writeFileSync(path.join(OUT, `skin-${skin}.bundle`), result.body || Buffer.alloc(0))
    console.log('[skins]', skin, result.status, result.body ? result.body.length : 0)
  }

  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[skins] fatal', error)
  app.exit(1)
})
