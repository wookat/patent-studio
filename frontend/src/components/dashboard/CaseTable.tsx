import { useMemo } from 'react'
import type { OnChangeFn, RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table'
import { ChevronDown } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { StatusDot } from '@/components/ui/status-dot'
import type { ProjectSummary } from '@/lib/types'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'
import { groupCaseRows, type DashGroup } from '@/store/dashboard'
import { useStudio } from '@/store'
import type { Tag } from '@/types/case'
import { caseColumns, ownerNameOf } from './caseColumns'
import { CaseRow, canEditCase, useCanEditCase } from './CaseRow'

/** 超过此行数走 TanStack Virtual（21 §4.2） */
export const VIRTUAL_THRESHOLD = 200

export interface CaseTableProps {
  /** 已筛选（store selectDashboardRows）；排序在表内 */
  rows: ProjectSummary[]
  tags: Tag[]
  selected: string[]
  onToggleSelected(pid: string): void
  onSetSelected(pids: string[]): void
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  /** <lg：卡片列表（标题两行 + 案号 + 徽章 + 头像 + DeadlineCell Heat） */
  mobile?: boolean
  empty?: React.ReactNode
  /** 工具行「分组」（桶内仍按 sorting；组头 32 可折叠）；默认 none */
  group?: DashGroup
  /** 工具行「紧凑」：行高 --row-h → --row-h-compact（36） */
  compact?: boolean
}

/** 紧凑只改本表的 --row-h（不动全局 data-density） */
const COMPACT = '[--row-h:var(--row-h-compact)]'
const TABLE_CLASS = 'min-h-0 flex-1 [&_table]:table-fixed [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-sticky [&_thead]:bg-panel'

function Card(props: Omit<Parameters<typeof CaseRow>[0], 'canEdit'>) {
  const canEdit = useCanEditCase(props.row)
  return <CaseRow {...props} canEdit={canEdit} />
}

/**
 * 主区表格（21 §4.2）：prep DataTable（TanStack）——列 案号/名称/类型/状态/责任人/客户/最近期限/标签/最近修改，
 * 受控排序 + 列显隐（持久化在 store.dashColumns）+ 勾选（store.dashSelected）；>200 行虚拟。<lg 卡片。
 */
export function CaseTable({ rows, tags, selected, onToggleSelected, onSetSelected, sorting, onSortingChange, columnVisibility, onColumnVisibilityChange, mobile, empty, group = 'none', compact = false }: CaseTableProps) {
  const columns = useMemo(() => caseColumns(tags), [tags])
  const rowSelection = useMemo<RowSelectionState>(() => Object.fromEntries(selected.map((id) => [id, true])), [selected])
  const authOff = useStudio((s) => s.authStatus === 'off')
  const superuser = useStudio((s) => s.user?.is_superuser ?? false)
  const editableIds = useMemo(() => new Set(rows.filter((r) => canEditCase(r, authOff, superuser)).map((r) => r.id)), [rows, authOff, superuser])
  const onRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
    const next = typeof updater === 'function' ? updater(rowSelection) : updater
    // 任何途径（全选 / 行勾 / 未来键盘选择）都进不了只读行——批量条没有只读可执行动作
    onSetSelected(Object.keys(next).filter((k) => next[k] && editableIds.has(k)))
  }
  const groups = useMemo(() => (group === 'none' || mobile ? null : groupCaseRows(rows, group, ownerNameOf)), [rows, group, mobile])
  const collapsed = useStudio((s) => s.dashGroupCollapsed)
  const setGroupCollapsed = useStudio((s) => s.setDashGroupCollapsed)

  if (mobile) {
    if (!rows.length) return <div data-testid="case-cards-empty">{empty}</div>
    return (
      <ul data-slot="CaseTable" data-variant="cards" className="flex flex-col gap-cards-m" aria-label="案卷列表">
        {rows.map((r) => (
          <Card key={r.id} row={r} tags={tags} selected={selected.includes(r.id)} onToggleSelected={onToggleSelected} />
        ))}
      </ul>
    )
  }
  if (groups && rows.length) {
    return (
      <div data-slot="CaseTable" data-variant="grouped" data-testid="case-table" data-group={group} className={cn('flex min-h-0 flex-1 flex-col overflow-auto', compact && COMPACT)}>
        {groups.map((g, i) => {
          const key = `${group}:${g.key}`
          const open = !collapsed[key]
          return (
            <section key={key} aria-label={g.label} data-testid={`case-group-${g.key}`}>
              <h3 className="sticky top-0 z-sticky m-0 bg-sunken">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setGroupCollapsed(key, open)}
                  className={cn('flex h-md-control w-full items-center gap-2 border-b border-border px-page-x text-left text-xs font-medium text-fg-strong hover:bg-hover', FOCUS_RING, TRANSITION_COLOR)}
                  data-testid={`case-group-toggle-${g.key}`}
                >
                  <ChevronDown className={cn('size-3.5 text-fg-icon transition-transform duration-(--dur-fast) motion-reduce:transition-none', !open && '-rotate-90')} aria-hidden />
                  {g.status ? <StatusDot status={g.status} size="sm" /> : <span className="truncate">{g.label}</span>}
                  <span className="text-fg-muted tabular-nums" data-testid={`case-group-count-${g.key}`}>
                    {g.rows.length}
                  </span>
                </button>
              </h3>
              {open && (
                <DataTable
                  columns={columns}
                  data={g.rows}
                  getRowId={(r) => r.id}
                  sorting={sorting}
                  onSortingChange={onSortingChange}
                  columnVisibility={columnVisibility}
                  onColumnVisibilityChange={onColumnVisibilityChange}
                  rowSelection={rowSelection}
                  onRowSelectionChange={onRowSelectionChange}
                  virtual={g.rows.length > VIRTUAL_THRESHOLD}
                  empty={empty}
                  data-testid={`case-table-${g.key}`}
                  className={cn('overflow-visible [&_table]:table-fixed [&_thead]:bg-panel', i > 0 && '[&_thead]:collapse')}
                />
              )}
            </section>
          )
        })}
      </div>
    )
  }
  return (
    <DataTable
      data-slot="CaseTable"
      data-testid="case-table"
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      sorting={sorting}
      onSortingChange={onSortingChange}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={onColumnVisibilityChange}
      rowSelection={rowSelection}
      onRowSelectionChange={onRowSelectionChange}
      virtual={rows.length > VIRTUAL_THRESHOLD}
      empty={empty}
      className={cn(TABLE_CLASS, compact && COMPACT)}
    />
  )
}
