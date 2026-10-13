import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent,
} from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { TextSelection, type Plugin } from 'prosemirror-state'
import { Button } from '@/components/ui/button'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Block } from '@/components/block-model/blocks'
import { BlockActionsContext, type BlockActions } from '@/components/block-model/context'
import { equationLine } from '@/components/block-model/edit/serialize'
import { focusBlock, openDeleteDialog } from '@/components/block-model/dialogs/state'
import { deleteDisabledReason } from '@/components/block-model/dialogs/lookup'
import { TITLE_ID, blockEntries, claimId, diagnosticsByBlock, type BlockDiagnostic } from '@/components/block-model/model'
import { useBlockTemplates, type InsertAnchor } from '@/components/block-model/toolbar/insert'
import { useIsDesktop } from '@/hooks/useMisc'
import { blockElement, flash, useFocusConsumer } from '@/lib/focusSync'
import { createPdfGestures } from '@/components/preview/gestures'
import { cn } from '@/lib/utils'
import { blockSource, findBlockLines, makePanelId, selectAstStale, useStudio } from '@/store'
import { readHeadings } from '@/store/styleEdit'
import { blockAtLine, type AstEquation, type BookName } from '@/types/ast'
import { NumberMenu } from './completion/NumberMenu'
import { numberCandidates } from './completion/numberCompletion'
import { toCritic } from './mode/toCritic'
import { BookEditor } from './editor/BookEditor'
import { focusBlockStart } from './editor/bookView'
import { criticDecorations, criticKey, criticPosOf, setCriticActive, setCriticLevel } from './review/criticDecorations'
import { isEditableLevel } from './review/markupLevel'
import { FormatBar } from './toolbar/FormatBar'
import { SelectionPopover } from './toolbar/SelectionPopover'
import { FORMAT_KEYS } from './toolbar/commands'
import { useMobileBoldSlot } from './toolbar/MobileBoldAction'
import { useLayoutHistorySlot } from './toolbar/useLayoutHistorySlot'
import { HeadingStylePanel } from './style-panel/HeadingStylePanel'
import { Paper } from './Paper'
import { LayoutDecorations } from './LayoutDecorations'
import { FiguresPaperBody } from './paper/FiguresPaper'
import { SlashMenu } from './slash/SlashMenu'
import { EquationEditor } from './equation'
import { EquationSheet, LayoutCommentDrawer, mobileNotice, type CommentDraftTarget } from './mobile/LayoutMobile'
import { TableToolbar } from './table'
import { useInsertMenus } from './useInsertMenus'
import { PART_HEADER_LABEL, type LayoutViewProps, type PaperPart } from './slots'
import { styleVars, useStyleCss } from './styleCss'
import './layout-view.css'

const BOOK_NAMES: readonly BookName[] = ['abstract', 'claims', 'description']
const READONLY_HINT = '只读模式 — 切到编辑 / 审阅模式后才能修改'
const MARKUP_READONLY_HINT = '当前标记档为只读投影 — 切到「所有标记」后才能修改'
/**
 * PDF 选块落光标：等 dock 激活 / 选区条卸载抢完焦点再试，最多 PDF_CARET_RETRIES × PDF_CARET_RETRY_MS；
 * 落上后还要再确认一拍焦点没被同一轮清理（选区条卸载 / 面板激活）拢回 body，被拢就重新落。
 */
