import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useStudio, selectStale, selectErrorCount } from '@/store'
import { fmtClock } from '@/lib/format'

/**
 * 过期条（痛点 #4，仅移动端预览 Tab；桌面 07 §2 不盖横幅，过期信息只在 PdfStatusText / 控制台角标 / 状态栏）：
 * 构建失败或改动尚未生效时常驻，说明"看到的 PDF 是 HH:MM 那次成功构建"；「查看问题」切到控制台 Tab 错误页。
 * 仅在有旧 PDF 可看（lastOk）且 selectStale 为真时出现；建中（自动构建正在追上）不打扰。
 */
export function StaleBanner() {
  const stale = useStudio(selectStale)
  const hasOk = useStudio((s) => s.lastOk !== null)
  const lastOkAt = useStudio((s) => s.lastOkAt)
  const phase = useStudio((s) => s.phase)
  const errorCount = useStudio(selectErrorCount)
  const setConsoleTab = useStudio((s) => s.setConsoleTab)
  const setMobileTab = useStudio((s) => s.setMobileTab)
  const enqueue = useStudio((s) => s.enqueue)

  if (!stale || !hasOk) return null
  // 正在追赶（排队/构建中）且没有错误：几百毫秒后就会刷新，不闪琥珀条
  if ((phase === 'queued' || phase === 'building') && errorCount === 0) return null

  const time = fmtClock(lastOkAt)
  const isError = phase === 'error' || errorCount > 0

  return (
    <div
      data-slot="StaleBanner"
      data-testid="stale-banner"
      role="status"
      aria-live="polite"
      className="flex h-7 shrink-0 items-center gap-2 overflow-hidden border-b border-warn-dot/40 bg-warn-bg px-3 text-xs text-warn-fg"
    >
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        <span className="hidden lg:inline">显示的是上次成功构建 </span>
        <span className="lg:hidden">上次成功 </span>
        <b className="tabular font-semibold">{time}</b>
        {isError ? (
          <>
            {' '}
            · <span className="hidden lg:inline">当前 </span>
            <b className="tabular font-semibold">{errorCount}</b> 个错误<span className="hidden lg:inline">，修改未生效</span>
          </>
        ) : (
          <> · <span className="hidden lg:inline">当前</span>修改未生效</>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {isError ? (
          <button
            type="button"
            className="inline-flex h-6 items-center gap-0.5 rounded-sm px-1.5 font-medium underline-offset-2 hover:bg-warn-dot/20 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              setConsoleTab('error')
              setMobileTab('console')
            }}
          >
            查看问题 <ArrowRight className="size-3" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex h-6 items-center gap-0.5 rounded-sm px-1.5 font-medium underline-offset-2 hover:bg-warn-dot/20 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => enqueue('manual', true)}
          >
            立即构建
          </button>
        )}
      </span>
    </div>
  )
}
