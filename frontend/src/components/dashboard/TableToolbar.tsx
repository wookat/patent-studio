import { ArrowDownNarrowWide, ArrowUpNarrowWide, Filter, Rows3, X } from 'lucide-react'
import type { SortingState, VisibilityState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { DASH_GROUPS, DASH_GROUP_LABEL, type DashGroup } from '@/store/dashboard'
import { SORT_KEY, TOGGLEABLE_COLUMNS } from './caseColumns'
import { ColumnMenu } from './ColumnMenu'
import { StatusFilters } from './FilterRail'

/** 工具行「排序」可选列 = 有排序键的可见列（与表头点击同一套 SORT_KEY / sorting 状态） */
export const SORTABLE_COLUMNS = TOGGLEABLE_COLUMNS.filter((c) => c.id in SORT_KEY)
const SORT_NONE = 'none'

/** Select 值 = 排序列 id（升降单独一键）；表头点击产生的 sorting 也能在这里如实反映 */
export const sortValueOf = (sorting: SortingState): string => sorting[0]?.id ?? SORT_NONE
export const sortingOfValue = (v: string, prev: SortingState): SortingState => (v === SORT_NONE ? [] : [{ id: v, desc: prev[0]?.id === v ? prev[0].desc : false }])

/** 工具行内的 Select 触发器与 ghost Button 同一视觉（无边框、悬停 bg-hover），有值时 soft 底色标出「已生效」 */
const GHOST_TRIGGER = 'w-auto border-transparent bg-transparent px-2 text-fg hover:border-transparent hover:bg-hover'
const ACTIVE_TRIGGER = 'bg-primary-soft text-link hover:bg-selected'

export interface TableToolbarProps {
  sorting: SortingState
  onSortingChange(next: SortingState): void
  columns: VisibilityState
  onColumnsChange(next: VisibilityState): void
  className?: string
}

/**
 * 台账表格工具行（05 §4 S1；ux-05 最小版）：h 32 一行，全部 ghost 芯片（Linear / Notion 同做法），有值的芯片 soft 底色。
 * 左：`分组`（Select：不分 / 状态 / 责任人 / 客户 → store.dashGroup）· `筛选`（Popover：状态十档勾选，与左栏「按状态」同一 store.dashStatuses；徽标 = 已选数）·
 * `排序 ⇅`（Select 列 + 紧贴的升降键成一组，与表头点击同一 sorting）。
 * 右：表格显示设置同处 —— `列`（显隐）· `紧凑`（Toggle：行高 40 → 36，store.dashCompact 持久化）。全部原生按钮 / Radix，键盘可达；不新增功能面。
 */
export function TableToolbar({ sorting, onSortingChange, columns, onColumnsChange, className }: TableToolbarProps) {
  const group = useStudio((s) => s.dashGroup)
  const setGroup = useStudio((s) => s.setDashGroup)
  const compact = useStudio((s) => s.dashCompact)
  const setCompact = useStudio((s) => s.setDashCompact)
  const statuses = useStudio((s) => s.dashStatuses)
  const toggleStatus = useStudio((s) => s.toggleDashStatus)
  const sortValue = sortValueOf(sorting)
  const sorted = sortValue !== SORT_NONE
  const desc = sorting[0]?.desc ?? false

  return (
    <div data-slot="TableToolbar" data-testid="table-toolbar" role="toolbar" aria-label="表格工具" className={cn('flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel px-page-x text-xs', className)}>
      <Select value={group} onValueChange={(v) => setGroup(v as DashGroup)}>
        <SelectTrigger size="sm" className={cn(GHOST_TRIGGER, group !== 'none' && ACTIVE_TRIGGER)} aria-label="分组" data-testid="toolbar-group">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DASH_GROUPS.map((g) => (
            <SelectItem key={g} value={g} data-testid={`toolbar-group-${g}`}>
              {g === 'none' ? DASH_GROUP_LABEL[g] : `分组：${DASH_GROUP_LABEL[g].slice(1)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger>
          <Button variant={statuses.length ? 'soft' : 'ghost'} size="sm" aria-label={statuses.length ? `筛选状态，已选 ${statuses.length} 项` : '筛选状态'} data-testid="toolbar-filter">
            <Filter aria-hidden />
            筛选
            {statuses.length > 0 && <Count value={statuses.length} size="sm" tone="brand" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" aria-label="按状态筛选" data-testid="toolbar-filter-content">
          <StatusFilters />
          {statuses.length > 0 && (
            <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-fg-muted" onClick={() => statuses.forEach(toggleStatus)} data-testid="toolbar-filter-clear">
              <X aria-hidden />
              清除状态筛选
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <div className="inline-flex items-center" role="group" aria-label="排序">
        <Select value={sortValue} onValueChange={(v) => onSortingChange(sortingOfValue(v, sorting))}>
          <SelectTrigger size="sm" className={cn(GHOST_TRIGGER, sorted && cn(ACTIVE_TRIGGER, 'rounded-r-none'))} aria-label="排序" data-testid="toolbar-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SORT_NONE} data-testid="toolbar-sort-none">
              默认排序
            </SelectItem>
            {SORTABLE_COLUMNS.map((c) => (
              <SelectItem key={c.id} value={c.id} data-testid={`toolbar-sort-${c.id}`}>
                按{c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={sorted ? 'soft' : 'ghost'}
          size="icon-sm"
          disabled={!sorted}
          className={cn(sorted ? 'rounded-l-none' : 'hidden')}
          aria-label={desc ? '当前降序，切换为升序' : '当前升序，切换为降序'}
          onClick={() => sorting[0] && onSortingChange([{ id: sorting[0].id, desc: !desc }])}
          data-testid="toolbar-sort-dir"
        >
          {desc ? <ArrowDownNarrowWide aria-hidden /> : <ArrowUpNarrowWide aria-hidden />}
        </Button>
      </div>

      <div className="ml-auto inline-flex items-center gap-1" role="group" aria-label="表格显示">
        <ColumnMenu visibility={columns} onChange={onColumnsChange} />
        <Toggle size="sm" pressed={compact} onPressedChange={setCompact} className="text-xs data-[state=on]:bg-primary-soft data-[state=on]:text-link" aria-label="紧凑行高" data-testid="toolbar-compact">
          <Rows3 aria-hidden />
          紧凑
        </Toggle>
      </div>
    </div>
  )
}
