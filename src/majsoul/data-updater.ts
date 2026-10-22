import * as fs from 'fs'
import * as https from 'https'
import * as path from 'path'

const RELEASE_API =
  'https://api.github.com/repos/Avenshy/MajsoulData/releases/latest'
const ASSETS = ['liqi.desc', 'max_data.yaml']

/**
 * 检查并更新 liqi.desc / max_data.yaml。
 *
 * 数据来源与 MajsoulMax 相同：Avenshy/MajsoulData 的 Release。
 * 更新后的文件保存在用户数据目录，下次启动生效。
 */
export async function checkDataUpdate(
  dataDir: string,
  log: (message: string) => void
): Promise<void> {
  const current = readVersion(dataDir)
  const release: any = JSON.parse(await get(RELEASE_API))

  const latest = String(release.tag_name || '')
  if (!latest) return
  if (latest === current) {
    log(`liqi 数据已是最新：${latest}`)
    return
  }

  const assets: any[] = release.assets || []
  const urls = new Map<string, string>()
  for (const name of ASSETS) {
    const asset = assets.find(item => item.name === name)
    if (!asset) {
      log(`数据更新失败：发布页缺少 ${name}`)
      return
    }
    urls.set(name, asset.browser_download_url)
  }

  log(`发现新版本 liqi 数据 ${latest}，正在更新……`)
  const buffers = new Map<string, Buffer>()
  for (const name of ASSETS) {
    buffers.set(name, await getBinary(urls.get(name)))
  }

  fs.mkdirSync(dataDir, { recursive: true })
  for (const name of ASSETS) {
    fs.writeFileSync(path.join(dataDir, name), buffers.get(name))
  }
  fs.writeFileSync(path.join(dataDir, 'version.txt'), latest, 'utf-8')
  log(`liqi 数据已更新到 ${latest}，重新启动游戏后生效`)
}

function readVersion(dataDir: string): string {
  try {
    return fs.readFileSync(path.join(dataDir, 'version.txt'), 'utf-8').trim()
  } catch {
    return ''
  }
}

function get(url: string, redirects = 0): Promise<string> {
  return getBinary(url, redirects).then(buffer => buffer.toString('utf-8'))
}

function getBinary(url: string, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('重定向次数过多'))
      return
    }
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'MajsoulPlus',
          Accept: 'application/vnd.github+json'
        },
        timeout: 20000
      },
      response => {
        const status = response.statusCode || 0
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume()
          resolve(getBinary(response.headers.location, redirects + 1))
          return
        }
        if (status !== 200) {
          response.resume()
          reject(new Error(`HTTP ${status}`))
          return
        }
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks)))
        response.on('error', reject)
      }
    )
    request.on('timeout', () => request.destroy(new Error('请求超时')))
    request.on('error', reject)
  })
}
