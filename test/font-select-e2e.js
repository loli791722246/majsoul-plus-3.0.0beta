/* eslint-disable */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const userData = app.getPath('userData')
const fontsDir = path.join(userData, 'fonts')
fs.mkdirSync(fontsDir, { recursive: true })
try {
  fs.copyFileSync('C:/Windows/Fonts/SIMYOU.TTF', path.join(fontsDir, 'MyFont.ttf'))
} catch (error) {
  console.log('[fontsel] copy font failed', error.message)
}

require('../dist/index')

setTimeout(() => app.exit(2), 60000).unref()

app.whenReady().then(async () => {
  await new Promise(resolve => setTimeout(resolve, 5000))
  const manager = BrowserWindow.getAllWindows().find(window =>
    window.getURL().includes('/manager/index.html')
  )
  if (!manager) {
    console.log('[fontsel] no manager')
    app.exit(1)
    return
  }

  await manager.webContents.executeJavaScript(
    `document.querySelector('li[data-target="settingPage"]').click()`
  )
  await new Promise(resolve => setTimeout(resolve, 1500))

  const options = await manager.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('#font-source option')).map(o => [o.value, o.textContent])`
  )
  console.log('[fontsel] options', JSON.stringify(options))

  const custom = options.find(item => String(item[1]).includes('自定义'))[0]
  await manager.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('#font-source');
    select.value = ${JSON.stringify(custom)};
    select.dispatchEvent(new Event('change'));
  })()`)
  await new Promise(resolve => setTimeout(resolve, 800))

  const { UserConfigs } = require('../dist/config')
  console.log(
    '[fontsel] main after change',
    JSON.stringify(UserConfigs.font)
  )

  // 重新打开设置页，确认下拉框保持自定义字体
  await manager.webContents.executeJavaScript(
    `document.querySelector('li[data-target="extensionPage"]').click()`
  )
  await manager.webContents.executeJavaScript(
    `document.querySelector('li[data-target="settingPage"]').click()`
  )
  await new Promise(resolve => setTimeout(resolve, 800))
  const selected = await manager.webContents.executeJavaScript(
    `document.querySelector('#font-source').value`
  )
  console.log('[fontsel] select after reopen', selected)

  app.quit()
})

app.on('window-all-closed', () => {})
