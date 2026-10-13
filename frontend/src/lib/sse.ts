import type { AgentStep, ChatConfirm } from '@/types/ai'

/**
 * text/event-stream 增量解析（09 §3.1 chat 契约 + agent 批2）：`data:{"delta":"…"}`* → `data:{"done":true,model,usage,fallback}`；
 * agent 工具循环多出 `data:{"step":{id,name,status,summary}}`（running→ok|error）与 `data:{"confirm":{id,tool,args,danger,plan_md?,resume}}`（流停等裁决）；
 * 错误 `data:{"error":{kind,message}}`。事件以空行分隔，多行 data 按 \n 拼接；`[DONE]`（OpenAI 习惯）与非 JSON 载荷忽略。
 */
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string | null; usage: ChatUsage | null; fallback: boolean; steps?: number }
  | { type: 'error'; kind: string; message: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'confirm'; confirm: ChatConfirm }

export interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** 逐块喂入、逐事件产出；跨块断开的行与事件靠内部缓冲拼回 */
export class SseParser {
  private buf = ''
  private data: string[] = []

  feed(chunk: string): ChatEvent[] {
    this.buf += chunk
    const out: ChatEvent[] = []
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      if (line === '') {
        const ev = this.flush()
        if (ev) out.push(ev)
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).replace(/^ /, ''))
      }
      // event:/id:/retry:/注释行：契约未用，忽略
    }
    return out
  }

  /** 流结束：收尾没有以空行终止的最后一个事件 */
  end(): ChatEvent[] {
    const out: ChatEvent[] = []
    if (this.buf.trim()) {
      const rest = this.feed('\n')
      out.push(...rest)
    }
    const ev = this.flush()
    if (ev) out.push(ev)
    return out
  }

  private flush(): ChatEvent | null {
    if (this.data.length === 0) return null
    const raw = this.data.join('\n')
    this.data = []
    return parseChatPayload(raw)
  }
}

export function parseChatPayload(raw: string): ChatEvent | null {
  const s = raw.trim()
  if (!s || s === '[DONE]') return null
  let v: unknown
  try {
    v = JSON.parse(s)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.delta === 'string') return { type: 'delta', text: o.delta }
  if (o.step && typeof o.step === 'object') {
    const s = o.step as Record<string, unknown>
    const status = s.status === 'running' || s.status === 'ok' ? s.status : 'error'
    return { type: 'step', step: { id: String(s.id ?? ''), name: String(s.name ?? ''), status, summary: String(s.summary ?? '') } }
  }
  if (o.confirm && typeof o.confirm === 'object') {
    const c = o.confirm as Record<string, unknown>
    const r = c.resume && typeof c.resume === 'object' ? (c.resume as { assistant: unknown; calls: unknown[] }) : { assistant: null, calls: [] }
    return {
      type: 'confirm',
      confirm: {
        id: String(c.id ?? ''),
        tool: String(c.tool ?? ''),
        args: (c.args && typeof c.args === 'object' ? c.args : {}) as Record<string, unknown>,
        danger: c.danger === true,
        plan_md: typeof c.plan_md === 'string' ? c.plan_md : undefined,
        resume: r,
      },
    }
  }
  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>
    return { type: 'error', kind: String(e.kind ?? 'error'), message: String(e.message ?? '未知错误') }
  }
  if (o.done === true) {
    const u = o.usage && typeof o.usage === 'object' ? (o.usage as Record<string, unknown>) : null
    const n = (k: string) => (u && typeof u[k] === 'number' ? (u[k] as number) : 0)
    return {
      type: 'done',
      model: typeof o.model === 'string' ? o.model : null,
      usage: u ? { prompt_tokens: n('prompt_tokens'), completion_tokens: n('completion_tokens'), total_tokens: n('total_tokens') } : null,
      fallback: o.fallback === true,
      steps: typeof o.steps === 'number' ? o.steps : undefined,
    }
  }
  return null
}

/** 读完整个响应体，逐事件回调；调用方用 AbortSignal 中断（reader 会抛 AbortError） */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (ev: ChatEvent) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) onEvent(ev)
    }
    const tail = decoder.decode()
    for (const ev of tail ? parser.feed(tail) : []) onEvent(ev)
    for (const ev of parser.end()) onEvent(ev)
  } finally {
    reader.releaseLock()
  }
}
