import { useMemo, useState } from 'react'
import { Archive, ChevronDown, FolderKanban, Plus, Settings2, Share2, SlidersHorizontal, Trash2, UserRound } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Count } from '@/components/ui/count'
import { ScrollRow } from '@/components/ui/scroll-row'
import { BottomDrawer } from '@/components/ui/sheet'
import { StatusDot } from '@/components/ui/status-dot'
import { Tag as UiTag } from '@/components/ui/tag'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'
import { useStudio, type DashScope } from '@/store'
import { selectOwnerOptions, selectStatusCounts, type RowsInput } from '@/store/dashboard'
import { CASE_STATUSES, type CaseStatus, type Tag } from '@/types/case'
import { TagManagerDialog } from './TagManagerDialog'
import { LABEL_NEW_PROJECT } from '@/lib/copy'

export interface FilterRailProps {
  tags: Tag[]
  /** 每个范围的计数（selectDashboardRows 派生） */
  counts?: Partial<Record<DashScope, number>>
  /** 375：横向 chips + 「筛选」BottomDrawer 而非竖栏 */
  horizontal?: boolean
  /** 分组栏顶部「新建案卷」（台账页唯一 primary）；空态自带 primary 时传 false 保持唯一 */
  showCreate?: boolean
  className?: string
}

const SCOPES: { id: DashScope; label: string; icon: typeof Archive; authOnly?: boolean }[] = [
  { id: 'all', label: '全部案卷', icon: FolderKanban },
  { id: 'mine', label: '我负责', icon: UserRound, authOnly: true },
  { id: 'shared', label: '共享给我', icon: Share2, authOnly: true },
  { id: 'archived', label: '已归档', icon: Archive },
  { id: 'trash', label: '回收站', icon: Trash2 },
]

/** 分组栏项 32 r4（05 §3.13）：选中 --bg-selected + --fg-strong；首列（图标 / 复选框 / 折叠箭头）统一 16 宽、间距 8，文字左缘对齐 */
const ITEM = cn(
  'flex h-md-control w-full items-center gap-2 rounded-sm px-2 text-sm text-fg hover:bg-hover aria-[current=true]:bg-selected aria-[current=true]:font-medium aria-[current=true]:text-fg-strong',
  FOCUS_RING,
  TRANSITION_COLOR,
)
/** 空态占位文字：与项文字同一左缘（px-2 + 首列 16 + gap 8） */
const PLACEHOLDER = 'flex h-md-control items-center pl-8 pr-2 text-xs text-fg-muted'
/** 抽屉里的项 44 高（触控） */
const ITEM_MOBILE = cn('flex min-h-touch w-full items-center gap-3 rounded-sm px-3 text-base text-fg hover:bg-hover', FOCUS_RING, TRANSITION_COLOR)
/** 375 横滑 chip（06 §2.1 / §3.2 ③）：视觉 sm 32，命中区 touchHit ≥ 44，容器 ScrollRow 不裁切 */
const CHIP = cn(
  'inline-flex h-sm-control shrink-0 items-center gap-inline-m whitespace-nowrap rounded-full border border-border bg-panel px-3 text-sm text-fg hover:bg-hover aria-[current=true]:border-fg-strong aria-[current=true]:bg-selected aria-[current=true]:font-medium aria-[current=true]:text-fg-strong',
  touchHit,
  FOCUS_RING,
  TRANSITION_COLOR,
)

function useFilterState() {
  const statuses = useStudio((s) => s.dashStatuses)
  const selTags = useStudio((s) => s.dashTags)
  const owners = useStudio((s) => s.dashOwners)
  const toggleStatus = useStudio((s) => s.toggleDashStatus)
  const toggleTag = useStudio((s) => s.toggleDashTag)
  const toggleOwner = useStudio((s) => s.toggleDashOwner)
  const clear = () => {
    statuses.forEach(toggleStatus)
    selTags.forEach(toggleTag)
    owners.forEach(toggleOwner)
  }
  return { statuses, selTags, owners, toggleStatus, toggleTag, toggleOwner, clear, active: statuses.length + selTags.length + owners.length }
}

/** 选择器输入：全是 store 内引用，useShallow 稳定；派生结果在组件内 useMemo（避免选择器每次返回新对象触发重渲染） */
function useRowsInput(): RowsInput {
  return useStudio(
    useShallow((s) => ({
      projects: s.projects,
      user: s.user,
      dashScope: s.dashScope,
      dashStatuses: s.dashStatuses,
      dashTags: s.dashTags,
      dashQuery: s.dashQuery,
      dashOwners: s.dashOwners,
      dashFocus: s.dashFocus,
      dashUnread: s.dashUnread,
    })),
  )
}

