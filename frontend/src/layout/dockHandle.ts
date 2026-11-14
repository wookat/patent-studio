import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { parsePanelId, useStudio, type DockHandle, type LayoutPresetId, type OpenPanelOptions, type PanelId } from '@/store'
import { describePanel, type PanelParams } from './registry'
import { readHashProjectQuery, writeCompanionHash } from '@/lib/hash'
import { DEFAULT_PRESET, LAYOUT_PRESETS, type LayoutPreset } from './presets'
import { LAYOUT_SAVE_DEBOUNCE_MS, clearLayout, loadLayout, saveLayout } from './persistence'

/**
 * DockviewHost 的非组件部分：装入 / 落盘 / DockHandle（docs/plan/08-r4-dockview-design.md §5 / §7）。
 * 只 `import type` dockview（运行时 api 由宿主 onReady 传入），所以本文件不会把 dockview-core 带进主包。
 */

export interface HostRuntime {
  api: DockviewApi
  /** 装入 / 清空期间不落盘 */
  muted: boolean
  timer: ReturnType<typeof setTimeout> | null
  loadedPid: string | null
  dispose: () => void
}

/** 预置 / 持久化里的 title 只是回退值；装入前按注册表重算（其他轨道改标题不用改预置） */
export function withTitles(layout: SerializedDockview): SerializedDockview {
  const panels: SerializedDockview['panels'] = {}
  for (const [id, p] of Object.entries(layout.panels)) panels[id] = { ...p, title: describePanel(id)?.title ?? p.title }
  return { ...layout, panels }
}

interface BasePanelOptions {
  id: string
  component: string
  params: PanelParams
  title: string
}

function addOptions(id: PanelId): BasePanelOptions | null {
  const d = describePanel(id)
  if (!d) return null
  return { id, component: d.kind, params: d.params, title: d.title }
}

/**
 * 默认值的伴随栏生效点（无持久化布局 = 用户还没定过自己的样子）：已开伴随栏 / 深链 `?panel=` 不抢。
 * store 与 `?panel=` 双写——CompanionHost 的 hash 同步按 hash 判真源，只写一边会因挂载顺序被 apply() 回退。
 */
function openPresetCompanion(preset: LayoutPreset): void {
  if (!preset.companion) return
  if (useStudio.getState().companion || readHashProjectQuery().panel) return
  writeCompanionHash(preset.companion)
  useStudio.getState().openCompanion(preset.companion)
}

function loadPreset(rt: HostRuntime, id: LayoutPresetId): void {
  const preset = LAYOUT_PRESETS[id]
  rt.muted = true
  try {
    rt.api.clear()
    rt.api.fromJSON(withTitles(preset.layout))
  } finally {
    rt.muted = false
  }
  useStudio.setState({ layoutPreset: id, compareLock: preset.compareLock })
  if (preset.companion) useStudio.getState().openCompanion(preset.companion)
}

/** loadLayout(pid) ?? 默认预置 → fromJSON；持久化损坏（JSON / 版本 / 含未注册面板）→ 清掉并回默认 */
export function loadInto(rt: HostRuntime, pid: string | null): void {
  const stored = pid ? loadLayout(pid) : null
  if (pid && !stored) clearLayout(pid)
  rt.muted = true
  try {
    try {
      rt.api.fromJSON(withTitles(stored?.dock ?? LAYOUT_PRESETS[DEFAULT_PRESET].layout))
    } catch {
      if (pid) clearLayout(pid)
      rt.api.clear()
      rt.api.fromJSON(withTitles(LAYOUT_PRESETS[DEFAULT_PRESET].layout))
      useStudio.setState({ layoutPreset: DEFAULT_PRESET, compareLock: false })
      openPresetCompanion(LAYOUT_PRESETS[DEFAULT_PRESET])
      return
    }
    useStudio.setState({ layoutPreset: stored?.preset ?? DEFAULT_PRESET, compareLock: stored?.compareLock ?? false })
    if (!stored) openPresetCompanion(LAYOUT_PRESETS[DEFAULT_PRESET])
  } finally {
    rt.muted = false
    rt.loadedPid = pid
  }
}

export function flushSave(rt: HostRuntime): void {
  if (rt.timer) {
    clearTimeout(rt.timer)
    rt.timer = null
  }
  if (!rt.loadedPid) return
  const s = useStudio.getState()
  saveLayout(rt.loadedPid, { preset: s.layoutPreset, compareLock: s.compareLock, dock: rt.api.toJSON() })
}

