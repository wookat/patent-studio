import { ExternalLink } from 'lucide-react'
import { Count } from '@/components/ui/count'
import { deliverHash } from '@/lib/hash'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'
import { useStudio, type ConsoleTab } from '@/store'

const DIAG_TABS: { id: ConsoleTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'error', label: '错误' },
  { id: 'warning', label: '警告' },
  { id: 'info', label: '提示' },
]
const TOOL_TABS: { id: ConsoleTab; label: string }[] = [
  { id: 'checks', label: '回归检查' },
  { id: 'oa', label: 'OA 答复' },
]

function Chip({ value, tone }: { value: number; tone: 'muted' | 'error' }) {
  return <Count value={value} showZero tone={tone === 'error' ? 'danger' : 'neutral'} data-testid="console-tab-count" />
}

/**
 * 控制台 tab 条（05 §3.5 伴随栏面板头：下划线 Tabs，不用 Segmented）：全部 N / 错误 N / 警告 N / 提示 N ｜ 回归检查 / OA 答复（轨道 E，09 §6.5）。
 * 当前 tab 2px 品牌色下划线；计数 Count（neutral），错误计数 >0 danger。容器窄时可横向滚动（移动端）。
 * W4-E（docs/plan/17 §2.5）：体检与 XML 校验收敛到递交页；tablist 后追一个「递交页」链接（不是 tab，不进键盘环），
 * 体检有 error 时链接带红计数。
 * `scroll='bar'`（移动端）：tablist 不自己滚，整条（含「递交页」）交由外层横向滚动容器，末尾 Tab 在屏边露头提示可滑，
 * 末尾 16 内边距出血到页边（06 §3.2 ③）。
 */
export function ConsoleTabs({ className, scroll = 'tabs' }: { className?: string; scroll?: 'tabs' | 'bar' }) {
  const pid = useStudio((s) => s.pid)
  const consoleTab = useStudio((s) => s.consoleTab)
  const setConsoleTab = useStudio((s) => s.setConsoleTab)
  const items = useStudio((s) => s.items)
  const preflightErrors = useStudio((s) => s.preflight?.counts.error ?? 0)
  const counts: Partial<Record<ConsoleTab, number>> = {
    all: items.length,
    error: items.filter((d) => d.severity === 'error').length,
    warning: items.filter((d) => d.severity === 'warning').length,
    info: items.filter((d) => d.severity === 'info').length,
  }

  const render = (t: { id: ConsoleTab; label: string }) => {
    const selected = consoleTab === t.id
    const n = counts[t.id] ?? null
    return (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls="console-tabpanel"
        id={`console-tab-${t.id}`}
        tabIndex={selected ? 0 : -1}
        data-testid={`console-tab-${t.id}`}
        className={cn(
          'flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 text-sm transition-colors duration-fast in-data-[density=touch]:min-h-touch',
          FOCUS_RING_INSET,
          selected ? 'border-primary font-medium text-fg-strong' : 'border-transparent text-fg-muted hover:text-fg-strong',
        )}
        onClick={() => setConsoleTab(t.id)}
      >
        {t.label}
        {n != null && <Chip value={n} tone={t.id === 'error' && n > 0 ? 'error' : 'muted'} />}
      </button>
    )
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const order = [...DIAG_TABS, ...TOOL_TABS].map((t) => t.id)
    const i = order.indexOf(consoleTab)
    let next: ConsoleTab | null = null
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length]
    else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length]
    else if (e.key === 'Home') next = order[0]
    else if (e.key === 'End') next = order[order.length - 1]
    if (!next) return
    e.preventDefault()
    setConsoleTab(next)
    document.getElementById(`console-tab-${next}`)?.focus()
  }

  return (
    <div className={cn('flex items-stretch', scroll === 'bar' ? 'w-max min-w-full pr-page-m' : 'min-w-0', className)} data-slot="ConsoleTabsBar" data-scroll={scroll}>
      <div
        role="tablist"
        aria-label="控制台"
        data-slot="ConsoleTabs"
        data-testid="console-tabs"
        className={cn(
          'flex items-stretch gap-0 px-2',
          scroll === 'bar' ? 'shrink-0' : 'min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
        onKeyDown={onKeyDown}
      >
        {DIAG_TABS.map(render)}
        <span className="mx-1 my-auto h-4 w-px shrink-0 bg-border" aria-hidden />
        {TOOL_TABS.map(render)}
      </div>
      {pid && (
        <a
          href={`#${deliverHash(pid)}`}
          className={cn('ml-auto flex h-full shrink-0 items-center gap-1 whitespace-nowrap px-2 text-xs text-link hover:underline in-data-[density=touch]:min-h-touch [&_svg]:size-3.5', FOCUS_RING_INSET)}
          data-testid="console-deliver-link"
        >
          递交页{preflightErrors > 0 && <Chip value={preflightErrors} tone="error" />} <ExternalLink aria-hidden />
        </a>
      )}
    </div>
  )
}
