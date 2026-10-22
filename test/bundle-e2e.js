/* eslint-disable */
// 资源替换端到端测试：资源包 -> 自动打补丁 -> 代理下发
const { app, session, net } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')

const OUT_DIR = path.join(__dirname, '..', 'test-output')
fs.mkdirSync(OUT_DIR, { recursive: true })

// 1x1 红色 PNG
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

app.commandLine.appendSwitch('ignore-certificate-errors')

setTimeout(() => {
  console.log('[bundle] global timeout')
  app.exit(2)
}, 180000).unref()

function requestThroughElectron(url) {
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
  const packDir = path.join(userData, 'resourcepack', 'test_pack')
  fs.mkdirSync(path.join(packDir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(packDir, 'resourcepack.json'),
    JSON.stringify(
      {
        id: 'test_pack',
        version: '1.0.0',
        name: '测试资源包',
        replace: [],
        assets: [{ target: 'deco/character/yiji/full', file: 'yiji.png' }]
      },
      null,
      2
    )
  )
  fs.writeFileSync(path.join(packDir, 'assets', 'yiji.png'), RED_PNG)
  fs.writeFileSync(
    path.join(userData, 'resourcepack', 'active.json'),
    JSON.stringify(['test_pack'])
  )

  LoadResourcePack()

  const port = await StartMajsoul(0)
  console.log('[bundle] proxy port', port)

  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  const indexFile = path.join(userData, 'bundles', 'index.json')
  for (let i = 0; i < 90; i++) {
    if (fs.existsSync(indexFile)) {
      try {
        const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'))
        if (index.version) break
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'))
  const bundles = index.groups['deco/character/yiji/full']
  console.log('[bundle] target bundles', bundles)
  if (!bundles || bundles.length === 0) {
    console.log('[bundle] FAIL: 索引里找不到目标分组')
    app.exit(1)
    return
  }

  const url = `https://game.maj-soul.com/assetbundles/DXT/${bundles[0]}`
  console.log('[bundle] requesting', url)
  const started = Date.now()
  const response = await requestThroughElectron(url)
  console.log(
    '[bundle] status',
    response.status,
    'size',
    response.body ? response.body.length : 0,
    'ms',
    Date.now() - started,
    response.error || ''
  )

  if (response.body && response.body.length > 0) {
    const file = path.join(OUT_DIR, 'patched.bundle')
    fs.writeFileSync(file, response.body)
    fs.writeFileSync(path.join(OUT_DIR, 'bundle-name.txt'), bundles[0])
    console.log('[bundle] saved', file)
  }

  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[bundle] fatal', error)
  app.exit(1)
})
