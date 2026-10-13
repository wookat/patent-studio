import { Monitor, Moon, Rows3, Rows4, Sun } from 'lucide-react'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { useStudio, type Density, type Theme } from '@/store'

const THEME_OPTIONS: readonly SegmentedOption<Theme>[] = [
  { value: 'system', label: '跟随系统', icon: <Monitor aria-hidden /> },
  { value: 'light', label: '浅色', icon: <Sun aria-hidden /> },
  { value: 'dark', label: '深色', icon: <Moon aria-hidden /> },
]

const DENSITY_OPTIONS: readonly SegmentedOption<Density>[] = [
  { value: 'comfortable', label: '舒适', icon: <Rows3 aria-hidden /> },
  { value: 'compact', label: '紧凑', icon: <Rows4 aria-hidden /> },
]

/**
 * 账户 → 外观：主题 / 密度 Segmented（md 档；375 也是 md，命中区由原语 touchHit 补到 44，项等宽铺满）。即时生效并持久化在本机（store/ui），不经服务端，因此无「保存」。
 * 手机始终触控密度，375 不显示密度项。
 */
export function AppearanceSection({ mobile = false }: { mobile?: boolean }) {
  const theme = useStudio((s) => s.theme)
  const setTheme = useStudio((s) => s.setTheme)
  const density = useStudio((s) => s.density)
  const setDensity = useStudio((s) => s.setDensity)
  const segClass = mobile ? 'w-full [&>button]:flex-1' : undefined
  return (
    <section aria-labelledby="account-appearance-h" className="grid gap-4 border-t border-border pt-6" data-testid="account-appearance">
      <header>
        <h3 id="account-appearance-h" className="text-base font-semibold text-fg-strong">
          外观
        </h3>
        <p className="mt-0.5 text-xs text-fg-muted">只影响本浏览器，立即生效。</p>
      </header>
      <div className={mobile ? 'grid gap-1' : 'grid gap-1.5'}>
        <span className="text-xs font-medium text-fg-muted" id="account-theme-label">
          主题
        </span>
        <Segmented<Theme> options={THEME_OPTIONS} value={theme} onValueChange={(v) => setTheme(v)} size="md" aria-label="主题" data-testid="account-theme" className={segClass} />
      </div>
      {!mobile && (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-fg-muted" id="account-density-label">
            密度
          </span>
          <Segmented<Density> options={DENSITY_OPTIONS} value={density} onValueChange={(v) => setDensity(v)} size="md" aria-label="密度" data-testid="account-density" />
        </div>
      )}
    </section>
  )
}
