import { Loader2 } from 'lucide-react'
import { fmtMs } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useStudio, selectErrorCount } from '@/store'

function hhmm(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export type PdfStatusTone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral'

const TONE_FG: Record<PdfStatusTone, string> = {
  ok: 'text-ok-fg',
  info: 'text-info-fg',
  warn: 'text-warn-fg',
  danger: 'text-danger-fg',
  neutral: 'text-fg-muted',
}
const TONE_DOT: Record<PdfStatusTone, string> = {
  ok: 'bg-ok-dot',
  info: 'bg-info-dot',
  warn: 'bg-warn-dot',
  danger: 'bg-danger-dot',
  neutral: 'bg-fg-subtle',
}

/**
 * PDF 工具条构建状态（05 §3.6）：点 + 文字，不依赖色觉；11px 等宽数字，可截断。
 *  ok「已更新 · 22 页 · 1.7 s」／ info + spinner「构建中…」／ danger「构建失败 · 显示 14:32 的 PDF」（可点 → 控制台）／ neutral「就绪」。
 * 过期信息只出现在这里 + 控制台角标 + 状态栏，PDF 区不盖横幅。
 */
export function PdfStatusText({ className }: { className?: string }) {
  const phase = useStudio((s) => s.phase)
  const previewMs = useStudio((s) => s.previewMs)
  const totalMs = useStudio((s) => s.outcome?.timings.total_ms ?? s.lastOk?.timings.total_ms ?? null)
  const lastOkAt = useStudio((s) => s.lastOkAt)
  const netError = useStudio((s) => s.netError)
  const pages = useStudio((s) => s.pageInfo?.total ?? 0)
  const errorCount = useStudio(selectErrorCount)
  const openConsole = useStudio((s) => s.openConsole)

  let text: string
  let tone: PdfStatusTone
  let clickable = false

  switch (phase) {
    case 'building':
    case 'queued':
      text = phase === 'queued' ? '排队中…' : '构建中…'
      tone = 'info'
      break
    case 'ok':
      text = `已更新${pages ? ` · ${pages} 页` : ''} · ${fmtMs(previewMs ?? totalMs)}`
      tone = 'ok'
      break
    case 'error':
      text = netError
        ? '连接失败'
        : lastOkAt
          ? `构建失败 · 显示 ${hhmm(lastOkAt)} 的 PDF`
          : errorCount > 0
            ? `构建失败 · ${errorCount} 个错误`
            : '构建失败'
      tone = 'danger'
      clickable = true
      break
    case 'superseded':
      text = '已取代'
      tone = 'neutral'
      break
    default:
      text = '就绪'
      tone = 'neutral'
  }

  const busy = tone === 'info'
  const body = (
    <>
      {busy ? (
        <Loader2 className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden />
      ) : (
        <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
      )}
      <span className="min-w-0 truncate" title={text}>{text}</span>
    </>
  )
  const base = cn('inline-flex min-w-0 items-center gap-1.5 text-2xs font-medium tabular', TONE_FG[tone])

  if (clickable) {
    return (
      <button
        type="button"
        className={cn(base, 'h-xs-control rounded-xs px-1 hover:bg-hover hover:underline', className)}
        onClick={() => openConsole('error')}
        title={netError ? `请求失败：${netError}` : '查看控制台中的错误'}
        data-slot="PdfStatusText"
        data-testid="preview-status"
        data-phase={phase}
        data-tone={tone}
      >
        {body}
      </button>
    )
  }
  return (
    <span className={cn(base, className)} data-slot="PdfStatusText" data-testid="preview-status" data-phase={phase} data-tone={tone} title={text} aria-live="polite">
      {body}
    </span>
  )
}
