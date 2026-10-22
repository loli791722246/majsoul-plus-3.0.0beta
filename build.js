const fs = require('fs')
const path = require('path')

const dest = path.resolve('./dist/')

// 移除包含 exports 的第二行（sandbox-preload 需要以脚本形式运行）
function simpleBrowserify(dir) {
  const file = path.resolve(dest, dir)
  try {
    const data = fs.readFileSync(file, { encoding: 'utf-8' })
    const lines = data.split('\n')
    lines.splice(1, 1)
    fs.writeFileSync(file, lines.join('\n'), { encoding: 'utf-8' })
  } catch (error) {
    console.error(error)
  }
}

function copy(from, to = from) {
  const srcRoot = path.resolve('./', from)
  const dstRoot = path.resolve(dest, to)
  fs.mkdirSync(dstRoot, { recursive: true })
  for (const entry of fs.readdirSync(srcRoot)) {
    fs.cpSync(path.join(srcRoot, entry), path.join(dstRoot, entry), {
      recursive: true
    })
  }
}

// 复制静态资源
copy('assets', '.')
copy('i18n')
copy('resourcepack', 'bin/resourcepack')
copy('extension', 'bin/extension')
copy('tool', 'bin/tool')

// 桌布生成工具的字体
for (const font of ['SourceHanSansCN-Light.otf', 'SourceHanSansCN-Normal.otf']) {
  const from = path.resolve('./assets/manager/fonts', font)
  const to = path.resolve(dest, 'bin/tool/desktopCreator', font)
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  } catch (error) {
    console.error(error)
  }
}

simpleBrowserify('windows/sandbox-preload.js')
