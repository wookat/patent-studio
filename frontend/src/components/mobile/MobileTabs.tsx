import { Eye, FolderOpen, MoreHorizontal, PenLine, Sparkles } from 'lucide-react'
import { Count } from '@/components/ui/count'
import { useStudio, selectDirty, selectErrorCount, type MobileTab } from '@/store'
import { FOCUS_RING_INSET, TRANSITION_COLOR, cn } from '@/lib/utils'
import { useTextInputFocused } from './useTextInputFocused'

type NavId = 'files' | MobileTab | 'more'

const TABS: { id: NavId; label: string; Icon: typeof Eye }[] = [
  { id: 'files', label: '案卷', Icon: FolderOpen },
  { id: 'edit', label: '编辑', Icon: PenLine },
  { id: 'preview', label: '预览', Icon: Eye },
  { id: 'ai', label: 'AI', Icon: Sparkles },
  { id: 'more', label: '更多', Icon: MoreHorizontal },
]

/**
 * 底部导航 56（05 §3.19：案卷 · 编辑 · 预览 · AI · 更多）：图标 24 + 11px 标签，选中 = --fg-strong 字 + --link 图标（无胶囊底）；
 * 编辑 ●未保存、AI Count 待处理建议、预览 ●构建中；问题数进「更多」角标（控制台由更多 Sheet 进入，不再占 Tab）。
 * 每格 75×56 ≥ 44。文本输入聚焦时整条隐藏，让快捷键盘贴输入法。
 */
export function MobileTabs() {
  const inputFocused = useTextInputFocused()
  const tab = useStudio((s) => s.mobileTab)
  const setTab = useStudio((s) => s.setMobileTab)
  const settingsOpen = useStudio((s) => s.mobileSettingsOpen)
  const toggleMobileSettings = useStudio((s) => s.toggleMobileSettings)
  const moreOpen = useStudio((s) => s.moreOpen)
  const toggleMore = useStudio((s) => s.toggleMore)
  const navOpen = useStudio((s) => s.mobileNav.open)
  const openMobileNav = useStudio((s) => s.openMobileNav)
  const dirty = useStudio(selectDirty)
  const errors = useStudio(selectErrorCount)
  const pending = useStudio((s) => s.proposals.filter((p) => p.state === 'pending').length)
  const phase = useStudio((s) => s.phase)
  const busy = phase === 'building' || phase === 'queued'
  return (
    <nav
      data-slot="MobileTabs"
      data-testid="mobile-tabs"
      className={cn('grid h-mobile-tabs shrink-0 grid-cols-5 border-t bg-panel pb-[env(safe-area-inset-bottom)]', inputFocused && 'hidden')}
      aria-label="移动端导航"
      data-input-focused={inputFocused || undefined}
      hidden={inputFocused}
    >
      {/* 地标 <nav> 不能兼任 tablist（axe aria-allowed-role / region）：tablist 用 display:contents 包一层，栅格仍由 nav 排 */}
      <div role="tablist" aria-label="移动端导航" className="contents">
        {TABS.map(({ id, label, Icon }) => {
          const active = id === 'more' ? moreOpen : id === 'files' ? navOpen : tab === id && !settingsOpen && !moreOpen && !navOpen
          return (
            <button
              key={id}
              id={`mobile-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={id === 'more' || id === 'files' ? undefined : 'mobile-tabpanel'}
              aria-haspopup={id === 'more' || id === 'files' ? 'dialog' : undefined}
              data-testid={`mobile-tab-${id}`}
              className={cn(
                'flex h-full min-h-touch flex-col items-center justify-center gap-0.5 text-2xs leading-none',
                active ? 'text-fg-strong [&_svg]:text-link' : 'text-fg-muted hover:text-fg',
                FOCUS_RING_INSET,
                TRANSITION_COLOR,
              )}
              onClick={() => {
                if (id === 'more') {
                  toggleMore(!moreOpen)
                  return
                }
                if (id === 'files') {
                  openMobileNav()
                  return
                }
                if (settingsOpen) toggleMobileSettings(false)
                setTab(id)
              }}
            >
              <span className="relative inline-flex">
                <Icon className="size-6" strokeWidth={active ? 2.25 : 1.75} />
                {id === 'edit' && dirty && (
                  <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-warn-dot ring-2 ring-panel" aria-label="有未保存修改" data-testid="tab-dirty-dot" />
                )}
                {id === 'ai' && pending > 0 && (
                  <Count value={pending} max={9} tone="brand" className="absolute -right-3.5 -top-1.5" aria-label={`${pending} 条待处理建议`} data-testid="tab-ai-count" />
                )}
                {id === 'more' && errors > 0 && (
                  <Count value={errors} max={9} tone="danger" className="absolute -right-3.5 -top-1.5" aria-label={`${errors} 个错误`} data-testid="tab-error-dot" />
                )}
                {id === 'preview' && busy && (
                  <span className="absolute -right-1 -top-0.5 size-2 animate-pulse rounded-full bg-warn-dot ring-2 ring-panel motion-reduce:animate-none" aria-label="构建中" />
                )}
              </span>
              <span className={cn(active && 'font-medium')}>{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
