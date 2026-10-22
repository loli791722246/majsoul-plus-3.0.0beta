/* eslint-disable */
// 验证主进程注入文本替换脚本（不依赖 HTML 注入）
const { app, session, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')
const {
  findGameContents,
  injectTextReplacer
} = require('../dist/majsoul/text-inject')

app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('disable-direct-composition')

setTimeout(() => app.exit(2), 180000).unref()

async function main() {
  await app.whenReady()
  InitGlobal()

  const userData = app.getPath('userData')
  const packDir = path.join(userData, 'resourcepack', 'text_pack')
  fs.mkdirSync(path.join(packDir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(packDir, 'resourcepack.json'),
    JSON.stringify({
      id: 'text_pack',
      version: '1.0.0',
      name: '文本测试',
      replace: [],
      assets: [],
      text: [
        { from: '正在初始化遊戲資源', to: '正在加载自定义资源' },
        { from: '一姬', to: '泠鸢' }
      ],
      probe: ['一姬']
    })
  )
  fs.writeFileSync(
    path.join(userData, 'resourcepack', 'active.json'),
    JSON.stringify(['text_pack'])
  )

  LoadResourcePack()
  const port = await StartMajsoul(0)
  const gameSession = session.defaultSession
  await gameSession.setProxy({
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`
  })
  gameSession.setCertificateVerifyProc((request, callback) => callback(0))

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  win.loadURL('https://game.maj-soul.com/1/').catch(() => {})

  await new Promise(resolve => setTimeout(resolve, 45000))

  const target = findGameContents()
  console.log('[inject] found page:', target ? target.getURL() : 'none')
  if (target) {
    injectTextReplacer(target)
    await new Promise(resolve => setTimeout(resolve, 1500))
    target
      .executeJavaScript('window.__majsoulPlusScan && window.__majsoulPlusScan()', true)
      .catch(() => {})
  }

  await new Promise(resolve => setTimeout(resolve, 20000))

  try {
    const info = await win.webContents.executeJavaScript(`(() => {
      const out = { heap: false };
      try {
        const m = unityInstance && unityInstance.Module;
        const h = m && (m.HEAPU8 || (m.asm && m.asm.HEAPU8));
        if (!h) return out;
        out.heap = true;
        const enc = new TextEncoder();
        function count(s) {
          const p = enc.encode(s);
          let c = 0, pos = 0;
          while (true) {
            pos = h.indexOf(p[0], pos);
            if (pos < 0) break;
            let ok = true;
            for (let j = 1; j < p.length; j++) { if (h[pos + j] !== p[j]) { ok = false; break; } }
            if (ok) { c++; pos += p.length; } else pos += 1;
          }
          return c;
        }
        out.loadingOld = count('正在初始化遊戲資源');
        out.loadingNew = count('正在加载自定义资源');
        out.yiji = count('一姬');
        out.lingyuan = count('泠鸢');
        return out;
      } catch (e) { out.error = String(e); return out; }
    })()`)
    console.log('[inject] result', JSON.stringify(info))
  } catch (error) {
    console.log('[inject] eval error', error.message)
  }

  win.destroy()
  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[inject] fatal', error)
  app.exit(1)
})
