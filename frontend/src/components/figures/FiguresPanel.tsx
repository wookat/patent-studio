import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { FolderArchive, ImagePlus, Loader2, UploadCloud } from 'lucide-react'
import { editorCommands } from '@/components/editor/commands'
import { gotoSourceLine } from '@/components/problems/locateSource'
import { api } from '@/lib/api'
import { FOCUS_RING, cn } from '@/lib/utils'
import { selectReadonly, useStudio } from '@/store'
import type { FigureItem, FigurePatch, FigureRef } from '@/types/figures'
import { figureReject, splitFiles } from '@/components/figure-book/figureFiles'
import { DeleteFigureDialog } from './DeleteFigureDialog'
import { FigureCard } from './FigureCard'
import { FIGURE_ACCEPT, FIGURE_SR_INSTRUCTIONS, captionOf, figureAnnouncements, figureLabel, refsOf } from './figureModel'

export interface FiguresPanelProps {
  /** desktop = 侧栏下块（卡片单列、缩略图 64）；mobile = 移动壳伴随 Sheet 全宽（缩略图 96、控件 ≥44，拖拽换上移/下移按钮） */
  variant?: 'desktop' | 'mobile'
  className?: string
}

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/**
 * R2 附图面板（docs/plan/05-r2-figures-preflight-design.md §6.2）。
 * 数据：store.figures（GET /figures，图号由内核按 spec_figures 生成）+ ast.figures[].caption + preflight.figures[].refs；
 * 写动作全部走 figures slice（uploadFigures / reorderFigures / updateFigure / deleteFigure），面板不改 settings。
 * 排序：桌面 dnd-kit（指针 + KeyboardSensor 空格抓起 ↑↓，中文播报）；移动 上移/下移；放下即 reorderFigures(arrayMove)。
 * 删除：DeleteFigureDialog 确认；409 → 同一对话框列引用行，点击 gotoLine（全文行）。
 * 插入引用：editorCommands.insertText('图N') 到光标处（编辑器未挂载时 toast 提示）。
 * 501 → figuresUnavailable，显示未实现空态。
 */
const NO_FIGURES: FigureItem[] = []

