import { useCallback, useMemo, useState, type CompositionEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { findBlockLines, makePanelId, useStudio } from '@/store'
import { TITLE_ID } from '@/components/block-model/model'
import { templatesFor, useInsertBlock, type InsertAnchor } from '@/components/block-model/toolbar/insert'
import type { BlockTemplate } from '@/lib/api'
import type { Ast, BookName } from '@/types/ast'
import type { LayoutViewToolbar } from '@/store'
import { useNumberMenu } from './completion/NumberMenu'
import { anchorIn, caretContext, insertPlainText } from './completion/caret'
import { numberCandidates, type NumberCandidate, type NumberKind } from './completion/numberCompletion'
import { FIGURE_BOOK_ITEM, TEMPLATE_ERROR_ITEM, TEMPLATE_RETRY_ITEM, useSlashMenu, type SlashItemId } from './slash/SlashMenu'
import type { PopupAnchor } from './slash/PopupList'
import type { BlockEntry } from '@/components/block-model/model'

const NUMBER_KINDS: ReadonlySet<string> = new Set<NumberKind>(['图', '表', '式'])
const isNumberKind = (s: string | undefined): s is NumberKind => s != null && NUMBER_KINDS.has(s)

export interface InsertMenusDeps {
  ast: Ast | null
  byId: Map<string, BlockEntry>
  activeId: string | null
  books: readonly BookName[]
  editable: boolean
  toolbarPanel: string
  setToolbarPanel: (p: LayoutViewToolbar) => void
  templates: BlockTemplate[] | null
  templatesError: string | null
  /** 插入选「公式」时委托宿主（带脏态守卫 setEquation({kind:'insert'})） */
  requestEquation: (anchor: InsertAnchor) => void
  bodyRef: RefObject<HTMLDivElement | null>
}

/**
 * 版面视图「/」插入菜单 + 「图/表/式」编号补全子系统（原 LayoutView 内联段抽出）：
 *  - slash：工具条「插入」店开（autoFocus）或块内输入 `/` 店开（anchor 于光标）；候选 = 后端模板按书过滤
 *  - number：输入「图/表/式」首字 → NumberMenu（候选只来自 AST），选中插纯文本
 *  - probe/onInput/onCompositionEnd：编辑块内每次文本输入探测触发符；onKeyDownCapture 弹层键导航接管 ↑↓/Enter/Esc
 */
export function useInsertMenus(d: InsertMenusDeps) {
  const { ast, byId, activeId, books, editable, toolbarPanel, setToolbarPanel, templates, templatesError, requestEquation, bodyRef } = d
  const openPanel = useStudio((s) => s.openPanel)

  // ---- `/` 插入菜单 ----
  // 工具条「插入」打开的菜单由 store.layoutViewToolbar 派生；块内输入 `/` 打开的菜单绑定当前编辑块，编辑会话结束即失效
  const [inlineSlash, setInlineSlash] = useState<{ blockId: string; anchor: PopupAnchor } | null>(null)
  const slash = useMemo<{ anchor: PopupAnchor | null; autoFocus: boolean } | null>(() => {
    if (toolbarPanel === 'insert' && editable) return { anchor: null, autoFocus: true }
    if (inlineSlash && inlineSlash.blockId === activeId) return { anchor: inlineSlash.anchor, autoFocus: false }
    return null
  }, [toolbarPanel, editable, inlineSlash, activeId])
  const insertAnchor = useMemo<InsertAnchor | null>(() => {
    if (!ast) return null
    const id = activeId
    if (id && id !== TITLE_ID && id !== ast.abstract.id && findBlockLines(ast, id)) return { after_block_id: id }
    if (id === TITLE_ID || id === ast.abstract.id) return { book: 'abstract' }
    const book = id ? byId.get(id)?.book : undefined
    return { book: book ?? books[0] ?? 'description' }
  }, [ast, activeId, byId, books])
  const insertBook: BookName | null = useMemo(() => {
    if (!insertAnchor) return null
    if ('book' in insertAnchor) return insertAnchor.book
    return ast ? findBlockLines(ast, insertAnchor.after_block_id)?.book ?? null : null
  }, [insertAnchor, ast])
  const slashItems = useMemo(() => templatesFor(templates, insertBook), [templates, insertBook])
  const slashFigureBook = insertBook === 'description'
  const insert = useInsertBlock(editable ? insertAnchor : null, activeId)
  const closeSlash = useCallback(() => {
    setInlineSlash(null)
    if (useStudio.getState().layoutViewToolbar === 'insert') setToolbarPanel('none')
  }, [setToolbarPanel])
  const onSlashSelect = useCallback(
    (kind: SlashItemId) => {
      if (kind === TEMPLATE_RETRY_ITEM) {
        void useStudio.getState().loadBlockTemplates()
        return
      }
      if (kind === TEMPLATE_ERROR_ITEM) return
      closeSlash()
      if (!editable) return
      if (kind === FIGURE_BOOK_ITEM) {
        openPanel(makePanelId('figures'))
        return
      }
      if (kind === 'equation') {
        if (insertAnchor) requestEquation(insertAnchor)
        return
      }
      insert(kind)
    },
    [closeSlash, editable, insert, insertAnchor, openPanel, requestEquation],
  )
  const slashNav = useSlashMenu(slashItems, onSlashSelect, closeSlash, slashFigureBook, templatesError)

  // ---- 「图 / 表 / 式」编号补全（同样绑定当前编辑块）----
  const [numberState, setNumberMenu] = useState<{ blockId: string; kind: NumberKind; anchor: PopupAnchor; editor: HTMLElement } | null>(null)
  const numberMenu = numberState && numberState.blockId === activeId ? numberState : null
  const numberItems = useMemo(() => (numberMenu ? numberCandidates(ast, numberMenu.kind) : []), [ast, numberMenu])
  const closeNumber = useCallback(() => setNumberMenu(null), [])
  const onNumberSelect = useCallback(
    (c: NumberCandidate) => {
      const editor = numberMenu?.editor
      setNumberMenu(null)
      if (editor) insertPlainText(editor, c.label.slice(c.kind.length))
    },
    [numberMenu],
  )
  const numberNav = useNumberMenu(numberItems, onNumberSelect, closeNumber)

  const probe = (data: string | null) => {
    if (!editable || !activeId || !data || !bodyRef.current) return
    const ctx = caretContext(bodyRef.current)
    if (!ctx) return
    const last = data.at(-1)
    if (last === '/' && ctx.before === '/') {
      setNumberMenu(null)
      setInlineSlash({ blockId: activeId, anchor: anchorIn(bodyRef.current, ctx.rect) })
      return
    }
    if (isNumberKind(last) && ctx.before.endsWith(last)) {
      setInlineSlash(null)
      setNumberMenu(
        numberCandidates(ast, last).length ? { blockId: activeId, kind: last, anchor: anchorIn(bodyRef.current, ctx.rect), editor: ctx.editor } : null,
      )
      return
    }
    if (inlineSlash) setInlineSlash(null)
    if (numberMenu) setNumberMenu(null)
  }
  const onInput = (e: FormEvent<HTMLDivElement>) => {
    const ne = e.nativeEvent
    if (!(ne instanceof InputEvent) || ne.isComposing || ne.inputType !== 'insertText') return
    probe(ne.data)
  }
  const onCompositionEnd = (e: CompositionEvent<HTMLDivElement>) => probe(e.data)
  // 弹层打开且焦点仍在块编辑器：捕获阶段接管 ↑↓ / Enter / Esc（不让 ProseMirror / BlockEditor 看到）
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return
    const inPopup = e.target instanceof HTMLElement && e.target.closest('.ps-popup')
    if (inPopup) return
    const handled = numberMenu && numberItems.length ? numberNav.handleKey(e) : slash && !slash.autoFocus ? slashNav.handleKey(e) : false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return { slash, slashItems, slashFigureBook, slashNav, onSlashSelect, closeSlash, numberMenu, numberItems, numberNav, onNumberSelect, closeNumber, insertAnchor, onInput, onCompositionEnd, onKeyDownCapture }
}
