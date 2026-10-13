import type { Comment, CriticMark } from '@/lib/types'
import type { Ast, BookName } from '@/types/ast'
import { blockAtLine } from '@/types/ast'

/** 块 id / 全文行 → 所属书（Focus.book）：id 前缀优先，其次 AST 折算行，缺省说明书 */
export function bookForAnchor(ast: Ast | null, blockId: string, line: number): BookName {
  if (blockId === 'abstract' || blockId.startsWith('abstract/')) return 'abstract'
  if (blockId === 'claims' || blockId.startsWith('claims/')) return 'claims'
  if (blockId === 'description' || blockId.startsWith('description/')) return 'description'
  if (ast) {
    if (ast.claims.some((c) => c.id === blockId)) return 'claims'
    if (ast.abstract.id === blockId) return 'abstract'
    if (ast.description.some((b) => b.id === blockId)) return 'description'
    const loc = blockAtLine(ast, line)
    if (loc) return loc.book
  }
  return 'description'
}

/** 块 id → 面板分组标题（AST 缺失或找不到时退化为 id / 「未定位」） */
export function blockLabel(ast: Ast | null, blockId: string): string {
  if (!blockId) return '未定位'
  if (blockId === 'abstract' || blockId.startsWith('abstract/')) return '说明书摘要'
  if (blockId === 'claims') return '权利要求书'
  if (blockId === 'description') return '说明书'
  if (!ast) return blockId
  const claim = ast.claims.find((c) => c.id === blockId)
  if (claim) return `权利要求 ${claim.num}`
  if (ast.abstract.id === blockId || ast.abstract.paragraphs.some((p) => p.id === blockId)) return '说明书摘要'
  const b = ast.description.find((x) => x.id === blockId)
  if (!b) return blockId
  switch (b.kind) {
    case 'section':
    case 'subsection':
      return b.title
    case 'paragraph':
      return b.para_no !== null ? `段落 [${String(b.para_no).padStart(4, '0')}]` : '段落'
    case 'table':
      return `表 · [${String(b.para_no).padStart(4, '0')}]`
    case 'code':
      return `代码 · [${String(b.para_no).padStart(4, '0')}]`
    case 'equation':
      return '公式'
    default:
      return blockId
  }
}


/** 修订摘要：ins → +新；del → −旧；sub → 旧 → 新；comment/mark → 内文 */
export function markSummary(m: CriticMark): string {
  switch (m.kind) {
    case 'ins':
      return `+ ${m.b || m.final}`
    case 'del':
      return `− ${m.a}`
    case 'sub':
      return `${m.a} → ${m.b}`
    default:
      return m.a
  }
}

/**
 * 一条「逻辑修订」：同一行内首尾相接的若干标记（如 `{--旧--}{++新++}`），或一次选区格式化产生的一对包裹片
 * （`{++_{++}2{++}++}`：开口片以行内格式开符结尾、闭口片以对应闭符开头，中间是被包的原文）合成一张卡，接受 / 拒绝按整簇。
 * kind：全 ins ⇒ ins、全 del ⇒ del、混合 ⇒ sub；comment / mark 不合并。
 */
export interface MarkCluster {
  id: string
  kind: CriticMark['kind']
  line: number
  from: number
  to: number
  /** 拒绝后的文字（原文） */
  a: string
  /** 接受后的文字（新文） */
  b: string
  marks: CriticMark[]
  author: string | null
  at: number | null
}

const MERGEABLE = new Set<CriticMark['kind']>(['ins', 'del', 'sub'])

/** 行内格式的开 / 闭符（与 layout-view/mode/toCritic 的 ATOM 同口径） */
const FORMAT_PAIRS: readonly [string, string][] = [
  ['***', '***'],
  ['**', '**'],
  ['*', '*'],
  ['<u>', '</u>'],
  ['_{', '}'],
  ['^{', '}'],
  ['_[', ']'],
  ['^[', ']'],
]
const WRAP_GAP_MAX = 40
const FORMAT_LABEL: Record<string, string> = { '***': '粗斜体', '**': '加粗', '*': '斜体', '<u>': '下划线', '_{': '下标', '^{': '上标', '_[': '下标', '^[': '上标' }

/** 簇是一次「套 / 去行内格式」（ins：新文 = 开符 + 原文 + 闭符；del 反之）时返回格式名，否则 null */
export function formatOf(c: MarkCluster): { label: string; text: string; removed: boolean } | null {
  if (c.kind === 'comment' || c.kind === 'mark' || !c.a || !c.b) return null
  for (const [o, cl] of FORMAT_PAIRS) {
    if (c.b === o + c.a + cl) return { label: FORMAT_LABEL[o] ?? '格式', text: c.a, removed: false }
    if (c.a === o + c.b + cl) return { label: FORMAT_LABEL[o] ?? '格式', text: c.b, removed: true }
  }
  return null
}

const isFormatWrap = (open: string, close: string) =>
  FORMAT_PAIRS.some(([o, c]) => open.endsWith(o) && close.startsWith(c))

