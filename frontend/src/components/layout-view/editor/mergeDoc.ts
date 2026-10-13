import type { Node as PmNode, ResolvedPos } from 'prosemirror-model'
import { Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { blockAttrsOf } from '../doc/bookSchema'

/**
 * 服务端 / 协同远端的新 doc 到达时**按块合并**而不整篇替换（22 §2 决策 1）：
 * 顶层块序列取公共前缀 / 后缀（node.eq），只替换中间差异区间 —— 差异区外的光标经 tr.mapping 原位保留；
 * 光标落在差异区内时按 `{blockId, offset}` 尽量恢复到同块同偏移。
 * 该事务 `addToHistory=false`（远端 / 回填不进撤销栈）。
 */

export interface CursorAnchor {
  blockId: string | null
  /** 顶层块索引（blockId 为空的新块兜底） */
  index: number
  /** 块内文本偏移（相对块起点） */
  offset: number
}

export function cursorAnchor(state: EditorState): CursorAnchor {
  return posAnchor(state.doc, state.selection.$from)
}

function posAnchor(doc: PmNode, $pos: ResolvedPos): CursorAnchor {
  if ($pos.depth === 0) return { blockId: null, index: Math.min($pos.index(0), Math.max(0, doc.childCount - 1)), offset: 0 }
  const index = $pos.index(0)
  const node = doc.child(index)
  return { blockId: blockAttrsOf(node).blockId, index, offset: $pos.pos - $pos.before(1) }
}

/** 选区两端各自锚定（anchor / head）：合并不把整段选区塌成光标，选中后紧接的 Ctrl+B/I/U 仍作用于同一段字 */
export interface SelectionAnchor {
  anchor: CursorAnchor
  head: CursorAnchor
}

export function selectionAnchor(state: EditorState): SelectionAnchor {
  const { $anchor, $head } = state.selection
  return { anchor: posAnchor(state.doc, $anchor), head: posAnchor(state.doc, $head) }
}

function restorePos(doc: PmNode, a: CursorAnchor): number | null {
  let index = -1
  if (a.blockId) doc.forEach((n, _p, i) => { if (index < 0 && blockAttrsOf(n).blockId === a.blockId) index = i })
  if (index < 0) index = Math.min(a.index, doc.childCount - 1)
  if (index < 0) return null
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  const node = doc.child(index)
  return Math.min(pos + Math.max(1, a.offset), pos + node.nodeSize - 1)
}

export function restoreCursor(doc: PmNode, a: CursorAnchor): Selection {
  const target = restorePos(doc, a)
  return target === null ? Selection.atStart(doc) : TextSelection.near(doc.resolve(target))
}

export function restoreSelection(doc: PmNode, s: SelectionAnchor): Selection {
  const a = restorePos(doc, s.anchor)
  const h = restorePos(doc, s.head)
  if (a === null || h === null) return Selection.atStart(doc)
  if (a === h) return TextSelection.near(doc.resolve(a))
  return TextSelection.between(doc.resolve(a), doc.resolve(h))
}

export interface MergeResult {
  tr: Transaction
  /** 被替换的顶层块区间 [from, to)（旧 doc 的块索引） */
  from: number
  to: number
}

export interface SyncBase {
  /** 上一次与服务端 / 房间同步时的 doc（三方合并的 base） */
  doc: PmNode | null
  /** base 对应的本书文本；本地保存成功后也推进到已保存文本 */
  text: string | null
}

export interface IncomingPlan {
  /** 要 dispatch 的合并结果；null = 只需装饰事务 */
  merge: MergeResult | null
  /** all：base.doc/text 与调度器 saved 一起推进到 incoming；doc：只推进 base.doc；none：不动 */
  advance: 'all' | 'doc' | 'none'
}

/**
 * props(ast/content) 新文本到达（AST 已跟上、非组字中）时的合并决策（BookEditor.syncFromProps）：
 * - 本地序列化 == incoming（我们自己的回写）或本地没有未落盘输入 → mergeBookDoc 按块合并 / 回填属性，推进 base；
 * - 本地有未落盘输入且 incoming 就是我们刚保存成功的正文回流（== base.text）→ 远端并没有新改动，只推进 base.doc，
 *   **不做**三方合并：拿保存前的旧 base 去比会把刚保存的文本当成远端插入再套一遍 → 正文重复（qa-01 / ux-01）；
 * - 本地有未落盘输入且 incoming 是真正的远端改动 → mergeRemoteDoc 三方合并；conflict 时本地优先、base 不动。
 */
export function planIncoming(state: EditorState, next: PmNode, local: string | null, incoming: string, base: SyncBase, pending: boolean): IncomingPlan {
  if (local !== incoming && pending) {
    if (incoming === base.text) return { merge: null, advance: 'doc' }
    const r = base.doc ? mergeRemoteDoc(state, next, base.doc) : 'conflict'
    if (r === 'conflict' || r === null) return { merge: null, advance: 'none' }
    return { merge: r, advance: 'all' }
  }
  return { merge: mergeBookDoc(state, next), advance: 'all' }
}

/** 返回 null 表示两 doc 相等（无事可做） */
export function mergeBookDoc(state: EditorState, next: PmNode): MergeResult | null {
  const cur = state.doc
  if (cur.eq(next)) return null
  const n = cur.childCount
  const m = next.childCount
  let prefix = 0
  while (prefix < n && prefix < m && cur.child(prefix).eq(next.child(prefix))) prefix++
  let suffix = 0
  while (suffix < n - prefix && suffix < m - prefix && cur.child(n - 1 - suffix).eq(next.child(m - 1 - suffix))) suffix++
  let from = 0
  for (let i = 0; i < prefix; i++) from += cur.child(i).nodeSize
  const to = cur.content.size - sizeAfter(cur, suffix)
  const sel = selectionAnchor(state)
  const inside = touches(sel, prefix, n - suffix)
  const replacement = next.content.cut(sizeBefore(next, prefix), next.content.size - sizeAfter(next, suffix))
  let tr = state.tr.replaceWith(from, to, replacement)
  if (!cur.attrs.book || cur.attrs.lead !== next.attrs.lead || cur.attrs.trail !== next.attrs.trail || cur.attrs.book !== next.attrs.book) {
    tr = tr.setDocAttribute('lead', next.attrs.lead).setDocAttribute('trail', next.attrs.trail).setDocAttribute('book', next.attrs.book)
  }
  if (inside) tr = tr.setSelection(restoreSelection(tr.doc, sel))
  tr = keepStoredMarks(state, tr).setMeta('addToHistory', false).setMeta('ps-merge', true)
  return { tr, from: prefix, to: n - suffix }
}

/**
 * 本地有未保存改动（cur ≠ base）时的三方合并：远端相对 base 的改动区间（顶层块）套到本地；
 * 若该区间与本地脏区（cur 相对 base 的差异区）重叠：同一个纯文本块内两端改动的字符区间不重叠时按字符套（同段各改一处互不覆盖），
 * 否则 'conflict'（本地优先，随后本地保存覆盖）；base 为上一次与服务端 / 房间同步时的 doc。cur 与 base 相等时退化为 mergeBookDoc。
 */
export function mergeRemoteDoc(state: EditorState, next: PmNode, base: PmNode): MergeResult | 'conflict' | null {
  const cur = state.doc
  if (cur.eq(base)) return mergeBookDoc(state, next)
  if (base.eq(next)) return null
  const bn = base.childCount
  const [rp, rs] = commonEnds(base, next)
  const [lp, ls] = commonEnds(cur, base)
  // 远端改动区（base 索引）[rp, bn - rs)；本地脏区（base 索引）[lp, bn - ls)
  const rFrom = rp
  const rTo = bn - rs
  const dFrom = lp
  const dTo = bn - ls
  const before = rTo <= dFrom
  const after = rFrom >= dTo
  if (!before && !after) {
    const oneBlock = rFrom === dFrom && rTo === rFrom + 1 && dTo === rTo && cur.childCount === bn && next.childCount === bn
    return (oneBlock && mergeTextBlock(state, next, base, rFrom)) || 'conflict'
  }
  const shift = before ? 0 : cur.childCount - bn
  const cFrom = rFrom + shift
  const cTo = rTo + shift
  const from = sizeBefore(cur, cFrom)
  const to = sizeBefore(cur, cTo)
  const sel = selectionAnchor(state)
  const inside = touches(sel, cFrom, cTo)
  const replacement = next.content.cut(sizeBefore(next, rp), next.content.size - sizeAfter(next, rs))
  let tr = state.tr.replaceWith(from, to, replacement)
  if (cur.attrs.lead !== next.attrs.lead || cur.attrs.trail !== next.attrs.trail) {
    tr = tr.setDocAttribute('lead', next.attrs.lead).setDocAttribute('trail', next.attrs.trail)
  }
  if (inside) tr = tr.setSelection(restoreSelection(tr.doc, sel))
  tr = keepStoredMarks(state, tr).setMeta('addToHistory', false).setMeta('ps-merge', true)
  return { tr, from: cFrom, to: cTo }
}

/** 同一顶层纯文本块（子节点全是 text，位置 = 块起点 + 1 + 字符偏移）内的字符级三方合并；区间重叠 / 非纯文本 → null */
function mergeTextBlock(state: EditorState, next: PmNode, base: PmNode, idx: number): MergeResult | null {
  const cur = state.doc
  const cb = cur.child(idx)
  const nb = next.child(idx)
  const bb = base.child(idx)
  if (cb.type !== bb.type || nb.type !== bb.type || !textOnly(cb) || !textOnly(nb) || !textOnly(bb)) return null
  const bt = bb.textContent
  const nt = nb.textContent
  const ct = cb.textContent
  const [ra, rb] = strEnds(bt, nt)
  const [la, lb] = strEnds(bt, ct)
  const rFrom = ra
  const rTo = bt.length - rb
  const dFrom = la
  const dTo = bt.length - lb
  const before = rTo <= dFrom
  const after = rFrom >= dTo
  if (!before && !after) return null
  const shift = before ? 0 : ct.length - bt.length
  const start = sizeBefore(cur, idx) + 1
  const from = start + rFrom + shift
  const to = start + rTo + shift
  const tr = keepStoredMarks(state, state.tr.insertText(nt.slice(ra, nt.length - rb), from, to)).setMeta('addToHistory', false).setMeta('ps-merge', true)
  return { tr, from: idx, to: idx + 1 }
}

function textOnly(n: PmNode): boolean {
  if (!n.isTextblock) return false
  for (let i = 0; i < n.childCount; i++) if (!n.child(i).isText) return false
  return true
}

/** 刚按下 Ctrl+B 还没打字时的 storedMarks 不被回填事务清掉 */
function keepStoredMarks(state: EditorState, tr: Transaction): Transaction {
  return state.storedMarks ? tr.setStoredMarks(state.storedMarks) : tr
}

/** 选区任一端落在被替换的顶层块区间 [from, to) 内 */
function touches(s: SelectionAnchor, from: number, to: number): boolean {
  const inRange = (a: CursorAnchor) => a.index >= from && a.index < to
  return inRange(s.anchor) || inRange(s.head)
}

/** 字符串公共前缀 / 后缀长度（后缀不与前缀重叠） */
function strEnds(a: string, b: string): [number, number] {
  const max = Math.min(a.length, b.length)
  let p = 0
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++
  return [p, s]
}

/** 顶层块公共前缀 / 后缀长度 */
function commonEnds(a: PmNode, b: PmNode): [number, number] {
  const n = a.childCount
  const m = b.childCount
  let prefix = 0
  while (prefix < n && prefix < m && a.child(prefix).eq(b.child(prefix))) prefix++
  let suffix = 0
  while (suffix < n - prefix && suffix < m - prefix && a.child(n - 1 - suffix).eq(b.child(m - 1 - suffix))) suffix++
  return [prefix, suffix]
}

function sizeBefore(doc: PmNode, count: number): number {
  let s = 0
  for (let i = 0; i < count; i++) s += doc.child(i).nodeSize
  return s
}
function sizeAfter(doc: PmNode, count: number): number {
  let s = 0
  for (let i = doc.childCount - count; i < doc.childCount; i++) s += doc.child(i).nodeSize
  return s
}
