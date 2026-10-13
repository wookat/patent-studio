import { useState, type KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical, ImageOff, ImageUp, MoreHorizontal, Star, TextCursorInput, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { boardHash } from '@/lib/hash'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { FigureItem, FigurePatch, FigureRef } from '@/types/figures'
import { refLabel } from './DeleteFigureDialog'
import { figureLabel, type FigureCaption } from './figureModel'

export interface FigureCardProps {
  pid: string
  figure: FigureItem
  index: number
  count: number
  caption: FigureCaption
  refs: FigureRef[] | null
  selected: boolean
  mobile: boolean
  onSelect(): void
  onMove(delta: -1 | 1): void
  onPatch(patch: FigurePatch): void
  onInsertRef(): void
  /** 菜单「更换图片」——打开面板级文件选择（整组替换，被引用也可换） */
  onReplaceImage(): void
  onGotoLine(line: number): void
  onDelete(): void
  /** 只读角色（viewer/reviewer）：禁用一切写动作（排序/引用/摘要图/删除/宽度） */
  readOnly?: boolean
  /** figs-src 中已有 mmd 图源的 stem 集——命中才显示「在画板中编辑」 */
  srcStems?: ReadonlySet<string>
}

/** A4 版心上限（与 input max 同口径；R37-01：此前 max 只挡 spinner，commit 不 clamp 可提交 1512） */
const MAX_CM = 17

function parseCm(raw: string): number | null {
  const v = Number(raw.trim())
  return Number.isFinite(v) && v > 0 ? Math.min(MAX_CM, Math.round(v * 10) / 10) : null
}

/** 宽度输入：受控字符串，失焦 / Enter 提交（非法值回退到当前值），Esc 放弃 */
function CmInput({ value, label, mobile, onCommit }: { value: number | null; label: string; mobile: boolean; onCommit(v: number): void }) {
  const shown = value == null ? '' : String(value)
  /** null = 跟随 store 值；编辑中为草稿字符串 */
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const v = parseCm(draft)
    setDraft(null)
    if (v != null && v !== value) onCommit(v)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setDraft(null)
    }
  }
  return (
    <Input
      type="number"
      inputMode="decimal"
      step={0.5}
      min={1}
      max={17}
      value={draft ?? shown}
      placeholder="cm"
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKey}
      onPointerDown={(e) => e.stopPropagation()}
      data-esc-local={draft != null || undefined}
      className={cn('w-14 px-1.5 text-xs tabular', mobile ? 'h-touch w-20 text-sm' : 'h-6')}
    />
  )
}

/**
 * 一张附图卡（设计 §6.2 卡片列表）：缩略图 · 灰显图号（内核生成）· 题注（AST，点击定位到题注行）· 宽度 cm · 摘要图 · 引用数。
 * 桌面：dnd-kit 手柄（指针 + 键盘：空格抓起、↑↓ 移动）；移动：上移 / 下移按钮（触摸拖拽不做）。写动作全部回调到面板 → figures slice。
 */
