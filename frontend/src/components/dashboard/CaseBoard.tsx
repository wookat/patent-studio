import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Count } from '@/components/ui/count'
import { StatusDot } from '@/components/ui/status-dot'
import type { ProjectSummary } from '@/lib/types'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'
import { CASE_STATUSES, STATUS_LABEL, type CaseStatus, type Tag } from '@/types/case'
import { useStudio } from '@/store'
import { CaseRow, useCanEditCase } from './CaseRow'

export interface CaseBoardProps {
  rows: ProjectSummary[]
  tags: Tag[]
  selected: string[]
  onToggleSelected(pid: string): void
  /** 拖卡到另一列 ⇒ 改状态（store.setCaseStatus） */
  onMove(pid: string, status: CaseStatus): void
  /** 只显示这些列（默认全部十档；空列折叠为 40 竖条，点击展开后可拖入） */
  columns?: readonly CaseStatus[]
  /** 375：长按 200ms 拾起，避免与横向滚动冲突 */
  mobile?: boolean
}

const isStatus = (x: unknown): x is CaseStatus => typeof x === 'string' && (CASE_STATUSES as readonly string[]).includes(x)

/** 拖放结果 → 需要发出的状态变更；同列 / 落到列外 / 目标非状态 ⇒ null */
export function resolveDrop(rows: ProjectSummary[], activeId: unknown, overId: unknown): { pid: string; status: CaseStatus } | null {
  if (typeof activeId !== 'string' || !isStatus(overId)) return null
  const row = rows.find((r) => r.id === activeId)
  if (!row) return null
  if ((row.case?.status ?? 'drafting') === overId) return null
  return { pid: row.id, status: overId }
}

/** 卡片上的链接 / 勾选 / 菜单等自身可点目标不触发拖动；其余区域按住即拖（Trello 手感），键盘拖动走拖柄 */
const INTERACTIVE = 'a, button, input, [role="menu"], [role="menuitem"], [role="menuitemradio"]'

function Card({ row, ...props }: Omit<Parameters<typeof CaseRow>[0], 'canEdit' | 'dense'>) {
  const canEdit = useCanEditCase(row)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: row.id, disabled: !canEdit, data: { row } })
  const onPointerDown = listeners?.onPointerDown as ((e: ReactPointerEvent) => void) | undefined
  return (
    <CaseRow
      {...props}
      row={row}
      canEdit={canEdit}
      dense
      ref={setNodeRef}
      className={cn(canEdit && 'touch-manipulation', isDragging && 'opacity-40')}
      liProps={
        canEdit && onPointerDown
          ? {
              onPointerDown: (e) => {
                if (!(e.target as HTMLElement).closest(INTERACTIVE)) onPointerDown(e)
              },
            }
          : undefined
      }
      handle={
        canEdit ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`拖动 ${row.title || row.id} 到其它状态列`}
            title="拖到其它状态列"
            className={cn('-ml-1 inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg-strong active:cursor-grabbing max-lg:size-touch', FOCUS_RING)}
            data-testid={`drag-${row.id}`}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : undefined
      }
    />
  )
}

/**
 * 状态列（05 §4 S2）：宽 `--w-board-col` 280 `--bg-sunken` r6；列头 32 = `StatusDot md` + `Count`；
 * 计数 0 的列默认**折叠为 40 竖条**（竖排标题，点击展开），折叠态仍是 droppable，拖到上方自动展开提示。
 * 移动端一列一屏（列宽 = 视口 − 48，右侧露出下一列）+ scroll-snap。
 */
function Column({
  status,
  cards,
  collapsed,
  onExpand,
  mobile,
  children,
}: {
  status: CaseStatus
  cards: number
  collapsed: boolean
  onExpand(): void
  mobile?: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const openDialog = useStudio((s) => s.openDialog)
  const label = `${STATUS_LABEL[status]}（${cards}）`
  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        role="listitem"
        data-status={status}
        data-collapsed
        data-over={isOver || undefined}
        className={cn('flex w-board-col-collapsed shrink-0 flex-col items-center rounded-md border border-border bg-sunken py-2', mobile && 'snap-start', TRANSITION_COLOR, isOver && 'border-primary bg-selected')}
        aria-label={label}
      >
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={false}
          aria-label={`展开「${STATUS_LABEL[status]}」列`}
          // 列框仍 --w-board-col-collapsed 40；<lg 按钮本体 44（--h-touch）居中溢出列框，命中区 ≥ 44
          className={cn('flex min-h-touch w-full flex-1 flex-col items-center gap-1.5 rounded-sm py-1 hover:bg-hover max-lg:w-touch max-lg:shrink-0', FOCUS_RING)}
          data-testid={`board-expand-${status}`}
        >
          <StatusDot status={status} size="sm" className="[writing-mode:vertical-rl] [&>span]:mt-1.5" />
          <Count value={cards} size="sm" showZero />
        </button>
      </div>
    )
  }
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      data-status={status}
      data-over={isOver || undefined}
      className={cn(
        'flex shrink-0 flex-col rounded-md border border-border bg-sunken',
        mobile ? 'w-[calc(100vw-var(--spacing)*12)] snap-start' : 'w-board-col',
        TRANSITION_COLOR,
        isOver && 'border-primary bg-selected',
      )}
      aria-label={label}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 px-3">
        <StatusDot status={status} className="font-medium" />
        <Count value={cards} size="sm" showZero className="ml-auto" />
      </header>
      <ul className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" aria-label={`${STATUS_LABEL[status]}的案卷`}>
        {children}
      </ul>
      <footer className="shrink-0 px-2 pb-2">
        <button
          type="button"
          onClick={() => openDialog('create')}
          className={cn('flex h-8 w-full items-center justify-center gap-1 rounded-md border border-dashed border-border-strong text-xs text-fg-muted hover:border-primary hover:text-primary', FOCUS_RING)}
          data-testid={`board-create-${status}`}
        >
          <Plus className="size-3.5" aria-hidden />
          新建案卷
        </button>
      </footer>
    </div>
  )
}

