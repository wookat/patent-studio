// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { dispatchHotkey, HOTKEYS } from '../hotkeys'
import { bindLayoutHotkeys, LAYOUT_HOTKEYS, layoutHotkeyMap } from '../layoutShortcuts'
import { useStudio, type DockHandle } from '@/store'

function fakeDock(): DockHandle & { calls: string[] } {
  const calls: string[] = []
  const rec = (n: string) => (...a: unknown[]) => void calls.push([n, ...a.filter((x) => x !== undefined).map(String)].join(' '))
  return {
    calls,
    openPanel: rec('open'),
    closePanel: rec('close'),
    focusPanel: rec('focus'),
    focusNext: rec('next'),
    toggleMaximize: rec('max'),
    applyPreset: rec('preset'),
    resetLayout: rec('reset'),
    panelIds: () => [],
    isPanelVisible: () => true,
  }
}

/** Mod-X（jsdom 非 mac → ctrlKey） */
const key = (action: keyof typeof HOTKEYS) => {
  const parts = HOTKEYS[action].split('-')
  return new KeyboardEvent('keydown', {
    key: parts[parts.length - 1],
    ctrlKey: parts.includes('Mod'),
    shiftKey: parts.includes('Shift'),
    cancelable: true,
  })
}

afterEach(() => {
  useStudio.getState().registerDock(null)
  useStudio.setState({ compareLock: false, activePanelId: null })
})

describe('lib/layoutShortcuts（08 §6.4）', () => {
  it('七个 R4 动作全部落到 dockHandle / compareLock（R18：F6 组与 Mod-PageDown 同入口）', () => {
    const dock = fakeDock()
    useStudio.getState().registerDock(dock)
    useStudio.setState({ activePanelId: 'source:claims' })
    const map = layoutHotkeyMap()
    for (const a of LAYOUT_HOTKEYS) map[a]!()
    expect(dock.calls).toEqual(['next 1', 'next -1', 'next 1', 'next -1', 'max', 'close source:claims'])
    expect(useStudio.getState().compareLock).toBe(true)
  })

  it('没有活动面板时 closePanel 不调 dock', () => {
    const dock = fakeDock()
    useStudio.getState().registerDock(dock)
    layoutHotkeyMap().closePanel!()
    expect(dock.calls).toEqual([])
  })

  it('bindLayoutHotkeys 只在 dock 就绪时吞键：未就绪 Mod-PageDown 放行，就绪后命中并 preventDefault，注销后再放行', () => {
    const unbind = bindLayoutHotkeys()
    const e0 = key('nextPanel')
    expect(dispatchHotkey(e0)).toBe(false)
    expect(e0.defaultPrevented).toBe(false)

    const dock = fakeDock()
    useStudio.getState().registerDock(dock)
    const e1 = key('nextPanel')
    expect(dispatchHotkey(e1)).toBe(true)
    expect(e1.defaultPrevented).toBe(true)
    expect(dispatchHotkey(key('maximizePanel'))).toBe(true)
    expect(dispatchHotkey(key('compareLock'))).toBe(true)
    expect(dispatchHotkey(key('nextPanelGroup'))).toBe(true)
    expect(dock.calls).toEqual(['next 1', 'max', 'next 1'])
    expect(useStudio.getState().compareLock).toBe(true)

    useStudio.getState().registerDock(null)
    expect(dispatchHotkey(key('prevPanel'))).toBe(false)

    useStudio.getState().registerDock(dock)
    unbind()
    expect(dispatchHotkey(key('prevPanel'))).toBe(false)
    expect(dock.calls).toEqual(['next 1', 'max', 'next 1'])
  })

  it('不与既有全局键位冲突', () => {
    const seen = new Map<string, string>()
    for (const [a, k] of Object.entries(HOTKEYS)) {
      expect(seen.get(k), `${a} 与 ${seen.get(k)} 同键 ${k}`).toBeUndefined()
      seen.set(k, a)
    }
  })
})
