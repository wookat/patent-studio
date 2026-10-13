import { useContext, useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ImageOff, PencilLine } from 'lucide-react'
import { WidthHandle } from '@/components/figure-book/WidthHandle'
import { Block, Gen } from '@/components/block-model/blocks'
import { BlockActionsContext } from '@/components/block-model/context'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { Ast, AstFigure } from '@/types/ast'
import type { FigureItem } from '@/types/figures'

/** CSS 厘米 → 像素（纸面不缩放时 1cm = 96/2.54 px；ps-pages 的整体 zoom 由浏览器一并缩放） */
const PX_PER_CM = 96 / 2.54
/** A4 双侧 2 cm 页边距后的正文可用宽度；DOCX 里 figure width 也是按这个满宽 */
const TEXT_WIDTH_CM = 17

const modified = (e: MouseEvent) => e.ctrlKey || e.metaKey

/**
 * 说明书附图纸面（W10）：每张 AST figure 像 Word 一样直接摆在纸上——真实图片按 width/17 占正文宽、等比高、下方居中「图N」，
 * 不再套卡片 / 灰色舞台 / 文件名头栏。选中后（Word 选中图片的样子）出现宽度手柄与一行元信息（文件 · 宽 · alt · 题注），
 * 双击 → 打开附图书面板（排序 / alt / 摘要图 / 删除）。figures slice 未加载时按 pid 拉一次；
 * 某图不在 figures.md 清单（或 /figures 501）时退回只读文字行。
 */
export function FiguresPaperBody({
  ast, pid, activeId, readOnly, mobile, onOpenFigureBook,
}: { ast: Ast; pid: string | null; activeId: string | null; readOnly: boolean; mobile: boolean; onOpenFigureBook?: () => void }) {
  const figures = useStudio((s) => s.figures)
  const figsV = useStudio((s) => s.figsVersion)
  const figuresPid = useStudio((s) => s.figuresPid)
  const figuresUnavailable = useStudio((s) => s.figuresUnavailable)
  const loadFigures = useStudio((s) => s.loadFigures)
  const updateFigure = useStudio((s) => s.updateFigure)
  const setFigureAspect = useStudio((s) => s.setFigureAspect)
  const actions = useContext(BlockActionsContext)

  useEffect(() => {
    if (pid && figuresPid !== pid && !figuresUnavailable) void loadFigures(pid)
  }, [pid, figuresPid, figuresUnavailable, loadFigures])

  const byName = new Map<string, FigureItem>(figures.map((f) => [f.name, f]))
  if (ast.figures.length === 0) {
    return <p className="ps-body ps-empty">（无附图）</p>
  }
  return (
    <div className="ps-figure-list">
      {ast.figures.map((fig) => {
        const item = byName.get(baseName(fig.file))
        if (!item) return <FigureFallback key={fig.id} fig={fig} active={activeId === fig.id} />
        return (
          <PaperFigure
            key={fig.id}
            fig={fig}
            item={item}
            previewUrl={pid && item.preview ? api.figUrl(pid, item.preview, figsV) : null}
            selected={activeId === fig.id}
            readOnly={readOnly}
            mobile={mobile}
            onSelect={() => actions.select(fig.id)}
            onOpen={onOpenFigureBook}
            onWidth={(width) => void updateFigure(item.name, { width })}
            onAspect={(r) => setFigureAspect(item.name, r)}
          />
        )
      })}
    </div>
  )
}

interface PaperFigureProps {
  fig: AstFigure
  item: FigureItem
  previewUrl: string | null
  selected: boolean
  readOnly: boolean
  mobile: boolean
  onSelect(): void
  onOpen?(): void
  onWidth(width: number): void
  onAspect(ratio: number): void
}