/** 分组标题是可操作的折叠开关：左栏 sm 32；抽屉里与项同为 44（下一项只隔 2px，伸 touch-hit 会盖住它，所以本体撑到 44） */
function Section({ title, count, children, defaultOpen = true, testId, dense }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; testId?: string; dense?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex flex-col gap-0.5" data-testid={testId}>
      <CollapsibleTrigger
        data-testid={`filter-section-${title}`}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle hover:bg-hover [&[data-state=closed]>svg]:-rotate-90',
          dense ? 'min-h-touch' : 'h-sm-control',
          FOCUS_RING,
        )}
      >
        <ChevronDown className="size-4 transition-transform duration-(--dur-fast) motion-reduce:transition-none" aria-hidden />
        <span className="flex-1 text-left">{title}</span>
        {count ? <Count value={count} size="sm" tone="brand" /> : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** 状态十档，只显计数 > 0 的档（已勾选的即使计数 0 也保留，避免无法取消）；左栏 / 移动抽屉 / 表格工具行「筛选」共用 */
export function StatusFilters({ dense }: { dense?: boolean }) {
  const { statuses, toggleStatus } = useFilterState()
  const input = useRowsInput()
  const counts = useMemo(() => selectStatusCounts(input), [input])
  const shown = CASE_STATUSES.filter((st) => (counts[st] ?? 0) > 0 || statuses.includes(st))
  if (!shown.length) return <p className={PLACEHOLDER}>当前范围没有案卷</p>
  return (
    <div role="group" aria-label="状态" className={cn(dense ? 'grid grid-cols-2 gap-x-2' : 'flex flex-col gap-0.5')}>
      {shown.map((st: CaseStatus) => (
        <label key={st} className={cn(dense ? ITEM_MOBILE : ITEM, 'cursor-pointer')}>
          <Checkbox checked={statuses.includes(st)} onCheckedChange={() => toggleStatus(st)} data-testid={`status-filter-${st}`} />
          <StatusDot status={st} size="sm" className="flex-1" />
          <span className="text-xs text-fg-muted tabular-nums" data-testid={`status-count-${st}`}>
            {counts[st] ?? 0}
          </span>
        </label>
      ))}
    </div>
  )
}

function TagFilters({ tags, onManage, dense }: { tags: Tag[]; onManage?: () => void; dense?: boolean }) {
  const { selTags, toggleTag } = useFilterState()
  const item = dense ? ITEM_MOBILE : ITEM
  return (
    <div role="group" aria-label="标签" className="flex flex-col gap-0.5">
      {/* R11：无标签时不再占「暂无标签」空行，只留下方管理入口 */}
      {tags.map((t) => (
        <label key={t.name} className={cn(item, 'cursor-pointer')}>
          <Checkbox checked={selTags.includes(t.name)} onCheckedChange={() => toggleTag(t.name)} data-testid={`tag-filter-${t.name}`} />
          <UiTag color={t.color} className="min-w-0 max-w-full [&>span:last-child]:truncate">
            {t.name}
          </UiTag>
        </label>
      ))}
      {onManage && (
        <button type="button" onClick={onManage} className={cn(item, 'text-fg-muted')} data-testid="manage-tags">
          <Settings2 className="size-4" aria-hidden />
          <span className="flex-1 text-left">管理标签…</span>
        </button>
      )}
    </div>
  )
}

/** 责任人 = 当前范围下各案 owner；auth=off 无账号体系则不渲染本组 */
function OwnerFilters({ dense }: { dense?: boolean }) {
  const { owners, toggleOwner } = useFilterState()
  const input = useRowsInput()
  const options = useMemo(() => selectOwnerOptions(input), [input])
  const item = dense ? ITEM_MOBILE : ITEM
  if (!options.length) return <p className={PLACEHOLDER}>暂无责任人</p>
  return (
    <div role="group" aria-label="责任人" className="flex flex-col gap-0.5">
      {options.map((o) => (
        <label key={o.id} className={cn(item, 'cursor-pointer')}>
          <Checkbox checked={owners.includes(o.id)} onCheckedChange={() => toggleOwner(o.id)} data-testid={`owner-filter-${o.id}`} />
          <span className="flex-1 truncate text-left" title={o.name}>{o.name}</span>
          <span className="text-xs text-fg-muted tabular-nums">{o.count}</span>
        </label>
      ))}
    </div>
  )
}

/**
 * 分组栏（05 §3.13；Overleaf 项目页左栏 All / Your / Shared / Archived / Trashed + Tags）：
 * w 240 `--bg-app` 右边线；顶部 `Button primary md "新建案卷"` 全宽（**台账页唯一 primary**）→ 视图段（范围）→ 按状态（`StatusDot sm` + 计数，只显 >0）→ 标签（`Tag`）→ 责任人。
 * auth=off 时隐藏「我负责 / 共享给我 / 责任人」（无用户概念）；标签增删改只对超管 / auth=off 开放（机构级字典）。
 * 375：范围横向 chips 32，状态 / 标签 / 责任人收进 BottomDrawer（项 44），按钮上标出已选筛选数。
 *   chips 行的 ScrollRow 纵向出血收到 6（-my-1.5 py-1.5）：32 chip 的 44 热区恰好需要 6，多出的部分会盖住上一行今日摘要的热区（docs/plan/28）。
 */
export function FilterRail({ tags, counts, horizontal, showCreate = true, className }: FilterRailProps) {
  const authOff = useStudio((s) => s.authStatus === 'off')
  const superuser = useStudio((s) => s.user?.is_superuser ?? false)
  const scope = useStudio((s) => s.dashScope)
  const setScope = useStudio((s) => s.setDashScope)
  const openDialog = useStudio((s) => s.openDialog)
  const { active, clear, statuses, owners } = useFilterState()
  const [manage, setManage] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const scopes = SCOPES.filter((s) => !(s.authOnly && authOff))
  const canManage = authOff || superuser
  const onManage = canManage ? () => setManage(true) : undefined
  const manager = <TagManagerDialog open={manage} onOpenChange={setManage} />

  if (horizontal) {
    return (
      <nav data-slot="FilterRail" data-variant="chips" aria-label="筛选" className={cn('flex min-w-0 flex-col', className)}>
        <ScrollRow data-testid="scope-chips" className="-my-1.5 py-1.5">
          {scopes.map((s) => (
            <button key={s.id} type="button" aria-current={scope === s.id || undefined} onClick={() => setScope(s.id)} className={CHIP} data-testid={`scope-${s.id}`}>
              {s.label}
              {counts?.[s.id] != null && <span className="text-xs text-fg-muted tabular-nums">{counts[s.id]}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className={cn(CHIP, 'ml-auto')}
            aria-current={active > 0 || undefined}
            aria-label={active ? `筛选，已选 ${active} 项` : '筛选'}
            data-testid="filter-sheet-trigger"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            筛选
            {active > 0 && <Count value={active} size="sm" tone="brand" />}
          </button>
        </ScrollRow>
        <BottomDrawer open={drawer} onOpenChange={setDrawer} title="筛选" description="状态、标签与责任人" snap="full" data-testid="filter-sheet" data-slot="FilterSheet">
          <div className="flex flex-col gap-4 px-2 pb-2">
            <Section title="状态" count={statuses.length} dense>
              <StatusFilters dense />
            </Section>
            <Section title="标签" dense>
              <TagFilters tags={tags} onManage={onManage} dense />
            </Section>
            {!authOff && (
              <Section title="责任人" count={owners.length} dense>
                <OwnerFilters dense />
              </Section>
            )}
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-panel p-3">
            <Button variant="ghost" size="xl" onClick={clear} disabled={!active} data-testid="filter-clear">
              清除
            </Button>
            <Button variant="secondary" size="xl" onClick={() => setDrawer(false)} data-testid="filter-done">
              完成
            </Button>
          </div>
        </BottomDrawer>
        {manager}
      </nav>
    )
  }

  return (
    <nav data-slot="FilterRail" aria-label="筛选" className={cn('flex w-dash-rail shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-app px-3 py-3', className)}>
      {showCreate && (
        <Button size="md" className="w-full" onClick={() => openDialog('create')} data-testid="dashboard-create">
          <Plus aria-hidden />
          {LABEL_NEW_PROJECT}
        </Button>
      )}
      <ul className="flex flex-col gap-0.5" aria-label="视图">
        {scopes.map((s) => (
          <li key={s.id}>
            <button type="button" aria-current={scope === s.id || undefined} onClick={() => setScope(s.id)} className={ITEM} data-testid={`scope-${s.id}`}>
              <s.icon className="size-4 text-fg-icon" aria-hidden />
              <span className="flex-1 text-left">{s.label}</span>
              {counts?.[s.id] != null && <span className="text-xs text-fg-muted tabular-nums">{counts[s.id]}</span>}
            </button>
          </li>
        ))}
      </ul>
      <Section title="按状态" count={statuses.length} testId="filter-status-section">
        <StatusFilters />
      </Section>
      <Section title="标签">
        <TagFilters tags={tags} onManage={onManage} />
      </Section>
      {!authOff && (
        <Section title="责任人" count={owners.length} defaultOpen={false}>
          <OwnerFilters />
        </Section>
      )}
      {active > 0 && (
        <button type="button" onClick={clear} className={cn(ITEM, 'text-fg-muted')} data-testid="filter-clear">
          清除筛选（{active}）
        </button>
      )}
      {manager}
    </nav>
  )
}
