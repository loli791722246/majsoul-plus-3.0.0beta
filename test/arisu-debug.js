/* eslint-disable */
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const rp = require('../dist/resourcepack/resourcepack')
const { LoadResourcePack } = rp
const { BundlePatcher } = require('../dist/bundles/patcher')

setTimeout(() => app.exit(2), 90000).unref()

app.whenReady().then(async () => {
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

  const reps = rp.ResourcePackManager.getAssetReplacements()
  console.log('[dbg] appDataDir', require('../dist/global').appDataDir)
  console.log('[dbg] details', JSON.stringify(rp.ResourcePackManager.getDetails()).slice(0, 500))
  console.log('[dbg] reps', reps.length)
  console.log(
    '[dbg] docs reps',
    JSON.stringify(reps.filter(item => String(item.target).includes('docs')))
  )

  const patcher = new BundlePatcher(
    path.resolve(__dirname, '..', 'runtime/patcher-bin/patcher/patcher.exe'),
    null,
    userData,
    (level, message) => console.log('[dbg]', level, message)
  )
  patcher.ensureIndex()
  await new Promise(resolve => setTimeout(resolve, 20000))
  const bundle = 'u6v_ssucaagg002qbdd779z_a9132ada699a5ba469d3.majset'
  const index = patcher.ensureIndex()
  console.log('[dbg] index', !!index)
  const matched = patcher.match(bundle, reps)
  console.log('[dbg] matched', JSON.stringify(matched))
  app.quit()
})