/**
 * @param lineOf 有则允许「格式包裹」合并（需要中间原文一起进卡）；不传只合并首尾相接的标记
 */
export function clusterMarks(marks: CriticMark[], lineOf?: (line: number) => string | undefined): MarkCluster[] {
  const sorted = [...marks].sort((x, y) => x.line - y.line || x.from - y.from)
  const out: MarkCluster[] = []
  for (const m of sorted) {
    const last = out[out.length - 1]
    if (last && MERGEABLE.has(m.kind) && MERGEABLE.has(last.kind) && last.line === m.line) {
      const gap = m.from - last.to
      let between: string | null = gap === 0 ? '' : null
      if (gap > 0 && gap <= WRAP_GAP_MAX && lineOf && last.kind === m.kind && last.kind !== 'sub') {
        const text = lineOf(m.line)
        const mid = text?.slice(last.to, m.from) ?? ''
        const prev = last.kind === 'ins' ? last.b : last.a
        const next = last.kind === 'ins' ? m.final : m.original
        if (text && !/[{}]/.test(mid) && isFormatWrap(prev, next)) between = mid
      }
      if (between !== null) {
        last.to = m.to
        last.a += between + m.original
        last.b += between + m.final
        last.marks.push(m)
        if (last.kind !== m.kind) last.kind = 'sub'
        last.author ??= m.author ?? null
        last.at ??= m.at ?? null
        continue
      }
    }
    out.push({ id: m.id, kind: m.kind, line: m.line, from: m.from, to: m.to, a: m.original, b: m.final, marks: [m], author: m.author ?? null, at: m.at ?? null })
  }
  for (const c of out) {
    if (c.marks.length === 1) continue
    if (c.kind === 'sub' && !c.a) c.kind = 'ins'
    else if (c.kind === 'sub' && !c.b) c.kind = 'del'
  }
  return out
}

/** 簇摘要（给 title / 测试）：ins → +新；del → −旧；sub → 旧 → 新；comment/mark → 内文 */
export function clusterSummary(c: MarkCluster): string {
  const f = formatOf(c)
  if (f) return `${f.removed ? '去掉' : ''}${f.label}：${f.text}`
  switch (c.kind) {
    case 'ins':
      return `+ ${c.b}`
    case 'del':
      return `− ${c.a}`
    case 'sub':
      return `${c.a} → ${c.b}`
    default:
      return c.marks[0]?.a ?? ''
  }
}

const CRITIC_ANY = /\{\+\+(.*?)\+\+\}|\{--(.*?)--\}|\{~~(.*?)~>(.*?)~~\}|\{>>(.*?)<<\}|\{==(.*?)==\}/g
/** 把一段源码里的 CriticMarkup 折成「接受后」纯文字（卡片上下文用；不是解析器，只处理完整标记） */
export function stripCritic(s: string): string {
  return s.replace(CRITIC_ANY, (_m, ins, _del, _subA, subB, _cmt, mark) => ins ?? subB ?? mark ?? '')
}

/** 卡片上下文：改动前后各取一小段可读正文（去掉 CriticMarkup 与行首 Markdown 记号） */
export function markContext(lineText: string | undefined, c: MarkCluster, span = 14): { before: string; after: string } {
  if (lineText === undefined) return { before: '', after: '' }
  const before = stripCritic(lineText.slice(0, c.from)).replace(/^\s*(#{1,6}\s+|\d+\.\s+|[-*+]\s+|\[\d{4}\]\s*)/, '')
  const after = stripCritic(lineText.slice(c.to))
  return {
    before: before.length > span ? `…${before.slice(-span)}` : before,
    after: after.length > span ? `${after.slice(0, span)}…` : after,
  }
}

export interface MarkGroup {
  blockId: string
  line: number
  items: MarkCluster[]
}

/** 修订按所属块分组（权利要求 3 / 段落 [0012] / 说明书摘要…），块内按行序 */
export function groupMarks(ast: Ast | null, clusters: MarkCluster[]): MarkGroup[] {
  const map = new Map<string, MarkGroup>()
  for (const c of clusters) {
    const blockId = ast ? blockAtLine(ast, c.line)?.block.id ?? '' : ''
    const g = map.get(blockId)
    if (g) g.items.push(c)
    else map.set(blockId, { blockId, line: c.line, items: [c] })
  }
  return [...map.values()].sort((a, b) => a.line - b.line)
}

export interface Group {
  blockId: string
  line: number
  items: Comment[]
}

/** 按块分组、块按首条行号排序、块内按行号 */
export function groupComments(list: Comment[]): Group[] {
  const map = new Map<string, Group>()
  for (const c of [...list].sort((a, b) => a.anchor.line - b.anchor.line || a.created_at - b.created_at)) {
    const g = map.get(c.anchor.block_id)
    if (g) g.items.push(c)
    else map.set(c.anchor.block_id, { blockId: c.anchor.block_id, line: c.anchor.line, items: [c] })
  }
  return [...map.values()].sort((a, b) => a.line - b.line)
}
