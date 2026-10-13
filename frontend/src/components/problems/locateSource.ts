import { bookAtFullLine } from '@/components/cards/sync'
import { revealView } from '@/components/editor/ViewTabs'
import { isDesktopViewport, useStudio } from '@/store'
import { splitBooks } from '@/lib/docset'
import { blockAtLine, type Ast, type BookName } from '@/types/ast'
import type { FocusSource } from '@/types/focus'

/**
 * 诊断 / 体检结果 → 源码行（W7 domain-02）：`revealView('source', book)` + `setFocus{book,line}`。
 * 源码卡片（useSourceFocus）收到 Focus 后把该行滚到视口中央并闪烁 --focus-ring；被遮住的书 tab 由 revealView 露出。
 *  - 后端 Diagnostic 没有 book 字段：按 AST 块（blockAtLine）或 content 书段（bookAtFullLine）从全文行反查；
 *    头部 / 书标题行落不到任何书 → 退回 gotoLine（全文卡片 / 移动编辑 Tab 仍能滚到该行）。
 *  - 递交页没有 dock（DesktopShell 未挂载）：先写 Focus，等 dockHandle 注册后再 revealView（源码卡片挂载时重放最近一次 Focus）；
 *    dock 刚挂载时 CodeMirror 还没量完行高 / 面板尺寸未定，中心滚动会偏，所以布局稳定后再重发一次同一 Focus（仍是同一目标时才重发）。
 *  - 移动壳：gotoLine（切到编辑 Tab）+ Focus（编辑器同样滚到中央闪烁）。
 */

export interface SourceTarget {
  book: BookName | null
  line: number
  blockId?: string | null
  source?: FocusSource
}

/** 全文行所在的书：优先 AST 块，其次 content 书段，`## 书名` 标题行算该书（空书只剩标题时定位仍能开卡片）；头部 → null */
export function bookForLine(ast: Ast | null, content: string, line: number): BookName | null {
  if (ast) {
    const loc = blockAtLine(ast, line)
    if (loc) return loc.book
  }
  return bookAtFullLine(content, line) ?? bookOfHeadingLine(content, line)
}

function bookOfHeadingLine(content: string, line: number): BookName | null {
  const split = splitBooks(content)
  for (const b of split.order) if (split.books[b]?.offset === line) return b
  return null
}

/** dock 挂载 → 源码卡片 CodeMirror 测量完成的安全等待（两帧不够：dockview 开面板 + CM 首次量高都在下一任务） */
export const SETTLE_MS = 250

let pendingDock: (() => void) | null = null
let settleTimer: number | null = null

type FocusReq = { book: BookName; blockId: string; line: number; source: FocusSource }

/** 布局稳定后重发同一 Focus（seq 变 → 源码卡片重新居中）；用户已另行定位则不打断 */
function resettle(focus: FocusReq): void {
  if (settleTimer != null) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    const cur = useStudio.getState().focus
    if (cur && cur.book === focus.book && cur.line === focus.line && cur.source === focus.source) useStudio.getState().setFocus(focus)
  }, SETTLE_MS)
}

/** dock 尚未注册（递交页 → 工作台路由切换中）：等 dockHandle 出现再执行；新的定位请求覆盖旧的 */
function whenDockReady(fn: () => void): void {
  pendingDock?.()
  const unsub = useStudio.subscribe((st) => {
    if (!st.dockHandle) return
    unsub()
    pendingDock = null
    fn()
  })
  pendingDock = unsub
}

/**
 * 定位到源码行。返回实际用到的书（null = 只能 gotoLine，无法按书打开源码卡片）。
 * 调用方（问题面板 / 体检 / 递交页）不必知道 dock 是否存在。
 */
export function locateSourceLine(target: SourceTarget): BookName | null {
  const s = useStudio.getState()
  const { line } = target
  const source = target.source ?? 'problems'
  const book = target.book ?? bookForLine(s.ast, s.content, line)
  const blockId = target.blockId ?? (s.ast ? blockAtLine(s.ast, line)?.block.id ?? null : null)
  if (!book) {
    mobileGoto(line)
    return null
  }
  const focus: FocusReq = { book, blockId: blockId ?? '', line, source }
  if (s.dockHandle) {
    revealView('source', book)
    s.setCursor({ line, col: 1 })
    s.setFocus(focus)
    return book
  }
  if (isDesktopViewport()) {
    s.setCursor({ line, col: 1 })
    s.setFocus(focus)
    whenDockReady(() => {
      revealView('source', book)
      useStudio.getState().setFocus(focus)
      resettle(focus)
    })
    return book
  }
  mobileGoto(line)
  s.setFocus(focus)
  return book
}

/**
 * 侧栏 / 伴随栏里的「跳到源码行」（文件树书行、附图题注、删除对话框引用行）：
 * 桌面 dock 已挂 → locateSourceLine（露出 / 新开该书源码卡片；只发 scrollRequest 时未开卡片会无声失败）；否则 gotoLine。
 */
export function gotoSourceLine(line: number, book: BookName | null = null, source: FocusSource = 'outline'): void {
  const s = useStudio.getState()
  if (s.dockHandle) locateSourceLine({ book, line, source })
  else s.gotoLine(line)
}

/** 窄屏：伴随栏是盖住编辑器的 Sheet（MobileShell），定位后先收起再滚到行，否则高亮行被面板遮住 */
function mobileGoto(line: number): void {
  const s = useStudio.getState()
  if (s.companion && !isDesktopViewport()) s.closeCompanion()
  s.gotoLine(line)
}
