import { IncomingMessage } from 'http'
import { Socket } from 'net'
import * as tls from 'tls'
import { RawData, WebSocket, WebSocketServer } from 'ws'

export interface FrameResult {
  /** 修改后的报文，未修改时为空 */
  data?: Buffer
  /** 是否丢弃该报文 */
  drop?: boolean
  /** 需要额外注入到对端（通常是客户端）的报文 */
  inject?: Buffer[]
}

export interface FrameHandler {
  onClientMessage(data: Buffer, binary: boolean): FrameResult | void
  onServerMessage(data: Buffer, binary: boolean): FrameResult | void
}

type Logger = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void

const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'upgrade',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-accept',
  'proxy-connection'
])

/**
 * 在已经解密（被中间人接管）的 HTTP 连接上完成一次 WebSocket 反向代理：
 * 客户端 <-> 本函数 <-> 官方服务器，并在双向报文之间插入 FrameHandler。
 */
export function relayWebSocket(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  host: string,
  handler: FrameHandler,
  log: Logger
) {
  const path = req.url || '/'
  const protocols = parseProtocols(req.headers['sec-websocket-protocol'])

  const headers: { [key: string]: string } = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  // 使用被访问域名作为 Host，避免上游校验失败
  headers.host = host

  const socketOptions: tls.ConnectionOptions = {
    host,
    port: 443,
    servername: host,
    rejectUnauthorized: false
  }

  const upstream = new WebSocket(`wss://${host}${path}`, protocols, {
    createConnection: () => tls.connect(socketOptions),
    headers,
    perMessageDeflate: true,
    handshakeTimeout: 15000,
    maxPayload: 64 * 1024 * 1024
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 })

  let client: WebSocket | undefined
  let closed = false

  const shutdown = (code = 1001, reason = '') => {
    if (closed) return
    closed = true
    try {
      client && client.close(code, reason)
    } catch {}
    try {
      upstream.close(code, reason)
    } catch {}
  }

  upstream.on('unexpected-response', (request, response) => {
    log(
      'error',
      `WebSocket 上游拒绝握手 ${host}${path}: ${response.statusCode}`
    )
    if (!socket.destroyed) {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`
      )
      socket.destroy()
    }
    closed = true
  })

  upstream.on('error', error => {
    log('error', `WebSocket 上游错误 ${host}${path}: ${error.message}`)
    if (!client && !socket.destroyed) {
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    }
    shutdown()
  })

  upstream.on('open', () => {
    if (closed || socket.destroyed) {
      upstream.close()
      return
    }

    wss.handleUpgrade(
      req,
      socket,
      head,
      (clientSocket: WebSocket) => {
        client = clientSocket
        log('debug', `WebSocket 已接管 ${host}${path}`)

        client.on('message', (data: RawData, isBinary: boolean) => {
          const buf = toBuffer(data)
          let result: FrameResult | void
          try {
            result = handler.onClientMessage(buf, isBinary)
          } catch (error) {
            log('error', `处理客户端报文失败: ${error && error.stack}`)
          }
          if (!result) {
            send(upstream, buf, isBinary)
            return
          }
          if (!result.drop) {
            send(upstream, result.data || buf, isBinary)
          }
          if (result.inject && result.inject.length > 0) {
            for (const injected of result.inject) send(client, injected, true)
          }
        })

        upstream.on('message', (data: RawData, isBinary: boolean) => {
          const buf = toBuffer(data)
          let result: FrameResult | void
          try {
            result = handler.onServerMessage(buf, isBinary)
          } catch (error) {
            log('error', `处理服务端报文失败: ${error && error.stack}`)
          }
          if (!result) {
            send(client, buf, isBinary)
            return
          }
          if (!result.drop) {
            send(client, result.data || buf, isBinary)
          }
          if (result.inject && result.inject.length > 0) {
            for (const injected of result.inject) send(client, injected, true)
          }
        })

        client.on('close', (code: number, reason: Buffer) =>
          shutdown(code, reason.toString())
        )
        client.on('error', () => shutdown())
      }
    )
  })

  upstream.on('close', (code: number, reason: Buffer) => {
    if (closed) return
    closed = true
    try {
      client && client.close(code, reason.toString())
    } catch {}
  })
}

function send(ws: WebSocket, data: Buffer, binary: boolean) {
  if (ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(data, { binary })
  } catch {}
}

function parseProtocols(header: string | string[] | undefined): string[] {
  if (!header) return []
  const value = Array.isArray(header) ? header.join(',') : header
  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data as ArrayBuffer)
}
