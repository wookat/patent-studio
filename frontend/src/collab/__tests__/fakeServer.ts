import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'

/**
 * 内存版 y-websocket 服务端（与 backend/app/collab/rooms.py 同线协议：
 * varUint(messageType) · sync = varUint(step) + varUint8Array(payload)，step1=stateVector / step2 & update = Y update；
 * awareness = varUint8Array(awarenessUpdate)）。作为 `WebSocketPolyfill` 注入 connectCollab，
 * 让 provider 状态机、双端合并、awareness、1008 拒绝在 vitest 里可复现。一个 FakeServer 管多个房间（url 末段 = roomname）。
 * lib0 不是直接依赖，varUint 编解码自写（lib0 同格式：7 位小端）。
 */
const MSG_SYNC = 0
const MSG_AWARENESS = 1
const STEP1 = 0
const STEP2 = 1
const UPDATE = 2

function writeVarUint(out: number[], n: number) {
  while (n > 127) {
    out.push(128 | (n & 127))
    n = Math.floor(n / 128)
  }
  out.push(n)
}
function readVarUint(buf: Uint8Array, pos: { i: number }): number {
  let n = 0
  let mult = 1
  for (;;) {
    const b = buf[pos.i++]
    n += (b & 127) * mult
    if (b < 128) return n
    mult *= 128
  }
}
function pack(type: number, step: number | null, payload: Uint8Array): Uint8Array {
  const head: number[] = []
  writeVarUint(head, type)
  if (step != null) writeVarUint(head, step)
  writeVarUint(head, payload.length)
  const out = new Uint8Array(head.length + payload.length)
  out.set(head, 0)
  out.set(payload, head.length)
  return out
}
function readBytes(buf: Uint8Array, pos: { i: number }): Uint8Array {
  const len = readVarUint(buf, pos)
  const out = buf.slice(pos.i, pos.i + len)
  pos.i += len
  return out
}

type Reject = { code: number; reason: string }

class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  readonly conns = new Set<FakeSocket>()
  constructor(initial: string) {
    this.awareness.setLocalState(null)
    if (initial) this.doc.getText('content').insert(0, initial)
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const buf = pack(MSG_SYNC, UPDATE, update)
      for (const c of this.conns) if (c !== origin) c.deliver(buf)
    })
    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin instanceof FakeSocket) for (const id of [...added, ...updated]) origin.controlled.add(id)
        const buf = pack(MSG_AWARENESS, null, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]))
        for (const c of this.conns) c.deliver(buf)
      },
    )
  }
}

export class FakeServer {
  readonly rooms = new Map<string, Room>()
  /** 每次握手 +1（含被拒的） */
  accepts = 0
  /** 设定后新连接直接以该 code 关闭（模拟 rooms.py 的 `close(1008, reason)`） */
  reject: Reject | null = null
  /** 这些用户名（awareness user.name）的写入被忽略（模拟 viewer 只读：服务端丢弃其 update） */
  readonly readonlyNames = new Set<string>()
  readonly sockets = new Set<FakeSocket>()
  private readonly initial: Record<string, string>

  constructor(initial: Record<string, string> = {}) {
    this.initial = initial
  }

  room(name: string): Room {
    let r = this.rooms.get(name)
    if (!r) {
      r = new Room(this.initial[name] ?? '')
      this.rooms.set(name, r)
    }
    return r
  }

  text(name: string): string {
    return this.room(name).doc.getText('content').toString()
  }

  /** provider 注入用：`new WS(url)` 即握手 */
  get WebSocket(): typeof WebSocket {
    return socketClassFor(this)
  }

  /** 服务端主动掐断所有连接（默认 1006 异常断开），provider 应进入 reconnecting 并退避重连 */
  dropAll(code = 1006, reason = '') {
    for (const s of [...this.sockets]) s.serverClose(code, reason)
  }

  handle(sock: FakeSocket, buf: Uint8Array) {
    const room = sock.room
    const pos = { i: 0 }
    const type = readVarUint(buf, pos)
    if (type === MSG_SYNC) {
      const step = readVarUint(buf, pos)
      const payload = readBytes(buf, pos)
      if (step === STEP1) {
        sock.deliver(pack(MSG_SYNC, STEP2, Y.encodeStateAsUpdate(room.doc, payload)))
      } else if (!this.isReadonly(sock)) {
        Y.applyUpdate(room.doc, payload, sock)
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(room.awareness, readBytes(buf, pos), sock)
    }
  }

  isReadonly(sock: FakeSocket): boolean {
    for (const id of sock.controlled) {
      const st = sock.room.awareness.getStates().get(id) as { user?: { name?: string } } | undefined
      if (st?.user?.name && this.readonlyNames.has(st.user.name)) return true
    }
    return false
  }

  open(sock: FakeSocket) {
    this.accepts++
    if (this.reject) {
      sock.serverClose(this.reject.code, this.reject.reason)
      return
    }
    const room = sock.room
    room.conns.add(sock)
    this.sockets.add(sock)
    sock.readyState = 1
    sock.onopen?.(new Event('open'))
    sock.deliver(pack(MSG_SYNC, STEP1, Y.encodeStateVector(room.doc)))
    const states = room.awareness.getStates()
    if (states.size > 0) {
      sock.deliver(pack(MSG_AWARENESS, null, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()])))
    }
  }

  closed(sock: FakeSocket) {
    this.sockets.delete(sock)
    sock.room.conns.delete(sock)
    if (sock.controlled.size) awarenessProtocol.removeAwarenessStates(sock.room.awareness, [...sock.controlled], null)
  }
}

function socketClassFor(server: FakeServer): typeof WebSocket {
  class Bound extends FakeSocket {
    constructor(url: string) {
      super(server, url)
    }
  }
  return Bound as unknown as typeof WebSocket
}

export class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly OPEN = 1
  readyState = 0
  binaryType = 'blob'
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  readonly server: FakeServer
  readonly url: string
  readonly room: Room
  readonly controlled = new Set<number>()

  constructor(server: FakeServer, url: string) {
    this.server = server
    this.url = url
    this.room = server.room(url.split('/').pop() ?? '')
    queueMicrotask(() => server.open(this))
  }

  send(buf: Uint8Array) {
    if (this.readyState !== 1) return
    this.server.handle(this, new Uint8Array(buf))
  }

  /** 服务端 → 客户端：下一微任务投递，避免 provider 在 onopen 里同步收到回包 */
  deliver(buf: Uint8Array) {
    queueMicrotask(() => {
      if (this.readyState !== 1) return
      this.onmessage?.({ data: buf.slice().buffer })
    })
  }

  /** 客户端主动关闭（provider.disconnect / destroy） */
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.server.closed(this)
    this.onclose?.({ code: 1000, reason: '', wasClean: true })
  }

  serverClose(code: number, reason: string) {
    if (this.readyState === 3) return
    this.readyState = 3
    this.server.closed(this)
    this.onclose?.({ code, reason, wasClean: code === 1000 })
  }
}

/** 让微任务链（握手 → step1/step2 → sync → awareness）跑完 */
export async function flush(ms = 0) {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
