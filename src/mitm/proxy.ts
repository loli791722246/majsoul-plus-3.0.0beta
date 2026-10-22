import * as http from 'http'
import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http'
import * as https from 'https'
import * as net from 'net'
import * as tls from 'tls'
import * as zlib from 'zlib'
import { CertificateAuthority } from './certificate'
import { FrameHandler, relayWebSocket } from './websocket'

export interface InterceptedResponse {
  status: number
  headers?: { [key: string]: string }
  body: Buffer
}

export interface MitmHandlers {
  /** 为某个 WebSocket 连接创建报文处理器，返回 null 表示原样透传 */
  handleWebSocket(host: string, path: string): FrameHandler | null
  /** 请求阶段的拦截（例如替换游戏资源），返回 null 表示继续转发 */
  handleRequest(
    host: string,
    req: IncomingMessage
  ):
    | InterceptedResponse
    | Promise<InterceptedResponse | null>
    | null
  /** 是否需要缓冲响应体以便修改（例如向 HTML 注入脚本） */
  needsResponseBody(
    host: string,
    req: IncomingMessage,
    headers: IncomingHttpHeaders
  ): boolean
  /** 修改响应体，返回 null 表示不修改 */
  transformResponse(
    host: string,
    req: IncomingMessage,
    headers: IncomingHttpHeaders,
    body: Buffer
  ): Buffer | null
  /** 上游响应到达时回调（用于诊断日志） */
  onResponse?(host: string, path: string, status: number): void
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void
}

/**
 * 基于 HTTP CONNECT 的本地中间人代理。
 *
 * 与 MajsoulMax 相同：游戏流量经由本代理转发，代理按 SNI 动态签发证书完成
 * TLS 解密，然后对 WebSocket 中的 protobuf 报文进行读写。
 */
export class MitmProxy {
  private proxyServer: http.Server
  private innerServer: http.Server
  private httpAgent: http.Agent
  private httpsAgent: https.Agent
  private started = false
  private sockets: Set<net.Socket> = new Set()

