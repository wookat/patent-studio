import type { ColumnDef, Row, SortingState, Table } from '@tanstack/react-table'
import { fmtDateTime, fmtRelative } from '@/lib/format'
import { Checkbox } from '@/components/ui/checkbox'
import { StatusDot } from '@/components/ui/status-dot'
import type { ProjectSummary } from '@/lib/types'
import { projectHash } from '@/lib/hash'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { targetFilingDaysLeft } from '@/store/dashboard'
import { CASE_STATUSES, KIND_LABEL, STATUS_LABEL, type Tag } from '@/types/case'
import { AvatarStack, RelatedBadge, RowActions, TagList, canEditCase, useCanEditCase } from './CaseRow'
import { DeadlineCell, deadlineKindLabel, targetFilingLabel } from './DeadlineCell'
import { OwnerPicker, ownerDisplayName } from './OwnerPicker'
import { StatusPicker } from './StatusPicker'

export type CaseColumnId =
  | 'select'
  | 'case_no'
  | 'title'
  | 'kind'
  | 'status'
  | 'owner'
  | 'client'
  | 'deadline'
  | 'tags'
  | 'modified'
  | 'application_no'
  | 'filing_date'
  | 'collab'
  | 'actions'

/** 列显隐菜单里可开关的列（勾选 / ⋯ 固定） */
export type TextColumnId = Exclude<CaseColumnId, 'select' | 'actions'>

export const TOGGLEABLE_COLUMNS: readonly { id: TextColumnId; label: string }[] = [
  { id: 'case_no', label: '案号' },
  { id: 'title', label: '名称' },
  { id: 'kind', label: '类型' },
  { id: 'status', label: '状态' },
  { id: 'owner', label: '责任人' },
  { id: 'client', label: '客户' },
  { id: 'deadline', label: '最近期限' },
  { id: 'tags', label: '标签' },
  { id: 'modified', label: '最近修改' },
  { id: 'application_no', label: '申请号' },
  { id: 'filing_date', label: '申请日' },
  { id: 'collab', label: '协作者' },
]

const zh = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** 责任人文本（排序 / 分组 / CSV）：后端 owner 直查 → 成员表 → 「已离开的成员」，永不输出账号 id */
export const ownerNameOf = (r: ProjectSummary): string => {
  const id = r.case?.owner_user_id
  if (!id) return ''
  return ownerDisplayName(id, r.owner ?? r.collaborators?.find((c) => c.user_id === id))
}

/** 各列的「取值」——排序、CSV 导出共用同一套 accessor，保证导出内容 = 屏幕所见 */
export const CELL_TEXT: Record<TextColumnId, (r: ProjectSummary) => string> = {
  case_no: (r) => r.case?.case_no ?? '',
  title: (r) => r.title || r.id,
  kind: (r) => (r.case ? KIND_LABEL[r.case.kind] : ''),
  status: (r) => (r.case ? STATUS_LABEL[r.case.status] : ''),
  owner: ownerNameOf,
  client: (r) => r.case?.client ?? '',
  deadline: (r) => {
    const d = r.case?.next_deadline
    const t = targetFilingDaysLeft(r)
    const parts = [
      d && `${deadlineKindLabel(d.kind)} ${d.due}（${d.days_left < 0 ? `逾期 ${-d.days_left} 天` : `剩 ${d.days_left} 天`}）`,
      t != null && `${targetFilingLabel(t)}（${r.case?.dates.target_filing ?? ''}）`,
    ]
    return parts.filter(Boolean).join('；')
  },
  tags: (r) => (r.case?.tags ?? []).join('、'),
  modified: (r) => fmtDateTime(r.mtime),
  application_no: (r) => r.case?.dates.application_no ?? '',
  filing_date: (r) => r.case?.dates.filed ?? '',
  collab: (r) => (r.collaborators ?? []).map((c) => c.display_name || c.email).join('、'),
}

type SortKey = string | number | undefined
const cmpKey = (x: Exclude<SortKey, undefined>, y: Exclude<SortKey, undefined>) => (typeof x === 'number' && typeof y === 'number' ? x - y : zh.compare(String(x), String(y)))
const text = (id: TextColumnId) => (r: ProjectSummary) => CELL_TEXT[id](r) || undefined

