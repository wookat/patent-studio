import { fmtMs } from '@/lib/format'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio, selectErrorCount } from '@/store'

type PillState = 'idle' | 'busy' | 'ok' | 'warn' | 'error'

const STYLE: Record<PillState, string> = {
  idle: 'bg-sunken text-fg-muted',
  busy: 'bg-selected text-fg-strong',
  ok: 'bg-success-soft text-success',
  warn: 'bg-warn-bg text-warn-fg hover:bg-warning/30',
  error: 'bg-danger-bg text-danger-fg hover:bg-destructive/20',
}

/**
 * 构建状态 pill（03 §3.5）：高 22
 *   就绪（muted）/ 构建中（primary-soft + 脉冲点 + 计时）/ 已更新 · 1.3 s（success-soft）/ 构建错误（destructive-soft，可点 → 问题面板）。
 * 构建成功但 lint 仍有 error 级问题（02 §5.1 lint 非阻断）时不再显示绿色，而是琥珀「已更新 · N 个问题」（可点 → 问题面板），
 * 避免与红色错误条 / gutter ● / 预览角标同屏一红一绿。
 * `queued` 归入构建中；`superseded` 归入上一个成功/就绪态。
 */
function okState(errors: number, totalMs: number | undefined): [PillState, string] {
  if (errors > 0) return ['warn', `已更新 · ${errors} 个问题`]
  return ['ok', `已更新 · ${fmtMs(totalMs)}`]
}

export function StatusPill({ className }: { className?: string }) {
  const phase = useStudio((s) => s.phase)
  const elapsedMs = useStudio((s) => s.elapsedMs)
  const totalMs = useStudio((s) => s.lastOk?.timings.total_ms)
  const netError = useStudio((s) => s.netError)
  const netStatus = useStudio((s) => s.netStatus)
  const hasOk = useStudio((s) => s.lastOk !== null)
  const errors = useStudio(selectErrorCount)
  const openBottom = useStudio((s) => s.openBottom)

  let state: PillState
  let text: string
  switch (phase) {
    case 'building':
      state = 'busy'
      text = `构建中 ${fmtMs(elapsedMs)}`
      break
    case 'queued':
      state = 'busy'
      text = '排队中'
      break
    case 'error':
      state = 'error'
      text = netError ? (netStatus === 401 || netStatus === 403 ? '权限不足' : '请求失败') : errors > 1 ? `构建错误 · ${errors}` : '构建错误'
      break
    case 'ok':
      ;[state, text] = okState(errors, totalMs)
      break
    default:
      if (hasOk) {
        ;[state, text] = okState(errors, totalMs)
      } else {
        state = 'idle'
        text = '就绪'
      }
  }

  const base = cn(
    'inline-flex h-5.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold tabular transition-colors',
    STYLE[state],
    className,
  )
  const dot = (
    <span
      aria-hidden
      className={cn('size-1.5 rounded-full bg-current', state === 'busy' && 'motion-safe:animate-pulse-dot')}
    />
  )

  if (state === 'error' || state === 'warn') {
    return (
      <button
        type="button"
        className={cn(base, FOCUS_RING)}
        onClick={() => openBottom('problems')}
        aria-label={`${text}，打开问题面板`}
        data-slot="StatusPill"
        data-state={state}
        data-testid="build-status"
      >
        {dot}
        {text}
      </button>
    )
  }
  return (
    <span className={base} role="status" aria-live="polite" data-slot="StatusPill" data-state={state} data-testid="build-status">
      {dot}
      {text}
    </span>
  )
}
