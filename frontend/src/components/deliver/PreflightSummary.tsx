import { CircleCheck, RefreshCw } from 'lucide-react'
import { diagLocationLabel } from '@/lib/diagLocation'
import { FOCUS_RING, cn } from '@/lib/utils'
import type { Severity } from '@/lib/types'
import { useStudio } from '@/store'
import type { PreflightItem, PreflightReport } from '@/types/preflight'
import { BOOK_LABELS } from '@/lib/docset'
import { LOCATE_ROW, SEVERITY_LABEL, SEVERITY_ORDER, groupByRule, ruleLabel } from '@/components/preflight/preflightUtils'

export interface PreflightSummaryProps {
  report: PreflightReport | null
  loading: boolean
  /** 后端 501 / 报错文案；null = 正常 */
  error: string | null
  unavailable: boolean
  /** 报告基于的正文与编辑器当前正文不同 */
  stale: boolean
  onRerun(): void
  /** 点条目 → 回工作台并定位（E1：goWorkbench + usePreflightLocate） */
  onLocate(item: PreflightItem): void
  mobile?: boolean
  className?: string
}

const SEV_CLASS: Record<Severity, string> = {
  error: 'bg-danger-bg text-danger-fg',
  warning: 'bg-warn-bg text-warn-fg',
  info: 'bg-sunken text-fg-muted',
}

/**
 * 递交页左栏：体检结果按严重度分组（error → warning → info），组内按规则再分；条目可点回工作台定位（17 §2.2）。
 * 复用 preflightUtils 的分组 / 文案，不复制 PreflightPanel 的四视图（权项树 / 标记 / 支持性留在工作台控制台）。
 * 空态优先级与 PreflightPanel 一致：501 → 错误 → 加载中 → 未体检 → 报告。
 */
export function PreflightSummary({ report, loading, error, unavailable, stale, onRerun, onLocate, mobile = false, className }: PreflightSummaryProps) {
  let empty: string | null = null
  if (unavailable) empty = `体检后端尚未实现（${error ?? '501'}）`
  else if (error && !report) empty = `体检失败：${error}`
  else if (loading && !report) empty = '正在体检…'
  else if (!report) empty = '尚未体检'

  const ast = useStudio((s) => s.ast)
  const groups = report ? groupByRule(report.items) : []
  const where = (it: PreflightItem) => {
    const label = diagLocationLabel({ line: it.line, blockId: it.block_id, section: it.book ? BOOK_LABELS[it.book] : null }, ast)
    return label === '全文' && !it.book ? null : label
  }

  return (
    <section
      data-slot="PreflightSummary"
      data-testid="preflight-summary"
      aria-label="体检结果"
      aria-busy={loading || undefined}
      className={cn('flex min-h-0 flex-col rounded-md border bg-panel', className)}
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">体检</h2>
        {report && (
          <span className="flex items-center gap-1 text-xs tabular-nums" data-testid="preflight-summary-counts">
            {SEVERITY_ORDER.map((sev) => (
              <span key={sev} className={cn('rounded px-1.5 py-px', report.counts[sev] ? SEV_CLASS[sev] : 'text-fg-muted')}>
                {report.counts[sev]} {SEVERITY_LABEL[sev]}
              </span>
            ))}
          </span>
        )}
        {stale && report && (
          <span className="text-xs text-warn-fg" data-testid="preflight-summary-stale">
            正文已改动，结果可能过期
          </span>
        )}
        <button
          type="button"
          className={cn(
            'ml-auto inline-flex items-center gap-1 rounded border px-2 text-xs hover:bg-hover disabled:opacity-50 [&_svg]:size-3.5',
            FOCUS_RING,
            mobile ? 'min-h-touch px-3 text-sm' : 'h-sm-control',
          )}
          onClick={onRerun}
          disabled={loading || unavailable}
          data-testid="preflight-summary-run"
        >
          <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden /> {loading ? '体检中…' : '重新体检'}
        </button>
      </header>

      {empty ? (
        <p className="px-4 py-8 text-center text-sm text-fg-muted" data-testid={unavailable ? 'preflight-summary-unavailable' : 'preflight-summary-empty'}>
          {empty}
        </p>
      ) : report && report.items.length === 0 ? (
        <p className="flex items-center justify-center gap-1.5 px-4 py-8 text-sm text-fg-muted [&_svg]:size-4" data-testid="preflight-summary-empty">
          <CircleCheck className="text-ok-fg" aria-hidden /> 未发现问题，可以递交
        </p>
      ) : (
        <div className="min-h-0 overflow-auto" data-testid="preflight-summary-list">
          {SEVERITY_ORDER.filter((sev) => groups.some((g) => g.severity === sev)).map((sev) => (
            <section key={sev} aria-label={SEVERITY_LABEL[sev]} className="border-b last:border-b-0" data-testid="preflight-summary-group" data-severity={sev}>
              <h3 className={cn('sticky top-0 px-3 py-1 text-xs font-semibold', SEV_CLASS[sev])}>
                {SEVERITY_LABEL[sev]} · {report!.counts[sev]}
              </h3>
              <ul>
                {groups
                  .filter((g) => g.severity === sev)
                  .flatMap((g) =>
                    g.items.map((it, i) => (
                      <li key={`${g.rule}-${i}`}>
                        <button
                          type="button"
                          className={cn(LOCATE_ROW, 'flex-col items-start gap-0.5 px-3 py-1.5', mobile && 'min-h-touch')}
                          onClick={() => onLocate(it)}
                          data-testid="preflight-summary-item"
                          data-rule={it.rule}
                        >
                          <span className="text-xs text-fg-muted">
                            {ruleLabel(g.rule)}
                            {where(it) && ` · ${where(it)}`}
                          </span>
                          <span className="text-sm">{it.message}</span>
                        </button>
                      </li>
                    )),
                  )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
