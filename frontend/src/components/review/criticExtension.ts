import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import type { CriticKind, CriticMark } from '@/lib/types'
import { useStudio } from '@/store'
import { findBlockLines } from '@/store/blocks'
import { currentView } from '@/components/workbench/viewSwitchPlan'
import { activePmView } from '@/components/layout-view/editor/activeView'
import { topBlock, selectionText } from '@/components/layout-view/toolbar/commands'
import { blockAttrsOf } from '@/components/layout-view/doc/bookSchema'

/**
 * CodeMirror CriticMarkup 装饰扩展（C5-review-ui；docs/plan/07 §5.3 / §7.1）。
 * 数据来源：store review.marks（后端 POST /critic，前端不解析）；Editor.tsx 以 `setCriticMarks.of(marks)` 推入。
 * 渲染：{++ins++} 绿底下划线 / {--del--} 红底删除线 / {~~a~>b~~} 红删除线 + 绿下划线两段 /
 *       {>>c<<} 黄底斜体带气泡 / {==m==} 黄底；标记符本身 40% 透明弱化但不隐藏（源码所见即所得）。
 * 每条标记末尾挂一个行内小按钮组「✓ 接受 / ✗ 拒绝」，默认调 store.acceptMark/rejectMark（可用 criticActions facet 覆盖，测试用）。
 * 颜色不是唯一信息载体：ins/del 另带下划线/删除线，按钮有 aria-label。
 */
export const setCriticMarks = StateEffect.define<readonly CriticMark[]>()

export interface CriticActions {
  accept(id: string): void
  reject(id: string): void
}

const storeActions: CriticActions = {
  accept: (id) => useStudio.getState().acceptMark(id),
  reject: (id) => useStudio.getState().rejectMark(id),
}

export const criticActions = Facet.define<CriticActions, CriticActions>({
  combine: (values) => values[0] ?? storeActions,
})

export const CRITIC_KIND_LABEL: Record<CriticKind, string> = {
  ins: '插入',
  del: '删除',
  sub: '替换',
  comment: '批注',
  mark: '高亮',
}

const OPEN: Record<CriticKind, string> = { ins: '{++', del: '{--', sub: '{~~', comment: '{>>', mark: '{==' }
const CLOSE: Record<CriticKind, string> = { ins: '++}', del: '--}', sub: '~~}', comment: '<<}', mark: '==}' }
const SUB_ARROW = '~>'

const sym = Decoration.mark({ class: 'cm-critic-sym' })
const body: Record<CriticKind, Decoration> = {
  ins: Decoration.mark({ class: 'cm-critic cm-critic-ins' }),
  del: Decoration.mark({ class: 'cm-critic cm-critic-del' }),
  sub: Decoration.mark({ class: 'cm-critic cm-critic-sub' }),
  comment: Decoration.mark({ class: 'cm-critic cm-critic-comment' }),
  mark: Decoration.mark({ class: 'cm-critic cm-critic-mark' }),
}

