import { CircleCheck, RefreshCw } from 'lucide-react'
import { fmtMs } from '@/lib/format'
import { useEffect } from 'react'
import { useNamedLandmarkHost } from '@/components/ui/landmark-host'
import { FOCUS_RING, FOCUS_RING_INSET, cn } from '@/lib/utils'
import { selectPreflightStale, useStudio } from '@/store'
import type { PreflightReport, PreflightView } from '@/types/preflight'
import { ClaimTree } from './ClaimTree'
import { ItemsView } from './ItemsView'
import { NumeralsTable } from './NumeralsTable'
import { SupportTable } from './SupportTable'

export interface PreflightPanelProps {
  /** desktop = 控制台替换 PDF 区（表格全列）；mobile = MobileConsole（表格降为卡片行，二级 tab 横向可滚） */
  variant?: 'desktop' | 'mobile'
  className?: string
}

const PREFLIGHT_VIEWS: { id: PreflightView; label: string }[] = [
  { id: 'items', label: '问题' },
  { id: 'claims', label: '权利要求树' },
  { id: 'numerals', label: '附图标记' },
  { id: 'support', label: '支持性' },
]

/** 各视图有数据时渲染；空数据的文案（视图级空态，与面板级空态区分） */
const VIEW_EMPTY: Record<PreflightView, string> = {
  items: '未发现问题',
  claims: '未解析到权利要求',
  numerals: '说明书里没有附图标记',
  support: '权项里没有可核对的术语',
}

function ViewBody({ view, report }: { view: PreflightView; report: PreflightReport }) {
  const rows =
    view === 'items' ? report.items.length : view === 'claims' ? report.claim_tree.length : view === 'numerals' ? report.numerals.length : report.support_map.length
  if (rows === 0) {
    return (
      <p className="flex items-center justify-center gap-1.5 px-4 py-6 text-center text-sm text-fg-muted [&_svg]:size-4" data-testid="preflight-empty">
        {view === 'items' && <CircleCheck className="text-ok-fg" aria-hidden />}
        {VIEW_EMPTY[view]}
      </p>
    )
  }
  if (view === 'items') return <ItemsView items={report.items} />
  if (view === 'claims') return <ClaimTree nodes={report.claim_tree} />
  if (view === 'numerals') return <NumeralsTable rows={report.numerals} />
  return <SupportTable rows={report.support_map} />
}


/**
 * R2.5 体检面板（docs/plan/05-r2-figures-preflight-design.md §6.2）。
 * 头部「重新体检」+ counts chip + 耗时 + 陈旧提示；二级 tab（问题 / 权利要求树 / 附图标记 / 支持性 = store.preflightView）；
 * 四视图各自实现定位：源码行 + 结构块 + PDF（preflightUtils.usePreflightLocate）。
 * 状态优先级：无案子 → 501 未实现 → 错误 → 加载中（有旧报告时仍显示旧报告，仅头部转圈）→ 未体检 → 报告。
 * 触发（05 §6.1）：面板挂载（打开 tab）且无报告或报告过期 → loadPreflight；保存成功（saved 变化）再跑一次；不随键入防抖。
 */
