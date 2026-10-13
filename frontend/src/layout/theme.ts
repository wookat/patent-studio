import type { DockviewTheme } from 'dockview-react'

/**
 * dockview 主题（docs/plan/08-r4-dockview-design.md §8）：只有一个 className，浅 / 深色由 `.dark` 下的 Overleaf token 自动翻转
 * （变量映射在 layout/dockview.css）。`colorScheme` 供 dockview 自身决定图标/覆盖层的明暗，随 useIsDark 切换。
 */
export const DOCKVIEW_THEME_CLASS = 'dockview-theme-studio'

export function studioTheme(dark: boolean): DockviewTheme {
  return {
    name: 'studio',
    className: DOCKVIEW_THEME_CLASS,
    colorScheme: dark ? 'dark' : 'light',
    gap: 0,
    dndOverlayMounting: 'absolute',
    dndPanelOverlay: 'group',
  }
}
