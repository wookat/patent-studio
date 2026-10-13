import { useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, ImageOff, Pencil, Plus, Star, X } from 'lucide-react'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'
import type { FigureItem } from '@/types/figures'
import type { PreflightItem } from '@/types/preflight'
import { WidthHandle } from './WidthHandle'

export interface FigureCardProps {
  figure: FigureItem
  /** 缩略图 URL（api.figUrl(pid, figure.preview)）；null = 无可显示的预览（emf 无伴生） */
  previewUrl?: string | null
  /** 说明书「图N为…」题注（AST）；null = 未写 */
  caption: string | null
  /** 题注所在全文行；有则题注可点击定位 */
  captionLine?: number | null
  /** 正文引用数（体检报告）；null = 未跑体检 */
  refCount: number | null
  /** 体检里 block_id=figures/N 的条目 → 右上角角标 */
  issues?: readonly PreflightItem[]
  selected: boolean
  /** 缩略图区域代表的页面可用宽度 17 cm 对应多少 px（卡片容器宽度）；WidthHandle 用它换算拖拽 */
  pxPerCm: number
  variant: 'desktop' | 'mobile'
  readOnly?: boolean
  onSelect(): void
  onWidth(width: number): void
  onAbstractWidth?(width: number): void
  onAspect(ratio: number): void
  onGotoCaption?(line: number): void
  /** 标号表整表替换（标号→名称）；仅已编入说明书节的图有该回调 */
  onMarks?(marks: Record<string, string>): void
  /** 右上角 / 长按工具条插槽：FigureToolbar 的单图菜单（设为摘要图 / 删除 / 插入引用 / 定位题注） */
  menu?: ReactNode
  /** dnd-kit 拖拽把手插槽（桌面）；移动用上移 / 下移按钮放进 menu */
  dragHandle?: ReactNode
  /** dnd-kit useSortable 的节点 ref / transform（由 FigureBookView 注入） */
  setNode?: (el: HTMLLIElement | null) => void
  style?: CSSProperties
  dragging?: boolean
}

const worst = (issues: readonly PreflightItem[]) => (issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : 'info')

const MARK_NUM_RE = /^\d{3,4}$/

/**
 * 附图标记号表（figures.md `marks:`，W15 批85-D）：只读时显示 `101 名称` 行；点铅笔进入编辑——
 * 行内增删改后「完成」整表 PUT（{num: name}），校验口径同后端（3-4 位数字 + 名称非空），不合法行阻止提交。
 */