/** 排序键：文本列按中文 collator；undefined = 无值（空文本 / 无期限），无论升降都排末尾（TanStack sortUndefined:'last' 同语义） */
export const SORT_KEY: Record<Exclude<TextColumnId, 'collab'>, (r: ProjectSummary) => SortKey> = {
  case_no: text('case_no'),
  title: text('title'),
  kind: text('kind'),
  status: (r) => (r.case ? CASE_STATUSES.indexOf(r.case.status) : undefined),
  owner: text('owner'),
  client: text('client'),
  // 排序仍以普通期限为准；只有目标递交日的案用它兜底，不至于永远排末
  deadline: (r) => r.case?.next_deadline?.days_left ?? targetFilingDaysLeft(r) ?? undefined,
  tags: text('tags'),
  modified: (r) => r.mtime ?? 0,
  application_no: text('application_no'),
  filing_date: text('filing_date'),
}

/**
 * 与 DataTable 内部（TanStack getSortedRowModel + 各列 sortingFn / sortUndefined）同一套键；供 CSV 导出复现屏幕顺序。
 * 无排序 = 保持 store 给出的顺序（最近修改在前）。
 */
export function sortCaseRows(rows: readonly ProjectSummary[], sorting: SortingState): ProjectSummary[] {
  const s = sorting[0]
  const key = s && s.id in SORT_KEY ? SORT_KEY[s.id as keyof typeof SORT_KEY] : undefined
  if (!key) return [...rows]
  const dir = s!.desc ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    if (x === undefined || y === undefined) return x === undefined && y === undefined ? 0 : x === undefined ? 1 : -1
    return dir * cmpKey(x, y)
  })
}

const sortingFnOf = (id: keyof typeof SORT_KEY) => (a: { original: ProjectSummary }, b: { original: ProjectSummary }) => {
  const x = SORT_KEY[id](a.original)
  const y = SORT_KEY[id](b.original)
  if (x === undefined || y === undefined) return x === undefined && y === undefined ? 0 : x === undefined ? 1 : -1
  return cmpKey(x, y)
}

const SortHead = ({ id, children }: { id: CaseColumnId; children: string }) => <span className="whitespace-nowrap" data-testid={`sort-${id}`}>{children}</span>

function StatusCell({ row }: { row: ProjectSummary }) {
  const canEdit = useCanEditCase(row)
  if (!row.case) return null
  return canEdit ? <StatusPicker pid={row.id} status={row.case.status} /> : <StatusDot status={row.case.status} />
}

const Dash = () => <span className="text-fg-subtle">—</span>

/**
 * 可补录的空台账字段：可写时「—」渲染为 ghost 钮，点击经 openCaseForm(pid, field) 直开案件表单聚焦该字段
 * （递交页字段错误的同款深链）；只读仍为纯文本「—」。只挂案件表单里真实存在的字段。
 */
function FillableDash({ row, field, label }: { row: ProjectSummary; field: string; label: string }) {
  const canEdit = useCanEditCase(row)
  const openCaseForm = useStudio((s) => s.openCaseForm)
  if (!canEdit) return <Dash />
  return (
    <button
      type="button"
      className={cn('-mx-1 rounded-sm px-1 text-fg-subtle hover:bg-hover hover:text-link hover:underline', FOCUS_RING)}
      title={`点击补录${label}`}
      aria-label={`补录${label}`}
      onClick={() => openCaseForm(row.id, field)}
      data-testid={`fill-${field}-${row.id}`}
    >
      —
    </button>
  )
}

/**
 * 列宽策略：除「案名」弹性外全部定宽（默认列固定合计 940），案名吃掉剩余宽度；表容器（DataTable `@container/table`）变窄时按优先级收起低信息列，
 * 保证案名 ≥ 236：<1300 收「标签」（1440 视口案名 372），<1200 再收「最近修改」（1280 视口 308），<940 再收「类型 / 客户」（1024 视口 236）。Tailwind 需字面类名。
 */
