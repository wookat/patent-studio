import { EditorSelection, type EditorState, type Text, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { openSearchPanel, SearchQuery, setSearchQuery } from '@codemirror/search'
import { selectReadonly, useStudio } from '@/store'
import { sectionAt } from './section'
import { MSG_READONLY } from '@/lib/copy'
import { bookAtLine, splitBooks } from '@/lib/docset'
import type { BookName } from '@/types/ast'

/**
 * 编辑命令接口（07 §2.1 编辑器）：模块级 registry，CodeMirror 视图挂载时注册，
 * 供 EditorToolbar、C1 菜单「编辑 ▸ 插入」与 C4 控制台「一键修复」调用。
 *  - insert(kind)：按光标所在位置/章节插入专利 Markdown 模板（块级模板独占一行）
 *  - replaceLine(line, from, to)：把第 line 行（1-based）中首个 `from` 换成 `to`；from='' 表示整行替换
 *  - replaceLines(lineStart, lineEnd, text)：把闭区间整段换成 text（AI 建议 / 术语统一的 CriticMarkup 写入）
 * 纯函数 insertSpec / replaceLineSpec / replaceLinesSpec 只依赖 EditorState，可在 node 下单测。
 */

export type InsertKind = 'h2' | 'h3' | 'formula' | 'subscript' | 'table' | 'figure' | 'claimRef'

export const INSERT_KINDS: readonly InsertKind[] = ['h2', 'h3', 'formula', 'subscript', 'table', 'figure', 'claimRef']

export const INSERT_LABELS: Record<InsertKind, string> = {
  h2: '章节标题 ##',
  h3: '小节标题 ###',
  formula: '公式 $$…$$',
  subscript: '下标 _{}',
  table: '表格',
  figure: '附图引用',
  claimRef: '权项引用',
}

const HEADING_PREFIX = /^#{1,6}\s*/
const CLAIM_START = /^(\d+)\s*[.．、]/
const FIGURE_NUM = /图\s*(\d+)/g
const TABLE_CAPTION = /^表\s*(\d+)\s/
const SUBJECT_IN_CLAIM_1 = /^1\s*[.．、]\s*一种(.+?)[，,]/

function maxMatch(doc: Text, re: RegExp, lineRe = false): number {
  let max = 0
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text
    if (lineRe) {
      const m = re.exec(text)
      if (m) max = Math.max(max, Number(m[1]))
      continue
    }
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) max = Math.max(max, Number(m[1]))
  }
  return max
}

/** 权项主题词（方法 / 系统 / 装置…）：取权项 1「一种……，」的末两字，找不到用「方法」 */
export function claimSubject(doc: Text): string {
  for (let i = 1; i <= doc.lines; i++) {
    const m = SUBJECT_IN_CLAIM_1.exec(doc.line(i).text)
    if (m) {
      const s = m[1].trim()
      return s.length >= 2 ? s.slice(-2) : s || '方法'
    }
  }
  return '方法'
}

/** 光标所在行之前最近的权项号（用于「根据权利要求 N」默认值） */
function precedingClaimNumber(doc: Text, lineNo: number): number {
  for (let i = lineNo; i >= 1; i--) {
    const m = CLAIM_START.exec(doc.line(i).text)
    if (m) return Number(m[1])
  }
  return 0
}

interface Template {
  text: string
  /** 相对 text 起点的选区（默认光标落在末尾） */
  select?: [number, number]
  /** true = 独占一行（前后保证换行） */
  block?: boolean
}

function selectWord(text: string, word: string): [number, number] {
  const i = text.indexOf(word)
  return i < 0 ? [text.length, text.length] : [i, i + word.length]
}

function template(state: EditorState, kind: InsertKind): Template | null {
  const doc = state.doc
  const sel = state.selection.main
  const head = doc.lineAt(sel.head)
  switch (kind) {
    case 'formula': {
      const text = '$$公式$$'
      return { text, select: selectWord(text, '公式'), block: true }
    }
    case 'subscript': {
      const selected = state.sliceDoc(sel.from, sel.to)
      if (selected && !selected.includes('\n')) return { text: `_{${selected}}` }
      return { text: '_{}', select: [2, 2] }
    }
    case 'table': {
      const n = maxMatch(doc, TABLE_CAPTION, true) + 1
      const text = `表${n} 表题\n\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |`
      return { text, select: selectWord(text, '表题'), block: true }
    }
    case 'figure': {
      const sec = sectionAt(doc, head.number)
      const max = maxMatch(doc, FIGURE_NUM)
      if (sec.sub === '附图说明') {
        const n = max + 1
        const text = `图${n}为本发明实施例的示意图；`
        return { text, select: selectWord(text, '示意图'), block: true }
      }
      const n = Math.max(1, max)
      const text = `如图${n}所示，`
      return { text, select: selectWord(text, String(n)) }
    }
    case 'claimRef': {
      const sec = sectionAt(doc, head.number)
      const cur = sec.claim ?? precedingClaimNumber(doc, head.number)
      const n = Math.max(1, cur - (sec.claim != null ? 1 : 0))
      const text = `根据权利要求${n}所述的${claimSubject(doc)}，其特征在于，`
      return { text, select: selectWord(text, String(n)) }
    }
    default:
      return null
  }
}

