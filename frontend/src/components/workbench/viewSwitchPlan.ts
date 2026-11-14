import { makePanelId, parsePanelId, type BookView, type OpenPanelOptions, type PanelId } from '@/store/layout'
import type { EditorView } from '@/store/ui'
import { findBlockLines } from '@/store/blocks'
import { blockAtLine, type Ast, type BookName } from '@/types/ast'

/**
 * W9 决策 6：三视图一体控件的纯逻辑（无 React / 无 store 副作用，vitest 直接测）。
 *  - 视图是**全局**的：`源码 | 版面 | PDF` 分段切换把所有同视图的书卡片一起换成目标视图（卡头只剩书名 Tab），
 *    活动卡片最后替换以保持焦点；PDF 是单卡，切到 PDF = 聚焦 / 原位替换活动卡片。
 *  - 「并排」= 当前视图 + PDF 双栏（dockview 现有 split：PDF 卡放在活动卡片右侧）。
 *  - 切换保持案子 / 书 / 当前块：从 activeBlock（缺省光标行所在块）算出 Focus，目标视图挂载后 useFocusConsumer 重放即回到同块。
 */
export type ThreeView = EditorView | 'pdf'

export const THREE_VIEWS: readonly ThreeView[] = ['source', 'layout', 'pdf']

/** 三视图显示文案（ViewSwitch / ViewTabs 共源） */
export const VIEW_LABEL: Record<ThreeView, string> = { source: '源码', layout: '版面', pdf: 'PDF' }

export interface ViewSwitchState {
  activePanelId: PanelId | null
  editorView: EditorView
  activeBook: BookView
  /** dock 当前打开的面板；null = 无 dock（375 / 窄桌面回退） */
  openPanels: readonly PanelId[] | null
  ast: Ast | null
  activeBlockId: string | null
  /** 全文 1-based 光标行（activeBlock 缺省时用它找块） */
  cursorLine: number
}

export type PanelOp = { type: 'open'; id: PanelId; opts?: OpenPanelOptions } | { type: 'close'; id: PanelId }

export interface BlockFocus {
  book: BookName
  blockId: string
  line: number
}

export interface ViewSwitchPlan {
  /** 需要写回的 store.editorView（PDF 不改） */
  editorView: EditorView | null
  ops: PanelOp[]
  /** 切换前的当前块（目标视图定位用）；无 AST / 无块 → null */
  focus: BlockFocus | null
}

export function isThreeView(kind: string): kind is ThreeView {
  return kind === 'source' || kind === 'layout' || kind === 'pdf'
}

/** 活动卡片当前是哪一视图；非三视图卡片 / 无 dock 回退到 editorView */
export function currentView(s: Pick<ViewSwitchState, 'activePanelId' | 'editorView'>): { view: ThreeView; panelId: PanelId | null; book: BookView | null } {
  const p = s.activePanelId ? parsePanelId(s.activePanelId) : null
  if (p && isThreeView(p.kind)) return { view: p.kind, panelId: s.activePanelId, book: p.book }
  return { view: s.editorView, panelId: null, book: null }
}

/** 切换前的当前块：activeBlock 优先，其次光标行所在块 */
export function blockFocusOf(s: Pick<ViewSwitchState, 'ast' | 'activeBlockId' | 'cursorLine'>): BlockFocus | null {
  if (!s.ast) return null
  if (s.activeBlockId) {
    const loc = findBlockLines(s.ast, s.activeBlockId)
    if (loc) return { book: loc.book, blockId: s.activeBlockId, line: loc.offset + loc.start }
  }
  const at = blockAtLine(s.ast, s.cursorLine)
  return at ? { book: at.book, blockId: at.block.id, line: s.ast.books[at.book].offset + at.block.lines.start } : null
}

function panelsOfKind(open: readonly PanelId[], kind: ThreeView): PanelId[] {
  return open.filter((id) => parsePanelId(id)?.kind === kind)
}

