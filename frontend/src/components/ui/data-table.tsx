import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { FOCUS_RING, cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

declare module '@tanstack/react-table' {
  // TanStack 官方扩展写法：两个类型参数必须与原声明一致（即使未使用）
  interface ColumnMeta<TData extends RowData, TValue> {
    /** 弹性列：不写死宽度，`table-fixed` 下吃掉全部剩余宽度（一张表通常只有一列，如「案名」）；其余列按 size 固定 */
    flex?: boolean
    /** 加到该列 th / td 上的类（如按表宽收起低信息列的 `@max-[…]/table` 容器查询变体，见 caseColumns） */
    cellClass?: string
  }
}

/**
 * DataTable<TData>（TanStack Table v8 封装）：
 * columns / data / sorting / columnVisibility / rowSelection 受控或非受控；onRowClick；virtual 时用 @tanstack/react-virtual 只渲染可视行；
 * empty 为空态节点（建议传 <EmptyState/>）。行 data-testid=row-<id>（getRowId 默认 index，调用方传 getRowId 用业务 id）。
 * 列宽：TanStack 给每列默认 size 150，所以除 `meta.flex` 列外都写 width；未激活排序的 ⇅ 只在表头悬停 / 聚焦时显示（Linear / Notion 同做法）。
 */
export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  getRowId?: (row: TData, index: number) => string
  onRowClick?: (row: TData) => void
  /** 大列表虚拟滚动；需给容器固定高度（className 上 h-*） */
  virtual?: boolean
  /** 虚拟行估算高度（默认 40 = --row-h） */
  estimateRowHeight?: number
  empty?: React.ReactNode
  className?: string
  'data-testid'?: string
}

export function DataTable<TData>({
  columns,
  data,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  onRowClick,
  virtual = false,
  estimateRowHeight = 40,
  empty = '暂无数据',
  className,
  ...rest
}: DataTableProps<TData>) {
  const [innerSorting, setInnerSorting] = React.useState<SortingState>([])
  const [innerVisibility, setInnerVisibility] = React.useState<VisibilityState>({})
  const [innerSelection, setInnerSelection] = React.useState<RowSelectionState>({})

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      sorting: sorting ?? innerSorting,
      columnVisibility: columnVisibility ?? innerVisibility,
      rowSelection: rowSelection ?? innerSelection,
    },
    onSortingChange: onSortingChange ?? setInnerSorting,
    onColumnVisibilityChange: onColumnVisibilityChange ?? setInnerVisibility,
    onRowSelectionChange: onRowSelectionChange ?? setInnerSelection,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const rows = table.getRowModel().rows
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
  })
  const vItems = virtual ? virtualizer.getVirtualItems() : null
  const padTop = vItems && vItems.length ? vItems[0].start : 0
  const padBottom = vItems && vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0
  const visibleRows = vItems ? vItems.map((v) => rows[v.index]) : rows

  return (
    <div ref={scrollRef} data-slot="data-table" className={cn('@container/table relative min-h-0 overflow-auto', className)} {...rest}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort()
                const dir = h.column.getIsSorted()
                return (
                  <TableHead
                    key={h.id}
                    className={h.column.columnDef.meta?.cellClass}
                    style={{ width: h.column.columnDef.meta?.flex ? undefined : h.getSize() }}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                  >
                    {h.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        className={cn('group/sort inline-flex max-w-full items-center gap-1 rounded-sm hover:text-foreground', FOCUS_RING)}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                        {dir === 'asc' ? (
                          <ArrowUp className="size-3 shrink-0" aria-hidden />
                        ) : dir === 'desc' ? (
                          <ArrowDown className="size-3 shrink-0" aria-hidden />
                        ) : (
                          <ChevronsUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50 motion-reduce:transition-none" aria-hidden />
                        )}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-40 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
              {visibleRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid={`row-${row.id}`}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.cellClass}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export type { ColumnDef, SortingState, VisibilityState, RowSelectionState }
