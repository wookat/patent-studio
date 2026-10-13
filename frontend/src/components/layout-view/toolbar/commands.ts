import { Fragment, type Node as PmNode } from 'prosemirror-model'
import { TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { setBlockType, toggleMark } from 'prosemirror-commands'
import type { BlockTemplate } from '@/lib/api'
import type { BookName } from '@/types/ast'
import { BOOK_MARK_NAMES, blockAttrsOf, bookSchema, type BookBlockKind, type BookMarkName } from '../doc/bookSchema'
import { inlineNodes } from '../doc/inline'

/**
 * W9 格式工具条的纯命令（docs/plan/22 决策 2）：只依赖 doc/bookSchema，与 BookEditor 解耦，FormatBar / SelectionPopover / keymap 共用。
 * - marks：prosemirror-commands `toggleMark`；subscript ↔ superscript 互斥由 schema `excludes` 保证（加上标自动去下标）。
 * - setBlockKind：同一块内的文本级转换（正文 / 表题 / 图题 / `###` 章节 / `####` 小节 / 权项），blockId 保留，序列化后单块改动走块补丁。
 * - insertBlock：以后端 block-templates（SlashMenu 同一候选源）的 markdown 样板建节点，插到光标所在顶层块之后。
 */

export type MarkName = BookMarkName
export const MARK_NAMES = BOOK_MARK_NAMES

/** 段落样式下拉可切换的目标；equation / table / code / figure 是结构块，不能由文本块转换 */
export type TextBlockKind = 'paragraph' | 'table-caption' | 'figure-caption' | 'section' | 'subsection' | 'claim'
export const TEXT_BLOCK_KINDS: readonly TextBlockKind[] = ['paragraph', 'section', 'subsection', 'claim', 'table-caption', 'figure-caption']

const { ps_para, ps_heading, ps_equation, ps_table, ps_row, ps_cell, ps_claim } = bookSchema.nodes

export function markType(name: MarkName) {
  return bookSchema.marks[name]
}

export function isMarkActive(state: EditorState, name: MarkName): boolean {
  const type = markType(name)
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

export function activeMarks(state: EditorState): Set<MarkName> {
  const out = new Set<MarkName>()
  for (const name of MARK_NAMES) if (isMarkActive(state, name)) out.add(name)
  return out
}

/** 切换 mark；下标 / 上标互斥（schema excludes） */
export const toggleMarkCmd = (name: MarkName): Command => toggleMark(markType(name))

/** 键位：Ctrl/⌘+B / I / U，Ctrl/⌘+, 下标，Ctrl/⌘+. 上标（与 Word 一致） */
export const FORMAT_KEYS: Record<string, Command> = {
  'Mod-b': toggleMarkCmd('strong'),
  'Mod-B': toggleMarkCmd('strong'),
  'Mod-i': toggleMarkCmd('em'),
  'Mod-I': toggleMarkCmd('em'),
  'Mod-u': toggleMarkCmd('underline'),
  'Mod-U': toggleMarkCmd('underline'),
  'Mod-,': toggleMarkCmd('subscript'),
  'Mod-.': toggleMarkCmd('superscript'),
}

/** 光标所在顶层块（depth 1）；空文档 / 无选区 null */
export function topBlock(state: EditorState): { node: PmNode; pos: number; index: number } | null {
  const $from = state.selection.$from
  if ($from.depth < 1) {
    const idx = $from.index(0)
    const node = state.doc.maybeChild(idx)
    return node ? { node, pos: $from.posAtIndex(idx, 0), index: idx } : null
  }
  return { node: $from.node(1), pos: $from.before(1), index: $from.index(0) }
}

/** 当前块的样式名（段落样式下拉显示值）：权项内 / 权项块 → claim；标题按 level；段落按 attrs.kind */
export function currentBlockKind(state: EditorState): BookBlockKind | null {
  const top = topBlock(state)
  if (!top) return null
  const n = top.node
  if (n.type === ps_heading) return n.attrs.level === 4 ? 'subsection' : 'section'
  if (n.type === ps_para) return (blockAttrsOf(n).kind as BookBlockKind | null) ?? 'paragraph'
  return blockAttrsOf(n).kind as BookBlockKind | null
}

const bookOf = (state: EditorState): BookName | null => (state.doc.attrs.book as BookName | null) ?? null

/** 书允许的样式：说明书全部；权利要求书只有权项 / 正文；摘要只有正文 */
export function kindAllowedIn(book: BookName | null, kind: TextBlockKind): boolean {
  if (!book) return true
  if (book === 'abstract') return kind === 'paragraph'
  if (book === 'claims') return kind === 'claim' || kind === 'paragraph'
  return kind !== 'claim'
}

/**
 * 转换当前块的样式。文本块（ps_para / ps_heading / 权项内段）之间互转；结构块不可转。
 * 权项 → 正文：把 ps_claim 的首段提升为顶层 ps_para（多段权项取全部段并列）；正文 → 权项：包一层 ps_claim。
 */
export function setBlockKind(kind: TextBlockKind): Command {
  return (state, dispatch) => {
    const top = topBlock(state)
    if (!top || !kindAllowedIn(bookOf(state), kind)) return false
    const { node, pos } = top
    const blockId = blockAttrsOf(node).blockId
    const end = pos + node.nodeSize

    if (node.type === ps_claim) {
      if (kind === 'claim') return false
      const paras = node.content.content.filter((c) => c.type === ps_para)
      if (!paras.length) return false
      const out = paras.map((p, i) => textBlock(kind, i === 0 ? stripClaimNo(p.content) : p.content, i === 0 ? blockId : null))
      if (dispatch) {
        const tr = state.tr.replaceWith(pos, end, out)
        dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView())
      }
      return true
    }
    if (node.type !== ps_para && node.type !== ps_heading) return false
    if (kind === currentBlockKind(state)) return false

    if (kind === 'claim') {
      if (dispatch) {
        const content = withClaimNo(node.content, claimsBefore(state.doc, top.index) + 1)
        const claim = ps_claim.create({ blockId, kind: 'claim' }, ps_para.create({ blockId: null, kind: null }, content))
        const tr = state.tr.replaceWith(pos, end, claim)
        dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2))).scrollIntoView())
      }
      return true
    }
    const target = kind === 'section' || kind === 'subsection' ? ps_heading : ps_para
    const attrs = kind === 'section' || kind === 'subsection' ? { level: kind === 'section' ? 3 : 4, blockId, kind } : { blockId, kind }
    return setBlockType(target, attrs)(state, dispatch)
  }
}