  constructor(
    private readonly ca: CertificateAuthority,
    private readonly handlers: MitmHandlers
  ) {
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 })
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 64,
      rejectUnauthorized: false
    })

    this.innerServer = http.createServer((req, res) => {
      this.onRequest(req, res, hostOf(req), true).catch(error =>
        this.handlers.log('error', `处理请求失败: ${error}`)
      )
    })
    this.innerServer.on('upgrade', (req, socket, head) => {
      const host = hostOf(req)
      if (!host) {
        socket.destroy()
        return
      }
      let handler: FrameHandler | null = null
      try {
        handler = this.handlers.handleWebSocket(host, req.url || '/')
      } catch (error) {
        this.handlers.log('error', `创建 WebSocket 处理器失败: ${error}`)
      }
      if (!handler) {
        relayRaw(req, socket as net.Socket, head, host, this.handlers)
        return
      }
      relayWebSocket(
        req,
        socket as net.Socket,
        head,
        host,
        handler,
        this.handlers.log
      )
    })
    this.innerServer.on('clientError', (error, socket) => {
      try {
        socket.destroy()
      } catch {}
    })

    this.proxyServer = http.createServer((req, res) => {
      let host = ''
      let path = req.url || '/'
      try {
        const url = new URL(req.url || '/')
        host = url.hostname
        path = url.pathname + url.search
      } catch {
        host = hostOf(req)
      }
      ;(req as any).__mitmPath = path
      this.onRequest(req, res, host, false).catch(error =>
        this.handlers.log('error', `处理代理请求失败: ${error}`)
      )
    })

    this.proxyServer.on('connect', (req, socket, head) =>
      this.onConnect(req, socket as net.Socket, head)
    )
    this.proxyServer.on('clientError', (error, socket) => {
      try {
        socket.destroy()
      } catch {}
    })
  }

  get port(): number {
    const address = this.proxyServer.address()
    return typeof address === 'object' && address ? address.port : 0
  }

  start(port: number, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      this.proxyServer.once('error', onError)
      this.proxyServer.listen(port, host, () => {
        this.proxyServer.removeListener('error', onError)
        this.started = true
        const actual = this.port || port
        this.handlers.log('info', `MITM 代理已启动: ${host}:${actual}`)
        resolve(actual)
      })
    })
  }

  stop() {
    if (!this.started) return
    this.started = false
    this.sockets.forEach(socket => socket.destroy())
    this.sockets.clear()
    try {
      this.innerServer.close()
    } catch {}
    try {
      this.proxyServer.close()
    } catch {}
    this.httpAgent.destroy()
    this.httpsAgent.destroy()
  }

  private onConnect(req: IncomingMessage, socket: net.Socket, head: Buffer) {
    const [host, port] = splitHostPort(req.url || '')
    if (!host) {
      socket.destroy()
      return
    }

    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => {
      try {
        socket.destroy()
      } catch {}
    })

    if (port !== 443) {
      // 非 HTTPS 端口直接透传
      const upstream = net.connect(port, host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstream.write(head)
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      this.sockets.add(upstream)
      const cleanup = () => {
        this.sockets.delete(upstream)
        upstream.destroy()
        socket.destroy()
      }
      upstream.on('error', cleanup)
      upstream.on('close', cleanup)
      socket.on('close', cleanup)
      return
    }

    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head && head.length > 0) socket.unshift(head)

    let context: tls.SecureContext
    try {
      context = this.ca.getSecureContext(host)
    } catch (error) {
      this.handlers.log('error', `为 ${host} 签发证书失败: ${error}`)
      socket.destroy()
      return
    }

    const tlsSocket = new tls.TLSSocket(socket, {
      isServer: true,
      secureContext: context,
      ALPNProtocols: ['http/1.1']
    })
    ;(tlsSocket as any).__mitmHost = host
    this.sockets.add(tlsSocket)
    tlsSocket.on('close', () => this.sockets.delete(tlsSocket))
    tlsSocket.on('error', () => {
      try {
        tlsSocket.destroy()
      } catch {}
    })
    this.innerServer.emit('connection', tlsSocket)
  }

  private async onRequest(
    req: IncomingMessage,
    res: ServerResponse,
    host: string,
    secure: boolean
  ) {
    if (!host) {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }

    // 还原 origin-form 路径（绝对地址请求需要去掉协议与域名）
    const path = (req as any).__mitmPath || req.url || '/'

    let replaced: InterceptedResponse | null = null
    try {
      replaced = await this.handlers.handleRequest(host, req)
    } catch (error) {
      this.handlers.log('error', `请求拦截失败 ${host}${path}: ${error}`)
    }
    if (replaced) {
      res.writeHead(replaced.status, {
        ...(replaced.headers || {}),
        'Content-Length': String(replaced.body.length)
      })
      res.end(replaced.body)
      return
    }

    const headers: { [key: string]: any } = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      const lower = name.toLowerCase()
      if (lower === 'proxy-connection' || lower === 'connection') continue
      headers[name] = value
    }
    headers.host = host

    const options: https.RequestOptions = {
      host,
      port: secure ? 443 : 80,
      method: req.method,
      path,
      headers,
      agent: secure ? this.httpsAgent : this.httpAgent,
      rejectUnauthorized: false
    }

    let needBody = false
    const request = (secure ? https : http).request(options, up => {
      try {
        if (this.handlers.onResponse) {
          this.handlers.onResponse(host, path, up.statusCode || 0)
        }
      } catch {}
      try {
        needBody = this.handlers.needsResponseBody(host, req, up.headers)
      } catch (error) {
        this.handlers.log('error', `判断响应内容失败: ${error}`)
      }

      if (!needBody) {
        res.writeHead(up.statusCode || 502, filterHeaders(up.headers))
        up.pipe(res)
        up.on('error', () => res.destroy())
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      const limit = 32 * 1024 * 1024

      up.on('data', chunk => {
        if (!needBody) return
        chunks.push(chunk)
        size += chunk.length
        if (size > limit) {
          needBody = false
          res.writeHead(up.statusCode || 502, filterHeaders(up.headers))
          res.write(Buffer.concat(chunks))
          chunks.length = 0
          up.pipe(res)
        }
      })

      up.on('end', () => {
        if (!needBody) return
        const raw = Buffer.concat(chunks)
        let body: Buffer
        try {
          body = decompress(
            raw,
            String(up.headers['content-encoding'] || '')
          ) as any
        } catch (error) {
          // 无法解压（例如 zstd）时原样返回，保持响应头与内容一致
          res.writeHead(up.statusCode || 502, filterHeaders(up.headers))
          res.end(raw)
          return
        }

        let transformed: Buffer | null = null
        try {
          transformed = this.handlers.transformResponse(
            host,
            req,
            up.headers,
            body
          )
        } catch (error) {
          this.handlers.log('error', `修改响应失败 ${host}${path}: ${error}`)
        }

        if (!transformed) {
          const headers = filterHeaders(up.headers)
          delete headers['content-encoding']
          delete headers['content-length']
          headers['content-length'] = String(body.length)
          res.writeHead(up.statusCode || 502, headers)
          res.end(body)
          return
        }

        const newHeaders = filterHeaders(up.headers)
        delete newHeaders['content-encoding']
        delete newHeaders['content-length']
        delete newHeaders['content-security-policy']
        delete newHeaders['content-security-policy-report-only']
        newHeaders['content-length'] = String(transformed.length)
        res.writeHead(up.statusCode || 502, newHeaders)
        res.end(transformed)
      })

      up.on('error', error => {
        this.handlers.log(
          'error',
          `读取上游响应失败 ${host}${path}: ${error.message}`
        )
        try {
          res.destroy()
        } catch {}
      })
    })

    request.on('error', error => {
      this.handlers.log('error', `请求上游失败 ${host}${path}: ${error.message}`)
      try {
        if (!res.headersSent) res.writeHead(502)
        res.end('Bad Gateway')
      } catch {}
    })

    req.pipe(request)
    req.on('aborted', () => request.destroy())
  }
}

