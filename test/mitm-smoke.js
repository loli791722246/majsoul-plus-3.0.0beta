/* eslint-disable */
// 中间人代理 / mod 引擎的冒烟测试（不依赖 Electron）
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const tls = require('tls')
const https = require('https')
const { WebSocket, WebSocketServer } = require('ws')

const { CertificateAuthority } = require('../dist/mitm/certificate')
const { MitmProxy } = require('../dist/mitm/proxy')
const { Liqi, MsgType } = require('../dist/mod/liqi')
const { ModEngine } = require('../dist/mod/engine')
const { ModConfigStore } = require('../dist/mod/settings')
const { loadMaxData } = require('../dist/mod/data')

const dataDir = path.join(__dirname, '..', 'dist', 'data')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majsoul-plus-test-'))

let failures = 0
function check(name, condition, extra) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}${extra !== undefined ? ' -> ' + extra : ''}`)
  }
}

function requestThroughProxy(proxyPort, host, requestPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () => {
      socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`)
    })
    let buffer = Buffer.alloc(0)
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk])
      const index = buffer.indexOf('\r\n\r\n')
      if (index < 0) return
      socket.removeListener('data', onData)
      const head = buffer.subarray(0, index).toString()
      if (!head.startsWith('HTTP/1.1 200')) {
        reject(new Error(head))
        return
      }
      const tlsSocket = tls.connect(
        { socket, servername: host, rejectUnauthorized: false },
        () => {
          tlsSocket.write(
            `GET ${requestPath} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nAccept-Encoding: gzip, br\r\n\r\n`
          )
        }
      )
      const chunks = []
      tlsSocket.on('data', chunk => chunks.push(chunk))
      tlsSocket.on('end', () => resolve(Buffer.concat(chunks)))
      tlsSocket.on('error', reject)
    }
    socket.on('data', onData)
    socket.on('error', reject)
    socket.setTimeout(20000, () => reject(new Error('timeout')))
  })
}

function parseResponse(buffer) {
  const index = buffer.indexOf('\r\n\r\n')
  const head = buffer.subarray(0, index).toString()
  const body = buffer.subarray(index + 4)
  const lines = head.split('\r\n')
  return { status: Number(lines[0].split(' ')[1]), body }
}

async function testProtobuf() {
  console.log('\n[1] protobuf / mod 引擎')
  const liqi = Liqi.load(path.join(dataDir, 'liqi.desc'))
  const store = new ModConfigStore(path.join(tmpDir, 'config'))
  const maxData = loadMaxData(path.join(dataDir, 'max_data.yaml'), console.log)
  const engine = new ModEngine(
    liqi,
    store,
    maxData,
    (level, message) => {
      if (level === 'error') console.log('    engine error:', message)
    },
    '3.0.0-test'
  )
  console.log(
    '    角色:',
    maxData.character.length,
    '皮肤:',
    maxData.skin.length,
    '称号:',
    maxData.title.length
  )
  check('liqi 载入', liqi.rpc.size > 100, `rpc=${liqi.rpc.size}`)

  // 先构造一个 login 请求，让引擎记住 msg id 5 对应 ResLogin
  const reqFrame = liqi.encodeFrame(
    MsgType.Req,
    5,
    '.lq.Lobby.login',
    Buffer.alloc(0)
  )
  check('空 login 请求不修改', !engine.onClientMessage(reqFrame, true))

  const resType = liqi.lookup('lq.ResLogin')
  const resPayload = resType
    .encode(
      resType.create({
        account_id: 1234567,
        account: {
          account_id: 1234567,
          nickname: '测试',
          avatar_id: 0,
          title: 0
        }
      })
    )
    .finish()
  const resResult = engine.onServerMessage(
    liqi.encodeFrame(MsgType.Res, 5, '', resPayload),
    false
  )
  check('login 响应被修改', !!resResult && !!resResult.data)
  if (resResult && resResult.data) {
    const base = liqi.baseMessage.decode(resResult.data.subarray(3))
    const decodedAccount = resType.decode(base.data)
    check('响应 method_name 为空', String(base.method_name || '') === '')
    check('修改后仍可解析', true)
    check(
      '头像被设置为 400101',
      decodedAccount.account.avatar_id === 400101,
      decodedAccount.account.avatar_id
    )
    check(
      '昵称按配置写入',
      decodedAccount.account.nickname === '测试',
      decodedAccount.account.nickname
    )
  }

  const infoReq = liqi.encodeFrame(
    MsgType.Req,
    6,
    '.lq.Lobby.fetchCharacterInfo',
    Buffer.alloc(0)
  )
  engine.onClientMessage(infoReq, true)
  const infoType = liqi.lookup('lq.ResCharacterInfo')
  const infoResult = engine.onServerMessage(
    liqi.encodeFrame(
      MsgType.Res,
      6,
      '',
      infoType
        .encode(
          infoType.create({
            main_character_id: 200001,
            characters: [],
            skins: []
          })
        )
        .finish()
    ),
    false
  )
  const infoDecoded =
    infoResult && infoResult.data
      ? infoType.decode(
          liqi.baseMessage.decode(infoResult.data.subarray(3)).data
        )
      : null
  check(
    'fetchCharacterInfo 解锁全部角色',
    infoDecoded && infoDecoded.characters.length === maxData.character.length,
    infoDecoded && infoDecoded.characters.length
  )
}

