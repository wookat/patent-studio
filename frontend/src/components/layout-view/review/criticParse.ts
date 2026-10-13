import type { CriticKind } from '@/lib/types'

/**
 * CriticMarkup 单行解析（前端等价于 backend/src/patent_studio/kernel/critic.py：TOKEN 非贪婪、不跨行、不嵌套）。
 * 只服务版面装饰与四档投影；落盘真源仍是 Markdown 文本里的标记本身，接受 / 拒绝的写回走 store.review（POST /critic 的 marks）。
 * 法则与后端一致：无标记时 accept/reject 恒等；不改变行数；幂等。
 */
export interface CriticSpan {
  kind: CriticKind
  /** 含标记符的 [from,to)（行内 UTF-16 偏移，与 CriticMark.from/to 同口径） */
  from: number
  to: number
  /** 开口符后 / 闭合符前 */
  innerFrom: number
  innerTo: number
  /** sub：`~>` 起点（其余 kind 为 -1） */
  arrowAt: number
  a: string
  b: string
  final: string
  original: string
}

const TOKEN = /\{\+\+(.*?)\+\+\}|\{--(.*?)--\}|\{~~(.*?)~>(.*?)~~\}|\{>>(.*?)<<\}|\{==(.*?)==\}/g

export const CRITIC_OPEN: Record<CriticKind, string> = { ins: '{++', del: '{--', sub: '{~~', comment: '{>>', mark: '{==' }
export const SUB_ARROW = '~>'

export function parseCriticLine(line: string): CriticSpan[] {
  if (!line.includes('{')) return []
  const out: CriticSpan[] = []
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(line); m; m = TOKEN.exec(line)) {
    const from = m.index
    const to = from + m[0].length
    let span: CriticSpan
    if (m[1] !== undefined) span = mk('ins', from, to, '', m[1], m[1], '')
    else if (m[2] !== undefined) span = mk('del', from, to, m[2], '', '', m[2])
    else if (m[3] !== undefined) {
      span = mk('sub', from, to, m[3], m[4] ?? '', m[4] ?? '', m[3])
      span.arrowAt = span.innerFrom + m[3].length
    } else if (m[5] !== undefined) span = mk('comment', from, to, m[5], '', '', '')
    else span = mk('mark', from, to, m[6] ?? '', m[6] ?? '', m[6] ?? '', m[6] ?? '')
    out.push(span)
  }
  return out
}

function mk(kind: CriticKind, from: number, to: number, a: string, b: string, final: string, original: string): CriticSpan {
  return { kind, from, to, innerFrom: from + 3, innerTo: to - 3, arrowAt: -1, a, b, final, original }
}

/**
 * 替换标记是否为「格式变更」：选一段加下标 / 加粗在源码里是 `{~~129~>_{129}~~}`，进 doc 后行内语法已解成 mark，
 * 两侧文字相同只差格式（Word 的「格式变更」修订）。
 */
export const isFormatChange = (s: CriticSpan): boolean => s.kind === 'sub' && s.a !== '' && s.a === s.b


/** 一行 → 接受全部（final）/ 拒绝全部（original） */
export function resolveCriticLine(line: string, pick: 'final' | 'original'): string {
  const spans = parseCriticLine(line)
  if (spans.length === 0) return line
  let out = ''
  let at = 0
  for (const s of spans) {
    out += line.slice(at, s.from) + s[pick]
    at = s.to
  }
  return out + line.slice(at)
}

export const acceptCritic = (text: string) => text.split('\n').map((l) => resolveCriticLine(l, 'final')).join('\n')
export const rejectCritic = (text: string) => text.split('\n').map((l) => resolveCriticLine(l, 'original')).join('\n')

/**
 * 一行里「四档」下应保留 / 隐藏的字符区间：返回需隐藏的 [from,to) 列表（标记符恒隐藏；简单 / 无标记隐藏删除侧与批注；原始隐藏插入侧与批注）。
 * all：只隐藏标记符（内文全部可见，由装饰上色）。
 */
export function hiddenRanges(spans: readonly CriticSpan[], level: 'all' | 'simple' | 'none' | 'original'): [number, number][] {
  const out: [number, number][] = []
  for (const s of spans) {
    const hideInner = (from: number, to: number) => {
      if (to > from) out.push([from, to])
    }
    out.push([s.from, s.innerFrom])
    if (s.kind === 'sub') {
      out.push([s.arrowAt, s.arrowAt + SUB_ARROW.length])
      // 格式变更：Word 只显示改格式后的文字（原文不画删除线）
      if (level !== 'original' && (level !== 'all' || isFormatChange(s))) hideInner(s.innerFrom, s.arrowAt)
      if (level === 'original') hideInner(s.arrowAt + SUB_ARROW.length, s.innerTo)
    } else if (s.kind === 'comment') {
      if (level !== 'all') hideInner(s.innerFrom, s.innerTo)
    } else if (s.kind === 'del') {
      if (level === 'simple' || level === 'none') hideInner(s.innerFrom, s.innerTo)
    } else if (s.kind === 'ins') {
      if (level === 'original') hideInner(s.innerFrom, s.innerTo)
    }
    out.push([s.innerTo, s.to])
  }
  return out.sort((x, y) => x[0] - y[0])
}