function relayRaw(
  req: IncomingMessage,
  socket: net.Socket,
  head: Buffer,
  host: string,
  handlers: MitmHandlers
) {
  const upstream = tls.connect(
    { host, port: 443, servername: host, rejectUnauthorized: false },
    () => {
      const headers = Object.entries(req.headers)
        .filter(([name]) => name.toLowerCase() !== 'host')
        .map(([name, value]) =>
          Array.isArray(value)
            ? value.map(item => `${name}: ${item}`).join('\r\n')
            : `${name}: ${value}`
        )
        .join('\r\n')
      upstream.write(
        `${req.method} ${req.url} HTTP/1.1\r\nHost: ${host}\r\n${headers}\r\n\r\n`
      )
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    }
  )
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  handlers.log('debug', `WebSocket 透传: ${host}${req.url}`)
}

function hostOf(req: IncomingMessage): string {
  const mitmHost = (req.socket as any).__mitmHost
  if (mitmHost) return mitmHost
  const header = req.headers.host || ''
  return header.split(':')[0]
}

function splitHostPort(value: string): [string, number] {
  const index = value.lastIndexOf(':')
  if (index < 0) return [value, 443]
  return [value.slice(0, index), Number(value.slice(index + 1)) || 443]
}

function filterHeaders(headers: IncomingHttpHeaders) {
  const result: { [key: string]: any } = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (
      lower === 'connection' ||
      lower === 'keep-alive' ||
      lower === 'transfer-encoding' ||
      lower === 'upgrade'
    ) {
      continue
    }
    result[name] = value
  }
  return result
}

function decompress(body: Buffer, encoding: string): Buffer {
  switch (encoding.toLowerCase().trim()) {
    case 'gzip':
      return zlib.gunzipSync(body)
    case 'deflate':
      return zlib.inflateSync(body)
    case 'br':
      return zlib.brotliDecompressSync(body)
    case 'zstd':
      return (zlib as any).zstdDecompressSync
        ? (zlib as any).zstdDecompressSync(body)
        : body
    default:
      return body
  }
}
