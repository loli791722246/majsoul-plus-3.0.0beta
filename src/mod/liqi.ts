import * as fs from 'fs'
import * as protobuf from 'protobufjs'
import * as descriptor from 'protobufjs/ext/descriptor'

export enum MsgType {
  Notify = 1,
  Req = 2,
  Res = 3
}

export interface DecodedFrame {
  type: MsgType
  /** Notify 没有 id，使用 -1 */
  id: number
  method: string
  /** BaseMessage.data */
  payload: Uint8Array
  /** 解析后的消息对象，可能为 null（未知类型） */
  message: any
  /** BaseMessage 本身 */
  base: any
  /** 响应报文对应的 protobuf 类型 */
  messageType: protobuf.Type | null
}

/**
 * 雀魂 protobuf 协议（liqi）。
 *
 * liqi.desc 是游戏导出的 FileDescriptorSet，包含全部 .lq 消息定义；
 * 连接协议格式与 MajsoulMax 一致：
 *   [0]   1 = Notify / 2 = Req / 3 = Res
 *   [1:3] Req、Res 的 uint16 小端消息编号
 *   [..]  base.BaseMessage { method_name, data }
 */
export class Liqi {
  readonly root: protobuf.Root
  readonly baseMessage: protobuf.Type
  /** RPC 方法 -> 请求 / 响应类型全名 */
  readonly rpc: Map<string, { req: string; resp: string }> = new Map()

  private pendingRes: Map<number, { method: string; type: string }> = new Map()

  private constructor(root: protobuf.Root) {
    this.root = root

    const base = new protobuf.Namespace('base')
    this.baseMessage = new protobuf.Type('BaseMessage')
      .add(new protobuf.Field('method_name', 1, 'string'))
      .add(new protobuf.Field('data', 2, 'bytes'))
    base.add(this.baseMessage)
    root.add(base)
  }

  static load(descPath: string): Liqi {
    const buffer = fs.readFileSync(descPath)
    const fds = (descriptor as any).FileDescriptorSet.decode(buffer)
    const root = (protobuf.Root as any).fromDescriptor(fds) as protobuf.Root
    root.resolveAll()

    const liqi = new Liqi(root)

    const visit = (namespace: protobuf.Namespace) => {
      for (const nested of namespace.nestedArray) {
        if (nested instanceof protobuf.Service) {
          for (const method of nested.methodsArray) {
            const request = method.resolvedRequestType
            const response = method.resolvedResponseType
            if (!request || !response) continue
            liqi.rpc.set(`${nested.fullName}.${method.name}`, {
              req: request.fullName,
              resp: response.fullName
            })
          }
        } else if (nested instanceof protobuf.Namespace) {
          visit(nested)
        }
      }
    }
    visit(root)

    return liqi
  }

  lookup(name: string): protobuf.Type | null {
    if (!name) return null
    try {
      return this.root.lookupType(name) as protobuf.Type
    } catch {
      return null
    }
  }

  decode(
    buffer: Buffer,
    pendingRes: Map<number, { method: string; type: string }> = this.pendingRes
  ): DecodedFrame | null {
    if (buffer.length < 1) return null
    const type = buffer[0] as MsgType
    let id = -1
    let offset = 1

    if (type === MsgType.Req || type === MsgType.Res) {
      if (buffer.length < 3) return null
      id = buffer.readUInt16LE(1)
      offset = 3
    } else if (type !== MsgType.Notify) {
      return null
    }

    const base: any = this.baseMessage.decode(buffer.subarray(offset))
    let method = String(base.method_name || '')
    const payload = base.data as Uint8Array
    let message: any = null
    let messageType: protobuf.Type | null = null

    if (type === MsgType.Req) {
      const info = this.rpc.get(method)
      if (info) {
        pendingRes.set(id, { method, type: info.resp })
        messageType = this.lookup(info.req)
      }
    } else if (type === MsgType.Res) {
      const pending = pendingRes.get(id)
      if (pending) {
        pendingRes.delete(id)
        method = pending.method
        messageType = this.lookup(pending.type)
      }
    } else if (type === MsgType.Notify && method) {
      messageType = this.lookup(method)
    }

    if (messageType) {
      try {
        message = messageType.decode(payload)
      } catch {
        message = null
      }
    }

    return { type, id, method, payload, message, base, messageType }
  }

  encodeFrame(type: MsgType, id: number, method: string, payload: Uint8Array): Buffer {
    const base = this.baseMessage.encode(
      this.baseMessage.create({ method_name: method, data: payload })
    ).finish() as Uint8Array
    if (type === MsgType.Notify) {
      return Buffer.concat([Buffer.from([type]), Buffer.from(base)])
    }
    const header = Buffer.alloc(3)
    header.writeUInt8(type, 0)
    header.writeUInt16LE(id, 1)
    return Buffer.concat([header, Buffer.from(base)])
  }

  encodeMessage(type: protobuf.Type, message: any): Uint8Array {
    return type.encode(message).finish()
  }
}

/** 生成用于日志的简短描述 */
export function describe(frame: DecodedFrame): string {
  return `${MsgType[frame.type]}#${frame.id} ${frame.method}`
}
