import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { LocateFixed, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { revealView } from '@/components/editor/ViewTabs'
import { BlockEditor } from '@/components/block-model/edit'
import { equationLine } from '@/components/block-model/edit/serialize'
import type { EditableBlock } from '@/components/block-model/slots'
import { EquationEditor } from '@/components/layout-view/equation'
import { toCritic } from '@/components/layout-view/mode/toCritic'
import { serializeLayout, tablePlugins, toLayoutDoc } from '@/components/layout-view/table'
import { useIsDesktop } from '@/hooks/useMisc'
import { diagLocationLabel } from '@/lib/diagLocation'
import { BOOK_LABELS } from '@/lib/docset'
import { cn } from '@/lib/utils'
import { blockSource, findBlockLines, selectEditorMode, selectRoleKnown, useStudio } from '@/store'
import type { Ast, BookName } from '@/types/ast'
import { closeBlockEditor, useBlockEditorRequest, useHostOwnership, type BlockEditorAnchor, type BlockEditorRequest } from './state'

const ENGINE = { toDoc: toLayoutDoc, serialize: serializeLayout, plugins: tablePlugins }

export function editableBlockOf(ast: Ast, id: string): { block: EditableBlock; book: BookName } | null {
  const ap = ast.abstract.paragraphs.find((p) => p.id === id)
  if (ap) return { block: ap, book: 'abstract' }
  const c = ast.claims.find((b) => b.id === id)
  if (c) return { block: c, book: 'claims' }
  const d = ast.description.find((b) => b.id === id)
  return d ? { block: d, book: 'description' } : null
}

function blockLabel(block: EditableBlock): string {
  switch (block.kind) {
    case 'claim':
      return `权利要求 ${block.num}`
    case 'paragraph':
      return block.para_no !== null ? `段 [${String(block.para_no).padStart(4, '0')}]` : '段落'
    case 'section':
    case 'subsection':
      return block.title
    case 'equation':
      return `公式 ${block.label ?? ''}`.trim()
    case 'table':
      return '表格'
    case 'code':
      return '代码块'
    case 'figure':
      return `内嵌图 ${block.file}`
    default:
      return '块'
  }
}

/** 头部工具按钮不夺焦：内嵌 BlockEditor 失焦即提交关闭，故 mousedown 不改焦点、不进 Tab 序（关闭走 Esc） */
const HEADER_TOOL = { tabIndex: -1, onMouseDown: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault() } as const

const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [contenteditable="true"], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Tab 在卡片内循环：焦点一旦离开内嵌编辑器就会触发它的 blur 提交关闭 */
function trapTab(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Tab') return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (items.length === 0) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = e.currentTarget.ownerDocument.activeElement
  if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  }
}

/** 内嵌 BlockEditor 自带的边框/光环在卡片内去掉，由卡片外壳（r-lg sh-lg）承担层次 */
const FLAT_INNER =
  '[&_[data-testid=block-editor]]:mx-0 [&_[data-testid=block-editor]]:my-0 [&_[data-testid=block-editor]]:rounded-none [&_[data-testid=block-editor]]:border-0 [&_[data-testid=block-editor]]:bg-transparent [&_[data-testid=block-editor]]:p-0 [&_[data-testid=block-editor]]:ring-0'

/**
 * 块编辑器宿主（05 §3.18；原型 `.blockedit`）：openBlockEditor({blockId, source, anchor}) → 桌面 r-lg sh-lg 卡片（宽 ≤ 440，锚在选块右侧，
 * 右侧不够时落到块下方并随视口收窄；见 placeCard）头 36 = 定位信息「权利要求 N / 说明书 · 段落」+ 定位源码 + 关闭）/ 375 底部 Sheet，
 * 内嵌 ProseMirror 块编辑器（公式块用 EquationEditor）编辑单块 Markdown → store.patchBlock（review 模式先 toCritic）
 * → 内容变化自动入队重建 → 保存后重发 Focus，PDF 索引重建完成时 overlay 按新位置重画。只读角色（viewer）不打开，仅定位。
 */