export function scheduleSave(rt: HostRuntime): void {
  if (rt.muted || !rt.loadedPid) return
  if (rt.timer) clearTimeout(rt.timer)
  rt.timer = setTimeout(() => flushSave(rt), LAYOUT_SAVE_DEBOUNCE_MS)
}

export const FLOATING_DEFAULTS = { width: 560, height: 420, position: { right: 48, top: 48 } }

/** F6 逃逸链路的落点：`panel.focus()` 对焦到不可聚焦容器会静默落空（R19 真 Chrome 实测焦点掉 `document.body`）；
 * 面板页签（`.dv-tab` 是 role=tab 可聚焦控件）是真实可落点——焦点到页签即「该面板已激活」的可感知信号，
 * 再按 Tab/箭头键即可进面板内容或相邻页签。 */
function focusPanelTab(id: string): void {
  document.querySelector<HTMLElement>(`[data-testid="tab-${id}"]`)?.closest<HTMLElement>('.dv-tab')?.focus()
}

export function createDockHandle(rt: HostRuntime): DockHandle {
  const { api } = rt
  return {
    openPanel(id: PanelId, opts?: OpenPanelOptions) {
      const base = addOptions(id)
      if (!base) return
      const existing = api.getPanel(id)
      if (existing) {
        if (opts?.replace && opts.replace !== id) api.getPanel(opts.replace)?.api.close()
        existing.api.setActive()
        return
      }
      if (opts?.replace) {
        const old = api.getPanel(opts.replace)
        if (old) {
          const index = old.group.panels.indexOf(old)
          api.addPanel({ ...base, position: { referenceGroup: old.group, index } })
          api.removePanel(old)
          return
        }
      }
      if (opts?.floating) {
        api.addPanel({ ...base, floating: FLOATING_DEFAULTS })
        return
      }
      if (opts?.position) {
        const ref = api.getPanel(opts.position.referencePanel)
        if (ref) {
          api.addPanel({ ...base, position: { referencePanel: ref, direction: opts.position.direction } })
          return
        }
      }
      const group = api.activeGroup
      api.addPanel(group ? { ...base, position: { referenceGroup: group } } : base)
    },
    closePanel(id) {
      api.getPanel(id)?.api.close()
    },
    focusPanel(id) {
      const p = api.getPanel(id)
      if (!p) return
      p.api.setActive()
      p.focus()
      focusPanelTab(id)
    },
    focusNext(dir) {
      const panels = api.panels
      if (panels.length === 0) return
      // DOM 焦点所在面板优先：编辑器拿焦时 api.activePanel 可能滞后/置空（R19 实测首按从 -1 起算 → 落回原面板 = 无响应）
      const domIdx = panels.findIndex((p) => p.group.element.contains(document.activeElement))
      const cur = domIdx >= 0 ? domIdx : api.activePanel ? panels.indexOf(api.activePanel) : -1
      const next = panels[(cur + dir + panels.length) % panels.length]
      next.api.setActive()
      next.focus()
      focusPanelTab(next.id)
    },
    toggleMaximize(id) {
      const p = id ? api.getPanel(id) : api.activePanel
      if (!p) return
      if (p.api.isMaximized()) {
        p.api.exitMaximized()
        return
      }
      p.api.setActive()
      p.api.maximize()
    },
    applyPreset(id) {
      loadPreset(rt, id)
      scheduleSave(rt)
    },
    resetLayout() {
      if (rt.timer) clearTimeout(rt.timer)
      rt.timer = null
      if (rt.loadedPid) clearLayout(rt.loadedPid)
      loadPreset(rt, DEFAULT_PRESET)
    },
    panelIds() {
      return api.panels.map((p) => p.id)
    },
    isPanelVisible(id) {
      return api.getPanel(id)?.api.isVisible ?? false
    },
  }
}

/** 旧 ui.layout 三态（08 §1）：editor / preview → 最大化源码 / PDF 组（缺面板时先回默认预置），split → 还原 */
export function applyLegacyLayout(rt: HostRuntime, handle: DockHandle, layout: 'split' | 'editor' | 'preview'): void {
  const { api } = rt
  if (layout === 'split') {
    if (api.hasMaximizedGroup()) api.exitMaximizedGroup()
    return
  }
  const kind = layout === 'editor' ? 'source' : 'pdf'
  const find = () => {
    const matches = api.panels.filter((p) => parsePanelId(p.id)?.kind === kind)
    return matches.find((p) => p.api.isActive) ?? matches[0]
  }
  let target = find()
  if (!target) {
    handle.applyPreset(DEFAULT_PRESET)
    target = find()
  }
  if (!target) return
  target.api.setActive()
  if (!target.api.isMaximized()) target.api.maximize()
}