export function FiguresPanel({ variant = 'desktop', className }: FiguresPanelProps) {
  const pid = useStudio((s) => s.pid)
  const figuresPid = useStudio((s) => s.figuresPid)
  // 切案：openProject 先 set(pid) 再 resetFigures，中间 store 里仍是上一案的列表；等 project 就位再拉，且不用旧列表拼缩略图 URL
  const projectReady = useStudio((s) => !!s.pid && s.project?.id === s.pid)
  const figures = useStudio((s) => (s.figuresPid === s.pid ? s.figures : NO_FIGURES))
  const unavailable = useStudio((s) => s.figuresUnavailable)
  const error = useStudio((s) => s.figuresError)
  const loading = useStudio((s) => s.figuresLoading || (!!s.pid && s.figuresPid !== s.pid))
  const selected = useStudio((s) => s.selectedFigure)
  const ast = useStudio((s) => s.ast)
  const preflight = useStudio((s) => s.preflight)
  const preflightPid = useStudio((s) => s.preflightPid)
  const loadFigures = useStudio((s) => s.loadFigures)
  const uploadFigures = useStudio((s) => s.uploadFigures)
  const reorderFigures = useStudio((s) => s.reorderFigures)
  const updateFigure = useStudio((s) => s.updateFigure)
  const deleteFigure = useStudio((s) => s.deleteFigure)
  const replaceFigureImage = useStudio((s) => s.replaceFigureImage)
  const selectFigure = useStudio((s) => s.selectFigure)
  const toast = useStudio((s) => s.toast)
  const readonly = useStudio(selectReadonly)
  const mobile = variant === 'mobile'

  const fileInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  /** 待换图的主文件名（菜单点「更换图片」后打开 replaceInput） */
  const [replaceName, setReplaceName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [deleting, setDeleting] = useState<{ figure: FigureItem; refs: FigureRef[]; busy: boolean } | null>(null)
  /* queryFn 只返数组——Set 会被 structuralSharing 深度克隆成普通对象，.has 变 undefined 令面板崩（5550875 实案） */
  const { data: srcList } = useQuery({
    queryKey: ['figure-sources', pid],
    queryFn: () => api.getFigureSources(pid!),
    enabled: !!pid && projectReady,
  })
  const srcStems = useMemo(
    () => new Set((srcList?.sources ?? []).filter((s) => /\.(mmd|spec)$/.test(s.name)).map((s) => s.name.replace(/\.(mmd|spec)$/, ''))),
    [srcList],
  )

  useEffect(() => {
    if (pid && projectReady && figuresPid !== pid) void loadFigures(pid)
  }, [pid, projectReady, figuresPid, loadFigures])

  const names = useMemo(() => figures.map((f) => f.name), [figures])
  const labelOf = (name: string) => {
    const f = figures.find((x) => x.name === name)
    return f ? figureLabel(f) : name
  }
  const report = preflight && preflightPid === pid ? preflight : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= names.length) return
    void reorderFigures(arrayMove(names, from, to))
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(names.indexOf(String(active.id)), names.indexOf(String(over.id)))
  }

  const upload = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? [])
    if (!files.length || !pid || readonly) return
    /* 与附图书 / 文件树同一预校验（扩展名 + ≤50MB），被拒文件逐条 toast 不上传 */
    const { ok, bad } = splitFiles(files, figureReject)
    for (const b of bad) toast(`${b.file.name}：${b.reason}`, 'error')
    if (!ok.length) return
    setUploading(true)
    try {
      await uploadFigures(ok)
    } finally {
      setUploading(false)
    }
  }
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    void upload(e.target.files)
    e.target.value = ''
  }
  const askReplace = (name: string) => {
    setReplaceName(name)
    /* 选文件框随 React 一轮渲染挂上 name 即开——值用闭包读 replaceName，input 不再受控 */
    requestAnimationFrame(() => replaceInput.current?.click())
  }
  const onPickReplace = (e: ChangeEvent<HTMLInputElement>) => {
    const name = replaceName
    const stem = name?.replace(/\.[^.]*$/, '') ?? null
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!name || !stem || !picked.length || !pid || readonly) return
    /* 后端约定：换图上传的每个文件 stem 须 == 本组 stem——把所选文件改回本组 stem，后缀沿用所选（换格式由后端定主文件） */
    const { ok, bad } = splitFiles(picked, figureReject)
    for (const b of bad) toast(`${b.file.name}：${b.reason}`, 'error')
    if (!ok.length) return
    const renamed = ok.map((f) => new File([f], `${stem}${/\.[^.]+$/.exec(f.name)?.[0]?.toLowerCase() ?? '.png'}`, { type: f.type }))
    void replaceFigureImage(name, renamed)
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e) || readonly) return
    e.preventDefault()
    setDragOver(false)
    void upload(e.dataTransfer.files)
  }
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e) || !pid || unavailable || readonly) return
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
        s.closeCompanion()
        useStudio.getState().closeReviewDrawer()
      }
    } else {
      toast(`编辑器未就绪，无法插入「${text}」（结构视图下请先切回源码）`, 'info')
    }
  }
  const patch = (f: FigureItem, p: FigurePatch) => void updateFigure(f.name, p)

  const deleteBusy = useRef(false)
  const confirmDelete = async () => {
    // ref 闸：busy state 未 flush 前的同拍双击也会重发 DELETE（disabled 只挡渲染后）
    if (!deleting || deleteBusy.current) return
    deleteBusy.current = true
    try {
      setDeleting({ ...deleting, busy: true })
      const r = await deleteFigure(deleting.figure.name)
      if (r.ok || r.refs.length === 0) setDeleting(null)
      else setDeleting({ figure: deleting.figure, refs: r.refs, busy: false })
    } finally {
      deleteBusy.current = false
    }
  }

  const canUpload = !!pid && !unavailable && !uploading && !readonly
  const btn = cn(
    'inline-flex items-center gap-1 rounded border px-2 text-xs text-fg hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent [&_svg]:size-3.5',
    FOCUS_RING,
    mobile ? 'min-h-touch px-3 text-sm' : 'h-6',
  )

  let empty: string
  if (!pid) empty = '请先打开一个案子'
  else if (unavailable) empty = `附图管理后端尚未实现（${error ?? '501'}）`
  else if (error) empty = error
  else if (loading && figures.length === 0) empty = '正在读取附图…'
  else empty = '暂无附图 · 拖入图片或点击「上传」添加（emf / png / jpg …）'

  return (
    <section
      data-slot="FiguresPanel"
      data-testid="figures-panel"
      data-variant={variant}
      data-dragover={dragOver || undefined}
      aria-label="附图"
      className={cn('relative flex h-full min-h-0 flex-col', className)}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={cn('flex shrink-0 items-center gap-1 border-b px-2', mobile ? 'h-11' : 'h-8')} data-testid="figures-header">
        <span className="text-xs text-fg-muted tabular" data-testid="figures-count">
          {figures.length} 幅
        </span>
        {(loading || uploading) && <Loader2 aria-hidden className="size-3.5 animate-spin text-fg-muted" />}
        <div className="ml-auto flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={FIGURE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={onPick}
            data-testid="figures-file-input"
          />
          <input
            ref={replaceInput}
            type="file"
            multiple
            accept={FIGURE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={onPickReplace}
            data-testid="figures-replace-input"
          />
          <button
            type="button"
            className={btn}
            disabled={!canUpload}
            aria-label={uploading ? '正在上传附图' : '上传附图'}
            aria-busy={uploading}
            onClick={() => fileInput.current?.click()}
            data-testid="figures-upload"
          >
            {uploading ? <Loader2 aria-hidden className="animate-spin" /> : <ImagePlus aria-hidden />} {uploading ? '上传中…' : '上传'}
          </button>
          <a
            className={cn(btn, (!pid || figures.length === 0) && 'pointer-events-none opacity-50')}
            href={pid ? api.figuresExportUrl(pid) : undefined}
            download
            aria-disabled={!pid || figures.length === 0}
            tabIndex={!pid || figures.length === 0 ? -1 : undefined}
            data-testid="figures-export"
          >
            <FolderArchive aria-hidden /> 导出 zip
          </a>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto" data-testid="figures-body">
        {figures.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm text-fg-muted" data-testid="figures-empty">
              {empty}
            </p>
            {pid && !unavailable && !loading && !error && (
              <button type="button" className={cn(btn, 'h-8 px-3')} disabled={!canUpload} onClick={() => fileInput.current?.click()} data-testid="figures-empty-upload">
                <ImagePlus aria-hidden /> 选择图片
              </button>
            )}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[verticalOnly]}
            onDragEnd={onDragEnd}
            accessibility={{ announcements: figureAnnouncements(labelOf), screenReaderInstructions: FIGURE_SR_INSTRUCTIONS }}
          >
            <SortableContext items={names} strategy={verticalListSortingStrategy}>
              <ul aria-label="附图列表" className={cn('flex flex-col p-2', mobile ? 'gap-2' : 'gap-1.5')} data-testid="figures-list">
                {figures.map((f, i) => {
                  const caption = captionOf(ast, f.num)
                  return (
                    <FigureCard
                      key={f.name}
                      pid={pid!}
                      figure={f}
                      index={i}
                      count={figures.length}
                      caption={caption}
                      refs={refsOf(report, f.num)}
                      selected={selected === f.name}
                      mobile={mobile}
                      srcStems={srcStems}
                      onSelect={() => selectFigure(f.name)}
                      onMove={(d) => move(i, i + d)}
                      onPatch={(p) => patch(f, p)}
                      onInsertRef={() => insertRef(f)}
                      onReplaceImage={() => askReplace(f.name)}
                      onGotoLine={(line) => gotoSourceLine(line, 'description')}
                      onDelete={() => setDeleting({ figure: f, refs: [], busy: false })}
                      readOnly={readonly}
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
          data-testid="figures-dropzone"
        >
          <UploadCloud aria-hidden className="size-6" />
          松开即上传为附图
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
