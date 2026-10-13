import { AlertCircle, ChevronRight } from 'lucide-react'
import { diagLocationLabel } from '@/lib/diagLocation'
import { FOCUS_RING_INSET, cn, touchHit } from '@/lib/utils'
import { useStudio, selectErrorCount } from '@/store'

/**
 * 移动端全局错误条（顶栏之下一行，44 高——上下邻行都是满预算的 44 行，行内按钮的 44 命中区借不到位，docs/plan/30）：
 * 「⚠ 位置 · 消息 ›」整条点开控制台「错误」tab；右侧「定位」把源码滚到出错处。
 * 位置用书 / 权项 / 段落字样（diagLocationLabel），不出现源码行号。
 */
export function GlobalErrorBar() {
  const first = useStudio((s) => s.items.find((d) => d.severity === 'error') ?? null)
  const errors = useStudio(selectErrorCount)
  const netError = useStudio((s) => s.netError)
  const ast = useStudio((s) => s.ast)
  const gotoLine = useStudio((s) => s.gotoLine)
  const openConsole = useStudio((s) => s.openConsole)
  const msg = first?.message ?? (netError ? `请求失败：${netError}` : null)
  if (!msg) return null
  const line = first?.line ?? null
  const where = first ? diagLocationLabel(first, ast) : null
  const more = errors > 1 ? `等 ${errors} 个错误` : null
  return (
    <div
      role="alert"
      data-slot="GlobalErrorBar"
      data-testid="global-error-bar"
      className="flex h-11 w-full min-w-0 shrink-0 items-stretch border-b border-danger-fg/25 bg-danger-bg text-sm text-danger-fg"
    >
      <button
        type="button"
        className={cn(
          touchHit,
          '-mb-px flex min-w-0 flex-1 items-center gap-1.5 px-page-m text-left',
            FOCUS_RING_INSET,
        )}
        onClick={() => openConsole('error')}
        aria-label={`打开控制台查看 ${errors} 个错误：${where ? `${where}，` : ''}${msg}`}
        title={msg}
        data-testid="global-error-text"
      >
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate leading-none" data-testid="global-error-msg">
          {where && <span className="font-medium">{where}：</span>}
          {msg}
          {more && <span className="text-danger-fg/70">（{more}）</span>}
        </span>
        <ChevronRight className="size-4 shrink-0 text-danger-fg/60" aria-hidden />
      </button>
      {line != null && (
        <button
          type="button"
          className={cn(
            touchHit,
            '-mb-px shrink-0 border-l border-danger-fg/20 px-3 text-sm font-medium leading-none',
            FOCUS_RING_INSET,
          )}
          onClick={() => gotoLine(line)}
          aria-label={`在源码中定位到${where ?? '出错处'}`}
          data-testid="global-error-locate"
        >
          定位
        </button>
      )}
    </div>
  )
}
