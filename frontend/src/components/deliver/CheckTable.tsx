import { useMemo, type ReactNode } from 'react'
import { CircleCheck, Crosshair, RefreshCw } from 'lucide-react'
import { SEVERITY_LABEL } from '@/components/preflight/preflightUtils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type ColumnDef } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { diagLocationLabel } from '@/lib/diagLocation'
import type { Diagnostic, Severity } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { Ast } from '@/types/ast'

export interface CheckTableProps {
  /** 与控制台同一来源：store.items（selectCheckItems） */
  items: Diagnostic[]
  counts: Record<Severity, number>
  loading: boolean
  /** lint 请求失败文案；null = 正常 */
  error: string | null
  /** 结果基于的正文与编辑器当前正文不同 */
  stale: boolean
  /** 尚未跑过任何一次检查（items 可能仍是构建附带的） */
  ran: boolean
  onRerun(): void
  onLocate(d: Diagnostic): void
  mobile?: boolean
  className?: string
}

const SEV_TONE: Record<Severity, BadgeTone> = {
  error: 'danger',
  warning: 'warn',
  info: 'neutral',
}

export const SEV_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** 「位置」列：书 / 权项 / 段落字样（与控制台同口径，不露源码行号）；无 AST 时退到后端章节，再退到全文 */
export function locationLabel(d: Diagnostic, ast: Ast | null = null): string {
  return diagLocationLabel(d, ast)
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge tone={SEV_TONE[severity]} data-testid="check-severity" data-severity={severity}>
      {SEVERITY_LABEL[severity]}
    </Badge>
  )
}

/**
 * 递交页体检表（21 §4.4 / R-CHK-03）：级别 / 位置 / 信息 / 「定位」，数据 = diagnostics.items，与控制台「问题」同源同数。
 * 规则 id 不进表格列（机器名对代理师无意义），只作为信息栏 title / data-testid 保留给技术定位；控制台「问题」面板仍显示 id。
 * 1440 DataTable（级别列可排序，默认 error → warning → info 已由 diagnostics 排好）；375 转卡片（一行一卡，「定位」按钮占满宽）。
 * 空态优先级：请求失败 → 加载中 → 无问题（成功态）；陈旧 ⇒ 顶部 warning 横幅 + 「重新检查」。
 */
export function CheckTable({ items, counts, loading, error, stale, ran, onRerun, onLocate, mobile = false, className }: CheckTableProps) {
  const ast = useStudio((s) => s.ast)
  const columns = useMemo<ColumnDef<Diagnostic, unknown>[]>(
    () => [
      {
        id: 'severity',
        accessorFn: (d) => SEV_ORDER[d.severity],
        header: '级别',
        size: 56,
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
      },
      {
        id: 'location',
        accessorFn: (d) => d.line ?? Number.MAX_SAFE_INTEGER,
        header: '位置',
        size: 128,
        cell: ({ row }) => (
          <span className="inline-flex text-xs tabular-nums" data-testid="check-location">
            <span>{locationLabel(row.original, ast)}</span>
          </span>
        ),
      },
      {
        id: 'message',
        accessorKey: 'message',
        header: '信息',
        enableSorting: false,
        size: 200,
        cell: ({ row }) => (
          <div className="min-w-0" title={row.original.id}>
            <div className="break-words">{row.original.message}</div>
            {row.original.detail && <div className="mt-0.5 break-words text-xs text-fg-muted">{row.original.detail}</div>}
          </div>
        ),
      },
      {
        id: 'locate',
        header: () => <span className="sr-only">定位</span>,
        enableSorting: false,
        size: 72,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onLocate(row.original)
            }}
            aria-label={`定位到 ${locationLabel(row.original, ast)}`}
            data-testid="check-locate"
          >
            <Crosshair aria-hidden /> 定位
          </Button>
        ),
      },
    ],
    [onLocate, ast],
  )

  const total = items.length
  const header = (
    <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <h2 className="text-sm font-semibold text-fg-strong">体检</h2>
      <span className="flex items-center gap-1 text-xs tabular-nums" data-testid="check-counts" data-errors={counts.error}>
        {(['error', 'warning', 'info'] as Severity[]).map((sev) => (
          <span
            key={sev}
            className={cn(
              'rounded-xs px-1.5 py-px',
              counts[sev] === 0
                ? 'text-fg-muted'
                : sev === 'error'
                  ? 'bg-danger-bg text-danger-fg'
                  : sev === 'warning'
                    ? 'bg-warn-bg text-warn-fg'
                    : 'bg-sunken text-fg-muted',
            )}
          >
            {counts[sev]} {SEVERITY_LABEL[sev]}
          </span>
        ))}
      </span>
      <Button variant="ghost" size={mobile ? 'md' : 'sm'} className="ml-auto" onClick={onRerun} disabled={loading} data-testid="check-rerun">
        <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden /> 重新检查
      </Button>
    </header>
  )

  let body: ReactNode
  if (error && total === 0) {
    body = <EmptyState size="sm" title="检查失败" reason={error} action={<Button size="sm" variant="outline" onClick={onRerun}>重试</Button>} data-testid="check-error" />
  } else if (loading && total === 0 && !ran) {
    body = (
      <div className="grid gap-2 p-3" data-testid="check-loading" aria-busy>
        <Skeleton className="h-md-control w-full" />
        <Skeleton className="h-md-control w-full" />
        <Skeleton className="h-md-control w-3/4" />
      </div>
    )
  } else if (total === 0) {
    body = <EmptyState size="sm" icon={CircleCheck} title="体检通过" reason="当前正文未发现问题；仍请以 CPC 客户端校验为准。" data-testid="check-empty" />
  } else if (mobile) {
    body = (
      <ul className="grid gap-cards-m p-card-m" data-testid="check-cards">
        {items.map((d) => (
          <li key={d.id} className="grid gap-group-m rounded-md border border-border bg-panel p-card-m" data-testid={`check-card-${d.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={d.severity} />
              <span className="ml-auto text-xs tabular-nums text-fg-muted">{locationLabel(d, ast)}</span>
            </div>
            <div className="text-sm break-words" title={d.id}>{d.message}</div>
            {d.detail && <div className="text-xs break-words text-fg-muted">{d.detail}</div>}
            <Button variant="secondary" size="md" className="w-full" onClick={() => onLocate(d)} data-testid="check-locate">
              <Crosshair aria-hidden /> 定位
            </Button>
          </li>
        ))}
      </ul>
    )
  } else {
    body = <DataTable columns={columns} data={items} getRowId={(d) => d.id} onRowClick={onLocate} className="min-h-0 flex-1 [&_table]:table-fixed" data-testid="check-table" />
  }

  return (
    <section
      data-slot="CheckTable"
      data-testid="check-section"
      aria-label="体检结果"
      aria-busy={loading || undefined}
      className={cn('flex min-h-0 flex-col rounded-md border border-border bg-panel', className)}
    >
      {header}
      {stale && (
        <Alert variant="warn" className="m-3 mb-0" data-testid="check-stale">
          <RefreshCw />
          <AlertDescription>正文已修改，以下结果可能过期；点「重新检查」刷新。</AlertDescription>
        </Alert>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{body}</div>
    </section>
  )
}