class ActionsWidget extends WidgetType {
  readonly mark: CriticMark
  constructor(mark: CriticMark) {
    super()
    this.mark = mark
  }
  eq(other: ActionsWidget) {
    return other.mark.id === this.mark.id && other.mark.kind === this.mark.kind
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-critic-actions'
    wrap.setAttribute('data-testid', 'critic-actions')
    wrap.setAttribute('data-mark-id', this.mark.id)
    const label = CRITIC_KIND_LABEL[this.mark.kind]
    const mk = (text: string, aria: string, run: (a: CriticActions) => void, cls: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `cm-critic-btn ${cls}`
      b.textContent = text
      b.setAttribute('aria-label', aria)
      b.title = aria
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => {
        e.preventDefault()
        run(view.state.facet(criticActions))
      })
      wrap.appendChild(b)
    }
    if (this.mark.kind === 'comment' || this.mark.kind === 'mark') {
      mk('✓', `去除${label}标记（第 ${this.mark.line} 行）`, (a) => a.accept(this.mark.id), 'cm-critic-btn-accept')
    } else {
      mk('✓', `接受${label}（第 ${this.mark.line} 行）`, (a) => a.accept(this.mark.id), 'cm-critic-btn-accept')
      mk('✗', `拒绝${label}（第 ${this.mark.line} 行）`, (a) => a.reject(this.mark.id), 'cm-critic-btn-reject')
    }
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

/** 一条标记 → 装饰区间；标记文本与 from/to 对不上（编辑后过期）时退化为整段单色 */
function markRanges(m: CriticMark, base: number, text: string, out: Range<Decoration>[]) {
  const seg = text.slice(m.from, m.to)
  const open = OPEN[m.kind]
  const close = CLOSE[m.kind]
  const push = (from: number, to: number, deco: Decoration) => {
    if (to > from) out.push(deco.range(base + from, base + to))
  }
  const exact = seg.startsWith(open) && seg.endsWith(close) && seg.length >= open.length + close.length
  if (!exact) {
    push(m.from, m.to, body[m.kind])
    return
  }
  const innerFrom = m.from + open.length
  const innerTo = m.to - close.length
  push(m.from, innerFrom, sym)
  if (m.kind === 'sub') {
    const arrowAt = innerFrom + m.a.length
    const arrowOk = text.slice(arrowAt, arrowAt + SUB_ARROW.length) === SUB_ARROW && arrowAt + SUB_ARROW.length <= innerTo
    if (arrowOk) {
      push(innerFrom, arrowAt, body.del)
      push(arrowAt, arrowAt + SUB_ARROW.length, sym)
      push(arrowAt + SUB_ARROW.length, innerTo, body.ins)
    } else {
      push(innerFrom, innerTo, body.sub)
    }
  } else {
    push(innerFrom, innerTo, body[m.kind])
  }
  push(innerTo, m.to, sym)
}

function buildDecorations(marks: readonly CriticMark[], doc: EditorState['doc']): DecorationSet {
  if (marks.length === 0) return Decoration.none
  const out: Range<Decoration>[] = []
  for (const m of marks) {
    if (m.line < 1 || m.line > doc.lines) continue
    const line = doc.line(m.line)
    if (m.from < 0 || m.to > line.length || m.from >= m.to) continue
    markRanges(m, line.from, line.text, out)
    out.push(Decoration.widget({ widget: new ActionsWidget(m), side: 1 }).range(line.from + m.to))
  }
  return Decoration.set(out, true)
}

interface CriticState {
  marks: readonly CriticMark[]
  deco: DecorationSet
}

const criticField = StateField.define<CriticState>({
  create: () => ({ marks: [], deco: Decoration.none }),
  update(value, tr) {
    let marks = value.marks
    let changed = false
    for (const e of tr.effects) {
      if (e.is(setCriticMarks)) {
        marks = e.value
        changed = true
      }
    }
    if (!changed && !tr.docChanged) return value
    return { marks, deco: tr.docChanged && !changed ? value.deco.map(tr.changes) : buildDecorations(marks, tr.state.doc) }
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.deco),
})

/** 当前装饰集（测试 / 面板计数用） */
export function criticDecorations(state: EditorState): DecorationSet {
  return state.field(criticField).deco
}

export function countDecorations(set: DecorationSet, cls?: string): number {
  let n = 0
  const it = set.iter()
  while (it.value) {
    const spec = it.value.spec as { class?: string; widget?: unknown }
    if (!cls || spec.class?.split(' ').includes(cls) || (cls === 'widget' && spec.widget)) n++
    it.next()
  }
  return n
}

const criticTheme = EditorView.baseTheme({
  '.cm-critic-sym': { opacity: '0.4' },
  '.cm-critic-ins': {
    backgroundColor: 'var(--success-soft)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--success)',
    textUnderlineOffset: '2px',
  },
  '.cm-critic-del': {
    backgroundColor: 'var(--destructive-soft)',
    textDecoration: 'line-through',
    textDecorationColor: 'var(--destructive)',
  },
  '.cm-critic-sub': { backgroundColor: 'var(--accent)' },
  '.cm-critic-comment': {
    backgroundColor: 'var(--warning-soft)',
    color: 'var(--warning-foreground)',
    fontStyle: 'italic',
    borderRadius: '3px',
    paddingLeft: '2px',
  },
  '.cm-critic-comment::before': { content: '"💬"', fontStyle: 'normal', fontSize: '0.85em', marginRight: '2px', opacity: '0.8' },
  '.cm-critic-mark': { backgroundColor: 'var(--warning-soft)' },
  '.cm-critic-actions': {
    display: 'inline-flex',
    gap: '2px',
    marginLeft: '3px',
    marginRight: '2px',
    verticalAlign: 'baseline',
    opacity: '0.7',
  },
  '.cm-line:hover .cm-critic-actions, .cm-critic-actions:focus-within': { opacity: '1' },
  '.cm-critic-btn': {
    position: 'relative',
    font: 'inherit',
    fontSize: '0.8em',
    lineHeight: '1',
    padding: '1px 4px',
    borderRadius: '4px',
    border: '1px solid var(--border)',
    background: 'var(--background)',
    color: 'inherit',
    cursor: 'pointer',
  },
  /*
   * 375 / 触摸：视觉仍是行内小按钮，命中区用伪元素扩到 44×44（W6 §可访问性）。热区从按钮左边起向右延伸（不往左伸到行首 gutter 上），
   * 两枚间距 ≥ 44 - 按钮宽 保证热区不互盖；控件组本身撑到 44 高（所在视觉行随之变高），换行后上下两组标记的热区不互盖；
   * 控件组提到同行文本 / 相邻标记符号之上，伪元素才能真正接到点击。
   */
  '@media (max-width: 767px), (pointer: coarse)': {
    '.cm-critic-actions': {
      gap: 'calc(var(--h-touch) - 1em)',
      position: 'relative',
      zIndex: '1',
      height: 'var(--h-touch)',
      alignItems: 'center',
      verticalAlign: 'middle',
    },
    '.cm-critic-btn::after': {
      content: '""',
      position: 'absolute',
      left: '0',
      top: '50%',
      width: 'var(--h-touch)',
      height: 'var(--h-touch)',
      transform: 'translateY(-50%)',
    },
  },
  '.cm-critic-btn:hover': { background: 'var(--accent)' },
  '.cm-critic-btn:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '1px' },
  '.cm-critic-btn-accept': { color: 'var(--success)' },
  '.cm-critic-btn-reject': { color: 'var(--destructive)' },
})

export interface EditorSelectionInfo {
  /** 选区首行（全文 1-based） */
  line: number
  /** 选中文字（去首尾空白，最长 120 字）；无选区时为光标所在行文字 */
  quote: string
  empty: boolean
}

/** 存活的编辑器视图，末尾为最近创建 / 最近获得焦点者（桌面按书分卡 + 全文卡可同时存在，销毁一张时回退到另一张） */
const liveViews: EditorView[] = []
let activeView: EditorView | null = null

const promote = (view: EditorView) => {
  const i = liveViews.indexOf(view)
  if (i >= 0) liveViews.splice(i, 1)
  liveViews.push(view)
  activeView = view
}

const trackView = ViewPlugin.define((view) => {
  promote(view)
  return {
    update(u) {
      if (u.focusChanged && u.view.hasFocus && activeView !== u.view) promote(u.view)
    },
    destroy() {
      const i = liveViews.indexOf(view)
      if (i >= 0) liveViews.splice(i, 1)
      if (activeView === view) activeView = liveViews.at(-1) ?? null
    },
  }
})

/** 当前编辑器选区 → 批注锚点素材（ReviewPanel「添加批注」）；无编辑器时 null */
export function editorSelection(): EditorSelectionInfo | null {
  const s = useStudio.getState()
  // 版面态取 ProseMirror（W12 R12-05）：不分派会在桌面 toast「请先打开编辑器」、375 读到隐藏 CM 的陈旧选区锚错行
  if (currentView({ activePanelId: s.activePanelId, editorView: s.editorView }).view === 'layout') return pmEditorSelection()
  if (!activeView) return null
  const { state } = activeView
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.from)
  const raw = sel.empty ? line.text : state.sliceDoc(sel.from, sel.to)
  const quote = raw.replace(/\s+/g, ' ').trim().slice(0, 120)
  return { line: line.number + viewLineBase(state), quote, empty: sel.empty }
}

