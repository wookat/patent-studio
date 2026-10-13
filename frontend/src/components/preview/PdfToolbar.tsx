import { useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronUp, Download, Minus, Plus, Scaling, Search, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useIsDesktop } from '@/hooks/useMisc'
import { api } from '@/lib/api'
import { downloadFile } from '@/lib/download'
import { cn } from '@/lib/utils'
import { useStudio, selectErrorCount, type ZoomFit } from '@/store'
import { BuildButton } from './BuildButton'
import { PdfStatusText } from './PdfStatusText'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS, ZOOM_STEP, clampZoom } from './zoom'
import { ModeSwitch } from '@/components/review/ModeSwitch'

export type PdfToolbarVariant = 'desktop' | 'mobile'

/** 工具条内竖分隔（16 高）；`narrowHidden`：桌面右组在容器 < 400 时隐藏 */
function Divider({ narrowHidden = false }: { narrowHidden?: boolean }) {
  return <Separator orientation="vertical" className={cn('mx-0.5 h-4 self-center', narrowHidden && '@max-[400px]/pdftb:hidden')} />
}

/** 桌面右组次要控件（↑↓ / − +）在容器 < 400 时隐藏，给 ModeSwitch 与页码留位 */
const NARROW_HIDDEN = '@max-[400px]/pdftb:hidden'

/**
 * PDF 工具条（05 §3.6；原型 `.pdftb`）：h-pdftb 32，bg-app，下 1px 边；控件 24 ghost xs，11/12px 文字。
 * 桌面：左组 = [构建 ▾（桌面唯一构建按钮，顶栏不再重复）] [控制台⁽ᴺ⁾] [下载] [状态：点 + 文字]；中 = [ModeSwitch]；
 *       左组 min-w-0 + overflow-x-clip（窄容器下被裁而不与页码输入重叠），ModeSwitch 与右组 shrink-0 永不被裁（W9 审阅 bug）：
 *       ModeSwitch responsive 容器 < 640 图标分段、< 400 溢出菜单；右组 < 400 时隐藏 ↑↓ / − + / 分隔，只留页码 · 缩放 ▾ · 查找。
 *       右组 = ↑ [8] / 23 ↓ │ − 适宽 ▾ + │ 查找。pdfView==='logs'：右组隐藏，左组末尾「返回预览」。
 * 移动（data-density=touch，06 §2）两行：第一行 44 = 构建（primary md 36）· 控制台（icon md）· 状态；第二行 = 查找 · 页码（Input lg 44）· 适宽 · − +，按钮视觉 md 36，
 * 命中区由 Button 的 touch-hit 扩到 44，相邻 gap 8；横向页边 16；移动不加 overflow-hidden（会裁掉热区）。
 * MobilePreview 顶栏已有 primary 构建 / MoreSheet 控制台，故只挂第二行 `PdfToolbarMobileControls`。
 */
export function PdfToolbar({ variant, className }: { variant?: PdfToolbarVariant; className?: string }) {
  const desktop = useIsDesktop()
  const v: PdfToolbarVariant = variant ?? (desktop ? 'desktop' : 'mobile')
  const mobile = v === 'mobile'
  const pdfView = useStudio((s) => s.pdfView)
  const setPdfView = useStudio((s) => s.setPdfView)
  const logs = !mobile && pdfView === 'logs'

  return (
    <div
      data-slot="PdfToolbar"
      data-testid="pdf-toolbar"
      data-variant={v}
      data-view={logs ? 'logs' : 'pdf'}
      role="toolbar"
      aria-label="PDF 预览工具条"
      className={cn(
        '@container/pdftb shrink-0 whitespace-nowrap border-b border-border bg-app text-xs text-fg-muted',
        mobile ? 'grid grid-cols-1' : 'flex h-pdftb items-center gap-1 overflow-hidden px-2',
        className,
      )}
    >
      <div
        className={cn('flex min-w-0 flex-1 items-center gap-1', mobile ? 'h-touch gap-group-m px-page-m' : 'overflow-x-clip')}
        data-testid="pdf-toolbar-left"
      >
        <BuildButton variant={v} />
        <ConsoleButton mobile={mobile} />
        {!mobile && <DownloadPdf />}
        {!logs && <PdfStatusText className={mobile ? 'ml-auto' : 'ml-2 hidden @[420px]/pdftb:inline-flex'} />}
        {logs && (
          <Button size="xs" variant="secondary" className="ml-1" onClick={() => setPdfView('pdf')} data-testid="back-to-pdf">
            <ArrowLeft aria-hidden /> 返回预览
          </Button>
        )}
      </div>

      {!mobile && !logs && <ModeSwitch responsive className="ml-1" />}
      {!logs && <RightGroup mobile={mobile} className={mobile ? 'border-t border-border' : undefined} />}
    </div>
  )
}

