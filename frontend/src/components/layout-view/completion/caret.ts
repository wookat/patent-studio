import type { PopupAnchor } from '../slash/PopupList'

/**
 * 块编辑器（ProseMirror contenteditable，class ps-pm）内的光标探测。
 * D3 不持有 EditorView（BlockEditor 是 B2 的黑盒），所以 `/` 与「图 / 表 / 式」触发只看 DOM Selection：
 * 光标所在最近块级元素从头到光标的文本。
 */
export function caretContext(root: HTMLElement): { editor: HTMLElement; before: string; rect: DOMRect } | null {
  const sel = root.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const node = sel.anchorNode
  if (!node || !root.contains(node)) return null
  const editor = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>('.ps-pm')
  if (!editor) return null
  const line = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>('p, h1, h2, h3, h4, li, td, th, pre, div') ?? editor
  const range = root.ownerDocument.createRange()
  range.setStart(line, 0)
  range.setEnd(node, sel.anchorOffset)
  const before = range.toString()
  return { editor, before, rect: sel.getRangeAt(0).getBoundingClientRect() }
}

const POPUP_MIN_W = 192

/** 光标矩形 → 相对弹层容器的 left/top（弹层 absolute 定位在容器内；靠右时左移，不撑出容器触发横向滚动） */
export function anchorIn(container: HTMLElement, rect: DOMRect): PopupAnchor {
  const box = container.getBoundingClientRect()
  const x = rect.left - box.left + container.scrollLeft
  const maxX = Math.max(0, container.clientWidth - POPUP_MIN_W - 8)
  return { x: Math.min(x, maxX), y: rect.bottom - box.top + container.scrollTop + 4 }
}

/**
 * 往 contenteditable 光标处插入纯文本：优先 execCommand('insertText')（ProseMirror 通过 DOM 观察吸收为正常输入，可撤销），
 * 不可用时用 Selection 手工插入并派发 input 事件。
 */
export function insertPlainText(editor: HTMLElement, text: string): boolean {
  const doc = editor.ownerDocument
  editor.focus()
  if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)) return true
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const tn = doc.createTextNode(text)
  range.insertNode(tn)
  range.setStartAfter(tn)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  return true
}
