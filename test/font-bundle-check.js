/* eslint-disable */
const { app } = require('electron')
const path = require('path')
const { BundlePatcher } = require('../dist/bundles/patcher')

setTimeout(() => app.exit(2), 60000).unref()

app.whenReady().then(async () => {
  const patcher = new BundlePatcher(
    path.resolve(__dirname, '..', 'runtime/patcher-bin/patcher/patcher.exe'),
    null,
    app.getPath('userData'),
    (level, message) => console.log('[check]', level, message)
  )
  patcher.ensureIndex()
  await new Promise(resolve => setTimeout(resolve, 20000))
  console.log('[check] index', !!patcher.ensureIndex())
  for (const bundle of [
    'w66--ttv17fzz1r_b84573722da354b271ec.majset',
    'uwv8ssu060e25j9j446ufhh$$-iyqreeg@_bfc3792ff0922c2b07a0.majset'
  ]) {
    console.log('[check] isFont', bundle, patcher.isFontBundle(bundle))
  }
  app.quit()
})
