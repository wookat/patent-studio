import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ArrowDown, ArrowUp, Crosshair, GripVertical, Loader2, MoreHorizontal, PenLine, Star, TextCursorInput, Trash2, UploadCloud } from 'lucide-react'
import { editorCommands } from '@/components/editor/commands'
import { DeleteFigureDialog } from '@/components/figures/DeleteFigureDialog'
import { gotoSourceLine } from '@/components/problems/locateSource'
import { FIGURE_ACCEPT, FIGURE_SR_INSTRUCTIONS, captionOf, figureAnnouncements, figureLabel, refsOf } from '@/components/figures/figureModel'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { api } from '@/lib/api'
import { boardHash } from '@/lib/hash'
import { FOCUS_RING, cn } from '@/lib/utils'
import { selectReadonly, useStudio } from '@/store'
import type { FigureItem, FigureRef } from '@/types/figures'
import type { PreflightItem } from '@/types/preflight'
import { FigureCard } from './FigureCard'
import { FigureToolbar } from './FigureToolbar'
import { UploadDrop } from './UploadDrop'
import { badLinesOf, figureIssues, figureReject, gridCols, splitFiles } from './figureFiles'

export interface FigureBookViewProps {
  /** desktop = 结构视图 book=figures / dockview 卡片 / 侧栏；mobile = NavDrawer 全宽单列（无拖拽，菜单上移 / 下移） */
  variant?: 'desktop' | 'mobile'
  className?: string
}

const NO_FIGURES: FigureItem[] = []
const NO_ITEMS: PreflightItem[] = []
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
/** 卡片内边距 p-2 ×2 + 手柄留白 */
const CARD_PADDING = 16 + 12
const LIST_PADDING = 16
const GAP = 8

function useWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return w
}

interface SortableCardProps {
  figure: FigureItem
  /** 案卷 id——「画板改图」入口拼 boardHash 用 */
  pid: string | null
  index: number
  count: number
  mobile: boolean
  readOnly: boolean
  pxPerCm: number
  previewUrl: string | null
  caption: string | null
  captionLine: number | null
  refCount: number | null
  issues: readonly PreflightItem[] | undefined
  selected: boolean
  onSelect(): void
  onWidth(w: number): void
  onAbstractWidth(w: number): void
  onAspect(r: number): void
  onGotoCaption(line: number): void
  onMarks?(marks: Record<string, string>): void
  onMove(dir: -1 | 1): void
  onAbstract(): void
  onInsertRef(): void
  onDelete(): void
}