/** 行首标题前缀：已有 `#` 前缀则替换级别，否则加在行首 */
function headingSpec(state: EditorState, level: 2 | 3): TransactionSpec {
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  const prefix = `${'#'.repeat(level)} `
  const m = HEADING_PREFIX.exec(line.text)
  const oldLen = m ? m[0].length : 0
  const changes = { from: line.from, to: line.from + oldLen, insert: prefix }
  const rest = line.text.slice(oldLen)
  return { changes, selection: { anchor: line.from + prefix.length + rest.length }, scrollIntoView: true, userEvent: 'input' }
}

/** 计算插入事务；返回 null 表示该 kind 在当前状态下无事可做 */
export function insertSpec(state: EditorState, kind: InsertKind): TransactionSpec | null {
  if (kind === 'h2') return headingSpec(state, 2)
  if (kind === 'h3') return headingSpec(state, 3)
  const tpl = template(state, kind)
  if (!tpl) return null
  const sel = state.selection.main
  let from = sel.from
  let to = sel.to
  let text = tpl.text
  let offset = 0
  if (tpl.block) {
    const line = state.doc.lineAt(sel.head)
    if (line.text.trim()) {
      from = to = line.to
      text = `\n${text}`
      offset = 1
    } else {
      from = line.from
      to = line.to
    }
  }
  const [s0, s1] = tpl.select ?? [tpl.text.length, tpl.text.length]
  return {
    changes: { from, to, insert: text },
    selection: EditorSelection.range(from + offset + s0, from + offset + s1),
    scrollIntoView: true,
    userEvent: 'input',
  }
}

/** 第 line 行（1-based）中首个 `from` → `to`；from='' 整行替换。找不到返回 null */
export function replaceLineSpec(state: EditorState, line: number, from: string, to: string): TransactionSpec | null {
  if (line < 1 || line > state.doc.lines) return null
  const l = state.doc.line(line)
  let start = l.from
  let end = l.to
  if (from) {
    const i = l.text.indexOf(from)
    if (i < 0) return null
    start = l.from + i
    end = start + from.length
  }
  return {
    changes: { from: start, to: end, insert: to },
    selection: { anchor: start + to.length },
    scrollIntoView: true,
    userEvent: 'input',
  }
}

/** [lineStart, lineEnd]（1-based 闭区间）整段 → text（可多行）；区间非法返回 null */
export function replaceLinesSpec(state: EditorState, lineStart: number, lineEnd: number, text: string): TransactionSpec | null {
  if (lineStart < 1 || lineEnd < lineStart || lineEnd > state.doc.lines) return null
  const from = state.doc.line(lineStart).from
  const to = state.doc.line(lineEnd).to
  return {
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  }
}

export interface EditorCommandState {
  ready: boolean
  canUndo: boolean
  canRedo: boolean
}

export interface EditorCommands {
  /** 光标处插入模板；无视图 / 无事可做返回 false */
  insert(kind: InsertKind): boolean
  /** 光标处插入任意文本（替换选区） */
  insertText(text: string): boolean
  /** 第 line 行（1-based）内 from → to；from='' 整行替换。找不到返回 false */
  replaceLine(line: number, from: string, to: string): boolean
  /** [lineStart, lineEnd] 整段 → text；无视图 / 区间非法返回 false */
  replaceLines(lineStart: number, lineEnd: number, text: string): boolean
  undo(): boolean
  redo(): boolean
  openSearch(query?: string): boolean
  focus(): void
  getState(): EditorCommandState
  /** 视图注册/注销或每次文档/选区更新后回调 */
  subscribe(cb: () => void): () => void
}

let view: EditorView | null = null
/** 已注册视图的行基：全文行 = 视图行 + lineBase()（单书卡片 = 本书在 content.md 里的 offset；全文编辑器 = 0） */
let lineBase: () => number = () => 0
const listeners = new Set<() => void>()
const IDLE: EditorCommandState = { ready: false, canUndo: false, canRedo: false }
let snapshot: EditorCommandState = IDLE