const HIDE_WIDE = '@max-[1299px]/table:hidden'
const HIDE_NARROW = '@max-[1199px]/table:hidden'
const HIDE_NARROWER = '@max-[939px]/table:hidden'

function OwnerCell({ row }: { row: ProjectSummary }) {
  const canEdit = useCanEditCase(row)
  return row.case ? <OwnerPicker pid={row.id} ownerUserId={row.case.owner_user_id} owner={row.owner} collaborators={row.collaborators ?? []} readonly={!canEdit} /> : <Dash />
}

function ActionsCell({ row }: { row: ProjectSummary }) {
  const canEdit = useCanEditCase(row)
  return <RowActions row={row} canEdit={canEdit} />
}

/** 表头全选：只覆盖可编辑行（批量动作无一可给只读行执行）；无可编辑行时不给 affordance */
function SelectAllHead({ table }: { table: Table<ProjectSummary> }) {
  const authStatus = useStudio((s) => s.authStatus)
  const superuser = useStudio((s) => s.user?.is_superuser ?? false)
  const editable = table.getRowModel().rows.filter((r) => canEditCase(r.original, authStatus === 'off', superuser))
  if (!editable.length) return null
  const selCount = editable.filter((r) => r.getIsSelected()).length
  return (
    <Checkbox
      checked={selCount === 0 ? false : selCount === editable.length ? true : 'indeterminate'}
      onCheckedChange={(v) => table.setRowSelection(v ? Object.fromEntries(editable.map((r) => [r.id, true])) : {})}
      aria-label="全选"
      data-testid="select-all"
    />
  )
}

/** 行勾选：不可编辑行不渲染（与 StatusCell/ActionsCell 同口径），空格保留列位 */
function SelectCell({ row }: { row: Row<ProjectSummary> }) {
  const canEdit = useCanEditCase(row.original)
  if (!canEdit) return null
  return <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(v)} aria-label={`选择 ${row.original.title || row.original.id}`} data-testid={`select-${row.original.id}`} />
}