export function PaperFigure({ fig, item, previewUrl, selected, readOnly, mobile, onSelect, onOpen, onWidth, onAspect }: PaperFigureProps) {
  const [preview, setPreview] = useState<number | null>(null)
  const [broken, setBroken] = useState(false)
  const width = preview ?? item.width ?? fig.width ?? 15
  const pct = Math.min(100, Math.max(12, (width / TEXT_WIDTH_CM) * 100))
  const label = `图${fig.num}`
  const alt = fig.alt || item.alt || null
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !readOnly && onOpen) {
      e.preventDefault()
      onOpen()
    }
  }
  return (
    <figure
      className={cn('ps-figure ps-figure-paper', selected && 'is-selected')}
      data-block-id={fig.id}
      data-kind="figure"
      data-figure-num={fig.num}
      data-file={fig.file}
      data-width={width}
      data-selected={selected || undefined}
      data-testid={`ps-figure-${item.name}`}
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-label={fig.caption ? `${label}：${fig.caption}` : `${label} ${item.name}`}
      onClick={(e) => {
        if (modified(e)) return
        onSelect()
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onSelect()
      }}
      onDoubleClick={(e) => {
        if (modified(e) || readOnly) return
        onOpen?.()
      }}
      onKeyDown={onKey}
    >
      <div className="ps-figure-stage" style={{ width: `${pct}%` }} data-testid="ps-figure-stage">
        {previewUrl && !broken ? (
          <img
            src={previewUrl}
            alt={alt ?? fig.caption ?? label}
            draggable={false}
            className="ps-figure-img"
            data-testid="ps-figure-img"
            onLoad={(e) => {
              const el = e.currentTarget
              if (el.naturalHeight > 0) onAspect(el.naturalWidth / el.naturalHeight)
            }}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="ps-figure-missing" role="img" aria-label={`${item.name} 无预览`}>
            <ImageOff className="size-6" aria-hidden />
            <span>{item.name}</span>
          </div>
        )}
        {!readOnly && (
          <WidthHandle
            value={item.width ?? 15}
            pxPerCm={PX_PER_CM}
            label={`${label} 宽度`}
            onPreview={setPreview}
            onCommit={(w) => {
              setPreview(null)
              onWidth(w)
            }}
            className={cn('left-full', !selected && !mobile && 'ps-figure-handle-idle')}
          />
        )}
      </div>
      <figcaption className="ps-figure-no tabular">
        <Gen prefix="生成图号">{label}</Gen>
      </figcaption>
      {selected && (
        <div className={cn('ps-figure-meta', mobile && 'ps-figure-meta-m')} data-testid="ps-figure-meta">
          <span className="font-mono">{item.name}</span>
          <span className="tabular" data-testid="ps-figure-width">{width} cm</span>
          {item.is_abstract && <span>摘要图</span>}
          {alt && (
            <span className="min-w-0 truncate" title={alt}>
              alt：{alt}
            </span>
          )}
          {fig.caption && (
            <span className="min-w-0 truncate" title={fig.caption}>
              {fig.caption}
            </span>
          )}
          {!readOnly && onOpen && (
            <button
              type="button"
              className="ps-figure-edit touch-hit"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              data-testid="ps-figure-edit"
            >
              <PencilLine className="size-3.5" aria-hidden />
              附图书
            </button>
          )}
        </div>
      )}
    </figure>
  )
}

const baseName = (file: string) => file.slice(file.lastIndexOf('/') + 1)

function FigureFallback({ fig, active }: { fig: AstFigure; active: boolean }) {
  return (
    <Block id={fig.id} ariaLabel={`图 ${fig.num}`} active={active} tabStop={active} className="ps-figure">
      <p className="ps-p ps-caption">
        <Gen prefix="生成图号" className="mr-2">
          图{fig.num}
        </Gen>
        {fig.caption ?? <span className="text-fg-muted">（附图说明中未找到对应图题）</span>}
        <span className="ml-2 font-mono text-xs text-fg-muted">{fig.file}</span>
      </p>
    </Block>
  )
}
