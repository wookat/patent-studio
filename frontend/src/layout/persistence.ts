import type { SerializedDockview } from 'dockview-react'
import { RETIRED_PANEL_KINDS, type LayoutPresetId } from '@/store/layout'

/**
 * 布局持久化（docs/plan/08-r4-dockview-design.md §7.2）：按案卷一条 localStorage，与 `patent-studio:ui:v2` 分开——
 * dockview 布局树和 ui 偏好生命周期不同（前者按案卷、可整体重置；后者全局）。
 * 版本号变更即丢弃旧值（不迁移：布局是偏好，不是数据）。
 * W4-D（16 §7）：面板 kind `structure` 改名 `layout`，读入时把旧 id / 组件名 / 预置名重写，旧布局不丢。
 * W7 domain-04：`ai` / `review` 已不是 dock 面板（只在伴随栏），读入时从 panels / grid / 浮动组里剔除，空组随之删掉；
 * 剔到一个面板都不剩时返回 null → 调用方回默认预置。未知组件名不在此处理：dockview fromJSON 抛错 → DockviewHost 清掉并回默认（原有行为）。
 */

export const LAYOUT_STORAGE_VERSION = 1
export const LAYOUT_STORAGE_PREFIX = 'patent-studio:layout:v1:'

export interface StoredLayout {
  v: typeof LAYOUT_STORAGE_VERSION
  /** 最近应用的预置（用户改动后仍记着「基于哪个预置」） */
  preset: LayoutPresetId
  compareLock: boolean
  dock: SerializedDockview
  savedAt: number
}

export function layoutKey(pid: string): string {
  return LAYOUT_STORAGE_PREFIX + pid
}

export function loadLayout(pid: string, storage: Storage = localStorage): StoredLayout | null {
  const raw = storage.getItem(layoutKey(pid))
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<StoredLayout>
    if (v.v !== LAYOUT_STORAGE_VERSION || !v.dock || typeof v.dock !== 'object' || !v.dock.grid || !v.dock.panels) return null
    const renamed = renameStructureToLayout(v as StoredLayout)
    const dock = dropRetiredPanels(renamed.dock)
    return dock ? { ...renamed, dock } : null
  } catch {
    return null
  }
}

type GridNode = SerializedDockview['grid']['root']
type GroupState = Extract<GridNode['data'], { views: string[] }>

function isGroup(data: GridNode['data']): data is GroupState {
  return !Array.isArray(data)
}

/** 面板是否已下线（RETIRED_PANEL_KINDS：曾是 dock 面板、现只在伴随栏） */
export function isRetiredPanel(p: { contentComponent?: string } | undefined): boolean {
  const kind = p?.contentComponent
  return !!kind && RETIRED_PANEL_KINDS.has(kind)
}

function pruneGroup(g: GroupState, keep: (id: string) => boolean): GroupState | null {
  const views = g.views.filter(keep)
  if (views.length === 0) return null
  const activeView = g.activeView && views.includes(g.activeView) ? g.activeView : views[0]
  return { ...g, views, activeView }
}

/** 递归修剪 grid：空叶删、空枝删、单子枝塔平（根除外，dockview 根必须是 branch） */
function pruneGrid(node: GridNode, keep: (id: string) => boolean, root: boolean): GridNode | null {
  if (node.type === 'leaf' && isGroup(node.data)) {
    const g = pruneGroup(node.data, keep)
    return g ? { ...node, data: g } : null
  }
  if (!Array.isArray(node.data)) return null
  const kids = node.data.map((c) => pruneGrid(c, keep, false)).filter((c): c is GridNode => c !== null)
  if (kids.length === 0) return null
  if (kids.length === 1 && !root) return { ...kids[0], size: node.size }
  return { ...node, data: kids }
}

function groupIds(node: GridNode): string[] {
  if (node.type === 'leaf' && isGroup(node.data)) return [node.data.id]
  return Array.isArray(node.data) ? node.data.flatMap(groupIds) : []
}

export function dropRetiredPanels(dock: SerializedDockview): SerializedDockview | null {
  const dead = Object.keys(dock.panels).filter((id) => isRetiredPanel(dock.panels[id]))
  if (dead.length === 0) return dock
  const gone = new Set(dead)
  const keep = (id: string) => !gone.has(id) && id in dock.panels
  const panels = Object.fromEntries(Object.entries(dock.panels).filter(([id]) => keep(id)))
  const root = pruneGrid(dock.grid.root, keep, true)
  if (!root) return null
  const ids = groupIds(root)
  const activeGroup = dock.activeGroup && ids.includes(dock.activeGroup) ? dock.activeGroup : ids[0]
  const out: SerializedDockview = { ...dock, panels, grid: { ...dock.grid, root }, activeGroup }
  if (dock.floatingGroups) {
    out.floatingGroups = dock.floatingGroups.flatMap((f) => {
      if (f.data) {
        const g = pruneGroup(f.data, keep)
        return g ? [{ ...f, data: g }] : []
      }
      if (f.grid) {
        const r = pruneGrid(f.grid.root, keep, true)
        return r ? [{ ...f, grid: { ...f.grid, root: r } }] : []
      }
      return [f]
    })
  }
  if (dock.popoutGroups) {
    out.popoutGroups = dock.popoutGroups.flatMap((p) => {
      if (p.data) {
        const g = pruneGroup(p.data, keep)
        return g ? [{ ...p, data: g }] : []
      }
      if (p.grid) {
        const r = pruneGrid(p.grid.root, keep, true)
        return r ? [{ ...p, grid: { ...p.grid, root: r } }] : []
      }
      return [p]
    })
  }
  return out
}

/** 旧布局里 `structure:<book>` 面板 / `structure` 组件 / `structure-pdf` 预置 → `layout*`；无旧值时原样返回 */
export function renameStructureToLayout(v: StoredLayout): StoredLayout {
  const raw = JSON.stringify(v)
  if (!raw.includes('"structure')) return v
  return JSON.parse(raw.replace(/"structure(:[a-z]+)"/g, '"layout$1"').replace(/"structure"/g, '"layout"').replace(/"structure-pdf"/g, '"layout-pdf"')) as StoredLayout
}

export function saveLayout(pid: string, data: Omit<StoredLayout, 'v' | 'savedAt'>, storage: Storage = localStorage): void {
  const rec: StoredLayout = { v: LAYOUT_STORAGE_VERSION, savedAt: Date.now(), ...data }
  storage.setItem(layoutKey(pid), JSON.stringify(rec))
}

export function clearLayout(pid: string, storage: Storage = localStorage): void {
  storage.removeItem(layoutKey(pid))
}

/** onDidLayoutChange 落盘防抖（拖拽期间事件密集） */
export const LAYOUT_SAVE_DEBOUNCE_MS = 300
