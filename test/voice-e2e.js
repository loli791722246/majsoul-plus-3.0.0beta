/* eslint-disable */
// 语音替换端到端测试
const { app, session, net } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')

app.commandLine.appendSwitch('ignore-certificate-errors')

setTimeout(() => {
  console.log('[voice] timeout')
  app.exit(2)
}, 60000).unref()

function get(url) {
  return new Promise(resolve => {
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
}

async function main() {
  await app.whenReady()
  InitGlobal()

  const userData = app.getPath('userData')
  const packDir = path.join(userData, 'resourcepack', 'voice_pack')
  fs.mkdirSync(path.join(packDir, 'assets', 'audio', 'sound', 'yiji', 'lobby'), {
    recursive: true
  })

  fs.writeFileSync(
    path.join(packDir, 'resourcepack.json'),
    JSON.stringify({
      id: 'voice_pack',
      version: '1.0.0',
      name: '语音测试',
      replace: [
        {
          from: 'audio/sound/yiji/act_rich.mp3',
          to: 'audio/legacy.mp3'
        }
      ],
      assets: []
    })
  )
  fs.writeFileSync(path.join(packDir, 'assets', 'audio', 'legacy.mp3'), 'LEGACY-VOICE')
  fs.writeFileSync(
    path.join(packDir, 'assets', 'audio', 'sound', 'yiji', 'lobby', 'lobby_normal1.mp3'),
    'MIRROR-VOICE'
  )
  fs.writeFileSync(
    path.join(userData, 'resourcepack', 'active.json'),
    JSON.stringify(['voice_pack'])
  )

  LoadResourcePack()
  const port = await StartMajsoul(0)
  console.log('[voice] proxy', port)

  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  const base =
    'https://game.maj-soul.com/assetbundles/DXT/Assets/MyAssets/audio/sound/yiji'

  const mirrored = await get(`${base}/lobby/lobby_normal1.mp3`)
  console.log(
    '[voice] mirror:',
    mirrored.status,
    JSON.stringify(mirrored.body && mirrored.body.toString())
  )

  const legacy = await get(`${base}/act_rich.mp3`)
  console.log(
    '[voice] legacy rule:',
    legacy.status,
    JSON.stringify(legacy.body && legacy.body.toString())
  )

  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[voice] fatal', error)
  app.exit(1)
})
