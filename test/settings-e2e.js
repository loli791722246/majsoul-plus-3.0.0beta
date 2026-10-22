/* eslint-disable */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'test-output')
fs.mkdirSync(OUT, { recursive: true })

// 启动正式主进程（会创建管理器窗口）
require('../dist/index')

setTimeout(() => app.exit(2), 60000).unref()

app.whenReady().then(async () => {
  await new Promise(resolve => setTimeout(resolve, 5000))
  const windows = BrowserWindow.getAllWindows()
  const manager = windows.find(window =>
    window.getURL().includes('/manager/index.html')
  )
  if (!manager) {
    console.log('[settings] manager window not found')
    app.exit(1)
    return
  }

  await manager.webContents.executeJavaScript(
    `document.querySelector('li[data-target="settingPage"]').click()`
  )
  await new Promise(resolve => setTimeout(resolve, 1500))

  const info = await manager.webContents.executeJavaScript(`(() => {
    const text = (document.querySelector('#setting-inner') || {}).innerText || '';
    return {
      fontSelect: !!document.querySelector('#font-source'),
      fontOptions: Array.from(document.querySelectorAll('#font-source option')).map(o => o.value),
      scaleInput: !!document.querySelector('#font-scale'),
      unlockCharacters: !!document.querySelector('#mod-unlock_characters'),
      unlockViews: !!document.querySelector('#mod-unlock_views'),
      text: text.slice(-300)
    };
  })()`)
  console.log('[settings]', JSON.stringify(info))

  await manager.webContents.executeJavaScript(
    `document.querySelector('#setting-inner').scrollTop = 99999`
  )
  await new Promise(resolve => setTimeout(resolve, 500))
  let image = await manager.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, 'settings-page-bottom.png'), image.toPNG())

  await manager.webContents.executeJavaScript(`(() => {
    window.alert = () => {};
    const select = document.querySelector('#font-source');
    select.value = 'kaiti';
    select.dispatchEvent(new Event('change'));
    const scale = document.querySelector('#font-scale');
    scale.value = '1.05';
    scale.dispatchEvent(new Event('change'));
    const checkbox = document.querySelector('#mod-unlock_characters');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    document.querySelector('#save-configs').click();
  })()`)
  await new Promise(resolve => setTimeout(resolve, 1500))

  const userData = app.getPath('userData')
  const configFile = path.join(userData, 'user-config.json')
  const modFile = path.join(userData, 'config', 'settings.mod.yaml')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
  const mod = fs.readFileSync(modFile, 'utf-8')
  console.log(
    '[settings] saved font',
    JSON.stringify(config.font),
    'mod has unlock_characters:false',
    /unlock_characters:\s*false/.test(mod)
  )

  app.quit()
})

app.on('window-all-closed', () => {})
