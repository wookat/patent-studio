import { lazy, Suspense, type ReactNode } from 'react'

/**
 * 桌面主区插槽（docs/plan/08-r4-dockview-design.md §2）。
 * DesktopShell 传入现有 SplitPane 三态作为 fallback；dockview 宿主按需加载（lazy），加载期间显示 fallback，
 * 所以 dockview-react / dockview-core 只进独立 chunk，移动壳（不渲染 DockArea）永远不下载它。
 */
const DockviewHost = lazy(() => import('./DockviewHost'))

export interface DockAreaProps {
  fallback: ReactNode
}

export function DockArea({ fallback }: DockAreaProps) {
  return (
    <Suspense fallback={fallback}>
      <DockviewHost />
    </Suspense>
  )
}