/** 右组：页码 │ 缩放 │ 查找（移动为 44 行内 36 控件，查找居左） */
function RightGroup({ mobile, className }: { mobile: boolean; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-0.5', mobile ? 'h-touch justify-end gap-group-m px-page-m' : 'ml-auto', className)} data-testid="pdf-toolbar-right">
      {mobile && <FindButton mobile />}
      <PageBox mobile={mobile} />
      <Divider narrowHidden={!mobile} />
      <ZoomControls mobile={mobile} />
      {!mobile && (
        <>
          <Divider narrowHidden />
          <FindButton mobile={false} />
        </>
      )}
    </div>
  )
}

/** 移动预览 Tab 的 PDF 控件行（44）：与 PdfToolbar mobile 第二行同一件代码，页码 / 适宽 / 缩放 / 查找共用 store 逻辑 */
export function PdfToolbarMobileControls({ className }: { className?: string }) {
  return (
    <div role="toolbar" aria-label="PDF 预览工具条" data-slot="PdfToolbar" data-variant="mobile" className={cn('shrink-0 whitespace-nowrap border-b border-border bg-app text-xs text-fg-muted', className)}>
      <RightGroup mobile />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------- */

/** 移动 md 36 视觉（Button 自带 touch-hit → 命中 44）；桌面 xs 24 */
const iconSize = (mobile: boolean): 'icon-md' | 'icon-xs' => (mobile ? 'icon-md' : 'icon-xs')

/** 控制台按钮 + 错误计数（Count danger）；桌面 togglePdfView，移动 openConsole → mobileTab='console' */
function ConsoleButton({ mobile }: { mobile: boolean }) {
  const pdfView = useStudio((s) => s.pdfView)
  const togglePdfView = useStudio((s) => s.togglePdfView)
  const openConsole = useStudio((s) => s.openConsole)
  const errorCount = useStudio(selectErrorCount)
  const phase = useStudio((s) => s.phase)
  const netError = useStudio((s) => s.netError)
  const badge = errorCount > 0 ? String(errorCount) : phase === 'error' && netError ? '!' : null
  const active = !mobile && pdfView === 'logs'

  return (
    <Button
      variant="ghost"
      size={iconSize(mobile)}
      className={cn('relative', !mobile && 'ml-1', active && 'bg-active text-fg-strong')}
      onClick={() => (mobile ? openConsole() : togglePdfView())}
      aria-pressed={active}
      aria-label={badge ? `控制台：${badge} 个错误` : '控制台：构建日志与问题'}
      title="控制台：构建日志与问题"
      data-testid="console-toggle"
    >
      <SquareTerminal aria-hidden />
      {badge &&
        (errorCount > 0 ? (
          <Count value={errorCount} tone="danger" className="absolute -right-1.5 -top-1" data-testid="console-badge" />
        ) : (
          <span
            className="absolute -right-1.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-solid px-1.5 text-2xs font-medium leading-none text-danger-solid-fg"
            data-testid="console-badge"
          >
            {badge}
          </span>
        ))}
    </Button>
  )
}

/* ----------------------------------------------------------------------------------------- */

/** PDF 内查找（与 PDF 区 Ctrl+F 同步） */
function FindButton({ mobile }: { mobile: boolean }) {
  const open = useStudio((s) => s.pdfFindOpen)
  const setOpen = useStudio((s) => s.setPdfFindOpen)
  const hasPdf = useStudio((s) => s.lastOk !== null)
  return (
    <Button
      variant="ghost"
      size={iconSize(mobile)}
      className={cn(open && 'bg-active text-fg-strong')}
      disabled={!hasPdf}
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      aria-label="在 PDF 中查找"
      title="在 PDF 中查找（PDF 区 Ctrl+F）"
      data-testid="pdf-find-toggle"
    >
      <Search aria-hidden />
    </Button>
  )
}

/* ----------------------------------------------------------------------------------------- */

function DownloadPdf() {
  const pid = useStudio((s) => s.pid)
  const buildId = useStudio((s) => s.lastOk?.build_id)
  const hasOk = useStudio((s) => s.lastOk !== null)
  const toast = useStudio((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const href = pid && hasOk ? api.exportUrl(pid, 'pdf', buildId) : undefined
  const title = hasOk ? '下载 PDF（上次成功构建）' : '尚无成功构建'
  const run = async () => {
    if (!href || busy) return
    setBusy(true)
    try {
      await downloadFile(href)
    } catch (e) {
      toast(`下载失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="ghost" size="icon-xs" disabled={!href || busy} onClick={() => void run()} title={title} aria-label="下载 PDF" data-testid="download-pdf" data-href={href}>
      <Download aria-hidden />
    </Button>
  )
}

/* ----------------------------------------------------------------------------------------- */

/** ↑ · 页码输入 `8 / 23`（回车/失焦跳页，Esc 取消）· ↓；移动端无箭头，输入框 lg（touch 下 Input 恒 44，06 §2.3） */
function PageBox({ mobile }: { mobile: boolean }) {
  const pageInfo = useStudio((s) => s.pageInfo)
  const requestPage = useStudio((s) => s.requestPage)
  const page = pageInfo?.page ?? 0
  const total = pageInfo?.total ?? 0
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false) // Esc → blur 会走 onBlur=commit，用 flag 挡掉（R72-01）
  const shownValue = editing ? draft : page ? String(page) : ''

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setEditing(false)
      return
    }
    const n = parseInt(draft, 10)
    if (Number.isFinite(n) && total) requestPage(Math.min(total, Math.max(1, n)))
    setEditing(false)
  }
  const disabled = total === 0

  return (
    <span className={cn('inline-flex items-center tabular', mobile ? 'gap-inline-m' : 'gap-0.5')} data-testid="page-box">
      {!mobile && (
        <Button variant="ghost" size="icon-xs" className={NARROW_HIDDEN} disabled={disabled || page <= 1} onClick={() => requestPage(page - 1)} aria-label="上一页" title="上一页" data-testid="page-prev">
          <ChevronUp aria-hidden />
        </Button>
      )}
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={shownValue}
        disabled={disabled}
        aria-label="页码"
        size={mobile ? 'lg' : 'sm'}
        className={cn('px-1 text-center tabular', mobile ? 'w-lg-control' : 'h-xs-control w-8 rounded-xs text-2xs')}
        onFocus={(e) => {
          setDraft(page ? String(page) : '')
          setEditing(true)
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            cancelled.current = true
            setEditing(false)
            e.currentTarget.blur()
          }
        }}
        data-testid="page-input"
      />
      <span className={cn('px-1 text-fg-muted', mobile ? 'text-base' : 'text-2xs')} data-testid="page-total">
        / {total || '–'}
      </span>
      {!mobile && (
        <Button variant="ghost" size="icon-xs" className={NARROW_HIDDEN} disabled={disabled || page >= total} onClick={() => requestPage(page + 1)} aria-label="下一页" title="下一页" data-testid="page-next">
          <ChevronDown aria-hidden />
        </Button>
      )}
    </span>
  )
}

/* ----------------------------------------------------------------------------------------- */

const FIT_LABEL: Record<Exclude<ZoomFit, null>, string> = { width: '适宽', page: '适页' }

/** − [适宽 ▾] +（适宽 / 适页 / 50–200%）；移动端下拉换成「适宽」开关按钮 */
function ZoomControls({ mobile }: { mobile: boolean }) {
  const zoom = useStudio((s) => s.zoom)
  const setZoom = useStudio((s) => s.setZoom)
  const fit = useStudio((s) => s.zoomFit)
  const setFit = useStudio((s) => s.setZoomFit)
  const effective = useStudio((s) => s.effectiveZoom)

  // 适宽/适页下的 − + 以当前实际缩放为起点，切回百分比模式
  const current = fit ? effective : zoom
  const step = (dir: 1 | -1) => {
    setFit(null)
    setZoom(clampZoom(current + dir * ZOOM_STEP))
  }
  const choosePreset = (z: number) => {
    setFit(null)
    setZoom(z)
  }
  const label = fit ? FIT_LABEL[fit] : `${Math.round(zoom * 100)}%`

  return (
    <span className={cn('inline-flex items-center', mobile ? 'gap-group-m' : 'gap-0.5')} data-testid="zoom-controls">
      {mobile && (
        <Button
          variant="ghost"
          size="md"
          className={cn(fit === 'width' && 'bg-active text-fg-strong')}
          onClick={() => setFit(fit === 'width' ? null : 'width')}
          aria-pressed={fit === 'width'}
          title="适应宽度"
          data-testid="fit-width"
        >
          适宽
        </Button>
      )}
      <Button variant="ghost" size={iconSize(mobile)} className={cn(!mobile && NARROW_HIDDEN)} disabled={current <= ZOOM_MIN} onClick={() => step(-1)} aria-label="缩小" title={current <= ZOOM_MIN ? '缩小（已到最小）' : '缩小'} data-testid="zoom-out">
        <Minus aria-hidden />
      </Button>
      {!mobile && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="gap-0.5 px-1.5 tabular @max-[440px]/pdftb:px-1"
              title={`缩放：${label}`}
              aria-label={`缩放：${label}`}
              data-testid="zoom-menu"
            >
              <span className="@max-[440px]/pdftb:hidden">{label}</span>
              <Scaling className="hidden @max-[440px]/pdftb:block" aria-hidden />
              <ChevronDown className="text-fg-subtle" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36 py-1">
            <DropdownMenuItem onSelect={() => setFit('width')}>
              适宽{fit === 'width' && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFit('page')}>
              适页{fit === 'page' && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {ZOOM_PRESETS.map((z) => (
              <DropdownMenuItem key={z} className="tabular" onSelect={() => choosePreset(z)}>
                {Math.round(z * 100)}%
                {!fit && zoom === z && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="ghost" size={iconSize(mobile)} className={cn(!mobile && NARROW_HIDDEN)} disabled={current >= ZOOM_MAX} onClick={() => step(1)} aria-label="放大" title={current >= ZOOM_MAX ? '放大（已到最大）' : '放大'} data-testid="zoom-in">
        <Plus aria-hidden />
      </Button>
    </span>
  )
}