async function testHttpProxy(proxy) {
  console.log('\n[2] HTTPS 中间人（CONNECT + 证书签发）')
  let response
  try {
    response = parseResponse(
      await requestThroughProxy(
        proxy.port,
        'game.maj-soul.com',
        '/1/version.json'
      )
    )
  } catch (error) {
    check('通过代理访问 version.json', false, error.message)
    return
  }
  check('状态码 200', response.status === 200, response.status)
  const text = response.body.toString('utf-8')
  check('返回了版本号', /"version"/.test(text), text.slice(0, 80))
}

async function testHtmlInjection(proxy) {
  console.log('\n[3] HTML 注入')
  try {
    const response = parseResponse(
      await requestThroughProxy(proxy.port, 'game.maj-soul.com', '/1/')
    )
    const html = response.body.toString('utf-8')
    check('页面状态 200', response.status === 200)
    check('注入了标记脚本', html.includes('majsoul-plus-injected'))
  } catch (error) {
    check('获取游戏首页', false, error.message)
  }
}

class ProxyAgent extends https.Agent {
  constructor(proxyPort) {
    super({ keepAlive: false })
    this.proxyPort = proxyPort
  }
  createConnection(options, callback) {
    const host = options.host
    const socket = net.connect(this.proxyPort, '127.0.0.1', () => {
      socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`)
    })
    let buffer = Buffer.alloc(0)
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk])
      const index = buffer.indexOf('\r\n\r\n')
      if (index < 0) return
      socket.removeListener('data', onData)
      const tlsSocket = tls.connect(
        { socket, servername: host, rejectUnauthorized: false },
        () => callback(null, tlsSocket)
      )
      tlsSocket.on('error', callback)
    }
    socket.on('data', onData)
    socket.on('error', callback)
  }
}

async function testWebSocketRelay(proxy) {
  console.log('\n[4] WebSocket 中间人转发')

  const echoCa = new CertificateAuthority(path.join(tmpDir, 'echo-ca'))
  echoCa.init()
  const { key, cert } = echoCa.getHostCertificate('127.0.0.1')

  const server = https.createServer({ key, cert })
  const wss = new WebSocketServer({ server })
  wss.on('connection', socket => {
    socket.on('message', (data, isBinary) =>
      socket.send(data, { binary: isBinary })
    )
  })

  let listening = true
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(443, '127.0.0.1', resolve)
  }).catch(() => {
    listening = false
  })
  if (!listening) {
    console.log('    无法监听 443（需要管理员权限），跳过 WebSocket 测试')
    wss.close()
    return
  }
  console.log('    echo wss 服务已监听 127.0.0.1:443')

  try {
    const client = new WebSocket('wss://127.0.0.1:443/', {
      agent: new ProxyAgent(proxy.port),
      rejectUnauthorized: false
    })
    await new Promise((resolve, reject) => {
      client.on('open', resolve)
      client.on('error', reject)
    })

    const received = new Promise((resolve, reject) => {
      client.once('message', data => resolve(data.toString()))
      client.once('error', reject)
    })
    client.send('hello')
    const reply = await received
    check('WebSocket 双向转发正常', reply === 'S:C:hello', reply)
    client.close()
  } catch (error) {
    check('WebSocket 中间人连接', false, error.message)
  } finally {
    wss.close()
    server.close()
  }
}

async function main() {
  const ca = new CertificateAuthority(path.join(tmpDir, 'ca'))
  ca.init()
  check('已生成根证书', fs.existsSync(ca.caCertificatePath), ca.caCertificatePath)

  const proxy = new MitmProxy(ca, {
    handleWebSocket: (host, urlPath) => {
      if (host !== '127.0.0.1') return null
      return {
        onClientMessage: data => ({
          data: Buffer.concat([Buffer.from('C:'), data])
        }),
        onServerMessage: data => ({
          data: Buffer.concat([Buffer.from('S:'), data])
        })
      }
    },
    handleRequest: () => null,
    needsResponseBody: (host, req, headers) =>
      String(headers['content-type'] || '').includes('text/html'),
    transformResponse: (host, req, headers, body) => {
      const html = body.toString('utf-8')
      if (!html.includes('</head>')) return null
      return Buffer.from(
        html.replace(
          '</head>',
          '<script>window.__majsoul_plus_injected="majsoul-plus-injected"</script></head>'
        )
      )
    },
    log: (level, message) => {
      if (level === 'debug') return
      console.log(`    [${level}] ${message}`)
    }
  })

  const port = await proxy.start(0)
  console.log('    代理端口:', port)

  await testProtobuf()
  await testHttpProxy(proxy)
  await testHtmlInjection(proxy)
  await testWebSocketRelay(proxy)

  proxy.stop()
  console.log(`\n结果: ${failures === 0 ? '全部通过' : failures + ' 项失败'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
