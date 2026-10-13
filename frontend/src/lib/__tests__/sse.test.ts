import { describe, expect, it } from 'vitest'
import { SseParser, parseChatPayload, readSse, type ChatEvent } from '../sse'

const enc = new TextEncoder()
function stream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

describe('SseParser（text/event-stream → ChatEvent；09 §API chat）', () => {
  it('delta / done / error 三种 payload', () => {
    expect(parseChatPayload('{"delta":"你好"}')).toEqual({ type: 'delta', text: '你好' })
    expect(parseChatPayload('{"done":true,"model":"swe-2-medium","usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3},"fallback":false}')).toEqual({
      type: 'done',
      model: 'swe-2-medium',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      fallback: false,
    })
    expect(parseChatPayload('{"error":{"kind":"upstream","message":"502"}}')).toEqual({ type: 'error', kind: 'upstream', message: '502' })
    expect(parseChatPayload('[DONE]')).toBeNull()
    expect(parseChatPayload('not json')).toBeNull()
    expect(parseChatPayload('{"foo":1}')).toBeNull()
  })

  it('任意分块边界：事件、行、甚至多字节 JSON 字符串被切开也能拼回', () => {
    const p = new SseParser()
    const full = 'data: {"delta":"权利"}\n\ndata: {"delta":"要求"}\n\ndata: {"done":true,"model":"m","usage":null,"fallback":true}\n\n'
    const out: ChatEvent[] = []
    for (let i = 0; i < full.length; i += 7) out.push(...p.feed(full.slice(i, i + 7)))
    out.push(...p.end())
    expect(out).toEqual([
      { type: 'delta', text: '权利' },
      { type: 'delta', text: '要求' },
      { type: 'done', model: 'm', usage: null, fallback: true },
    ])
  })

  it('CRLF、注释行、event:/id: 行、多 data: 行拼接、末尾无空行', () => {
    const p = new SseParser()
    const out = p.feed(': keep-alive\r\nevent: message\r\nid: 1\r\ndata: {"delta":\r\ndata: "a"}\r\n\r\ndata:{"delta":"b"}')
    // 多 data 行按规范以 \n 连接后再 JSON.parse；最后一条没有空行收尾，要等 end()
    expect(out).toEqual([{ type: 'delta', text: 'a' }])
    expect(p.end()).toEqual([{ type: 'delta', text: 'b' }])
  })

  it('readSse：按字节流读完，回调顺序与 delta 累加正确；释放 reader', async () => {
    const events: ChatEvent[] = []
    const body = stream(['data: {"del', 'ta":"A"}\n\ndata: {"delta":"B"}\n', '\ndata: {"done":true}\n\n'])
    await readSse(body, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'done'])
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe('AB')
    expect(body.locked).toBe(false)
  })
})