export function PreflightPanel({ variant = 'desktop', className }: PreflightPanelProps) {
  const pid = useStudio((s) => s.pid)
  const report = useStudio((s) => s.preflight)
  const loading = useStudio((s) => s.preflightLoading)
  const error = useStudio((s) => s.preflightError)
  const unavailable = useStudio((s) => s.preflightUnavailable)
  const stale = useStudio(selectPreflightStale)
  const view = useStudio((s) => s.preflightView)
  const setView = useStudio((s) => s.setPreflightView)
  const hosted = useNamedLandmarkHost()
  const loadPreflight = useStudio((s) => s.loadPreflight)
  const elapsed = useStudio((s) => s.preflightElapsedMs)
  const saved = useStudio((s) => s.saved)
  const mobile = variant === 'mobile'

  useEffect(() => {
    const s = useStudio.getState()
    /* content 为空 = 换案加载窗（openProject 起调清场后未到齐）——此时 POST 必 422，等 saved 落地再触发 */
    if (!pid || !s.content || s.preflightLoading || s.preflightUnavailable || s.preflightError) return
    if (s.preflight && s.preflightContent === s.content) return
    void loadPreflight(pid)
  }, [pid, saved, loadPreflight])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const order = PREFLIGHT_VIEWS.map((v) => v.id)
    const i = order.indexOf(view)
    let next: PreflightView | null = null
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length]
    else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length]
    else if (e.key === 'Home') next = order[0]
    else if (e.key === 'End') next = order[order.length - 1]
    if (!next) return
    e.preventDefault()
    setView(next)
    document.getElementById(`preflight-tab-${next}`)?.focus()
  }

  let empty: string | null = null
  let tone: 'muted' | 'error' = 'muted'
  if (!pid) empty = '尚未打开案子'
  else if (unavailable) empty = `体检后端尚未实现（${error ?? '501'}）`
  else if (error && !report) {
    empty = `体检失败：${error}`
    tone = 'error'
  } else if (loading && !report) empty = '正在体检…'
  else if (!report) empty = '尚未体检 · 点击「重新体检」'

  return (
    <section
      data-slot="PreflightPanel"
      data-testid="preflight-panel"
      data-variant={variant}
      aria-label={hosted ? undefined : '递交前体检'}
      aria-busy={loading || undefined}
      className={cn('flex h-full min-h-0 flex-col', className)}
    >
      <div
        className={cn('flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1 text-xs', mobile ? 'min-h-11' : 'min-h-8')}
        data-testid="preflight-header"
      >
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-2 text-fg hover:bg-hover disabled:opacity-50 [&_svg]:size-3.5',
            FOCUS_RING,
            mobile ? 'min-h-touch px-3 text-sm' : 'h-6',
          )}
          onClick={() => pid && void loadPreflight(pid)}
          disabled={!pid || loading}
          data-testid="preflight-run"
        >
          <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden /> {loading ? '体检中…' : '重新体检'}
        </button>
        {report && (
          <span className="flex items-center gap-1 tabular-nums text-fg-muted" data-testid="preflight-counts">
            <span className={cn('rounded-sm px-1 py-px', report.counts.error && 'bg-danger-bg font-semibold text-danger-fg')}>{report.counts.error} 错误</span>
            {' · '}
            <span className={cn('rounded-sm px-1 py-px', report.counts.warning && 'bg-warn-bg font-semibold text-warn-fg')}>{report.counts.warning} 警告</span>
            {' · '}
            <span>{report.counts.info} 提示</span>
          </span>
        )}
        {report && elapsed !== null && (
          <span className="text-fg-muted tabular-nums" data-testid="preflight-elapsed">
            耗时 {fmtMs(elapsed)}
          </span>
        )}
        {stale && (
          <span className="text-warn-fg" data-testid="preflight-stale" role="status">
            内容已变，结果可能过期
          </span>
        )}
        {error && report && !unavailable && (
          <span className="text-danger-fg" data-testid="preflight-error" role="alert">
            重新体检失败：{error}
          </span>
        )}
      </div>
      <div
        role="tablist"
        aria-label="体检视图"
        className={cn('flex h-md-control shrink-0 items-stretch overflow-x-auto border-b border-border px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', mobile && 'h-touch')}
        onKeyDown={onKeyDown}
        data-testid="preflight-tabs"
      >
        {PREFLIGHT_VIEWS.map((v) => {
          const selected = view === v.id
          const n = report ? (v.id === 'items' ? report.items.length : v.id === 'claims' ? report.claim_tree.length : v.id === 'numerals' ? report.numerals.length : report.support_map.length) : null
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              id={`preflight-tab-${v.id}`}
              aria-selected={selected}
              aria-controls="preflight-tabpanel"
              tabIndex={selected ? 0 : -1}
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 px-2 text-sm transition-colors',
                FOCUS_RING_INSET,
                selected ? 'border-primary font-semibold text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
              onClick={() => setView(v.id)}
              data-testid={`preflight-tab-${v.id}`}
            >
              {v.label}
              {n !== null && n > 0 && <span className="ml-1 text-xs font-normal tabular-nums text-fg-muted">{n}</span>}
            </button>
          )
        })}
      </div>
      <div
        id="preflight-tabpanel"
        role="tabpanel"
        aria-labelledby={`preflight-tab-${view}`}
        className="min-h-0 flex-1 overflow-auto"
        data-testid={`preflight-body-${view}`}
      >
        {empty !== null ? (
          <p className={cn('px-4 py-6 text-center text-sm', tone === 'error' ? 'text-danger-fg' : 'text-fg-muted')} data-testid="preflight-empty">
            {empty}
          </p>
        ) : (
          <ViewBody view={view} report={report!} />
        )}
      </div>
    </section>
  )
}