const SR_INSTRUCTIONS = {
  draggable: '按空格拾起卡片，用左右方向键移到目标状态列，再按空格放下；Esc 取消。',
}

/**
 * 看板（13 §3.3；借鉴 Notion Board / Trello，专利场景：状态列 = 办案阶段，代理人一眼看到各阶段积压）。
 * 列横向滚动，列宽 `--w-board-col`（240）；卡片 = CaseRow card 变体，拖到另一列 ⇒ `onMove` ⇒ POST /case/status。
 * 列内不排序（按 mtime），所以只用 @dnd-kit/core：列 useDroppable(id=status)、卡 useDraggable(id=pid)。
 * 键盘：卡片拖柄聚焦后空格拾起、←/→ 换列、空格放下；拖拽不是唯一路径，卡上 StatusPicker 仍可改状态。
 */
export function CaseBoard({ rows, tags, selected, onToggleSelected, onMove, columns = CASE_STATUSES, mobile }: CaseBoardProps) {
  const [active, setActive] = useState<ProjectSummary | null>(null)
  /** 用户手动展开的空列（便于拖入）；非空列永远展开。持久化查看偏好（同列显隐 / 紧凑） */
  const expanded = useStudio((s) => s.dashBoardExpanded)
  const setExpanded = useStudio((s) => s.setDashBoardExpanded)
  const sensors = useSensors(
    useSensor(PointerSensor, mobile ? { activationConstraint: { delay: 200, tolerance: 6 } } : { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      // ←/→ 在列之间移动（列宽 + gap），↑/↓ 不动；dnd-kit 默认坐标步进 25px 在 240px 列上要按十次
      coordinateGetter: (event, { currentCoordinates }) => {
        const step = 252
        switch (event.code) {
          case 'ArrowRight':
            return { ...currentCoordinates, x: currentCoordinates.x + step }
          case 'ArrowLeft':
            return { ...currentCoordinates, x: currentCoordinates.x - step }
          default:
            return undefined
        }
      },
    }),
  )

  const onDragStart = (e: DragStartEvent) => setActive(rows.find((r) => r.id === e.active.id) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const drop = resolveDrop(rows, e.active.id, e.over?.id)
    if (drop) onMove(drop.pid, drop.status)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: SR_INSTRUCTIONS,
        announcements: {
          onDragStart: ({ active }) => `已拾起 ${labelOf(rows, active.id)}`,
          onDragOver: ({ over }) => (isStatus(over?.id) ? `移到「${STATUS_LABEL[over.id]}」列` : '不在任何状态列上'),
          onDragEnd: ({ active, over }) => (isStatus(over?.id) ? `${labelOf(rows, active.id)} 已放到「${STATUS_LABEL[over.id]}」` : '已放下，状态未变'),
          onDragCancel: ({ active }) => `已取消拖动 ${labelOf(rows, active.id)}`,
        },
      }}
    >
      <div
        data-slot="CaseBoard"
        className={cn('flex h-full gap-3 overflow-x-auto bg-app', mobile ? 'snap-x snap-mandatory scroll-px-4 px-4 py-3' : 'px-page-x py-4')}
        role="list"
        aria-label="按状态分列的看板"
      >
        {columns.map((status) => {
          const cards = rows.filter((r) => (r.case?.status ?? 'drafting') === status)
          const collapsed = cards.length === 0 && !expanded.includes(status)
          return (
            <Column key={status} status={status} cards={cards.length} collapsed={collapsed} onExpand={() => setExpanded((xs) => [...xs, status])} mobile={mobile}>
              {cards.map((r) => (
                <Card key={r.id} row={r} tags={tags} selected={selected.includes(r.id)} onToggleSelected={onToggleSelected} />
              ))}
            </Column>
          )
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && (
          <ul className="w-board-col list-none">
            <CaseRow row={active} tags={tags} selected={selected.includes(active.id)} onToggleSelected={() => {}} canEdit={false} dense className="border-primary shadow-lg" />
          </ul>
        )}
      </DragOverlay>
    </DndContext>
  )
}

const labelOf = (rows: ProjectSummary[], id: unknown) => rows.find((r) => r.id === id)?.title || String(id)
