import { useEffect } from 'react'
import { Bold } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import { Toggle } from '@/components/ui/toggle'
import { bottomBarActions } from '@/components/workbench/slots'
import { isMarkActive, toggleMarkCmd } from './commands'
import { runOnView, useEditorTick } from './useEditorTick'

/** 375 底部工具栏的 B（bottomBarActions 插槽 id='bold'）：对当前书 EditorView 切换加粗；44 命中 */
export function MobileBoldAction({ view }: { view: EditorView | null }) {
  const bump = useEditorTick(view)
  const on = view ? isMarkActive(view.state, 'strong') : false
  return (
    <Toggle
      size="lg"
      pressed={on}
      disabled={!view}
      aria-label="加粗"
      title="加粗（Ctrl/⌘+B）"
      className="min-h-touch min-w-touch shrink-0 self-center"
      data-testid="mlt-bold"
      onPressedChange={() => runOnView(view, toggleMarkCmd('strong'), bump)}
    >
      <Bold className="size-5" aria-hidden />
    </Toggle>
  )
}

/** 注册 / 注销 375 底栏 B；`enabled=false` 时不占位（MobileLayoutToolbar 显示禁用占位） */
export function useMobileBoldSlot(enabled: boolean, view: EditorView | null) {
  useEffect(() => {
    if (!enabled) return
    return bottomBarActions.register({ id: 'bold', order: 10, render: () => <MobileBoldAction view={view} /> })
  }, [enabled, view])
}
