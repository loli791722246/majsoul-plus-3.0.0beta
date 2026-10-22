/* eslint-disable */
// 验证运行时文本替换在真实 Unity 堆里生效
const { app, session, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const { InitGlobal } = require('../dist/global')
const { LoadResourcePack } = require('../dist/resourcepack/resourcepack')
const { StartMajsoul, StopMajsoul } = require('../dist/majsoul')

const OUT_DIR = path.join(__dirname, '..', 'test-output')
fs.mkdirSync(OUT_DIR, { recursive: true })

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
        { from: '一姬', to: '泠鸢' },
        { from: '正在初始化遊戲資源', to: '正在加载自定义资源' }
      ]
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

  win.loadURL('https://game.maj-soul.com/1/').catch(error => {
    console.log('[text] load error:', error.message)
  })

  await new Promise(resolve => setTimeout(resolve, 60000))

  try {
    const info = await win.webContents.executeJavaScript(`(() => {
      const result = { inst: false, module: false, heap: false };
      try {
        if (typeof unityInstance === 'undefined' || !unityInstance) return result;
        result.inst = true;
        const m = unityInstance.Module;
        result.module = !!m;
        const h = m && (m.HEAPU8 || (m.asm && m.asm.HEAPU8));
        if (!h) return result;
        result.heap = true;
        result.size = h.length;
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
        result.yiji = count('一姬');
        result.lingyuan = count('泠鸢');
        result.loadingOld = count('正在初始化遊戲資源');
        result.loadingNew = count('正在加载自定义资源');
        return result;
      } catch (e) { result.error = String(e); return result; }
    })()`)
    console.log('[text] heap info', JSON.stringify(info))
  } catch (error) {
    console.log('[text] eval error', error.message)
  }

  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT_DIR, 'text-test.png'), image.toPNG())

  win.destroy()
  StopMajsoul()
  app.quit()
}

app.on('window-all-closed', () => {})

main().catch(error => {
  console.error('[text] fatal', error)
  app.exit(1)
})