function MarksSection({ name, marks, readOnly, onMarks }: {
  name: string
  marks: Record<string, string>
  readOnly?: boolean
  onMarks?: (marks: Record<string, string>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<[string, string][]>([])
  const [error, setError] = useState<string | null>(null)
  const entries = Object.entries(marks)

  const startEdit = () => {
    setRows(entries.map(([k, v]) => [k, v] as [string, string]))
    setError(null)
    setEditing(true)
  }
  const commit = () => {
    const cleaned: Record<string, string> = {}
    for (const [num, label] of rows) {
      const n = num.trim(), l = label.trim()
      if (!n && !l) continue
      if (!MARK_NUM_RE.test(n)) { setError(`标记号须为 3–4 位数字：${n || '(空)'}`); return }
      if (!l) { setError(`标记 ${n} 缺名称`); return }
      cleaned[n] = l
    }
    onMarks?.(cleaned)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="mt-0.5" data-testid="fb-card-marks" data-name={name}>
        {entries.length > 0 && (
          <ul className="space-y-0.5" aria-label={`${name} 标号表`}>
            {entries.map(([num, label]) => (
              <li key={num} className="flex items-baseline gap-1.5 text-fg-muted" data-testid="fb-card-mark">
                <span className="shrink-0 font-mono tabular">{num}</span>
                <span className="truncate" title={label}>{label}</span>
              </li>
            ))}
          </ul>
        )}
        {onMarks && (
          <button
            type="button"
            className={cn('mt-0.5 inline-flex items-center gap-1 rounded-sm text-fg-subtle hover:text-fg', FOCUS_RING)}
            onClick={(e) => { e.stopPropagation(); startEdit() }}
            disabled={readOnly}
            data-testid="fb-card-marks-edit"
          >
            <Pencil className="size-3" aria-hidden />{entries.length ? '编辑标号' : '添加标号'}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="mt-0.5 space-y-1" data-testid="fb-card-marks-editor" onClick={(e) => e.stopPropagation()}>
      {rows.map(([num, label], i) => (
        <div key={i} className="flex items-center gap-1" data-testid="fb-card-mark-row">
          <input
            value={num}
            inputMode="numeric"
            maxLength={4}
            placeholder="标号"
            aria-label={`标号 ${i + 1}`}
            className="h-6 w-14 rounded border bg-panel px-1 font-mono tabular text-fg"
            onChange={(e) => setRows((r) => r.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))}
            data-testid={`fb-mark-num-${i}`}
          />
          <input
            value={label}
            placeholder="名称"
            aria-label={`名称 ${i + 1}`}
            className="h-6 min-w-0 flex-1 rounded border bg-panel px-1 text-fg"
            onChange={(e) => setRows((r) => r.map((row, j) => (j === i ? [row[0], e.target.value] : row)))}
            data-testid={`fb-mark-name-${i}`}
          />
          <button
            type="button"
            className={cn(touchHit, 'inline-flex size-6 items-center justify-center rounded-full text-fg-muted hover:text-fg', FOCUS_RING)}
            aria-label={`删除标号行 ${i + 1}`}
            onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
            data-testid={`fb-mark-rm-${i}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      ))}
      {error && <p role="alert" className="text-2xs text-danger-fg" data-testid="fb-marks-error">{error}</p>}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={cn('inline-flex items-center gap-0.5 rounded-sm text-fg-subtle hover:text-fg', FOCUS_RING)}
          onClick={() => setRows((r) => [...r, ['', '']])}
          data-testid="fb-mark-add"
        >
          <Plus className="size-3" aria-hidden />加一行
        </button>
        <button type="button" className={cn('ml-auto rounded-sm font-medium text-fg hover:text-fg-strong', FOCUS_RING)} onClick={commit} data-testid="fb-marks-save">完成</button>
        <button type="button" className={cn('rounded-sm text-fg-subtle hover:text-fg', FOCUS_RING)} onClick={() => setEditing(false)} data-testid="fb-marks-cancel">取消</button>
      </div>
    </div>
  )
}

/**
 * 附图书一张卡（15 §4.2）：缩略图按 width/17 占卡片宽度（所见即 DOCX 相对比例）· 右缘 WidthHandle ·
 * 图号（内核按顺序生成）· alt（figures.md 显示文本）· 题注（AST）· 摘要图星标 · 引用数 · 体检角标。
 * 写动作全部回调给 FigureBookView → figures / figuresBook slice；卡片不碰 store。
 */
export function FigureCard({
  figure: f, previewUrl, caption, captionLine, refCount, issues: issuesProp, selected, pxPerCm, variant, readOnly,
  onSelect, onWidth, onAbstractWidth, onAspect, onGotoCaption, onMarks, menu, dragHandle, setNode, style, dragging,
}: FigureCardProps) {
  const mobile = variant === 'mobile'
  const [preview, setPreview] = useState<number | null>(null)
  const [broken, setBroken] = useState(false)
  /** 摘要图宽输入有未提交草稿（值 ≠ 当前值）：Esc 先回退草稿，不关外层 Sheet */
  const [abstractDirty, setAbstractDirty] = useState(false)
  const abstractShown = f.abstract_width == null ? '' : String(f.abstract_width)
  const width = preview ?? f.width ?? 15
  const pct = Math.min(100, Math.max(12, (width / 17) * 100))
  const label = f.num != null ? `图${f.num}` : '未编入'
  const issues = issuesProp ?? []
  const tone = issues.length ? worst(issues) : null

  return (
    <li
      ref={setNode}
      style={style}
      data-slot="FigureCard"
      data-testid={`fb-card-${f.name}`}
      data-name={f.name}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      aria-label={caption ? `${label}：${caption}` : `${label} ${f.name}`}
      className={cn(
        'group relative flex min-w-0 flex-col gap-1 rounded-sm border bg-panel p-2 text-fg outline-none transition-shadow',
        selected ? 'border-brand-300 ring-1 ring-brand-300' : 'hover:border-border-strong',
        dragging && 'z-sticky opacity-90 shadow-lg',
      )}
      onClick={onSelect}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onSelect()
      }}
      tabIndex={-1}
    >
      <div className={cn('flex min-w-0 items-center gap-1', mobile ? 'text-sm' : 'text-xs')}>
        {dragHandle}
        <span className={cn('font-medium tabular', f.num == null && 'text-warn-fg')} data-testid="fb-card-num">{label}</span>
        {f.is_abstract && (
          <span className="inline-flex items-center gap-0.5 rounded bg-ok-bg px-1 text-ok-fg" title="摘要附图" data-testid="fb-card-abstract">
            <Star className="size-3" aria-hidden />摘要图
          </span>
        )}
        {tone && (
          <span
            role="img"
            aria-label={`体检 ${issues.length} 条：${issues.map((i) => i.message).join('；')}`}
            title={issues.map((i) => `[${i.severity}] ${i.message}`).join('\n')}
            className={cn(
              'inline-flex items-center gap-0.5 rounded px-1 tabular [&_svg]:size-3',
              tone === 'error' ? 'bg-danger-bg text-danger-fg' : tone === 'warning' ? 'bg-warn-bg text-warn-fg' : 'bg-sunken text-fg-muted',
            )}
            data-testid="fb-card-issues"
            data-severity={tone}
          >
            <AlertTriangle aria-hidden />{issues.length}
          </span>
        )}
        <span className="min-w-0 truncate text-fg-muted" title={f.name}>{f.name}</span>
        <span className="ml-auto shrink-0 tabular text-fg-muted" data-testid="fb-card-width">{width} cm</span>
        {menu}
      </div>

      <div className="relative w-full rounded bg-sunken py-2" data-testid="fb-card-stage">
        <div className="relative mx-auto flex min-h-24 items-center" style={{ width: `${pct}%` }}>
          {previewUrl && !broken ? (
            <img
              src={previewUrl}
              alt=""
              draggable={false}
              className="block w-full select-none rounded border bg-white object-contain"
              style={{ maxHeight: mobile ? 160 : 240 }}
              onLoad={(e) => {
                const el = e.currentTarget
                if (el.naturalHeight > 0) onAspect(el.naturalWidth / el.naturalHeight)
              }}
              onError={() => setBroken(true)}
            />
          ) : (
            <div className="flex h-24 w-full items-center justify-center rounded border border-dashed text-fg-muted" role="img" aria-label={`${f.name} 无预览`}>
              <ImageOff className="size-6" aria-hidden />
            </div>
          )}
          {f.num != null && (
            <WidthHandle
              value={f.width ?? 15}
              pxPerCm={pxPerCm}
              label={`${label} 宽度`}
              disabled={readOnly}
              onPreview={setPreview}
              onCommit={(w) => {
                setPreview(null)
                onWidth(w)
              }}
              className="left-full"
            />
          )}
        </div>
      </div>

      <div className={cn('flex min-w-0 flex-col gap-0.5', mobile ? 'text-sm' : 'text-xs')}>
        {f.alt && <span className="truncate text-fg-muted" title={f.alt}>alt：{f.alt}</span>}
        {caption && captionLine != null && onGotoCaption ? (
          <button
            type="button"
            className={cn('truncate text-left underline-offset-2 hover:underline', FOCUS_RING)}
            title={`${caption} · 点击定位到说明书中的题注`}
            onClick={(e) => {
              e.stopPropagation()
              onGotoCaption?.(captionLine!)
            }}
            data-testid="fb-card-caption"
          >
            {caption}
          </button>
        ) : (
          <span className={cn('truncate', !caption && 'italic text-fg-muted')} title={caption ?? undefined} data-testid="fb-card-caption">
            {caption ?? (f.num != null ? '未写题注（说明书「图N为…」）' : '未编入 docs/figures.md，不进 DOCX')}
          </span>
        )}
        {f.num != null && (
          <MarksSection name={f.name} marks={f.marks ?? {}} readOnly={readOnly} onMarks={onMarks} />
        )}
        <div className="flex items-center gap-2 text-fg-muted">
          {refCount != null && f.num != null && <span data-testid="fb-card-refs">正文引用 {refCount} 处</span>}
          {f.is_abstract && onAbstractWidth && (
            <label className="ml-auto inline-flex items-center gap-1">
              摘要图宽
              <input
                type="number"
                inputMode="decimal"
                step={0.5}
                min={2}
                max={17}
                defaultValue={f.abstract_width ?? ''}
                key={f.abstract_width ?? 'none'}
                disabled={readOnly}
                aria-label={`${label} 摘要附图宽度（厘米）`}
                className={cn('rounded border bg-panel px-1 text-right tabular text-fg', mobile ? 'h-touch w-20' : 'h-6 w-14')}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setAbstractDirty(e.currentTarget.value !== abstractShown)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  else if (e.key === 'Escape' && abstractDirty) {
                    e.stopPropagation()
                    e.currentTarget.value = abstractShown
                    setAbstractDirty(false)
                  }
                }}
                onBlur={(e) => {
                  const v = Number(e.currentTarget.value)
                  const ok = Number.isFinite(v) && v > 0
                  if (ok && v !== f.abstract_width) onAbstractWidth?.(v)
                  setAbstractDirty(!ok && e.currentTarget.value !== abstractShown)
                }}
                data-esc-local={abstractDirty || undefined}
                data-testid="fb-card-abstract-width"
              />
              cm
            </label>
          )}
        </div>
      </div>
    </li>
  )
}
