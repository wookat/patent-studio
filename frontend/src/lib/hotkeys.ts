/**
 * 页面级快捷键注册表（docs/ux/02-ia-layout.md §6）。
 * 键位写法沿用 CodeMirror：`Mod` = Ctrl（Windows/Linux）/ ⌘（macOS）。
 * 这里只提供“单一注册点”骨架；真实绑定（keydown 监听 + 动作接线）由 F1 shell 在 registerHotkeys 上完成。
 */
export const HOTKEYS = {
  save: 'Mod-s',
  build: 'Mod-Enter',
  find: 'Mod-f',
  replace: 'Mod-h',
  undo: 'Mod-z',
  redo: 'Mod-y',
  toggleSettings: 'Mod-,',
  toggleBottom: 'Mod-j',
  toggleOutline: 'Mod-b',
  cycleLayout: 'Mod-\\',
  nextProblem: 'F8',
  prevProblem: 'Shift-F8',
  escape: 'Escape',
  help: '?',
  /** R4 dockview（docs/plan/08 §6.4；D3 接线）：面板焦点轮转 / 最大化 / 关闭 / 对照锁。
   * Mod-PageUp/Down 在 Chrome/Edge 是浏览器级切标签键——不派发给页面（R18-02「按了没反应」实测）；
   * F6/Shift-F6 是可捕获的组间轮转键（同 dockview keyboardNavigation 默认键位），两条都接线。 */
  nextPanel: 'Mod-PageDown',
  prevPanel: 'Mod-PageUp',
  nextPanelGroup: 'F6',
  prevPanelGroup: 'Shift-F6',
  maximizePanel: 'Mod-Shift-m',
  closePanel: 'Mod-Shift-w',
  /** 对照锁（W5 spec §5.2：`Mod-Shift-L`；matchHotkey 大小写不敏感） */
  compareLock: 'Mod-Shift-L',
  /** W4-D 三视图（docs/plan/16 D4；editor/ViewTabs 接线）：当前卡片切到 源码 / 版面 / PDF */
  viewSource: 'Mod-Alt-1',
  viewLayout: 'Mod-Alt-2',
  viewPdf: 'Mod-Alt-3',
  /** W5 三视图（21 §5.2）：源码 → 版面 → PDF 循环；ViewTabs 接线（three-view 单元不改本表） */
  cycleView: 'Mod-Alt-0',
  /** ⌘K 全局命令面板（shell/CommandPalette；输入框内也放行） */
  palette: 'Mod-k',
} as const

export type HotkeyAction = keyof typeof HOTKEYS
export type HotkeyMap = Partial<Record<HotkeyAction, () => void>>

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** 用于 tooltip 的可读写法：Mod-s → Ctrl+S / ⌘S */
export function hotkeyLabel(action: HotkeyAction): string {
  const parts = HOTKEYS[action].split('-')
  return parts
    .map((p) => {
      if (p === 'Mod') return IS_MAC ? '⌘' : 'Ctrl'
      if (IS_MAC && p === 'Shift') return '⇧'
      if (IS_MAC && p === 'Alt') return '⌥'
      return p.length === 1 ? p.toUpperCase() : p
    })
    .join(IS_MAC ? '' : '+')
}

/** 判断一次 keydown 是否命中某键位（不含 CodeMirror 内部已处理的键） */
export function matchHotkey(e: KeyboardEvent, action: HotkeyAction): boolean {
  const parts = HOTKEYS[action].split('-')
  const key = parts[parts.length - 1]
  const mods = new Set(parts.slice(0, -1))
  const wantMod = mods.has('Mod')
  const hasMod = IS_MAC ? e.metaKey : e.ctrlKey
  if (wantMod !== hasMod) return false
  if (mods.has('Shift') !== e.shiftKey && key !== '?') return false
  if (mods.has('Alt') !== e.altKey) return false
  return e.key === key || e.key.toLowerCase() === key.toLowerCase()
}

const registry: HotkeyMap[] = []

/**
 * 注册一组快捷键动作；返回注销函数。
 * 骨架实现：只维护注册表，不监听 keydown（由 F1 在 AppBar/DesktopShell 里接 window keydown → dispatchHotkey）。
 */
export function registerHotkeys(map: HotkeyMap): () => void {
  registry.push(map)
  return () => {
    const i = registry.indexOf(map)
    if (i >= 0) registry.splice(i, 1)
  }
}

/** 把一次 keydown 分发给最近注册的处理器；命中则 preventDefault 并返回 true */
export function dispatchHotkey(e: KeyboardEvent): boolean {
  for (let i = registry.length - 1; i >= 0; i--) {
    for (const action of Object.keys(registry[i]) as HotkeyAction[]) {
      const fn = registry[i][action]
      if (fn && matchHotkey(e, action)) {
        e.preventDefault()
        fn()
        return true
      }
    }
  }
  return false
}
