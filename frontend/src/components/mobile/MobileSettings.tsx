import { useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { useFocusReturnOnUnmount } from '@/components/ui/focus-return'
import { SettingsContent } from '@/components/settings/SettingsContent'
import { PAGES, type PageId } from '@/components/settings/schema'
import { cn } from '@/lib/utils'
import { useStudio, selectSettingsChanged } from '@/store'

/**
 * 移动排版设置（07 §3 / prototype-c ?mobile&tab=settings）：占满内容区的整屏面板（顶栏 / 状态条 / 底部 Tab 仍在，Tab 无选中）。
 * 头 40：← 返回 · 「排版设置」· 页面下拉 ▾（切换 PAGES，含「模板」「集成」两个整页）· ✕；体：SettingsContent 单列 —— 标签/说明在上、
 * 控件 100% 宽在下，输入高 40（--h-control-mobile）；尾：[恢复默认] [完成]。开关 = ui.mobileSettingsOpen / toggleMobileSettings（与 settingsOpen 同步）。
 * 设置主体复用 settings 单元的 SettingsContent（与桌面同一份 schema / store）。
 * 不是 Radix 弹层：关闭（✕ / ← / 完成 / 全局 Esc）整块卸载，焦点由 useFocusReturnOnUnmount 还给入口链（More 里的「排版设置」→ 底栏「更多」）。
 */
export function MobileSettings({ className }: { className?: string }) {
  const toggleMobileSettings = useStudio((s) => s.toggleMobileSettings)
  const resetSettings = useStudio((s) => s.resetSettings)
  const toast = useStudio((s) => s.toast)
  const pid = useStudio((s) => s.pid)
  const changed = useStudio(selectSettingsChanged)
  const [page, setPage] = useState<PageId>(PAGES[0].id)
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0]
  const el = useRef<HTMLElement>(null)
  useFocusReturnOnUnmount(el)

  return (
    <section ref={el} data-slot="MobileSettings" data-testid="mobile-settings" className={cn('flex h-full min-h-0 flex-col bg-panel', className)} role="region" aria-label="排版设置">
      <header className="flex h-touch shrink-0 items-center gap-1 border-b pl-1 pr-1">
        <Button size="icon-xl" variant="ghost" className="shrink-0" onClick={() => toggleMobileSettings(false)} aria-label="返回" data-testid="settings-back">
          <ArrowLeft className="size-5" />
        </Button>
        <h2 className="min-w-0 shrink-0 truncate text-base font-semibold leading-6">排版设置</h2>
        <Button size="icon-xl" variant="ghost" className="shrink-0" onClick={() => toggleMobileSettings(false)} aria-label="关闭设置" data-testid="settings-close">
          <X className="size-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xl"
              className="ml-auto min-w-0 max-w-[45%] gap-1 px-2 text-xs font-medium text-fg-muted"
              aria-label={`设置页：${current.title}`}
              data-testid="mobile-settings-page-select"
            >
              <span className="truncate">{current.title}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {PAGES.map((p) => (
              <DropdownMenuItem
                key={p.id}
                className="min-h-touch"
                onSelect={() => setPage(p.id)}
                data-testid={`mobile-settings-page-option-${p.id}`}
                aria-current={p.id === page || undefined}
              >
                <span className={cn('flex-1', p.id === page && 'font-semibold text-primary-text')}>{p.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div
        className={cn(
          'min-h-0 flex-1 overflow-hidden',
          // 单列：ItemRow 的 label/desc 在上、控件区在下且 100% 宽；输入/下拉铺满、高 40
          '[&_[data-setting-id]>div]:flex-col [&_[data-setting-id]>div]:items-stretch [&_[data-setting-id]>div]:gap-2',
          '[&_[data-setting-id]>div>div:last-child]:w-full [&_[data-setting-id]>div>div:last-child]:items-stretch',
          '[&_[data-setting-id]>div>div:last-child_div]:w-full [&_[data-setting-id]>div>div:last-child_div]:items-stretch',
          '[&_[data-setting-id]_input]:h-touch [&_[data-setting-id]_input]:w-full',
          '[&_[data-setting-id]_button[role=combobox]]:h-touch [&_[data-setting-id]_button[role=combobox]]:w-full',
          '[&_[data-setting-id]_button[role=switch]]:self-start',
          '[&_[data-testid=settings-groups]>section>button]:h-11',
        )}
        data-testid="mobile-settings-content"
      >
        <SettingsContent className="h-full" tools={false} page={page} onPageChange={setPage} />
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 border-t bg-panel px-4 py-2" data-testid="mobile-settings-footer">
        <Button
          variant="outline"
          size="xl"
          disabled={!pid || !changed}
          onClick={() => {
            resetSettings()
            toast('已恢复默认排版参数（附图选择保留）', 'info')
          }}
          data-testid="settings-reset"
        >
          <RotateCcw />
          恢复默认
        </Button>
        <Button size="xl" onClick={() => toggleMobileSettings(false)} data-testid="settings-done">
          完成
        </Button>
      </div>
    </section>
  )
}