export function BlockEditorHost() {
  const owned = useHostOwnership()
  const req = useBlockEditorRequest()
  const isDesktop = useIsDesktop()
  const ast = useStudio((s) => s.ast)
  const content = useStudio((s) => s.content)
  const mode = useStudio(selectEditorMode)
  const roleKnown = useStudio(selectRoleKnown)
  // viewer / 协同只读只定位不打开；reviewer 仍可打开（保存时 toCritic 记为修订建议）
  const readonly = !roleKnown || mode === 'readonly'
  const pending = useStudio((s) => s.blockPending)
  const patchBlock = useStudio((s) => s.patchBlock)
  const setFocus = useStudio((s) => s.setFocus)

  const target = useMemo(() => {
    if (!req || !ast) return null
    const t = editableBlockOf(ast, req.blockId)
    if (!t) return null
    const markdown = blockSource(ast, content, req.blockId)
    return markdown === null ? null : { ...t, markdown }
  }, [req, ast, content])

  useEffect(() => {
    if (req && owned && (readonly || (ast && !target))) closeBlockEditor()
  }, [req, readonly, ast, target, owned])

  const submit = useCallback(
    async (md: string) => {
      if (!req || !target || !ast) return false
      const ok = await patchBlock(req.blockId, mode === 'review' ? toCritic(target.markdown, md) : md, req.base)
      if (ok) {
        const loc = findBlockLines(ast, req.blockId)
        setFocus({ book: target.book, blockId: req.blockId, line: loc ? loc.offset + loc.start : undefined, source: req.source })
        closeBlockEditor()
        returnFocus(req.source)
      }
      return ok
    },
    [req, target, ast, patchBlock, mode, setFocus],
  )

  const [pmHost, setPmHost] = useState<HTMLElement | null>(null)
  const [cardHost, setCardHost] = useState<HTMLElement | null>(null)
  const viewport = useViewportSize()
  const cardHeight = useMeasuredHeight(cardHost)
  if (!owned || !req || !target || readonly) return null
  const placement = placeCard(req.anchor, viewport, cardHeight)
  const { block, book, markdown } = target
  const label = blockLabel(block)
  const loc = ast ? findBlockLines(ast, req.blockId) : null
  const semantic = diagLocationLabel({ line: loc ? loc.offset + loc.start : null, blockId: req.blockId }, ast)
  const where = semantic === '全文' || semantic === label ? [BOOK_LABELS[book], label].join(' · ') : semantic
  const locateSource = () => {
    revealView('source', book)
    setFocus({ book, blockId: req.blockId, line: loc ? loc.offset + loc.start : undefined, source: req.source })
  }

  if (block.kind === 'equation') {
    return (
      <div ref={setPmHost} data-testid="block-editor-host" data-block-id={req.blockId} className="pointer-events-none fixed z-popover" style={placement.anchorRect}>
        <EquationEditor
          open
          variant={isDesktop ? 'popover' : 'sheet'}
          anchor={pmHost}
          initial={{ source: block.source, label: block.label ?? '' }}
          onSubmit={({ source, label: l }) => {
            const md = equationLine(source, l)
            if (md === markdown) return true
            return submit(md)
          }}
          onClose={closeBlockEditor}
        />
      </div>
    )
  }

  const editor = (
    <BlockEditor block={block} book={book} markdown={markdown} pending={pending} engine={ENGINE} onSubmit={submit} onCancel={closeBlockEditor} />
  )
  const hint = (
    <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-2xs leading-5 text-fg-subtle">
      <Kbd keys={['Mod', 'Enter']} /> 保存 <Kbd keys={['Escape']} /> 取消
      {mode === 'review' && <span className="text-fg-muted">· 审阅模式：改动记为修订建议</span>}
    </span>
  )

  if (!isDesktop) {
    return (
      <Sheet open onOpenChange={(o) => !o && closeBlockEditor()}>
        <SheetContent side="bottom" data-testid="block-editor-host" data-block-id={req.blockId} className="max-h-[85vh]">
          <SheetHeader>
            <SheetTitle>编辑 {label}</SheetTitle>
            <SheetDescription asChild>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-2xs text-fg-muted tabular" data-testid="block-editor-where">
                  {where}
                </span>
                {hint}
              </div>
            </SheetDescription>
          </SheetHeader>
          <div className={cn('min-h-0 flex-1 overflow-auto px-sheet-m pt-sheet-top-m pb-sheet-m', FLAT_INNER)} data-testid="block-editor-sheet-body">
            {editor}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  // portal 到 body：dockview 面板带 transform / contain，卡片的 fixed 视口坐标必须逃出面板
  return createPortal(
    <div
      ref={setCardHost}
      className="pointer-events-none fixed z-popover"
      style={{ left: placement.left, top: placement.top }}
      data-testid="block-editor-host"
      data-block-id={req.blockId}
      data-side={placement.side}
    >
      <Popover open onOpenChange={(o) => !o && closeBlockEditor()}>
        <PopoverTrigger>
          <button type="button" className="sr-only" aria-label={`编辑 ${label}`} tabIndex={-1} />
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          aria-label={`编辑 ${label}`}
          style={{ width: placement.width }}
          className="pointer-events-auto mt-0 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border-0 bg-elevated p-0 shadow-lg"
        >
          {/* 编辑器在 DOM 里排最前（Popover 自动聚焦首个可聚焦元素须落在编辑器内，否则编辑器 blur 即提交关闭）；头部 order-first 视觉置顶 */}
          <div className={cn('max-h-[60vh] overflow-auto p-3', FLAT_INNER)} onKeyDownCapture={trapTab}>
            {editor}
          </div>
          <div className="order-first flex h-lg-control shrink-0 items-center gap-2 border-b border-border pl-3 pr-1 text-2xs text-fg-muted" data-testid="block-editor-header">
            <span className="min-w-0 truncate font-mono tabular" data-testid="block-editor-where" title={where}>
              {where}
            </span>
            <Button variant="ghost" size="xs" className="ml-auto shrink-0" {...HEADER_TOOL} onClick={locateSource} title="在源码中定位该块" data-testid="block-editor-locate">
              <LocateFixed /> 定位源码
            </Button>
            <Button variant="ghost" size="icon-xs" className="shrink-0" {...HEADER_TOOL} onClick={closeBlockEditor} aria-label="关闭" title="关闭（Esc）" data-testid="block-editor-close">
              <X />
            </Button>
          </div>
          <div className="flex shrink-0 items-center border-t border-border bg-app px-3 py-1.5">{hint}</div>
        </PopoverContent>
      </Popover>
    </div>,
    document.body,
  )
}

/** 保存关闭后把键盘焦点送回触发视图的容器（PDF 预览 region），Focus 已在 store 里指回同块，overlay 重画时读屏与键盘都回到原处 */
function returnFocus(source: BlockEditorRequest['source']) {
  if (source !== 'pdf' || typeof document === 'undefined') return
  document.querySelector<HTMLElement>('[data-testid="pdf-preview"]')?.focus({ preventScroll: true })
}

/** 卡片宽度上限 = `--w-block-editor`（440，05 §3.18）；右侧容不下 320（`--w-companion-min`）就落到块下方 */
export const CARD_MAX_W = 440
export const CARD_MIN_W = 320
/** 卡片与选块 / 视口边的间距（4px 栅格） */
export const CARD_GAP = 8
export const CARD_PAD = 16

export interface CardPlacement {
  /** 卡片左上角（视口坐标） */
  left: number
  top: number
  width: number
  /** 相对选块的位置：右 / 下（下方不够高时翻到上方） */
  side: 'right' | 'bottom' | 'top'
  /** 选块包围盒（公式编辑器的 popover 自己锚在它上） */
  anchorRect: CSSProperties
}

/**
 * 桌面卡片落位（ux-02）：优先锚在选块右侧（顶对齐被点的行），右侧余宽 < 320 就落到该行下方（下方不够高则翻到上方）；
 * 宽度 = min(440, 可用空间)，所以 1280 / 1024 下随视口收窄；已知卡片高度时把底边夹回视口内（右 / 左侧上推）。
 */
export function placeCard(anchor: BlockEditorAnchor | undefined, viewport: { width: number; height: number }, cardHeight = 0): CardPlacement {
  const { width: vw, height: vh } = viewport
  const rect = anchor?.rect ?? (anchor ? { left: anchor.x, top: anchor.y, width: 0, height: 0 } : { left: vw / 2, top: vh * 0.2, width: 0, height: 0 })
  const anchorRect: CSSProperties = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const fit = (space: number) => Math.min(CARD_MAX_W, Math.max(0, space))
  const clampTop = (top: number) => Math.max(CARD_PAD, Math.min(top, vh - CARD_PAD - cardHeight))
  const spaceRight = vw - CARD_PAD - (rect.left + rect.width + CARD_GAP)
  if (spaceRight >= CARD_MIN_W) return { left: rect.left + rect.width + CARD_GAP, top: clampTop(rect.top), width: fit(spaceRight), side: 'right', anchorRect }
  const width = fit(vw - CARD_PAD * 2)
  const left = Math.max(CARD_PAD, Math.min(rect.left + rect.width / 2 - width / 2, vw - CARD_PAD - width))
  const below = rect.top + rect.height + CARD_GAP
  const fitsBelow = cardHeight === 0 || below + cardHeight <= vh - CARD_PAD
  const above = rect.top - CARD_GAP - cardHeight
  if (!fitsBelow && above >= CARD_PAD) return { left, top: above, width, side: 'top', anchorRect }
  return { left, top: clampTop(below), width, side: 'bottom', anchorRect }
}

/** 卡片实际高度（打开 / 编辑中内容增长时重测），用于把底边夹回视口 */
function useMeasuredHeight(host: HTMLElement | null) {
  const [h, setH] = useState(0)
  useLayoutEffect(() => {
    const card = host?.querySelector<HTMLElement>('[data-slot="popover-content"]')
    if (!card) return
    const measure = () => setH(card.offsetHeight)
    const raf = requestAnimationFrame(measure)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(card)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      setH(0)
    }
  }, [host])
  return h
}

const subscribeResize = (l: () => void) => {
  window.addEventListener('resize', l)
  return () => window.removeEventListener('resize', l)
}
const viewportSnapshot = () => `${window.innerWidth}x${window.innerHeight}`
const serverViewport = () => '1440x900'

/** 视口尺寸（收窄 / 放大时卡片重新落位） */
function useViewportSize() {
  const [w, h] = useSyncExternalStore(subscribeResize, viewportSnapshot, serverViewport).split('x')
  return { width: Number(w), height: Number(h) }
}
