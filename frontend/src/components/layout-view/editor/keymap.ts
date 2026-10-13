import { chainCommands, joinBackward, newlineInCode, splitBlock } from 'prosemirror-commands'
import { canJoin } from 'prosemirror-transform'
import { redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { Fragment, type Node as PmNode } from 'prosemirror-model'
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { goToNextCell } from 'prosemirror-tables'
import { bookSchema } from '../doc/bookSchema'

/**
 * 整书键盘（22 §2 决策 1）：
 * - Enter：段落 / 标题内分段（标题后新段是普通段落）；权项内 Enter = 新权项（文本前缀 `N.`，N = 位置序号）；
 *   公式 / 图（atom）选中时 Enter 不做事（编辑由双击）；代码块内 Enter = 换行。
 * - Shift+Enter：内核无软换行 → 吞掉。
 * - Backspace 行首：并入上一块（joinBackward）；块内首段且上一块是 atom 时不删 atom。
 * - Tab / Shift+Tab：表格内换格（goToNextCell），表格外吞掉不改结构。
 * - Mod-z / Shift-Mod-z / Mod-y：整书 prosemirror-history。
 */

const { ps_para, ps_claim, ps_heading, ps_code } = bookSchema.nodes

/** 权项文本的 `N.` 前缀（与内核 num_written 同形） */
export const CLAIM_PREFIX_RE = /^\s*(\d+)\s*[.、．]\s*/

/** 光标所在的顶层块索引与节点 */
export function topBlockAt(state: EditorState, pos = state.selection.from): { index: number; node: PmNode; pos: number } {
  const $pos = state.doc.resolve(pos)
  const index = $pos.index(0)
  return { index, node: $pos.node(1) ?? state.doc.child(index), pos: $pos.before(1) }
}

/** 权项内 Enter：在光标处切开，光标后文本成为新权项的首段，前缀 `N.`（N = 新权项位置） */
export const splitClaim: Command = (state, dispatch) => {
  const { $from, $to, empty } = state.selection
  if (!(state.selection instanceof TextSelection)) return false
  const claimDepth = findDepth($from, ps_claim)
  if (claimDepth < 0) return false
  if ($from.parent.type !== ps_para) return false
  if (!empty && !$from.sameParent($to)) return false
  if (dispatch) {
    const claimIndex = $from.index(0)
    const num = claimIndex + 2
    let tr = state.tr
    if (!empty) tr = tr.deleteSelection()
    const $cut = tr.doc.resolve(tr.mapping.map($from.pos))
    const claimEnd = $cut.after(claimDepth)
    const claimNode = $cut.node(claimDepth)
    // 光标后的内容（本段余下 + 后续段）
    const tail = claimNode.slice($cut.pos - $cut.start(claimDepth), claimNode.content.size).content
    const prefix = bookSchema.text(`${num}.`)
    let firstPara: PmNode
    const rest: PmNode[] = []
    if (tail.childCount > 0 && tail.firstChild!.type === ps_para) {
      firstPara = ps_para.create({ blockId: null, kind: null }, Fragment.from(prefix).append(tail.firstChild!.content))
      for (let i = 1; i < tail.childCount; i++) rest.push(tail.child(i))
    } else {
      firstPara = ps_para.create({ blockId: null, kind: null }, prefix)
      tail.forEach((n) => rest.push(n))
    }
    const newClaim = ps_claim.create({ blockId: null, kind: 'claim' }, [firstPara, ...rest])
    tr = tr.delete($cut.pos, claimEnd - 1)
    const insertAt = tr.mapping.map(claimEnd)
    tr = tr.insert(insertAt, newClaim)
    tr = tr.setSelection(TextSelection.create(tr.doc, insertAt + 2 + prefix.nodeSize))
    dispatch(renumberClaims(tr).scrollIntoView())
  }
  return true
}

/** 标题内 Enter：标题末尾 → 其后新建普通段；标题中间 → 切成两段（后半成普通段） */
const splitHeading: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!(state.selection instanceof TextSelection) || $from.parent.type !== ps_heading) return false
  if (dispatch) {
    let tr = state.tr.deleteSelection()
    const $cut = tr.doc.resolve(tr.mapping.map($from.pos))
    const after = $cut.after()
    const tail = $cut.parent.content.cut($cut.parentOffset)
    tr = tr.delete($cut.pos, after - 1)
    const para = ps_para.create({ blockId: null, kind: 'paragraph' }, tail)
    const at = tr.mapping.map(after)
    tr = tr.insert(at, para).setSelection(TextSelection.create(tr.doc, at + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** 普通 Enter：分段，新段 blockId 置空（等服务端 AST 回填），kind 继承为 paragraph */
const splitParagraph: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!(state.selection instanceof TextSelection) || $from.parent.type !== ps_para) return false
  return splitBlock(state, dispatch ? (tr) => dispatch(fixSplitAttrs(tr)) : undefined)
}

function fixSplitAttrs(tr: Transaction): Transaction {
  const $pos = tr.selection.$from
  const node = $pos.parent
  if (node.type === ps_para && (node.attrs.blockId !== null || node.attrs.kind !== 'paragraph')) {
    tr.setNodeMarkup($pos.before(), undefined, { ...node.attrs, blockId: null, kind: 'paragraph' })
  }
  return tr
}

const atomEnter: Command = (state) => state.selection instanceof NodeSelection

const swallow: Command = () => true

/** Backspace 行首：上一块是 atom（公式 / 图）时不删它，只把光标移到它上（避免误删） */
/**
 * 权项前缀 `N.` 是正文（num_written）：增删权项后按位置重写每个权项首段的前缀，使源码编号连续；
 * 引用文本（「根据权利要求 2」）不动 —— 引用重编号是内核 lint 的事。
 */
export function renumberClaims(tr: Transaction): Transaction {
  const edits: { from: number; to: number; text: string }[] = []
  tr.doc.forEach((claim, pos, i) => {
    if (claim.type !== ps_claim) return
    const first = claim.firstChild
    if (!first || first.type !== ps_para) return
    const want = `${i + 1}.`
    const m = CLAIM_PREFIX_RE.exec(first.textContent)
    const start = pos + 2
    if (!m) edits.push({ from: start, to: start, text: want })
    else if (m[0] !== want) edits.push({ from: start, to: start + m[0].length, text: want })
  })
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i]!
    tr.insertText(e.text, e.from, e.to)
  }
  return tr
}