const textBlock = (kind: TextBlockKind, content: PmNode['content'], blockId: string | null): PmNode =>
  kind === 'section' || kind === 'subsection'
    ? ps_heading.create({ level: kind === 'section' ? 3 : 4, blockId, kind }, content)
    : ps_para.create({ blockId, kind: kind === 'claim' ? 'paragraph' : kind }, content)

export const canSetBlockKind = (state: EditorState, kind: TextBlockKind): boolean => setBlockKind(kind)(state)

const stripHeading = (md: string) => md.replace(/^#{3,4}\s*/, '')
const CLAIM_NO_RE = /^\d+\s*[.．、]\s*/

/** 权项号在文本内（内核 `N.` 语法，与 AST claims[].segments[0].text 一致）：正文 → 权项补号，权项 → 正文去号 */
function stripClaimNo(content: Fragment): Fragment {
  const first = content.firstChild
  if (!first?.isText || !CLAIM_NO_RE.test(first.text!)) return content
  const rest = first.text!.replace(CLAIM_NO_RE, '')
  return rest ? content.replaceChild(0, bookSchema.text(rest, first.marks)) : content.cut(first.nodeSize)
}

function withClaimNo(content: Fragment, n: number): Fragment {
  const first = content.firstChild
  if (first?.isText && CLAIM_NO_RE.test(first.text!)) return content
  return Fragment.from(bookSchema.text(`${n}.`)).append(content)
}

const claimsBefore = (doc: PmNode, index: number): number => {
  let n = 0
  for (let i = 0; i < index; i++) if (doc.child(i).type === ps_claim) n++
  return n
}

/** GFM 样板 → ps_table（`<!-- 表格: 三线 -->` 选项行 → three_line；分隔行跳过） */
function tableFromTemplate(md: string): PmNode {
  const lines = md.split('\n')
  const three = lines.some((l) => /^<!--\s*表格.*三线/.test(l))
  const rows = lines
    .filter((l) => l.trim().startsWith('|') && !/^\|?\s*:?-{2,}/.test(l.trim()))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
  const width = Math.max(1, ...rows.map((r) => r.length))
  const rowNodes = rows.map((cells) =>
    ps_row.create(null, Array.from({ length: width }, (_, i) => ps_cell.create(null, cells[i] ? bookSchema.text(cells[i]) : null))),
  )
  return ps_table.create({ three_line: three, blockId: null, kind: 'table' }, rowNodes)
}

/** 后端 block-templates 样板（与 SlashMenu 同源）→ bookSchema 节点；不认识的 kind 返回 null */
export function nodeFromTemplate(t: BlockTemplate): PmNode | null {
  const md = t.markdown
  switch (t.kind) {
    case 'paragraph':
    case 'figure-ref':
      return ps_para.create({ blockId: null, kind: 'paragraph' }, inlineNodes(md))
    case 'section':
      return ps_heading.create({ level: 3, blockId: null, kind: 'section' }, inlineNodes(stripHeading(md)))
    case 'subsection':
      return ps_heading.create({ level: 4, blockId: null, kind: 'subsection' }, inlineNodes(stripHeading(md)))
    case 'equation':
      return ps_equation.create({ source: md.replace(/^\$\$/, '').replace(/\$\$$/, ''), blockId: null, kind: 'equation' })
    case 'claim':
      return ps_claim.create({ blockId: null, kind: 'claim' }, ps_para.create({ blockId: null, kind: null }, inlineNodes(md)))
    case 'table':
      return tableFromTemplate(md)
    default:
      return null
  }
}

/** 在光标所在顶层块之后插入样板块并把光标放进去（样板 cursor 行列在整块内换算） */
export function insertBlock(t: BlockTemplate): Command {
  return (state, dispatch) => {
    if (!t.book.includes(bookOf(state) ?? t.book[0])) return false
    let node = nodeFromTemplate(t)
    if (!node) return false
    const top = topBlock(state)
    const at = top ? top.pos + top.node.nodeSize : state.doc.content.size
    if (node.type === ps_claim) {
      const n = claimsBefore(state.doc, top ? top.index + 1 : 0) + 1
      const first = node.firstChild!
      node = ps_claim.create(node.attrs, ps_para.create(first.attrs, withClaimNo(Fragment.from(inlineNodes(first.textContent.replace(CLAIM_NO_RE, ''))), n)))
    }
    if (dispatch) {
      const tr = state.tr.insert(at, node)
      const inner = node.isAtom ? at : at + 1 + (node.type === ps_claim ? 1 : 0) + (node.type === ps_table ? 2 : 0)
      const $p = tr.doc.resolve(Math.min(inner, tr.doc.content.size))
      dispatch(tr.setSelection(node.isAtom ? TextSelection.near($p) : TextSelection.near($p, 1)).scrollIntoView())
    }
    return true
  }
}

/** 选区文本（跨块用换行连接；批注引文） */
export const selectionText = (state: EditorState): string => state.doc.textBetween(state.selection.from, state.selection.to, '\n')