export function caseColumns(tags: Tag[]): ColumnDef<ProjectSummary, unknown>[] {
  return [
    {
      id: 'select',
      size: 36,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => <SelectAllHead table={table} />,
      cell: ({ row }) => <SelectCell row={row} />,
    },
    {
      id: 'case_no',
      accessorFn: SORT_KEY.case_no,
      sortUndefined: 'last',
      size: 104,
      sortingFn: sortingFnOf('case_no'),
      header: () => <SortHead id="case_no">案号</SortHead>,
      cell: ({ row }) =>
        row.original.case?.case_no ? (
          <span className="font-mono text-xs text-fg-muted tabular-nums whitespace-nowrap">{row.original.case.case_no}</span>
        ) : (
          <FillableDash row={row.original} field="case_no" label="案号" />
        ),
    },
    {
      id: 'title',
      accessorFn: SORT_KEY.title,
      sortUndefined: 'last',
      minSize: 200,
      meta: { flex: true },
      sortingFn: sortingFnOf('title'),
      header: () => <SortHead id="title">案名</SortHead>,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <a
            href={`#${projectHash(row.original.id)}`}
            className="block min-w-0 truncate font-medium text-fg-strong hover:text-link hover:underline"
            data-testid={`open-${row.original.id}`}
            title={row.original.title || row.original.id}
          >
            {row.original.title || row.original.id}
          </a>
          <RelatedBadge related={row.original.case?.related} />
        </span>
      ),
    },
    {
      id: 'kind',
      accessorFn: SORT_KEY.kind,
      sortUndefined: 'last',
      size: 64,
      meta: { cellClass: HIDE_NARROWER },
      sortingFn: sortingFnOf('kind'),
      header: () => <SortHead id="kind">类型</SortHead>,
      cell: ({ row }) => <span className="text-fg-muted">{CELL_TEXT.kind(row.original) || '—'}</span>,
    },
    {
      id: 'status',
      accessorFn: SORT_KEY.status,
      sortUndefined: 'last',
      sortDescFirst: false,
      size: 104,
      sortingFn: sortingFnOf('status'),
      header: () => <SortHead id="status">状态</SortHead>,
      cell: ({ row }) => <StatusCell row={row.original} />,
    },
    {
      id: 'owner',
      accessorFn: SORT_KEY.owner,
      sortUndefined: 'last',
      size: 120,
      sortingFn: sortingFnOf('owner'),
      header: () => <SortHead id="owner">责任人</SortHead>,
      cell: ({ row }) => <OwnerCell row={row.original} />,
    },
    {
      id: 'client',
      accessorFn: SORT_KEY.client,
      sortUndefined: 'last',
      size: 120,
      meta: { cellClass: HIDE_NARROWER },
      sortingFn: sortingFnOf('client'),
      header: () => <SortHead id="client">客户</SortHead>,
      cell: ({ row }) =>
        row.original.case?.client ? (
          <span className="block truncate" title={row.original.case.client}>{row.original.case.client}</span>
        ) : (
          <FillableDash row={row.original} field="client" label="客户" />
        ),
    },
    {
      id: 'deadline',
      accessorFn: SORT_KEY.deadline,
      sortUndefined: 'last',
      sortDescFirst: false,
      size: 144,
      sortingFn: sortingFnOf('deadline'),
      header: () => <SortHead id="deadline">最近期限</SortHead>,
      cell: ({ row }) => <DeadlineCell d={row.original.case?.next_deadline ?? null} targetDaysLeft={targetFilingDaysLeft(row.original)} />,
    },
    {
      id: 'tags',
      accessorFn: SORT_KEY.tags,
      sortUndefined: 'last',
      size: 112,
      meta: { cellClass: HIDE_WIDE },
      sortingFn: sortingFnOf('tags'),
      header: () => <SortHead id="tags">标签</SortHead>,
      cell: ({ row }) => {
        const names = row.original.case?.tags ?? []
        if (!names.length) return <Dash />
        return <TagList names={names} tags={tags} className="max-w-full overflow-hidden" />
      },
    },
    {
      id: 'modified',
      accessorFn: SORT_KEY.modified,
      sortDescFirst: true,
      size: 96,
      meta: { cellClass: HIDE_NARROW },
      sortingFn: sortingFnOf('modified'),
      header: () => <SortHead id="modified">最近修改</SortHead>,
      cell: ({ row }) => {
        const r = row.original
        const t = fmtRelative(r.mtime ? r.mtime * 1000 : 0)
        const by = r.last_modified_by ? `${r.last_modified_by} · ` : ''
        return (
          <span className="block truncate text-xs text-fg-muted tabular-nums" title={`${by}${CELL_TEXT.modified(r)}`}>
            {t}
          </span>
        )
      },
    },
    {
      id: 'application_no',
      accessorFn: SORT_KEY.application_no,
      sortUndefined: 'last',
      size: 150,
      sortingFn: sortingFnOf('application_no'),
      header: () => <SortHead id="application_no">申请号</SortHead>,
      cell: ({ row }) =>
        CELL_TEXT.application_no(row.original) ? (
          <span className="font-mono text-xs tabular-nums">{CELL_TEXT.application_no(row.original)}</span>
        ) : (
          <FillableDash row={row.original} field="dates.application_no" label="申请号" />
        ),
    },
    {
      id: 'filing_date',
      accessorFn: SORT_KEY.filing_date,
      sortUndefined: 'last',
      size: 110,
      sortingFn: sortingFnOf('filing_date'),
      header: () => <SortHead id="filing_date">申请日</SortHead>,
      cell: ({ row }) =>
        CELL_TEXT.filing_date(row.original) ? (
          <span className="tabular-nums">{CELL_TEXT.filing_date(row.original)}</span>
        ) : (
          <FillableDash row={row.original} field="dates.filed" label="申请日" />
        ),
    },
    {
      id: 'collab',
      size: 110,
      enableSorting: false,
      header: '协作者',
      cell: ({ row }) => <AvatarStack people={row.original.collaborators ?? []} />,
    },
    {
      id: 'actions',
      size: 40,
      enableSorting: false,
      enableHiding: false,
      header: () => <span className="sr-only">操作</span>,
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()} className="flex justify-end">
          <ActionsCell row={row.original} />
        </span>
      ),
    },
  ]
}