/** 权项首段行首 Backspace：去掉本权项的 `N.` 前缀，并入上一权项（段与上一权项末段合并），其后权项重编号 */
const mergeClaimBackward: Command = (state, dispatch) => {
  const { $from } = state.selection
  const claimDepth = findDepth($from, ps_claim)
  if (claimDepth < 0 || $from.parent.type !== ps_para || $from.index(claimDepth) !== 0) return false
  const claimIndex = $from.index(0)
  if (claimIndex === 0) return true
  const prev = state.doc.child(claimIndex - 1)
  if (prev.type !== ps_claim) return false
  if (dispatch) {
    let tr = state.tr
    const m = CLAIM_PREFIX_RE.exec($from.parent.textContent)
    if (m) tr = tr.delete($from.pos, $from.pos + m[0].length)
    const boundary = tr.mapping.map($from.before(claimDepth))
    tr = tr.join(boundary)
    const paraStart = tr.mapping.map($from.before())
    if (canJoin(tr.doc, paraStart) && tr.doc.resolve(paraStart).nodeBefore?.type === ps_para) tr = tr.join(paraStart)
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map($from.pos)), -1))
    dispatch(renumberClaims(tr).scrollIntoView())
  }
  return true
}

const backspaceAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset > 0 || !(state.selection instanceof TextSelection)) return false
  const before = $from.index($from.depth - 1) > 0 ? $from.node($from.depth - 1).child($from.index($from.depth - 1) - 1) : null
  if (before?.isAtom) {
    if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $from.before() - before.nodeSize)))
    return true
  }
  if (mergeClaimBackward(state, dispatch)) return true
  return joinBackward(state, dispatch)
}

const inCode: Command = (state, dispatch) => (state.selection.$from.parent.type === ps_code ? newlineInCode(state, dispatch) : false)

export const bookEnter: Command = chainCommands(atomEnter, inCode, splitClaim, splitHeading, splitParagraph, splitBlock)
export const bookBackspace: Command = chainCommands(backspaceAtStart)

export function bookKeymap() {
  return keymap({
    Enter: bookEnter,
    'Shift-Enter': swallow,
    Backspace: bookBackspace,
    Tab: chainCommands(goToNextCell(1), swallow),
    'Shift-Tab': chainCommands(goToNextCell(-1), swallow),
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
  })
}

function findDepth($pos: { depth: number; node(d: number): PmNode }, type: PmNode['type']): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === type) return d
  return -1
}