export function planViewSwitch(view: ThreeView, s: ViewSwitchState): ViewSwitchPlan {
  const cur = currentView(s)
  const focus = blockFocusOf(s)
  const editorView = view === 'pdf' ? null : view
  const book: BookView = cur.book ?? (focus?.book ?? s.activeBook)
  if (view === cur.view && (s.openPanels === null || cur.panelId)) return { editorView, ops: [], focus }

  if (s.openPanels === null) {
    return { editorView, ops: [{ type: 'open', id: view === 'pdf' ? 'pdf' : makePanelId(view, book) }], focus }
  }
  const open = s.openPanels
  const ops: PanelOp[] = []

  if (view === 'pdf') {
    if (open.includes('pdf')) ops.push({ type: 'open', id: 'pdf' })
    else ops.push({ type: 'open', id: 'pdf', opts: cur.panelId ? { replace: cur.panelId } : undefined })
    return { editorView, ops, focus }
  }

  if (cur.view === 'pdf' || !cur.panelId) {
    const want = makePanelId(view, book)
    const all = makePanelId(view, 'all')
    const same = panelsOfKind(open, view)
    if (same.includes(want)) ops.push({ type: 'open', id: want })
    else if (same.includes(all)) ops.push({ type: 'open', id: all })
    else if (same.length) ops.push({ type: 'open', id: same[0] })
    else ops.push({ type: 'open', id: want, opts: cur.panelId ? { replace: cur.panelId } : undefined })
    return { editorView, ops, focus }
  }

  // 源码 ↔ 版面：所有同视图卡片一起换，活动卡片最后（保持焦点）；目标已存在的卡片只关旧
  const active = cur.panelId
  const others = panelsOfKind(open, cur.view).filter((id) => id !== active)
  let focusTarget: PanelId | null = null
  for (const id of [...others, active]) {
    const target = makePanelId(view, parsePanelId(id)?.book ?? book)
    if (open.includes(target)) {
      ops.push({ type: 'close', id })
      if (id === active) focusTarget = target
    } else ops.push({ type: 'open', id: target, opts: { replace: id } })
  }
  if (focusTarget) ops.push({ type: 'open', id: focusTarget })
  return { editorView, ops, focus }
}

/** 并排（当前视图 + PDF）是否已成立：PDF 卡与至少一张源码 / 版面卡同时打开 */
export function isSideBySide(openPanels: readonly PanelId[] | null): boolean {
  if (!openPanels || !openPanels.includes('pdf')) return false
  return openPanels.some((id) => {
    const k = parsePanelId(id)?.kind
    return k === 'source' || k === 'layout'
  })
}

export function planSideBySide(on: boolean, s: Pick<ViewSwitchState, 'activePanelId' | 'editorView' | 'openPanels'>): PanelOp[] {
  if (s.openPanels === null) return []
  const cur = currentView(s)
  if (on) {
    if (s.openPanels.includes('pdf')) return []
    const ref = cur.panelId && cur.view !== 'pdf' ? cur.panelId : (s.openPanels.find((id) => ['source', 'layout'].includes(parsePanelId(id)?.kind ?? '')) ?? null)
    return [{ type: 'open', id: 'pdf', opts: ref ? { position: { referencePanel: ref, direction: 'right' } } : undefined }]
  }
  if (!s.openPanels.includes('pdf') || cur.view === 'pdf') return []
  return [{ type: 'close', id: 'pdf' }]
}

const HOTKEY_VIEW: Record<string, ThreeView> = { '1': 'source', '2': 'layout', '3': 'pdf', Digit1: 'source', Digit2: 'layout', Digit3: 'pdf' }

/** Ctrl+1/2/3（macOS ⌘）→ 视图；带 Alt / Shift 不算（Mod-Alt-1/2/3 仍由 editor/ViewTabs 的旧热键处理） */
export function viewForHotkey(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>, isMac = false): ThreeView | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.altKey || e.shiftKey) return null
  return HOTKEY_VIEW[e.key] ?? HOTKEY_VIEW[e.code] ?? null
}