/** 版面（ProseMirror）选区 → 锚点素材；行口径同 SelectionPopover（块首行），选区引文 / 空选区取该行文本 */
function pmEditorSelection(): EditorSelectionInfo | null {
  const view = activePmView()
  if (!view) return null
  const s = useStudio.getState()
  const sel = view.state.selection
  const top = topBlock(view.state)
  const blockId = top ? (blockAttrsOf(top.node).blockId ?? '') : ''
  const loc = blockId && s.ast ? findBlockLines(s.ast, blockId) : null
  // 光标不在已回填块内（未点进正文 / 新块未回填）→ 退 store 光标行，能否锚定由调用方 draftBlockId 判
  const line = loc ? loc.offset + loc.start : s.cursor.line
  const raw = !sel.empty ? selectionText(view.state) : (s.content.split('\n')[line - 1] ?? '')
  return { line, quote: raw.replace(/\s+/g, ' ').trim().slice(0, 120), empty: sel.empty }
}

/** 单书卡片 / 375 单书编辑器只装本书切片：切片在 content.md 中的起始行号偏移（全文编辑器为 0） */
function viewLineBase(state: EditorState): number {
  const full = useStudio.getState().content
  const text = state.doc.toString()
  if (text === full) return 0
  const at = full.indexOf(text)
  if (at < 0) return 0
  let n = 0
  for (let i = 0; i < at; i++) if (full.charCodeAt(i) === 10) n++
  return n
}

/** 挑一条 mark：把光标放到其起点并滚到视口中部（面板行 → 编辑器） */
export function revealMark(mark: CriticMark): boolean {
  if (!activeView) return false
  const { doc } = activeView.state
  const ln = mark.line - viewLineBase(activeView.state)
  if (ln < 1 || ln > doc.lines) return false
  const l = doc.line(ln)
  const pos = l.from + Math.min(mark.from, l.length)
  activeView.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  activeView.focus()
  return true
}

export function criticExtension(actions?: CriticActions): Extension {
  return [criticField, criticTheme, trackView, ...(actions ? [criticActions.of(actions)] : [])]
}
