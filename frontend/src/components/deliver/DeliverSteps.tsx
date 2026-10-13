import { Check, CircleAlert } from 'lucide-react'
import { ScrollRow } from '@/components/ui/scroll-row'
import { cn } from '@/lib/utils'

export type StepState = 'todo' | 'active' | 'done' | 'error'

export interface DeliverStep {
  label: string
  state: StepState
  hint?: string
}

const STATE_TEXT: Record<StepState, string> = { todo: '待进行', active: '进行中', done: '已完成', error: '有问题' }

/**
 * S7 四步流程条（prototype s7-deliver .steps）：体检 → 生成产物 → 打包递交 → 标记已递交。
 * 每步 = 24px 圆标（done 品牌实心 ✓ / error danger ! / active 品牌描边 / todo 灰描边）+ 14px 标签 + 12px 提示；
 * 1440 横排等分；375 `compact`（06 §3.2 ③ / prototype-w8-mobile 04 .step）= ScrollRow 横滑不裁切，每步一枚 sm 32 胶囊（圆标 + 标签）。
 * 状态永远有文字（sr-only 也算），不只靠颜色。
 */
export function DeliverSteps({ steps, compact = false, className }: { steps: DeliverStep[]; compact?: boolean; className?: string }) {
  const items = steps.map((s, i) => (
    <li
      key={s.label}
      className={cn(
        'flex min-w-0 items-start gap-2',
        compact
          ? cn(
              'h-sm-control shrink-0 items-center rounded-full pl-1 pr-3',
              s.state === 'active' ? 'bg-primary-soft' : 'bg-sunken',
            )
          : 'flex-1',
      )}
      data-state={s.state}
      data-testid={`deliver-step-${i + 1}`}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums [&_svg]:size-3.5',
          s.state === 'done' && 'border-primary bg-primary text-primary-foreground',
          s.state === 'error' && 'border-danger-dot bg-danger-bg text-danger-fg',
          s.state === 'active' && 'border-primary bg-primary-soft text-link',
          s.state === 'todo' && 'border-border-strong bg-panel text-fg-muted',
        )}
        aria-hidden
      >
        {s.state === 'done' ? <Check /> : s.state === 'error' ? <CircleAlert /> : i + 1}
      </span>
      <span className="min-w-0">
        <span className={cn('block truncate text-sm', s.state === 'todo' ? 'text-fg-muted' : s.state === 'active' && compact ? 'font-medium text-link' : 'font-medium text-fg-strong')}>
          {s.label}
          <span className="sr-only">（{STATE_TEXT[s.state]}）</span>
        </span>
        {!compact && s.hint && <span className="block truncate text-xs text-fg-muted">{s.hint}</span>}
      </span>
      {!compact && i < steps.length - 1 && <span className="mx-2 mt-3 h-px min-w-4 flex-1 bg-border" aria-hidden />}
    </li>
  ))

  if (compact) {
    return (
      <ScrollRow className={className} data-testid="deliver-steps" data-compact>
        <ol className="contents" aria-label="递交流程">
          {items}
        </ol>
      </ScrollRow>
    )
  }
  return (
    <ol className={cn('relative flex w-full min-w-0 max-w-full items-start gap-4', className)} aria-label="递交流程" data-testid="deliver-steps">
      {items}
    </ol>
  )
}
