import { registerHotkeys, type HotkeyAction, type HotkeyMap } from './hotkeys'
import { useStudio } from '@/store'

/** R4 布局快捷键（docs/plan/08-r4-dockview-design.md §6.4；D3 所有）；键位在 lib/hotkeys HOTKEYS，此处只接线 */
export const LAYOUT_HOTKEYS: readonly HotkeyAction[] = [
  'nextPanel',
  'prevPanel',
  'nextPanelGroup',
  'prevPanelGroup',
  'maximizePanel',
  'closePanel',
  'compareLock',
]

/** 动作 → store 布局命令（最终落到 dockHandle）；与 ShortcutsDialog 的「布局」段一一对应 */
export function layoutHotkeyMap(): HotkeyMap {
  const s = () => useStudio.getState()
  return {
    nextPanel: () => s().focusNextPanel(1),
    prevPanel: () => s().focusNextPanel(-1),
    nextPanelGroup: () => s().focusNextPanel(1),
    prevPanelGroup: () => s().focusNextPanel(-1),
    maximizePanel: () => s().toggleMaximize(),
    closePanel: () => {
      const { activePanelId, closePanel } = s()
      if (activePanelId) closePanel(activePanelId)
    },
    compareLock: () => s().setCompareLock(),
  }
}

/**
 * 只在 dockHandle 就绪时注册（命中即 preventDefault：Mod-PageDown / Mod-Shift-w 在浏览器里是切标签 / 关窗口，
 * 移动壳与 dockview 未加载时不能被吞掉）。返回注销函数。
 */
export function bindLayoutHotkeys(): () => void {
  let unreg: (() => void) | null = null
  const sync = (ready: boolean) => {
    if (ready && !unreg) unreg = registerHotkeys(layoutHotkeyMap())
    else if (!ready && unreg) {
      unreg()
      unreg = null
    }
  }
  sync(useStudio.getState().dockHandle !== null)
  const unsub = useStudio.subscribe((st, prev) => {
    if ((st.dockHandle !== null) !== (prev.dockHandle !== null)) sync(st.dockHandle !== null)
  })
  return () => {
    unsub()
    sync(false)
  }
}
