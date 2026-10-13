import type { Node as PmNode } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { CriticKind } from '@/lib/types'
import { blockAttrsOf } from '../doc/bookSchema'
import { SUB_ARROW, hiddenRanges, isFormatChange, parseCriticLine, type CriticSpan } from './criticParse'
import type { MarkupLevel } from './markupLevel'
import './critic.css'

/**
 * Word 式修订装饰（docs/plan/22 决策 4）：doc 文本里的 CriticMarkup 原样保留（fromBookDoc 照旧序列化、落盘随文本一起保存），
 * 只用 Decoration 渲染：插入 = 下划线、删除 = 删除线、替换 = 删除线 + 下划线相邻、批注 = 高亮、高亮 = 高亮；
 * 标记符（`{++` `++}` `~>` …）用 `display:none` 的 inline 装饰隐藏；块首 widget 竖线标「此行有改动」。
 * filterTransaction：改动区间若只切到标记符的一部分则拒绝该事务（光标进入标记内不能把边界打碎）。
 * 四档（MarkupLevel）由同一插件按 `hiddenRanges` 决定隐藏哪一侧；simple / none / original 由宿主 editable=false。
 */
export interface CriticDecorationsOptions {
  /** 标记 id：默认 `${blockId}:${lineIdx}:${from}`；BookEditor 接线时给出与 POST /critic 一致的 `${fullLine}:${from}` 以便与卡片互定位 */
  markId?: (blockId: string | null, lineIdx: number, from: number, span: CriticSpan) => string
  /** 块内 textblock 序 → 全文 1-based 行（BookEditor 用 findBlockLines(ast, blockId).start + lineIdx）；给了则默认 id = `${line}:${from}` */
  lineOf?: (blockId: string, lineIdx: number) => number | null
  /** 点正文标记 → 高亮卡片 */
  onActivate?: (id: string | null) => void
  level?: MarkupLevel
  activeId?: string | null
}

export interface CriticPluginState {
  level: MarkupLevel
  activeId: string | null
  decorations: DecorationSet
  /** 已装饰标记的 id 列表（按文档顺序），供卡片 → 正文定位 */
  ids: string[]
}

export const criticKey = new PluginKey<CriticPluginState>('ps-critic')

interface Meta {
  level?: MarkupLevel
  activeId?: string | null
}

const mergeMeta = (tr: Transaction, patch: Meta) => tr.setMeta(criticKey, { ...((tr.getMeta(criticKey) as Meta | undefined) ?? {}), ...patch })
export const setCriticLevel = (tr: Transaction, level: MarkupLevel) => mergeMeta(tr, { level })
export const setCriticActive = (tr: Transaction, activeId: string | null) => mergeMeta(tr, { activeId })

const BODY_CLASS: Record<CriticKind, string> = {
  ins: 'ps-critic-ins',
  del: 'ps-critic-del',
  sub: 'ps-critic-sub',
  comment: 'ps-critic-comment',
  mark: 'ps-critic-mark',
}

interface LineInfo {
  /** 行首文档位置 */
  base: number
  text: string
  lineIdx: number
  blockId: string | null
  blockPos: number
}

/** 逐 textblock 展平文本（非文本叶子占 1 个占位符，位置与 doc 一致） */
function textblockLines(doc: PmNode): LineInfo[] {
  const out: LineInfo[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((c) => {
      text += c.isText ? (c.text ?? '') : '\uFFFC'
    })
    if (!text.includes('{')) return false
    const blockId = blockIdAt(doc, pos)
    // 表格单元格 / 权项内段落：lineIdx 以块内 textblock 序计
    out.push({ base: pos + 1, text, lineIdx: lineIndexIn(doc, pos), blockId, blockPos: pos })
    return false
  })
  return out
}

function blockIdAt(doc: PmNode, pos: number): string | null {
  const $p = doc.resolve(pos)
  for (let d = $p.depth; d >= 0; d--) {
    const id = blockAttrsOf($p.node(d)).blockId
    if (id) return id
  }
  const self = doc.nodeAt(pos)
  return self ? blockAttrsOf(self).blockId : null
}

function lineIndexIn(doc: PmNode, pos: number): number {
  const $p = doc.resolve(pos)
  if ($p.depth === 0) return 0
  let idx = 0
  const top = $p.node(1)
  const topPos = $p.before(1)
  let found = false
  top.descendants((n, p) => {
    if (found) return false
    if (topPos + 1 + p === pos) {
      found = true
      return false
    }
    if (n.isTextblock) idx++
    return true
  })
  return found ? idx : 0
}

interface Built {
  set: DecorationSet
  ids: string[]
}