export function FigureCard(p: FigureCardProps) {
  const { figure: f, mobile, caption, refs } = p
  const label = figureLabel(f)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: f.name, disabled: mobile || p.readOnly })
  const thumb = mobile ? 'size-24' : 'size-16'
  const iconBtn = cn(
    'inline-flex shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent',
    FOCUS_RING,
    mobile ? 'min-h-touch min-w-touch [&_svg]:size-5' : 'size-6 [&_svg]:size-4',
  )
  const textBtn = cn(
    'inline-flex items-center justify-center gap-1 rounded border px-2 text-xs hover:bg-hover disabled:opacity-40 [&_svg]:size-3.5',
    FOCUS_RING,
    mobile && 'min-h-touch flex-1 text-sm [&_svg]:size-4',
  )
  const ast = useStudio((s) => s.ast)
  const figsV = useStudio((s) => s.figsVersion)
  const captionText = caption.text ?? (f.num != null ? '未写题注' : '未列入说明书附图，不进递交件')
  const alt = caption.text ? `${label}：${caption.text}` : `${label} ${f.name}`

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-slot="FigureCard"
      data-testid={`figure-card-${f.name}`}
      data-name={f.name}
      data-selected={p.selected || undefined}
      aria-label={alt}
      className={cn(
        'group relative flex flex-col rounded-sm border bg-panel text-fg outline-none transition-shadow',
        p.selected ? 'border-brand-300 ring-1 ring-brand-300' : 'hover:border-border-strong',
        isDragging && 'z-sticky shadow-lg opacity-90',
      )}
      onClick={p.onSelect}
      onFocus={(e) => {
        if (e.target === e.currentTarget) p.onSelect()
      }}
      tabIndex={-1}
    >
      <div className="flex items-center gap-1 whitespace-nowrap px-1.5 pt-1.5">
        {!mobile && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={cn(iconBtn, 'cursor-grab touch-none active:cursor-grabbing')}
            aria-label={`拖动排序 ${label}`} title={`拖动排序 ${label}`}
            disabled={p.readOnly}
            data-testid="figure-drag-handle"
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </button>
        )}
        <span className={cn('font-medium tabular', mobile ? 'text-sm' : 'text-xs', f.num == null ? 'text-warn-fg' : 'text-fg-muted')} data-testid="figure-num">
          {label}
        </span>
        {f.is_abstract && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-ok-bg px-1.5 text-2xs leading-4 text-ok-fg [&_svg]:size-3" data-testid="figure-abstract-badge">
            <Star aria-hidden /> 摘要
          </span>
        )}
        {refs != null && (
          <span
            className={cn('rounded-full px-1.5 text-2xs leading-4 tabular', refs.length ? 'bg-sunken text-fg-muted' : 'bg-warn-bg text-warn-fg')}
            title={refs.length ? refs.map((r) => `${refLabel(r, ast)}：${r.text}`).join('\n') : '正文尚未引用'}
            data-testid="figure-ref-count"
          >
            引用 {refs.length}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(iconBtn, 'ml-auto')} aria-label={`${label} 更多操作`} title="更多操作" data-testid="figure-menu">
              <MoreHorizontal />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={p.onInsertRef} disabled={f.num == null || p.readOnly} data-testid="figure-menu-insert">
              <TextCursorInput /> 插入引用「{label}」
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onMove(-1)} disabled={p.readOnly || p.index === 0} data-testid="figure-menu-up">
              <ArrowUp /> 上移
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onMove(1)} disabled={p.readOnly || p.index >= p.count - 1} data-testid="figure-menu-down">
              <ArrowDown /> 下移
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onPatch({ abstract: true })} disabled={p.readOnly || f.is_abstract} data-testid="figure-menu-abstract">
              <Star /> {f.is_abstract ? '已是摘要附图' : '设为摘要附图'}
            </DropdownMenuItem>
            {p.srcStems?.has(f.name.replace(/\.[^.]+$/, '')) && (
              <DropdownMenuItem
                onSelect={() => { window.location.hash = boardHash(p.pid, f.name.replace(/\.[^.]+$/, '')) }}
                disabled={p.readOnly}
                data-testid="figure-menu-board"
              >
                在画板中编辑
              </DropdownMenuItem>
            )}
            {f.preview && (
              <DropdownMenuItem
                onSelect={() => { window.location.hash = boardHash(p.pid, undefined, f.preview!) }}
                disabled={p.readOnly}
                data-testid="figure-menu-board-annotate"
              >
                画板改图（标注·挪区）
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={p.onReplaceImage} disabled={p.readOnly} data-testid="figure-menu-replace">
              <ImageUp /> 更换图片…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={p.onDelete} disabled={p.readOnly} className="text-danger-fg focus:bg-danger-bg focus:text-danger-fg" data-testid="figure-menu-delete">
              <Trash2 /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex gap-2 px-1.5 pb-1.5 pt-1">
        <div className={cn(thumb, 'flex shrink-0 items-center justify-center overflow-hidden rounded border bg-sunken')}>
          {f.preview ? (
            <img src={api.figUrl(p.pid, f.preview, figsV)} alt={alt} loading="lazy" draggable={false} className="size-full object-contain" data-testid="figure-thumb" />
          ) : (
            <span className="flex flex-col items-center gap-0.5 text-fg-muted" title="无可预览的伴生 png/svg" data-testid="figure-thumb-placeholder">
              <ImageOff aria-hidden className={mobile ? 'size-7' : 'size-5'} />
              <span className="text-2xs uppercase leading-3">{f.ext.slice(1)}</span>
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {caption.line != null ? (
            <button
              type="button"
              className={cn('line-clamp-2 text-left leading-4 hover:underline', FOCUS_RING, mobile ? 'min-h-touch text-sm leading-5' : 'text-xs')}
              title="定位到题注"
              onClick={(e) => {
                e.stopPropagation()
                p.onGotoLine(caption.line!)
              }}
              data-testid="figure-caption"
            >
              {captionText}
            </button>
          ) : (
            <span className={cn('line-clamp-2 italic leading-4 text-fg-muted', mobile ? 'text-sm leading-5' : 'text-xs')} data-testid="figure-caption">
              {captionText}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-nowrap text-2xs text-fg-muted">
            <span className="flex items-center gap-1">
              <span>宽</span>
              {p.readOnly ? (
                <span className="tabular">{f.width ?? '—'}</span>
              ) : (
                <CmInput value={f.width} label={`${label} 说明书宽度（厘米）`} mobile={mobile} onCommit={(width) => p.onPatch({ width })} />
              )}
              <span>cm</span>
            </span>
            {f.is_abstract && (
              <span className="flex items-center gap-1">
                <span>摘要</span>
                {p.readOnly ? (
                  <span className="tabular">{f.abstract_width ?? '—'}</span>
                ) : (
                  <CmInput value={f.abstract_width} label={`${label} 摘要附图宽度（厘米）`} mobile={mobile} onCommit={(abstract_width) => p.onPatch({ abstract_width })} />
                )}
                <span>cm</span>
              </span>
            )}
          </div>
          <span className="truncate text-2xs text-fg-muted" title={[f.name, ...f.companions].join(' · ')} data-testid="figure-name">
            {f.name}
            {f.companions.length > 0 && <span> +{f.companions.length}</span>}
          </span>
        </div>
      </div>

      {mobile && (
        <div className="flex gap-1 border-t px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={textBtn} disabled={p.readOnly || p.index === 0} aria-label={`${label} 上移`} onClick={() => p.onMove(-1)} data-testid="figure-move-up">
            <ArrowUp aria-hidden /> 上移
          </button>
          <button type="button" className={textBtn} disabled={p.readOnly || p.index >= p.count - 1} aria-label={`${label} 下移`} onClick={() => p.onMove(1)} data-testid="figure-move-down">
            <ArrowDown aria-hidden /> 下移
          </button>
          <button type="button" className={textBtn} disabled={f.num == null || p.readOnly} onClick={p.onInsertRef} data-testid="figure-insert-ref">
            <TextCursorInput aria-hidden /> 插入引用
          </button>
        </div>
      )}
      {!mobile && (
        <button
          type="button"
          className={cn(textBtn, 'mx-1.5 mb-1.5 h-6 justify-center')}
          disabled={f.num == null || p.readOnly}
          onClick={(e) => {
            e.stopPropagation()
            p.onInsertRef()
          }}
          data-testid="figure-insert-ref"
        >
          <TextCursorInput aria-hidden /> 插入引用「{label}」
        </button>
      )}
    </li>
  )
}
