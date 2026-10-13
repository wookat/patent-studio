import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStudio, selectErrorCount, selectWarningCount } from '@/store'
import { fmtClock, fmtMs } from '@/lib/format'

type Tone = 'ok' | 'error' | 'busy'

/**
 * 控制台状态横幅（07 §2.1 / prototype-c .summary）：
 *   失败 = 红底浅「构建失败 · 显示上次成功构建 14:32 ｜ DOCX 0.4 s · PDF 转换失败」
 *   成功 = 绿底浅「构建成功 · 1.7 s ｜ 22 页 · 0 错误 2 警告」
 *   构建中 / lint 中 = 灰。idle 且无结果 → 不渲染。
 */
export function ConsoleSummary({ className }: { className?: string }) {
  const phase = useStudio((s) => s.phase)
  const outcome = useStudio((s) => s.outcome)
  const lastOk = useStudio((s) => s.lastOk)
  const lastOkAt = useStudio((s) => s.lastOkAt)
  const elapsedMs = useStudio((s) => s.elapsedMs)
  const netError = useStudio((s) => s.netError)
  const lintRunning = useStudio((s) => s.lintRunning)
  const checkRunning = useStudio((s) => s.checkAllRunning)
  const errors = useStudio(selectErrorCount)
  const warnings = useStudio(selectWarningCount)

  let tone: Tone
  let main: React.ReactNode
  let side: React.ReactNode = null

  if (phase === 'building' || phase === 'queued') {
    tone = 'busy'
    main = phase === 'building' ? <>构建中 · {fmtMs(elapsedMs)}</> : <>等待停顿…</>
    side = lastOkAt != null ? <>上次成功构建 {fmtClock(lastOkAt)}</> : null
  } else if (lintRunning || checkRunning) {
    tone = 'busy'
    main = lintRunning ? <>形式检查中…</> : <>回归检查中…</>
  } else if (netError) {
    tone = 'error'
    main = <>无法连接后端</>
    side = <>{netError}</>
  } else if (phase === 'error' && outcome?.status === 'error') {
    tone = 'error'
    const t = outcome.timings
    const pdfPart = t.pdf_ms != null ? `PDF ${fmtMs(t.pdf_ms)}` : t.docx_ms != null ? 'PDF 转换失败' : null
    const docxPart = t.docx_ms != null ? `DOCX ${fmtMs(t.docx_ms)}` : 'DOCX 失败'
    main = lastOk && lastOkAt != null ? <>构建失败 · 显示上次成功构建 {fmtClock(lastOkAt)}</> : <>构建失败</>
    side = [docxPart, pdfPart].filter(Boolean).join(' · ')
  } else if (lastOk) {
    tone = 'ok'
    const pages = lastOk.summary?.pages
    main = <>构建成功 · {fmtMs(lastOk.timings.total_ms)}</>
    side = (
      <>
        {pages != null && <>{pages} 页 · </>}
        <span className={cn(errors > 0 && 'text-danger-fg')}>{errors} 错误</span> {warnings} 警告
      </>
    )
  } else {
    return null
  }

  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'error' ? AlertCircle : Loader2
  return (
    <div
      data-slot="ConsoleSummary"
      data-testid="console-summary"
      data-tone={tone}
      role="status"
      className={cn(
        'mx-4 my-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-4 py-3 text-base font-semibold',
        tone === 'ok' && 'bg-ok-bg text-link',
        tone === 'error' && 'bg-danger-bg text-danger-fg',
        tone === 'busy' && 'bg-sunken text-fg-muted',
        className,
      )}
    >
      <Icon className={cn('size-4 shrink-0', tone === 'busy' && 'animate-spin')} aria-hidden />
      <span className="min-w-0 flex-1">{main}</span>
      {side && <span className="ml-auto text-xs font-normal tabular opacity-90">{side}</span>}
    </div>
  )
}