function build(doc: PmNode, level: MarkupLevel, activeId: string | null, opts: CriticDecorationsOptions): Built {
  const decos: Decoration[] = []
  const ids: string[] = []
  for (const line of textblockLines(doc)) {
    const spans = parseCriticLine(line.text)
    if (spans.length === 0) continue
    const hidden = hiddenRanges(spans, level)
    for (const [a, b] of hidden) decos.push(Decoration.inline(line.base + a, line.base + b, { class: 'ps-critic-sym', 'aria-hidden': 'true' }))
    if (level !== 'none' && level !== 'original') {
      decos.push(
        Decoration.widget(line.base, () => bar(), { side: -1, key: `bar:${line.blockPos}`, ignoreSelection: true }),
      )
    }
    for (const s of spans) {
      const id = (opts.markId ?? defaultMarkId(opts.lineOf))(line.blockId, line.lineIdx, s.from, s)
      ids.push(id)
      const active = activeId != null && activeId === id
      const attrs = (cls: string) => ({ class: cls + (active ? ' ps-critic-active' : ''), 'data-critic-id': id, 'data-critic-kind': s.kind })
      const push = (from: number, to: number, cls: string) => {
        if (to > from) decos.push(Decoration.inline(line.base + from, line.base + to, attrs(cls), { criticId: id }))
      }
      const styled = level === 'all'
      if (isFormatChange(s)) {
        // Word 格式变更：原文不画删除线（hiddenRanges 已隐去），只给改格式后的文字标点线
        push(s.arrowAt + SUB_ARROW.length, s.innerTo, styled ? 'ps-critic-fmt' : 'ps-critic-plain')
      } else if (s.kind === 'sub') {
        push(s.innerFrom, s.arrowAt, styled ? BODY_CLASS.del : 'ps-critic-plain')
        push(s.arrowAt + SUB_ARROW.length, s.innerTo, styled ? BODY_CLASS.ins : 'ps-critic-plain')
      } else {
        push(s.innerFrom, s.innerTo, styled ? BODY_CLASS[s.kind] : 'ps-critic-plain')
      }
    }
  }
  return { set: DecorationSet.create(doc, decos), ids }
}

/** 默认 id：宿主给了 lineOf（块内行 → 全文 1-based 行）时与 store.review 的 CriticMark.id（`line:from`）同口径，卡片 ↔ 正文直接对得上 */
const defaultMarkId =
  (lineOf?: CriticDecorationsOptions['lineOf']) =>
  (blockId: string | null, lineIdx: number, from: number): string => {
    const line = blockId && lineOf ? lineOf(blockId, lineIdx) : null
    return line != null ? `${line}:${from}` : `${blockId ?? '?'}:${lineIdx}:${from}`
  }

function bar(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'ps-critic-bar'
  el.setAttribute('aria-hidden', 'true')
  return el
}

/** 标记符区间（用于 filterTransaction）：每个 span 的开口符、闭合符、`~>` */
function sigilRanges(doc: PmNode): [number, number][] {
  const out: [number, number][] = []
  for (const line of textblockLines(doc)) {
    for (const s of parseCriticLine(line.text)) {
      out.push([line.base + s.from, line.base + s.innerFrom], [line.base + s.innerTo, line.base + s.to])
      if (s.kind === 'sub') out.push([line.base + s.arrowAt, line.base + s.arrowAt + SUB_ARROW.length])
    }
  }
  return out
}

/** 改动 [from,to) 与某标记符区间部分相交（既非完全包含也非不相交）⇒ 打碎边界 */
export function breaksSigil(ranges: readonly [number, number][], from: number, to: number): boolean {
  for (const [a, b] of ranges) {
    const overlaps = from < b && to > a
    if (!overlaps) {
      // 纯插入落在标记符内部（不含端点）
      if (from === to && from > a && from < b) return true
      continue
    }
    const contains = from <= a && to >= b
    if (!contains) return true
  }
  return false
}

export function transactionBreaksSigil(tr: Transaction): boolean {
  if (!tr.docChanged) return false
  for (let i = 0; i < tr.steps.length; i++) {
    const ranges = sigilRanges(tr.docs[i]!)
    if (ranges.length === 0) continue
    let bad = false
    tr.steps[i]!.getMap().forEach((oldStart, oldEnd) => {
      if (breaksSigil(ranges, oldStart, oldEnd)) bad = true
    })
    if (bad) return true
  }
  return false
}

export function criticDecorations(opts: CriticDecorationsOptions = {}): Plugin<CriticPluginState> {
  return new Plugin<CriticPluginState>({
    key: criticKey,
    state: {
      init: (_, state: EditorState) => {
        const level = opts.level ?? 'all'
        const activeId = opts.activeId ?? null
        const b = build(state.doc, level, activeId, opts)
        return { level, activeId, decorations: b.set, ids: b.ids }
      },
      apply: (tr, prev) => {
        const meta = tr.getMeta(criticKey) as Meta | undefined
        const level = meta?.level ?? prev.level
        const activeId = meta && 'activeId' in meta ? (meta.activeId ?? null) : prev.activeId
        if (!tr.docChanged && level === prev.level && activeId === prev.activeId) return prev
        const b = build(tr.doc, level, activeId, opts)
        return { level, activeId, decorations: b.set, ids: b.ids }
      },
    },
    filterTransaction: (tr) => !transactionBreaksSigil(tr),
    props: {
      decorations: (state) => criticKey.getState(state)?.decorations ?? null,
      handleClickOn: (view: EditorView, _pos, _node, _nodePos, event) => {
        const el = (event.target as HTMLElement | null)?.closest?.('[data-critic-id]')
        const id = el?.getAttribute('data-critic-id') ?? null
        opts.onActivate?.(id)
        view.dispatch(setCriticActive(view.state.tr, id))
        return false
      },
    },
  })
}

/** 卡片 → 正文：找到 id 对应装饰的文档位置（供宿主 scrollIntoView / 选中） */
export function criticPosOf(state: EditorState, id: string): { from: number; to: number } | null {
  const ps = criticKey.getState(state)
  if (!ps) return null
  const hit = ps.decorations.find(undefined, undefined, (spec) => spec.criticId === id)
  if (hit.length === 0) return null
  return { from: Math.min(...hit.map((d) => d.from)), to: Math.max(...hit.map((d) => d.to)) }
}

export const criticIds = (state: EditorState): string[] => criticKey.getState(state)?.ids ?? []
