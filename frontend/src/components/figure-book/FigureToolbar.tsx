import { useRef, useState, type FormEvent } from 'react'
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, ChevronDown, FolderArchive, PenTool, X } from 'lucide-react'
import { goBoard } from '@/lib/hash'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { FIGURE_ACCEPT } from '@/components/figures/figureModel'
import { api } from '@/lib/api'
import { FIG_WIDTH_MAX, FIG_WIDTH_MIN, clampFigWidth, useStudio } from '@/store'
import { cn } from '@/lib/utils'
import { UploadDrop } from './UploadDrop'
import { figureReject, splitFiles } from './figureFiles'

export interface FigureToolbarProps {
  /** 有图号（已编入）的图数；0 时统一宽 / 高禁用 */
  count: number
  variant: 'desktop' | 'mobile'
  readOnly?: boolean
  className?: string
}

const PRESETS = [17, 15, 12, 8.5] as const

/**
 * 附图书顶部工具条（15 §4.2）：上传 · 统一宽度（预设 17/15/12/8.5 或输入）· 统一高度（cm，按每图宽高比换算为宽）· 导出 zip。
 * 单图动作（设摘要图 / 删除 / 上下移）在卡片菜单里，不在这里。
 */
export function FigureToolbar({ count, variant, readOnly, className }: FigureToolbarProps) {
  const pid = useStudio((s) => s.pid)
  const uploadFigures = useStudio((s) => s.uploadFigures)
  const unifyFigureWidth = useStudio((s) => s.unifyFigureWidth)
  const unifyFigureHeight = useStudio((s) => s.unifyFigureHeight)
  const toast = useStudio((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'width' | 'height' | null>(null)
  const [draft, setDraft] = useState('')
  /* 一键统一全部附图尺寸会覆盖逐图微调且不可经版本恢复——预设/自定义两路都先两阶确认（OaRounds 同例） */
  const [pending, setPending] = useState<{ mode: 'width' | 'height'; value: number } | null>(null)
  const widthBtn = useRef<HTMLButtonElement>(null)
  const heightBtn = useRef<HTMLButtonElement>(null)
  const mobile = variant === 'mobile'
  const disabled = readOnly || !pid || busy
  /** 触控档图标控件本体即 44×44（06 §2.1）；gap-1 紧邻时 touch-hit 伪元素会盖住邻居，故不用 */
  const iconSize = mobile && 'min-h-touch min-w-touch justify-center'

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      setMode(null)
      setDraft('')
    }
  }
  const upload = (files: File[]) => {
    const { ok, bad } = splitFiles(files, figureReject)
    for (const b of bad) toast(`${b.file.name}：${b.reason}`, 'error')
    if (ok.length) void run(async () => { await uploadFigures(ok) })
  }
  /** Esc 只收自定义表单，焦点回打开它的按钮 */
  const cancel = () => {
    const back = mode === 'width' ? widthBtn.current : heightBtn.current
    setMode(null)
    setDraft('')
    back?.focus()
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = Number(draft)
    if (!Number.isFinite(v) || v <= 0 || !mode) return
    setPending({ mode, value: mode === 'width' ? clampFigWidth(v) : v })
    setMode(null)
    setDraft('')
  }
  const confirmUnify = () => {
    const p = pending
    setPending(null)
    if (p) void run(() => (p.mode === 'width' ? unifyFigureWidth(p.value) : unifyFigureHeight(p.value)))
  }

  return (
    <div data-slot="FigureToolbar" role="toolbar" aria-label="附图书工具" className={cn('flex flex-wrap items-center gap-1 border-b px-2 py-1', className)}>
      <UploadDrop compact accept={FIGURE_ACCEPT} label="上传附图" disabled={disabled} onFiles={upload} testId="fb-upload" className={iconSize || undefined}>
        {!mobile && <span>上传</span>}
      </UploadDrop>

      <Button
        size="sm"
        variant="ghost"
        className={cn('h-7 gap-1 px-1.5 text-xs', iconSize)}
        disabled={readOnly}
        onClick={() => { if (pid) goBoard(pid) }}
        aria-label="绘制附图"
        title={mobile ? '绘制附图' : '绘制附图（画板：流程图/结构框图 + 拖拽精调）'}
        data-testid="fb-draw"
      >
        <PenTool aria-hidden />
        {!mobile && '绘制'}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={widthBtn}
            size="sm"
            variant="ghost"
            className={cn('h-7 gap-1 px-1.5 text-xs', iconSize)}
            disabled={disabled || count === 0}
            aria-label="统一宽度"
            title={mobile ? '统一宽度' : undefined}
            data-testid="fb-unify-width"
          >
            <AlignHorizontalJustifyCenter aria-hidden />
            {!mobile && '统一宽度'}
            <ChevronDown className="size-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRESETS.map((w) => (
            <DropdownMenuItem key={w} onSelect={() => setPending({ mode: 'width', value: w })}>
              {w} cm{w === 17 ? '（满幅）' : w === 15 ? '（默认）' : ''}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setMode('width')}>自定义…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        ref={heightBtn}
        size="sm"
        variant="ghost"
        className={cn('h-7 gap-1 px-1.5 text-xs', iconSize)}
        disabled={disabled || count === 0}
        onClick={() => setMode('height')}
        aria-label="统一高度"
        title={mobile ? '统一高度' : undefined}
        data-testid="fb-unify-height"
      >
        <AlignVerticalJustifyCenter aria-hidden />
        {!mobile && '统一高度'}
      </Button>

      {pending && (
        <span className="flex items-center gap-1" role="group" aria-label="确认统一附图尺寸">
          <span className="text-xs text-danger-fg">统一 {count} 幅{pending.mode === 'width' ? '宽度' : '高度'}为 {pending.value}cm？</span>
          <Button size="xs" variant="danger" disabled={busy} onClick={confirmUnify} data-testid="fb-unify-confirm">确认</Button>
          <Button size="icon-xs" variant="ghost" aria-label="取消" onClick={() => setPending(null)} data-testid="fb-unify-cancel">
            <X aria-hidden />
          </Button>
        </span>
      )}
      {mode && (
        <form className="flex items-center gap-1" onSubmit={submit} aria-label={mode === 'width' ? '统一宽度' : '统一高度'}>
          <Input
            autoFocus
            type="number"
            inputMode="decimal"
            step={0.5}
            min={mode === 'width' ? FIG_WIDTH_MIN : 1}
            max={mode === 'width' ? FIG_WIDTH_MAX : 25}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
            }}
            data-esc-local
            placeholder={mode === 'width' ? '宽 cm' : '高 cm'}
            aria-label={mode === 'width' ? '统一宽度（厘米）' : '统一高度（厘米）'}
            className={cn('w-20 text-xs', mobile ? 'h-touch' : 'h-7')}
            data-testid="fb-unify-input"
          />
          <Button size="sm" type="submit" className={cn('h-7 text-xs', iconSize)} disabled={busy}>应用</Button>
        </form>
      )}

      <span className="ml-auto text-xs text-fg-muted tabular" data-testid="fb-count">{count} 幅</span>
      {pid && (
        <a
          className={cn('inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs text-fg-muted hover:bg-hover hover:text-fg', iconSize, count === 0 && 'pointer-events-none opacity-50')}
          href={api.figuresExportUrl(pid)}
          download
          aria-disabled={count === 0}
          tabIndex={count === 0 ? -1 : undefined}
          title="导出全部附图 zip"
          data-testid="fb-export"
        >
          <FolderArchive className="size-4" aria-hidden />
          {!mobile && 'zip'}
        </a>
      )}
    </div>
  )
}
