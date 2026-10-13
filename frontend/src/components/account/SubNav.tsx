import { useEffect, useState, type ReactNode } from 'react'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { useIsDesktop } from '@/hooks/useMisc'
import { FOCUS_RING, cn } from '@/lib/utils'

export interface SubNavItem<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  /** 页内锚（`#/account?tab=security`），也用于键盘 / 中键打开 */
  href: string
  'data-testid'?: string
}

/** 读 `#/<page>?tab=<t>`；不在 tabs 内回退 fallback；hashchange 时更新 */
export function readHashTab<T extends string>(tabs: readonly T[], fallback: T): T {
  const q = window.location.hash.split('?')[1] ?? ''
  const t = new URLSearchParams(q).get('tab')
  return tabs.includes(t as T) ? (t as T) : fallback
}

/** tabs 须是模块级常量（effect 依赖按引用比较） */
export function useHashTab<T extends string>(tabs: readonly T[], fallback: T): T {
  const [tab, setTab] = useState<T>(() => readHashTab(tabs, fallback))
  useEffect(() => {
    const on = () => setTab(readHashTab(tabs, fallback))
    on()
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [tabs, fallback])
  return tab
}

export interface SubNavProps<T extends string> {
  items: readonly SubNavItem<T>[]
  value: T
  onValueChange(v: T): void
  'aria-label': string
  className?: string
}

/**
 * 页内二级导航（21 §4.6 账户 / 机构管理）：1440 左列 200（w-side-min）竖排链接，aria-current=page；
 * 375 顶部 Segmented md 放在 ScrollRow 里（06 §3.2 ③：出血到页边，首末 16）：只用文字不带图标，容得下时铺满内容宽（min-w-full，左右 16 对称），
 * 项多时才横向可滑不裁切。切换写 hash（?tab=），刷新 / 后退可恢复。
 */
export function SubNav<T extends string>({ items, value, onValueChange, className, ...rest }: SubNavProps<T>) {
  const desktop = useIsDesktop()
  if (!desktop) {
    const options: SegmentedOption<T>[] = items.map((it) => ({ value: it.value, label: it.label, 'data-testid': it['data-testid'] }))
    return (
      <ScrollRow className={className} data-testid="subnav-mobile">
        <Segmented options={options} value={value} onValueChange={onValueChange} aria-label={rest['aria-label']} className="w-max min-w-full" />
      </ScrollRow>
    )
  }
  return (
    <nav aria-label={rest['aria-label']} className={cn('w-side-min shrink-0', className)} data-testid="subnav-desktop">
      <ul className="grid gap-0.5">
        {items.map((it) => {
          const active = it.value === value
          return (
            <li key={it.value}>
              <a
                href={it.href}
                aria-current={active ? 'page' : undefined}
                data-state={active ? 'on' : 'off'}
                data-testid={it['data-testid']}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  onValueChange(it.value)
                }}
                className={cn(
                  'flex h-md-control items-center gap-2 rounded-sm px-3 text-sm [&_svg]:size-4',
                  FOCUS_RING,
                  active ? 'bg-primary-soft font-medium text-link' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                {it.icon}
                {it.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