const PDF_CARET_RETRIES = 10
const PDF_CARET_RETRY_MS = 50
/** 焦点已被另一个可输入控件接管 → 不再抢回 */
const FOCUS_OWNER_SELECTOR = 'input, textarea, select, [contenteditable="true"], .cm-content'
/** 模式条上的用法提示（「点击正文直接输入…」）关过一次就不再出；模式条本身仍承载审阅徽章 / 更新中 / 解析失败等状态 */
export const LAYOUT_NOTICE_KEY = 'patent-studio:layout-notice-dismissed'
const readNoticeDismissed = (): boolean => {
  try {
    return localStorage.getItem(LAYOUT_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}
const writeNoticeDismissed = () => {
  try {
    localStorage.setItem(LAYOUT_NOTICE_KEY, '1')
  } catch {
    /* 隐身模式等：本次会话内仍生效 */
  }
}

/** 只读模式下的输入提示：每次挂载只弹一次 */
function useReadonlyHint(toast: (msg: string, kind: 'info') => void, hint = READONLY_HINT) {
  const shown = useRef(false)
  return useCallback(() => {
    if (shown.current) return
    shown.current = true
    toast(hint, 'info')
  }, [toast, hint])
}

/**
 * 版面视图（docs/plan/16 / 22 决策 1）：store.ast → 连续 A4 纸面（不分页，页码以 PDF 为准），三书各一个整书 ProseMirror（<BookEditor/>），
 * 字体 / 字号 / 边距全部来自 --ps-* 变量（<style> 注入 GET /style.css；501 回退 layout-view.css；未保存的 settings.style 内联覆盖）。
 * 编辑：点哪写哪，停 600ms / 失焦 / 卸载→ store.saveBook(book, md, {review})（bookDiff → 块补丁 / 整书 PUT）；readonly 只能选取。
 * 插入：空行行首 `/` 或工具条「插入」→ <SlashMenu/>（候选 = 后端模板按书过滤；说明书多一项「附图…」→ 打开附图书面板）→ insertBlock；
 * 补全：输入「图 / 表 / 式」→ <NumberMenu/>（候选只来自 AST）→ 插入纯文本。公式块双击→ EquationEditor。
 */
export function LayoutView({ className, books = BOOK_NAMES, mode, slots }: LayoutViewProps) {
  const ast = useStudio((s) => s.ast)
  const astError = useStudio((s) => s.astError)
  const loading = useStudio((s) => s.astLoading)
  const unavailable = useStudio((s) => s.astUnavailable)
  const stale = useStudio(selectAstStale)
  const pid = useStudio((s) => s.pid)
  const settings = useStudio((s) => s.settings)
  const activeBlock = useStudio((s) => s.activeBlock)
  const cursorLine = useStudio((s) => s.cursor.line)
  const items = useStudio((s) => s.items)
  const setActiveBlock = useStudio((s) => s.setActiveBlock)
  const setCursor = useStudio((s) => s.setCursor)
  const gotoLine = useStudio((s) => s.gotoLine)
  const toast = useStudio((s) => s.toast)
  const content = useStudio((s) => s.content)
  const patchBlock = useStudio((s) => s.patchBlock)
  const saveBook = useStudio((s) => s.saveBook)
  const toolbarPanel = useStudio((s) => s.layoutViewToolbar)
  const setToolbarPanel = useStudio((s) => s.setLayoutViewToolbar)
  const insertBlock = useStudio((s) => s.insertBlock)
  const isDesktop = useIsDesktop()
  const mobile = !isDesktop
  const setFocus = useStudio((s) => s.setFocus)
  const css = useStyleCss(pid)
  const templates = useBlockTemplates()
  const templatesError = useStudio((s) => s.blockTemplatesError)
  const markupLevel = useStudio((s) => s.markupLevel)
  const activeMarkId = useStudio((s) => s.activeMarkId)
  const setActiveMark = useStudio((s) => s.setActiveMark)
  const hasMarks = useStudio((s) => s.marks.length > 0)

  const editable = mode !== 'readonly'
  // 审阅模式下简单 / 无标记 / 原始三档是只读投影（markupLevel.ts）：文中有 CriticMarkup 时编辑器 editable=false（隐藏区段上不能落笔）；
  // 无标记时四档投影同文，继续可编辑（改动仍经 toCritic 落建议）
  const markupReadonly = mode === 'review' && !isEditableLevel(markupLevel) && hasMarks
  const bookMode = markupReadonly ? 'readonly' : mode
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const setBodyRef = useCallback((el: HTMLDivElement | null) => {
    bodyRef.current = el
    setBodyEl(el)
  }, [])
  const pagesRef = useRef<HTMLDivElement>(null)
  const readonlyHint = useReadonlyHint(toast, markupReadonly ? MARKUP_READONLY_HINT : READONLY_HINT)

  const bookSet = useMemo(() => new Set<BookName>(books), [books])
  const entries = useMemo(() => (ast ? blockEntries(ast).filter((e) => bookSet.has(e.book)) : []), [ast, bookSet])
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const diags = useMemo(() => (ast ? diagnosticsByBlock(ast, items) : new Map<string, BlockDiagnostic>()), [ast, items])
  const vars = useMemo(() => styleVars(settings?.style), [settings?.style])
  const numbering = useMemo(() => {
    const h = readHeadings(settings?.style)
    return { h3: h.section.numbering, h4: h.subsection.numbering }
  }, [settings?.style])
  const labels = settings?.style?.header?.labels

  const activeId = activeBlock?.id ?? null
  const tabStopId = activeId && byId.has(activeId) ? activeId : entries[0]?.id ?? null

  // 窄屏中间档（平板）：整张纸按容器宽缩放不回流；375 移动模式（.ps-layout-mobile）改为真重排（R-LAY-04），不缩放
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const body = bodyRef.current
    const pages = pagesRef.current
    if (mobile || !body || !pages || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const pageW = pages.offsetWidth
      const avail = body.clientWidth - 32
      setScale(pageW > 0 && avail > 0 ? Math.min(1, avail / pageW) : 1)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    measure()
    return () => ro.disconnect()
  }, [ast, mobile])

  // 源码光标 → 当前块
  useEffect(() => {
    if (!ast) return
    const loc = blockAtLine(ast, cursorLine)
    if (!loc || loc.block.id === activeId || !byId.has(loc.block.id)) return
    // 附图的源码行就是它的附图说明段（caption_line）：选中附图时不让该段落把选中抢回去
    if (activeId && byId.get(activeId)?.fullLine === cursorLine && ast.figures.some((f) => f.id === activeId)) return
    setActiveBlock(loc.block.id, 'editor')
  }, [ast, cursorLine, activeId, setActiveBlock, byId])
  useEffect(() => {
    if (!activeBlock || activeBlock.source === 'structure') return
    blockEl(rootRef.current, activeBlock.id)?.scrollIntoView({ block: 'center' })
  }, [activeBlock])
  // W5 Focus（21 §5.2）：源码 / PDF / 大纲… 发来的定位 → 滚到 data-block-id + 闪烁；视图重新挂载时重放最近一次
  // 三书的 EditorView（表格工具条 / PDF 选块定位用）
  const viewsRef = useRef<Partial<Record<BookName, EditorView>>>({})
  const [pmView, setPmView] = useState<EditorView | null>(null)
  // 光标所在书的 EditorView：FormatBar / SelectionPopover 跟着它（三书共用一条工具条）
  const [activeBook, setActiveBook_] = useState<BookName | null>(null)
  const [viewTick, setViewTick] = useState(0)
  const toolbarView = useMemo(
    () => (activeBook ? viewsRef.current[activeBook] : null) ?? pmView ?? viewsRef.current.claims ?? viewsRef.current.abstract ?? null,
    [activeBook, pmView, viewTick],
  )

  // W9 review-rail：CriticMarkup 装饰（标记 id = `全文行:from`，与 store.review.marks 同口径）+ format-toolbar 快捷键；插件在 BookEditor 建 view 时捕获，檔位 / 高亮后续用 setMeta 更新
  const astRef = useRef(ast)
  astRef.current = ast
  const bookPlugins = useMemo<Record<BookName, readonly Plugin[]>>(() => {
    const s = useStudio.getState()
    const lineOf = (blockId: string, lineIdx: number) => {
      const loc = astRef.current ? findBlockLines(astRef.current, blockId) : null
      return loc ? loc.offset + loc.start + lineIdx : null
    }
    const mk = () => [keymap(FORMAT_KEYS), criticDecorations({ level: s.markupLevel, activeId: s.activeMarkId, onActivate: setActiveMark, lineOf })]
    return { abstract: mk(), claims: mk(), description: mk() }
  }, [setActiveMark])
  useEffect(() => {
    for (const v of Object.values(viewsRef.current)) {
      if (!v) continue
      const ps = criticKey.getState(v.state)
      if (!ps || (ps.level === markupLevel && ps.activeId === activeMarkId)) continue
      const fromCard = ps.activeId !== activeMarkId && activeMarkId != null
      v.dispatch(setCriticActive(setCriticLevel(v.state.tr, markupLevel), activeMarkId))
      if (!fromCard) continue
      // 卡片 → 正文：选中标记起点并滚到可见
      const pos = criticPosOf(v.state, activeMarkId)
      if (!pos) continue
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos.from)).scrollIntoView())
      v.dom.querySelector<HTMLElement>(`[data-critic-id="${CSS.escape(activeMarkId)}"]`)?.scrollIntoView({ block: 'center' })
    }
  }, [markupLevel, activeMarkId, viewTick])
  // PDF 选块待落的光标：dock 面板激活 / 选区条卸载会在同一轮事件里抢焦点，故落光标要等到下一帧且确认焦点真在编辑器里
  const pdfCaret = useRef<{ book: BookName; blockId: string; tries: number; placed: boolean } | null>(null)
  const placePdfCaret = useCallback(function place() {
    const p = pdfCaret.current
    if (!p) return
    const v = viewsRef.current[p.book]
    if (v && v.dom.isConnected) {
      if (p.placed && v.hasFocus()) {
        pdfCaret.current = null
        return
      }
      const active = document.activeElement
      if (p.placed && active instanceof HTMLElement && !v.dom.contains(active) && active.matches(FOCUS_OWNER_SELECTOR)) {
        pdfCaret.current = null
        return
      }
      p.placed = focusBlockStart(v, p.blockId) && v.hasFocus()
    }
    if (++p.tries > PDF_CARET_RETRIES) pdfCaret.current = null
    else window.setTimeout(place, PDF_CARET_RETRY_MS)
  }, [])
  const onBookView = useCallback(
    (book: BookName, v: EditorView | null) => {
      if (v) viewsRef.current[book] = v
      else delete viewsRef.current[book]
      if (book === 'description') setPmView(v)
      setViewTick((t) => t + 1)
      if (v && pdfCaret.current?.book === book) placePdfCaret()
    },
    [placePdfCaret],
  )
  // PDF 选块（source 'pdf'）：光标放到同块开头直接进入编辑（替代 W5 弹窗块编辑器）
  useFocusConsumer('layout', ast != null, (f) => {
    const el = blockElement(rootRef.current, f.blockId)
    if (!el) return
    // cursorLine 与目标块同步（上面「源码光标 → 当前块」effect 以 cursorLine 为准）
    const e = byId.get(f.blockId)
    if (e) setCursor({ line: e.fullLine, col: 1, section: e.label })
    if (useStudio.getState().activeBlock?.id !== f.blockId) setActiveBlock(f.blockId, 'structure')
    el.scrollIntoView({ block: 'center' })
    flash(el)
    if (f.source === 'pdf' && editable) {
      pdfCaret.current = { book: f.book, blockId: f.blockId, tries: 0, placed: false }
      placePdfCaret()
    }
  })

  // 375：点公式 → Sheet 放大；长按（500ms，不移动）块 / 选区 → 批注草稿（comments 契约；只读角色不开）
  const [equationSheet, setEquationSheet] = useState<AstEquation | null>(null)
  const [commentDraft, setCommentDraft] = useState<CommentDraftTarget | null>(null)
  // 批68：子编辑器脏态上报 + 宿主驱动替换的待执行动作——换公式目标/插入新公式/换批注锚在脏态先 DiscardDialog
  const [commentDirty, setCommentDirty] = useState(false)
  const [eqDirty, setEqDirty] = useState(false)
  const [pendingEdit, setPendingEdit] = useState<(() => void) | null>(null)
  const guardReplace = (dirtyNow: boolean, act: () => void) => (dirtyNow ? setPendingEdit(() => act) : act())

  const select = useCallback(
    (id: string) => {
      const e = byId.get(id)
      if (e) setCursor({ line: e.fullLine, col: 1, section: e.label })
      setActiveBlock(id, 'structure')
      if (e) setFocus({ book: e.book, blockId: id, line: e.fullLine, source: 'layout' })
      if (mobile && ast) {
        const desc = ast.description.find((b) => b.id === id)
        if (desc?.kind === 'equation') setEquationSheet(desc)
      }
    },
    [byId, mobile, ast, setActiveBlock, setCursor, setFocus],
  )
  const gestures = useMemo(
    () =>
      createPdfGestures({
        click: () => {},
        select: () => {},
        longPress: (target) => {
          if (!editable) return
          const el = target.closest<HTMLElement>('[data-block-id]')
          const id = el?.dataset.blockId
          const e = id ? byId.get(id) : undefined
          if (!el || !id || !e) return
          const sel = window.getSelection()
          const selected = sel && !sel.isCollapsed && el.contains(sel.anchorNode) ? sel.toString().trim() : ''
          const quote = selected || (el.textContent ?? '').trim().slice(0, 80)
          if (!quote) return
          guardReplace(commentDraft !== null && commentDirty, () => {
            select(id)
            setCommentDraft({ blockId: id, line: e.fullLine, quote })
          })
        },
      }),
    [byId, select, editable, commentDraft, commentDirty],
  )
  useEffect(() => () => gestures.dispose(), [gestures])
  // 公式块：atom，双击开 EquationEditor（D2）；initial 取 AST 的 source / label，提交走 equationLine → patchBlock
  // base = 打开时块原文行（冻结，409 冲突检测用）；不追 ast/content——编辑器存续期间他人改动要能触发 conflict
  const [equation, setEquation] = useState<{ kind: 'edit'; blockId: string; base: string } | { kind: 'insert'; anchor: InsertAnchor } | null>(null)
  const open = useCallback(
    (id: string) => {
      if (editable && ast) {
        const desc = ast.description.find((b) => b.id === id)
        if (desc?.kind === 'equation') {
          const base = blockSource(ast, content, id)
          if (base === null) return
          guardReplace(eqDirty, () => {
            setActiveBlock(id, 'structure')
            setEquation({ kind: 'edit', blockId: id, base })
          })
          return
        }
      } else if (mobile && ast && ast.description.find((b) => b.id === id)?.kind === 'equation') {
        select(id)
        return
      }
      const e = byId.get(id)
      if (!e) return
      setActiveBlock(id, 'structure')
      gotoLine(e.fullLine)
    },
    [editable, mobile, ast, content, byId, setActiveBlock, gotoLine, select, eqDirty],
  )
  // 整书编辑器光标进入某块 → activeBlock / cursor / Focus（点击为显式；键盘移动只换当前块）
  const onCursorBlock = useCallback(
    (id: string | null, explicit: boolean) => {
      if (!id) return
      const a = useStudio.getState().ast
      const book = byId.get(id)?.book ?? (a ? findBlockLines(a, id)?.book : null) ?? null
      if (book) setActiveBook_(book)
      if (explicit) select(id)
      else if (useStudio.getState().activeBlock?.id !== id) {
        const e = byId.get(id)
        if (e) setCursor({ line: e.fullLine, col: 1, section: e.label })
        setActiveBlock(id, 'structure')
      }
    },
    [select, byId, setCursor, setActiveBlock],
  )
  const openEquation = useCallback((id: string) => open(id), [open])
  const onViewAbstract = useCallback((v: EditorView | null) => onBookView('abstract', v), [onBookView])
  const onViewClaims = useCallback((v: EditorView | null) => onBookView('claims', v), [onBookView])
  const onViewDescription = useCallback((v: EditorView | null) => onBookView('description', v), [onBookView])
  const onReadonlyInput = readonlyHint
  const bookProps = useMemo(
    () =>
      ast
        ? {
            ast,
            content,
            astStale: stale,
            mode: bookMode,
            subExcept: settings?.sub_except,
            onCursorBlock,
            onReadonlyInput,
            onOpenEquation: openEquation,
          }
        : null,
    [ast, content, stale, bookMode, settings?.sub_except, onCursorBlock, onReadonlyInput, openEquation],
  )
  const gotoClaim = useCallback(
    (num: number) => {
      const id = ast ? claimId(ast, num) : null
      if (!id) return
      select(id)
      blockEl(rootRef.current, id)?.focus()
    },
    [ast, select],
  )
  const actions = useMemo<BlockActions>(() => ({ select, open, gotoClaim }), [select, open, gotoClaim])

  // ---- 整书落盘（edit 直写；review 经 saveBook({review}) 转 CriticMarkup）----
  const submitMarkdown = useCallback(
    // oldMd 即打开时块基线：同区间已被改 → 服务端 409，不静默覆盖
    (id: string, oldMd: string, md: string) => patchBlock(id, mode === 'review' ? toCritic(oldMd, md) : md, oldMd),
    [patchBlock, mode],
  )
  const saveBookMd = useMemo(() => {
    const review = mode === 'review'
    return {
      abstract: (md: string) => saveBook('abstract', md, { review }),
      claims: (md: string) => saveBook('claims', md, { review }),
      description: (md: string) => saveBook('description', md, { review }),
    } satisfies Record<BookName, (md: string) => Promise<boolean>>
  }, [saveBook, mode])
  // 当前块是表格 → 表格工具条（桌面浮动 / 375 挂在纸面缩放之外）
  const editingTable = editable && activeId != null && ast?.description.find((b) => b.id === activeId)?.kind === 'table'

  // ---- `/` 插入菜单 + 「图/表/式」编号补全（useInsertMenus.ts）----
  const requestEquation = useCallback(
    (anchor: InsertAnchor) => guardReplace(eqDirty, () => setEquation({ kind: 'insert', anchor })),
    [eqDirty],
  )
  const {
    slash, slashItems, slashFigureBook, slashNav, onSlashSelect, closeSlash,
    numberMenu, numberItems, numberNav, onNumberSelect, closeNumber,
    insertAnchor, onInput, onCompositionEnd, onKeyDownCapture,
  } = useInsertMenus({ ast, byId, activeId, books, editable, toolbarPanel, setToolbarPanel, templates, templatesError, requestEquation, bodyRef })

  const openPanel = useStudio((s) => s.openPanel)
  const openFigureBook = useCallback(() => openPanel(makePanelId('figures')), [openPanel])


  // ---- 公式编辑器（桌面 popover 锚在当前块 / 375 底部 sheet）----
  // 移动底部工具栏「公式」：当前块是公式则编辑，否则在当前块后插入；「表格」：当前块是表格则进入块编辑（工具条随编辑器出现）
  const lastPanel = useRef(toolbarPanel)
  useEffect(() => {
    if (lastPanel.current === toolbarPanel) return
    lastPanel.current = toolbarPanel
    if (!editable || !ast) return
    if (toolbarPanel === 'equation') {
      const desc = activeId ? ast.description.find((b) => b.id === activeId) : undefined
      if (desc?.kind === 'equation') {
        const base = blockSource(ast, content, desc.id)
        if (base !== null) guardReplace(eqDirty, () => setEquation({ kind: 'edit', blockId: desc.id, base }))
        else setToolbarPanel('none')
      } else if (insertAnchor) guardReplace(eqDirty, () => setEquation({ kind: 'insert', anchor: insertAnchor }))
      else setToolbarPanel('none')
    } else if (toolbarPanel === 'table') {
      const desc = activeId ? ast.description.find((b) => b.id === activeId) : undefined
      if (desc?.kind === 'table') {
        const v = viewsRef.current.description
        if (v) focusBlockStart(v, desc.id)
      } else {
        toast('先选中一个表格块，或用「插入」新建表格', 'info')
        setToolbarPanel('none')
      }
    }
  }, [toolbarPanel, editable, ast, content, activeId, insertAnchor, setToolbarPanel, toast, eqDirty])
  useEffect(() => {
    if (toolbarPanel === 'table' && !editingTable) setToolbarPanel('none')
  }, [toolbarPanel, editingTable, setToolbarPanel])
  const equationEditing = useMemo<{ key: string; initial: { source: string; label: string }; anchorId: string | null; markdown: string | null } | null>(() => {
    if (!equation || !editable || !ast) return null
    if (equation.kind === 'insert') {
      const n = numberCandidates(ast, '式').length + 1
      return { key: 'insert', initial: { source: '', label: `（${n}）` }, anchorId: 'after_block_id' in equation.anchor ? equation.anchor.after_block_id : null, markdown: null }
    }
    const b = ast.description.find((x) => x.id === equation.blockId)
    if (b?.kind !== 'equation') return null
    return { key: b.id, initial: { source: b.source, label: b.label ?? '' }, anchorId: b.id, markdown: equation.base }
  }, [equation, editable, ast, content])
  const [equationAnchor, setEquationAnchor] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setEquationAnchor(equationEditing?.anchorId && isDesktop ? blockEl(rootRef.current, equationEditing.anchorId) : null)
  }, [equationEditing, isDesktop])
  const closeEquation = useCallback(() => {
    setEquation(null)
    if (useStudio.getState().layoutViewToolbar === 'equation') setToolbarPanel('none')
  }, [setToolbarPanel])
  const onEquationSubmit = useCallback(
    async ({ source, label }: { source: string; label: string }): Promise<boolean> => {
      if (!equation || !equationEditing) return false
      const md = equationLine(source, label)
      if (equation.kind === 'edit') {
        const old = equationEditing.markdown
        const ok = old === null || old === md ? true : await submitMarkdown(equation.blockId, old, md)
        if (ok) closeEquation()
        return ok
      }
      const id = await insertBlock({ kind: 'equation', ...equation.anchor, markdown: md })
      if (!id) return false
      closeEquation()
      requestAnimationFrame(() => focusBlock(id))
      return true
    },
    [equation, equationEditing, submitMarkdown, insertBlock, closeEquation],
  )


  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!ast) return
    // 整书编辑器内的键盘全部交给 ProseMirror（Enter 分段 / Backspace 并段 / Ctrl+Z）
    if (e.target instanceof HTMLElement && e.target.closest('.ps-book')) return
    const target = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-block-id]') : null
    const id = target?.dataset.blockId ?? null
    if (e.key === 'Enter' && !e.altKey && id && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      open(id)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const els = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])
      if (els.length === 0) return
      const i = target ? els.indexOf(target) : -1
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : e.key === 'ArrowDown' ? Math.min(els.length - 1, i + 1) : Math.max(0, i - 1)
      e.preventDefault()
      const el = els[next]
      el.focus()
      select(el.dataset.blockId ?? '')
      return
    }
    if (!editable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) readonlyHint()
  }

  const common = (id: string) => ({ active: id === activeId, tabStop: id === tabStopId, diag: diags.get(id) })
  const label = (part: PaperPart) => labels?.[part] ?? PART_HEADER_LABEL[part]
  const showFormatTools = editable && !markupReadonly && ast != null
  useMobileBoldSlot(mobile && showFormatTools, toolbarView)
  useLayoutHistorySlot(mobile && editable && ast != null, toolbarView)
  // 模式条：提示文案可关（记住）；桌面有格式工具条时「插入」只在工具条上，模式条无内容可显示时整条不渲染（工具条 sticky top 随之归零）
  const [noticeDismissed, setNoticeDismissed] = useState(readNoticeDismissed)
  const dismissNotice = () => {
    writeNoticeDismissed()
    setNoticeDismissed(true)
  }
  const formatBarShown = showFormatTools && isDesktop
  // 「删除块」工具条入口（docs/plan/06 §5.5）：法定章节 / title / 摘要整块 / 附图由 deleteDisabledReason 禁用并说明
  const deleteReason = useMemo(() => deleteDisabledReason(ast, activeId), [ast, activeId])
  const onDeleteBlock = useCallback(() => {
    const st = useStudio.getState()
    if (activeId && deleteDisabledReason(st.ast, activeId) == null) openDeleteDialog(activeId)
  }, [activeId])
  // 插入入口单一：桌面在格式工具条，375 在底部 MobileLayoutToolbar；只有两者都没有时才落到模式条
  const insertInBar = editable && ast != null && !formatBarShown && !mobile
  const barStatus = ast != null && (stale || !!astError)
  const showNotice = !noticeDismissed
  const barShown = showNotice || insertInBar || barStatus || (!mobile && mode === 'review') || !!slots?.modeIndicator
  const toggleInsert = () => setToolbarPanel(slash?.autoFocus ? 'none' : 'insert')

  const view = (
    <div
      ref={rootRef}
      data-slot="LayoutView"
      data-testid="layout-view"
      data-mode={mode}
      data-editable={editable || undefined}
      className={cn('ps-layout', mobile && 'ps-layout-mobile', className)}
      data-mobile={mobile || undefined}
      data-bar={barShown ? undefined : 'off'}
      style={vars}
      onKeyDown={onKeyDown}
    >
      {css && <style data-testid="ps-style-css">{css}</style>}
      {barShown && (
      <div role="status" data-testid="layout-bar" className="ps-layout-bar" data-review={mode === 'review' || undefined}>
        {!mobile && mode === 'review' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-info-bg px-1.5 py-px font-medium text-info-fg" data-testid="layout-review-badge">
            审阅模式
          </span>
        )}
        {showNotice && (
          <span className="truncate" data-testid="layout-notice">
            {mobile
              ? mobileNotice(editable, mode === 'review')
              : mode === 'review'
                ? `改动记为修订，接受后才落正文 · ${editable ? '点击正文直接输入' : '只读'} · 页码以 PDF 为准`
                : `连续页不分页，页码以 PDF 为准 · ${editable ? '点击正文直接输入，Enter 分段，空行输入 / 插入' : '只读'}`}
          </span>
        )}
        {showNotice && (
          <Button variant="ghost" size="icon-xs" className="shrink-0 text-fg-muted" aria-label="不再显示提示" title="不再显示提示" data-testid="layout-notice-dismiss" onClick={dismissNotice}>
            <X aria-hidden />
          </Button>
        )}
        {ast && stale && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-info-fg">
            <span className="size-1.5 shrink-0 rounded-full bg-info-dot motion-safe:animate-pulse" aria-hidden />
            更新中…
          </span>
        )}
        {ast && astError && !stale && (
          <span className="flex shrink-0 items-center gap-1 text-danger-fg" title={astError}>
            <AlertTriangle className="size-3.5" aria-hidden />
            解析失败，显示上次结构
          </span>
        )}
        <div className="ps-layout-bar-end">
          {insertInBar && (
            <Button
              variant="ghost"
              size="xs"
              data-testid="layout-insert"
              aria-haspopup="listbox"
              aria-expanded={slash?.autoFocus ? true : false}
              aria-controls={slash?.autoFocus ? 'ps-slash-menu' : undefined}
              onClick={toggleInsert}
            >
              <Plus aria-hidden />
              插入
            </Button>
          )}
          {slots?.modeIndicator}
        </div>
      </div>
      )}
      {formatBarShown && (
        <FormatBar
          view={toolbarView}
          className="ps-layout-format-bar"
          onInsert={toggleInsert}
          insertOpen={!!slash?.autoFocus}
          deleteReason={deleteReason}
          onDeleteBlock={onDeleteBlock}
        />
      )}
      <div
        ref={setBodyRef}
        className="ps-layout-body"
        onInput={onInput}
        onCompositionEnd={onCompositionEnd}
        onKeyDownCapture={onKeyDownCapture}
        onPointerDown={mobile ? (e) => gestures.down(e) : undefined}
        onPointerMove={mobile ? (e) => gestures.move(e) : undefined}
        onPointerUp={mobile ? (e) => gestures.up(e) : undefined}
        onPointerCancel={mobile ? () => gestures.cancel() : undefined}
      >
        <BlockActionsContext.Provider value={actions}>
          <div ref={pagesRef} className="ps-pages" data-testid="ps-pages" style={{ '--ps-scale': mobile ? 1 : scale } as CSSProperties}>
            {!ast && <LayoutEmpty loading={loading} error={astError} unavailable={unavailable} hasProject={pid != null} />}
            {bookSet.has('abstract') && (
              <Paper part="abstract" label={label('abstract')} numbering={numbering}>
                {ast && (
                  <>
                    <h1 className="ps-title ps-h">{ast.title.text}</h1>
                    {bookProps && (
                      <BookEditor
                        key={`${pid}:abstract`}
                        book="abstract"
                        {...bookProps}
                        plugins={bookPlugins.abstract}
                        onView={onViewAbstract}
                        onSave={saveBookMd.abstract}
                        data-testid="ps-book-abstract"
                      />
                    )}
                    {ast.abstract.figure_num != null && <p className="ps-p ps-caption ps-empty">摘要附图：图{ast.abstract.figure_num}</p>}
                  </>
                )}
              </Paper>
            )}
            {bookSet.has('claims') && (
              <Paper part="claims" label={label('claims')} numbering={numbering}>
                {ast && (
                  <div className="ps-claims" data-testid="ps-claims">
                    {bookProps && (
                      <BookEditor key={`${pid}:claims`} book="claims" {...bookProps} plugins={bookPlugins.claims} onView={onViewClaims} onSave={saveBookMd.claims} data-testid="ps-book-claims" />
                    )}
                  </div>
                )}
              </Paper>
            )}
            {bookSet.has('description') && (
              <Paper part="description" label={label('description')} numbering={numbering}>
                {ast && (
                  <>
                    <Block id={TITLE_ID} {...common(TITLE_ID)} className="ps-title">
                      <h2 className="ps-h">{ast.title.text}</h2>
                    </Block>
                    {bookProps && (
                      <BookEditor
                        key={`${pid}:description`}
                        book="description"
                        {...bookProps}
                        plugins={bookPlugins.description}
                        onView={onViewDescription}
                        onSave={saveBookMd.description}
                        data-testid="ps-book-description"
                      />
                    )}
                  </>
                )}
              </Paper>
            )}
            {bookSet.has('description') && ast && ast.figures.length > 0 && (
              <Paper part="figures" label={label('figures')} numbering={numbering}>
                <FiguresPaperBody ast={ast} pid={pid} activeId={activeId} readOnly={!editable} mobile={!isDesktop} onOpenFigureBook={openFigureBook} />
              </Paper>
            )}
          </div>
          <LayoutDecorations ast={ast} pagesRef={pagesRef} />
        </BlockActionsContext.Provider>
        {showFormatTools && <SelectionPopover view={toolbarView} container={bodyEl} />}
        {slash && (
          <SlashMenu open items={slashItems} figureBook={slashFigureBook} anchor={slash.anchor} autoFocus={slash.autoFocus} nav={slashNav} error={templatesError} onSelect={onSlashSelect} onClose={closeSlash} />
        )}
        {numberMenu && <NumberMenu open items={numberItems} anchor={numberMenu.anchor} nav={numberNav} onSelect={onNumberSelect} onClose={closeNumber} />}
        {equationEditing && (
          <EquationEditor
            key={equationEditing.key}
            open
            variant={isDesktop ? 'popover' : 'sheet'}
            anchor={equationAnchor}
            initial={equationEditing.initial}
            onSubmit={onEquationSubmit}
            onClose={closeEquation}
            onDirty={setEqDirty}
          />
        )}
      </div>
      {pmView && editingTable && (
        <div className={isDesktop ? 'ps-layout-table-tools' : 'ps-layout-mobile-tools'} data-testid="layout-mobile-tools">
          <TableToolbar view={pmView} variant={isDesktop ? 'floating' : 'mobile'} />
        </div>
      )}
      {equationSheet && <EquationSheet block={equationSheet} onClose={() => setEquationSheet(null)} />}
      {commentDraft && (
        <LayoutCommentDrawer
          key={`${commentDraft.blockId}:${commentDraft.line}`}
          target={commentDraft}
          onClose={() => setCommentDraft(null)}
          onDirty={setCommentDirty}
        />
      )}
      <DiscardDialog
        open={pendingEdit !== null}
        onStay={() => setPendingEdit(null)}
        onDiscard={() => {
          const act = pendingEdit
          setPendingEdit(null)
          act?.()
        }}
      />
      {/* 公式/表格/删块对话框宿主在工作台壳单例挂载（DesktopShell/MobileShell）——LayoutView 每书一实例，这里再挂会 N 份叠渲染 */}
      {showFormatTools && isDesktop && <HeadingStylePanel />}
    </div>
  )
  if (!slots?.rightRail) return view
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="layout-view-shell">
      {view}
      {slots.rightRail}
    </div>
  )
}

function blockEl(root: HTMLElement | null, id: string): HTMLElement | null {
  if (!root) return null
  for (const el of root.querySelectorAll<HTMLElement>('[data-block-id]')) if (el.dataset.blockId === id) return el
  return null
}

function LayoutEmpty({ loading, error, unavailable, hasProject }: { loading: boolean; error: string | null; unavailable: boolean; hasProject: boolean }) {
  if (loading) {
    return (
      <p role="status" className="ps-layout-status items-center" data-testid="layout-loading">
        <span className="size-1.5 shrink-0 rounded-full bg-info-dot motion-safe:animate-pulse" aria-hidden />
        正在解析结构…
      </p>
    )
  }
  const text = error
    ? unavailable
      ? '后端 AST 接口尚未启用，版面视图暂不可用。'
      : `解析失败：${error}`
    : hasProject
      ? '等待后端 AST…'
      : '打开案子后显示版面。'
  return (
    <p role={error ? 'alert' : 'status'} className={cn('ps-layout-status', error && 'text-danger-fg')} data-testid="layout-empty" data-state={error ? 'error' : 'empty'}>
      {error && <AlertTriangle className="size-4 shrink-0" aria-hidden />}
      <span>{text}</span>
    </p>
  )
}