function SortableCard(p: SortableCardProps) {
  const { figure: f, mobile } = p
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: f.name, disabled: mobile || p.readOnly })
  const label = figureLabel(f)
  const iconBtn = cn(
    'inline-flex shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent',
    FOCUS_RING,
    mobile ? 'min-h-touch min-w-touch [&_svg]:size-5' : 'size-6 [&_svg]:size-4',
  )
  const canRef = f.num != null
  return (
    <FigureCard
      figure={f}
      previewUrl={p.previewUrl}
      caption={p.caption}
      captionLine={p.captionLine}
      refCount={p.refCount}
      issues={p.issues}
      selected={p.selected}
      pxPerCm={p.pxPerCm}
      variant={mobile ? 'mobile' : 'desktop'}
      readOnly={p.readOnly}
      onSelect={p.onSelect}
      onWidth={p.onWidth}
      onAbstractWidth={p.onAbstractWidth}
      onAspect={p.onAspect}
      onGotoCaption={p.onGotoCaption}
      onMarks={p.onMarks}
      setNode={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      dragging={isDragging}
      dragHandle={
        mobile ? undefined : (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={cn(iconBtn, 'cursor-grab touch-none active:cursor-grabbing')}
            aria-label={`拖动排序 ${label}`} title={`拖动排序 ${label}`}
            disabled={p.readOnly}
            data-testid="fb-drag-handle"
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </button>
        )
      }
      menu={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={iconBtn} aria-label={`${label} 更多操作`} title="更多操作" onClick={(e) => e.stopPropagation()} data-testid="fb-card-menu">
              <MoreHorizontal />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem disabled={p.readOnly || !canRef || f.is_abstract} onSelect={p.onAbstract} data-testid="fb-menu-abstract">
              <Star />设为摘要图
            </DropdownMenuItem>
            <DropdownMenuItem disabled={p.readOnly || !canRef} onSelect={p.onInsertRef} data-testid="fb-menu-insert-ref">
              <TextCursorInput />插入引用「{label}」
            </DropdownMenuItem>
            <DropdownMenuItem disabled={p.captionLine == null} onSelect={() => p.onGotoCaption(p.captionLine!)} data-testid="fb-menu-caption">
              <Crosshair />定位题注
            </DropdownMenuItem>
            {p.pid && f.preview && (
              <DropdownMenuItem
                disabled={p.readOnly}
                onSelect={() => { window.location.hash = boardHash(p.pid!, undefined, f.preview!) }}
                data-testid="fb-menu-annotate"
              >
                <PenLine />画板改图（标注·挪区）
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={p.readOnly || p.index === 0} onSelect={() => p.onMove(-1)} data-testid="fb-menu-up">
              <ArrowUp />上移
            </DropdownMenuItem>
            <DropdownMenuItem disabled={p.readOnly || p.index >= p.count - 1} onSelect={() => p.onMove(1)} data-testid="fb-menu-down">
              <ArrowDown />下移
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={p.readOnly} className="text-danger-fg focus:text-danger-fg" onSelect={p.onDelete} data-testid="fb-menu-delete">
              <Trash2 />删除…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}

/**
 * 附图书（15 §4.2）：结构视图 book=figures / dockview `figures` 卡片 / 移动抽屉的同一渲染。
 * 数据：figures slice（GET /figures，图号按 docs/figures.md 行序）+ ast.figures[].caption + preflight（refs / block_id=figures/N 角标 / figures.* 提示条）。
 * 写动作：排序 dnd-kit（指针 + 键盘，中文播报）→ reorderFigures(arrayMove)；菜单上移 / 下移 → moveFigure；宽度手柄 → updateFigure；
 * 工具条统一宽 / 高 → figuresBook.unifyFigureWidth / unifyFigureHeight；拖文件进书 → uploadFigures（先按 FIGURE_ACCEPT 预校验）。
 * 删除：DeleteFigureDialog（409 列引用行 → gotoLine）。布局：桌面容器 ≥ 420px 两列（rectSortingStrategy），否则 / 移动端单列。
 */
export function FigureBookView({ variant = 'desktop', className }: FigureBookViewProps) {
  const pid = useStudio((s) => s.pid)
  const figuresPid = useStudio((s) => s.figuresPid)
  const projectReady = useStudio((s) => !!s.pid && s.project?.id === s.pid)
  const figures = useStudio((s) => (s.figuresPid === s.pid ? s.figures : NO_FIGURES))
  const figsV = useStudio((s) => s.figsVersion)
  const unavailable = useStudio((s) => s.figuresUnavailable)
  const error = useStudio((s) => s.figuresError)
  const loading = useStudio((s) => s.figuresLoading || (!!s.pid && s.figuresPid !== s.pid))
  const selected = useStudio((s) => s.selectedFigure)
  const ast = useStudio((s) => s.ast)
  const report = useStudio((s) => (s.preflight && s.preflightPid === s.pid ? s.preflight : null))
  const items = report?.items ?? NO_ITEMS
  const loadFigures = useStudio((s) => s.loadFigures)
  const uploadFigures = useStudio((s) => s.uploadFigures)
  const reorderFigures = useStudio((s) => s.reorderFigures)
  const updateFigure = useStudio((s) => s.updateFigure)
  const deleteFigure = useStudio((s) => s.deleteFigure)
  const selectFigure = useStudio((s) => s.selectFigure)
  const moveFigure = useStudio((s) => s.moveFigure)
  const setFigureAspect = useStudio((s) => s.setFigureAspect)
  const toast = useStudio((s) => s.toast)
  const gotoCaption = (line: number) => gotoSourceLine(line, 'description')
  const mobile = variant === 'mobile'
  const roleReadonly = useStudio(selectReadonly)
  const readOnly = unavailable || !pid || roleReadonly

  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const bodyWidth = useWidth(body)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [deleting, setDeleting] = useState<{ figure: FigureItem; refs: FigureRef[]; busy: boolean } | null>(null)

  useEffect(() => {
    if (pid && projectReady && figuresPid !== pid) void loadFigures(pid)
  }, [pid, projectReady, figuresPid, loadFigures])

  const names = useMemo(() => figures.map((f) => f.name), [figures])
  const count = figures.filter((f) => f.num != null).length
  const cols = gridCols(bodyWidth, mobile)
  const cardWidth = bodyWidth > 0 ? (bodyWidth - LIST_PADDING - GAP * (cols - 1)) / cols : 320
  const pxPerCm = Math.max(4, (cardWidth - CARD_PADDING) / 17)
  const badLines = useMemo(() => badLinesOf(ast), [ast])
  const { byNum, loose } = useMemo(() => figureIssues(items), [items])
  const labelOf = (name: string) => {
    const f = figures.find((x) => x.name === name)
    return f ? figureLabel(f) : name
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = names.indexOf(String(active.id))
    const to = names.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void reorderFigures(arrayMove(names, from, to))
  }

  const upload = async (list: File[]) => {
    if (!pid || readOnly) return
    const { ok, bad } = splitFiles(list, figureReject)
    for (const b of bad) toast(`${b.file.name}：${b.reason}`, 'error')
    if (!ok.length) return
    setUploading(true)
    try {
      await uploadFigures(ok)
    } finally {
      setUploading(false)
    }
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragOver(false)
    void upload(Array.from(e.dataTransfer.files))
  }
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e) || readOnly) return
    e.preventDefault()
    if (!dragOver) setDragOver(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
  }

  const insertRef = (f: FigureItem) => {
    if (f.num == null) return
    const text = figureLabel(f)
    if (editorCommands.insertText(text)) {
      const s = useStudio.getState()
      if (mobile) {
        if (s.mobileTab !== 'edit') s.setMobileTab('edit')
        s.closeMobileNav()
      }
    } else {
      toast(`编辑器未就绪，无法插入「${text}」（结构视图下请先切回源码）`, 'info')
    }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDeleting({ ...deleting, busy: true })
    const r = await deleteFigure(deleting.figure.name)
    if (r.ok || r.refs.length === 0) setDeleting(null)
    else setDeleting({ figure: deleting.figure, refs: r.refs, busy: false })
  }

  let empty: string
  if (!pid) empty = '请先打开一个案子'
  else if (unavailable) empty = `附图后端尚未实现（${error ?? '501'}）`
  else if (error) empty = error
  else if (loading && figures.length === 0) empty = '正在读取附图…'
  else empty = '暂无附图'

  return (
    <section
      data-slot="FigureBookView"
      data-testid="figure-book"
      data-variant={variant}
      data-cols={cols}
      data-dragover={dragOver || undefined}
      aria-label="说明书附图"
      className={cn('relative flex h-full min-h-0 flex-col', className)}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <FigureToolbar count={count} variant={variant} readOnly={readOnly || uploading} />

      {(badLines.length > 0 || loose.length > 0) && (
        <div role="alert" className="flex items-start gap-2 border-b bg-warn-bg px-3 py-1.5 text-xs text-warn-fg" data-testid="fb-bad-lines">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            {badLines.length > 0 && <p className="font-medium">docs/figures.md 有 {badLines.length} 行无法解析，已跳过（不进 DOCX）：</p>}
            {badLines.length > 0 && (
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {badLines.map(({ line, text }) => (
                  <li key={line} className="truncate font-mono" title={text}>
                    第 {line} 行：{text}
                  </li>
                ))}
              </ul>
            )}
            {loose.map((it, i) => (
              <p key={`${it.rule}-${i}`} className="truncate" title={it.detail ?? undefined}>
                {it.message}
              </p>
            ))}
          </div>
        </div>
      )}

      <div ref={setBody} className="min-h-0 flex-1 overflow-auto" data-testid="fb-body">
        {(loading || uploading) && figures.length > 0 && (
          <div className="flex items-center gap-1 px-3 pt-1 text-xs text-fg-muted" aria-live="polite">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            {uploading ? '上传中…' : '刷新中…'}
          </div>
        )}
        {figures.length === 0 ? (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-center text-sm text-fg-muted" data-testid="fb-empty">{empty}</p>
            {!readOnly && !loading && !error && (
              <UploadDrop accept={FIGURE_ACCEPT} label="选择图片上传到 figs/" hint="或把 emf / png / jpg 拖到这里；每图在 docs/figures.md 追加一行" disabled={uploading} onFiles={upload} testId="fb-empty-drop" />
            )}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={cols === 1 ? [verticalOnly] : undefined}
            onDragEnd={onDragEnd}
            accessibility={{ announcements: figureAnnouncements(labelOf), screenReaderInstructions: FIGURE_SR_INSTRUCTIONS }}
          >
            <SortableContext items={names} strategy={cols === 1 ? verticalListSortingStrategy : rectSortingStrategy}>
              <ul
                aria-label="附图列表"
                className={cn('grid p-2', cols === 2 ? 'grid-cols-2 gap-2' : 'grid-cols-1', mobile ? 'gap-3' : 'gap-2')}
                data-testid="fb-list"
              >
                {figures.map((f, i) => {
                  const cap = captionOf(ast, f.num)
                  const refs = refsOf(report, f.num)
                  return (
                    <SortableCard
                      key={f.name}
                      figure={f}
                      pid={pid}
                      index={i}
                      count={figures.length}
                      mobile={mobile}
                      readOnly={readOnly}
                      pxPerCm={pxPerCm}
                      previewUrl={pid && f.preview ? api.figUrl(pid, f.preview, figsV) : null}
                      caption={cap.text}
                      captionLine={cap.line}
                      refCount={refs ? refs.length : null}
                      issues={f.num != null ? byNum.get(f.num) : undefined}
                      selected={selected === f.name}
                      onSelect={() => selectFigure(f.name)}
                      onWidth={(width) => void updateFigure(f.name, { width })}
                      onAbstractWidth={(abstract_width) => void updateFigure(f.name, { abstract_width })}
                      onAspect={(r) => setFigureAspect(f.name, r)}
                      onGotoCaption={gotoCaption}
                      onMarks={f.num != null ? (marks) => void updateFigure(f.name, { marks }) : undefined}
                      onMove={(dir) => void moveFigure(f.name, dir)}
                      onAbstract={() => void updateFigure(f.name, { abstract: true })}
                      onInsertRef={() => insertRef(f)}
                      onDelete={() => setDeleting({ figure: f, refs: [], busy: false })}
                    />
                  )
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {dragOver && (
        <div
          className="pointer-events-none absolute inset-1 z-sticky flex flex-col items-center justify-center gap-1 rounded-sm border-2 border-dashed border-primary bg-primary-soft/90 text-sm text-fg"
          data-testid="fb-dropzone"
        >
          <UploadCloud aria-hidden className="size-6" />
          松开以上传到 figs/（追加到 docs/figures.md）
        </div>
      )}

      <DeleteFigureDialog
        figure={deleting?.figure ?? null}
        refs={deleting?.refs ?? []}
        busy={deleting?.busy ?? false}
        onConfirm={() => void confirmDelete()}
        onGotoLine={(line) => {
          setDeleting(null)
          gotoSourceLine(line)
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  )
}