function computeState(): EditorCommandState {
  if (!view) return IDLE
  return { ready: true, canUndo: undoDepth(view.state) > 0, canRedo: redoDepth(view.state) > 0 }
}

function emit() {
  const next = computeState()
  if (next.ready !== snapshot.ready || next.canUndo !== snapshot.canUndo || next.canRedo !== snapshot.canRedo) snapshot = next
  for (const cb of listeners) cb()
}

/**
 * 由 CodeMirrorEditor / CardEditor 在挂载、聚焦 / 卸载时调用。
 * 命令接口里的行号一律是 content.md 全文行（诊断 / 术语 / AI 建议 / OA 都由后端按全文给出）；
 * 单书卡片的视图只含本书正文，由 `base` 换算，落在本书之外的行返回 false 交给调用方的 store 回退路径。
 */
export function registerEditorView(v: EditorView | null, base: () => number = () => 0) {
  view = v
  lineBase = v ? base : () => 0
  emit()
}

/**
 * 冷路径回退：编辑器从未聚焦过时 view 为空（registerCard 只在聚焦时注册，用于多卡仲裁）。
 * 读操作（开查找框）按 store 光标所在书的卡片在 DOM 里找回 CM 视图并注册，行基取该书 offset；
 * 无法定位书时取文档序里第一张源码卡。卡片未挂载（版面视图等）或 jsdom 外 → null，调用方走原有回退。
 */
function ensureView(): EditorView | null {
  if (view) return view
  if (typeof document === 'undefined') return null
  const s = useStudio.getState()
  const ds = splitBooks(s.content)
  const book = bookAtLine(ds, s.cursor.line || 1)
  const host =
    (book ? document.querySelector(`[data-testid="card-source-${book}"]`) : null) ??
    document.querySelector('[data-testid^="card-source-"]')
  const cm = host?.querySelector('.cm-content')
  const v = cm instanceof HTMLElement ? (EditorView.findFromDOM(cm) ?? null) : null
  if (!v) return null
  const hostBook = host?.getAttribute('data-testid')?.slice('card-source-'.length) as BookName | undefined
  const offset = hostBook ? (ds.books[hostBook]?.offset ?? 0) : 0
  registerEditorView(v, () => offset)
  return v
}

/** 全文行 → 已注册视图的行；不在视图范围内返回 null */
function toViewLine(fullLine: number): number | null {
  if (!view) return null
  const l = fullLine - lineBase()
  return l >= 1 && l <= view.state.doc.lines ? l : null
}

/** 由 CodeMirrorEditor 的 updateListener 在文档/选区变化后调用 */
export function notifyEditorUpdate() {
  emit()
}

/**
 * CM 的 `EditorState.readOnly` 只挡 DOM 输入（键入/粘贴/拖放），programmatic dispatch 照常改本地文档；
 * 只读角色（viewer / reviewer / collabReadonly）下写命令走这里统一拦，否则本地静默分叉、刷新被真值覆盖。
 */
function writable(): boolean {
  const s = useStudio.getState()
  if (!selectReadonly(s)) return true
  s.toast(MSG_READONLY, 'info')
  return false
}

function run(spec: TransactionSpec | null): boolean {
  if (!view || !spec) return false
  view.dispatch(spec)
  view.focus()
  return true
}

export const editorCommands: EditorCommands = {
  insert: (kind) => (view && writable() ? run(insertSpec(view.state, kind)) : false),
  insertText(text) {
    if (!view || !writable()) return false
    const sel = view.state.selection.main
    return run({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, scrollIntoView: true, userEvent: 'input' })
  },
  replaceLine(line, from, to) {
    const l = toViewLine(line)
    return view && l != null && writable() ? run(replaceLineSpec(view.state, l, from, to)) : false
  },
  replaceLines(lineStart, lineEnd, text) {
    const a = toViewLine(lineStart)
    const b = toViewLine(lineEnd)
    return view && a != null && b != null && writable() ? run(replaceLinesSpec(view.state, a, b, text)) : false
  },
  undo() {
    if (!view) return false
    const ok = undo(view)
    view.focus()
    return ok
  },
  redo() {
    if (!view) return false
    const ok = redo(view)
    view.focus()
    return ok
  },
  openSearch(query?: string) {
    const v = view ?? ensureView()
    if (!v) return false
    const ok = openSearchPanel(v)
    // 携带外部查询词（rail 搜索面板的「在编辑器中查找替换」），与面板大小写不敏感口径一致
    if (ok && query) v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) })
    return ok
  },
  focus() {
    view?.focus()
  },
  getState: () => snapshot,
  subscribe(cb) {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  },
}
