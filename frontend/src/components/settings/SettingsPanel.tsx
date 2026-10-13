import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNamedLandmarkHost } from '@/components/ui/landmark-host'
import { useStudio } from '@/store'
import { SettingsContent } from './SettingsContent'

/** 左 SettingsNav（--w-settings-nav 200）+ 右表单最少约 360 才摆得开；窄于此（三栏 dock 窄卡）改用分组 Select 的单列形态 */
export const SETTINGS_TWO_COLUMN_MIN_PX = 560

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'

/**
 * 排版设置面板（07 §1 G4 / §2.1；prototype-c `?settings&ok`）：替换编辑器区（ui.settingsOpen），右侧真实 PDF 保持可见。
 * 头 40px：「排版设置」16px 600 · 副文案 12px 灰 · ×（toggleSettings(false)，Esc 同）；
 * 体：SettingsContent——面板宽 ≥ SETTINGS_TWO_COLUMN_MIN_PX 时 variant="desktop"（左 SettingsNav + 右 SettingRow 列表），
 *     更窄（三栏 dock 窄卡）时 variant="mobile"（分组 Select + 搜索 + 更多菜单单列），由 ResizeObserver 量自身宽切换。
 * 可达性：挂载时焦点进入首控件；关闭后焦点还给打开它的元素（⚙ / 菜单项）。
 */
export function SettingsPanel() {
  const toggleSettings = useStudio((s) => s.toggleSettings)
  const dialog = useStudio((s) => s.dialog)
  const ref = useRef<HTMLElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const hosted = useNamedLandmarkHost()
  const [twoColumn, setTwoColumn] = useState(true)

  useEffect(() => {
    const root = ref.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const w = root.getBoundingClientRect().width
      if (w > 0) setTwoColumn(w >= SETTINGS_TWO_COLUMN_MIN_PX)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
    const root = ref.current
    if (!root) return
    const first = root.querySelector<HTMLElement>(TABBABLE) ?? root
    const raf = window.requestAnimationFrame(() => first.focus({ preventScroll: true }))
    return () => {
      window.cancelAnimationFrame(raf)
      const now = document.activeElement
      if ((now === document.body || now === null || root.contains(now)) && opener.current?.isConnected) opener.current.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || dialog) return
      // Radix Select / DropdownMenu / Dialog 打开时由其自身处理 Esc
      if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')) return
      const t = e.target as HTMLElement | null
      // 焦点在编辑器/其他输入框内时不抢 Esc（CodeMirror 用 Esc 关搜索面板）
      if (t && !ref.current?.contains(t) && t !== document.body && t.closest('.cm-editor, input, textarea, select')) return
      e.preventDefault()
      toggleSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSettings, dialog])

  return (
    <section
      ref={ref}
      data-slot="SettingsPanel"
      data-testid="settings-panel"
      aria-labelledby={hosted ? undefined : 'settings-panel-title'}
      data-columns={twoColumn ? 2 : 1}
      tabIndex={-1}
      className="flex h-full min-h-0 min-w-0 flex-col bg-panel outline-none"
    >
      <div className="flex h-topbar shrink-0 items-center gap-3 border-b border-border pl-4 pr-2" data-testid="settings-header">
        <h2 id="settings-panel-title" className="shrink-0 whitespace-nowrap text-lg font-semibold leading-6" data-testid="settings-title">排版设置</h2>
        {twoColumn && <span className="truncate text-xs text-fg-muted">改动即时生效并触发重新构建 · 默认值 = 零漂移基准</span>}
        <Button size="icon-sm" variant="ghost" className="ml-auto shrink-0" onClick={() => toggleSettings(false)} aria-label="关闭设置" title="关闭 (Esc)" data-testid="settings-close"><X /></Button>
      </div>
      <SettingsContent variant={twoColumn ? 'desktop' : 'mobile'} className="min-h-0 flex-1" />
    </section>
  )
}
