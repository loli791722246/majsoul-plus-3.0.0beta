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

  const portrait = await request(
    'https://game.maj-soul.com/assetbundles/DXT/uwv8ssu060e25j9j446ufhh$$-iyqreeg@_bfc3792ff0922c2b07a0.majset'
  )
  const docs = await request(
    'https://game.maj-soul.com/assetbundles/DXT/u6v_ssucaagg002qbdd779z_a9132ada699a5ba469d3.majset'
  )
  const audio = await request(
    'https://game.maj-soul.com/assetbundles/DXT/Assets/MyAssets/audio/sound/yiji/lobby/lobby_normal1.mp3'
  )

  fs.writeFileSync(path.join(OUT, 'arisu-portrait.bundle'), portrait.body || Buffer.alloc(0))
  fs.writeFileSync(path.join(OUT, 'arisu-docs.bundle'), docs.body || Buffer.alloc(0))
  fs.writeFileSync(path.join(OUT, 'arisu-audio.mp3'), audio.body || Buffer.alloc(0))

  const sourceAudio = fs.readFileSync(
    'D:/Dsh_WorkSpace/MajsoulArisu/assets/audio/sound/yiji/lobby/lobby_normal1.mp3'
  )
  console.log(
    '[arisu]',
    JSON.stringify({
      portrait: portrait.status,
      portraitSize: portrait.body ? portrait.body.length : 0,
      docs: docs.status,
      docsSize: docs.body ? docs.body.length : 0,
      audio: audio.status,
      audioSize: audio.body ? audio.body.length : 0,
      audioMatches: audio.body ? audio.body.equals(sourceAudio) : false
    })
  )

  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[arisu] fatal', error)
  app.exit(1)
})
