import type { BookName } from '@/types/ast'
import type { Slice } from './types'

/**
 * R4 layout slice（docs/plan/08-r4-dockview-design.md §5）：桌面 dockview 壳与卡片的共享状态。
 * dockview 自身的布局树不进 store（由 layout/persistence.ts 按案卷写 localStorage）；store 只放
 * 各卡片 / 菜单 / 状态栏都要读的少量字段，以及把「打开面板」这类意图转交给 dock 容器的句柄。
 * 移动壳没有 dock：dockHandle 为 null，openPanel 退化为现有 tab / 抽屉动作（见 openPanel 实现）。
 */

/**
 * 面板 kind = 注册表键 = dockview contentComponent 名（layout/registry.ts）。`ai terms oa import` 为轨道 E/F 面板（波次 3 接入）。
 * `settings` = 排版设置（ui.settingsOpen ↔ 该面板存在，由 DockviewHost 同步；旧双栏里它替换编辑器区，dockview 下是源码组里的一张 tab）。
 * `figures` = 附图书（W4-C FigureBookView，docs/figures.md 真源）；Rail 不再有入口，只从文件树 figs/ 与设置页「打开附图书」进。
 * `file` = 文件预览（W4-C FilePreviewPanel：figs/ 与 attachments/ 里点开的文件）；移动端落在 NavDrawer「案卷文件」tab 内。
 * `ai`（W6）/ `review`（W7 domain-04）已下线：只从顶栏伴随栏（CompanionHost）进；持久化布局里的旧面板由 layout/persistence RETIRED_PANEL_KINDS 迁移丢弃。
 */
export const PANEL_KINDS = [
  'source', 'layout', 'pdf', 'console', 'outline', 'history', 'checks', 'search', 'figures', 'settings',
  'terms', 'oa', 'import', 'file',
] as const
export type PanelKind = (typeof PANEL_KINDS)[number]

/** 曾是 dock 面板、现已迁至伴随栏的 kind；旧持久化布局里遇到就丢弃该面板（不报错、不留空组） */
export const RETIRED_PANEL_KINDS: ReadonlySet<string> = new Set(['ai', 'review'])

/** 卡片的「书」维度：单书 = docs/<book>.md 可编辑；all = content.md 只读合并镜像 */
export type BookView = BookName | 'all'
export const BOOK_VIEWS: readonly BookView[] = ['abstract', 'claims', 'description', 'all']

/** 面板 id：`source:claims` `layout:all` `pdf` `outline` …（kind[:book]）；dockview panel id 与之相同 */
export type PanelId = string

/** 预置布局（layout/presets.ts）：默认「源码 | PDF」/ 三书对照 / 权利要求书 ↔ 说明书 / 结构 | PDF / 审阅（全文源码 | PDF，审阅面板在伴随栏）/ AI 辅助 */
export const LAYOUT_PRESET_IDS = ['casework', 'default', 'three-books', 'claims-description', 'layout-pdf', 'review', 'ai-assist'] as const
export type LayoutPresetId = (typeof LAYOUT_PRESET_IDS)[number]

export interface OpenPanelOptions {
  /** 相对某面板放置；缺省 = 加入当前活动组（同组 tab） */
  position?: { referencePanel: PanelId; direction: 'left' | 'right' | 'above' | 'below' | 'within' }
  /** 浮动窗口打开 */
  floating?: boolean
  /** 在该面板原位替换（卡片标题栏「书切换」：同组同位置关旧开新） */
  replace?: PanelId
}

/** dock 容器（layout/DockArea）注册给 store 的命令接口；D1 实现，D2/D3 只经 store 动作调用 */
export interface DockHandle {
  openPanel(id: PanelId, opts?: OpenPanelOptions): void
  closePanel(id: PanelId): void
  focusPanel(id: PanelId): void
  /** 焦点移到下一个 / 上一个面板（按 dockview 面板顺序循环） */
  focusNext(dir: 1 | -1): void
  /** 最大化 / 还原：id 缺省 = 当前活动面板 */
  toggleMaximize(id?: PanelId): void
  /** 装入 layout/presets LAYOUT_PRESETS[id].layout，并按预置的 compareLock 调 setCompareLock */
  applyPreset(id: LayoutPresetId): void
  /** 清除本案持久化布局并回到默认预置 */
  resetLayout(): void
  /** 当前打开的面板 id（含浮动） */
  panelIds(): PanelId[]
  /** 面板在屏上（是其 tab 组的活动 tab）；不存在 → false */
  isPanelVisible(id: PanelId): boolean
}

export interface LayoutSlice {
  dockHandle: DockHandle | null
  /** dockview 当前活动面板（onDidActivePanelChange）；无 dock 时 null */
  activePanelId: PanelId | null
  /** 最近应用的预置；用户拖动改布局后仍保留（用于菜单勾选「基于 X」），resetLayout → DEFAULT_PRESET（ai-assist） */
  layoutPreset: LayoutPresetId
  /** 对照滚动锁（08 §6.3）：两张源码 / 结构卡片按块对齐滚动；由 cards/sync 消费 */
  compareLock: boolean
  /**
   * 当前书：桌面 = 焦点源码 / 结构卡片的书（卡片激活时写入）；移动 = BookSwitcher 选中项（编辑 Tab 显示哪本书）。
   * 状态栏 / 保存动作按它决定「保存本书」还是「保存全文」。'all' = 全文。
   */
  activeBook: BookView
  /**
   * W9 决策 4：版面卡右侧 320 审阅栏。rightRailOpen = ≥1280 常驻列展开 / 折叠（默认展开）；
   * rightRailSheetOpen = <1280（含 375）Sheet 是否打开（默认关，用户点开关才弹）。两者不进 dockview 序列化；
   * 由 workbench/ViewSwitch「审阅栏」与 375 底栏开关按断点选一个切换。
   */
  rightRailOpen: boolean
  rightRailSheetOpen: boolean
  /** 版面卡身自己够宽能容下 320 列（LayoutRightRail 用 ResizeObserver 写；三栏 dock 下的窄卡为 false → ≥ 1280 也退到 Sheet） */
  rightRailColumnFits: boolean
  /**
   * 有人要「把审阅栏亮出来」但版面卡还没量过宽（rightRailColumnFits 仍是默认 true）：
   * 深链 / 审阅模式在案卷加载完的微任务里就选宿主，此时若按列打开而随后实测窄卡退到 Sheet，列不渲染、Sheet 又没开 → 什么都不见。
   * 置位后由下一次 setRightRailColumnFits 结算：退到 Sheet 就顺手把 Sheet 打开；不进持久化。
   */
  rightRailReveal: boolean
  /** dock 面板集合变更计数（open/close/preset/reset；DockviewHost 的 onDidAddPanel/onDidRemovePanel 也应 bump，见 integration_requests）——dockHandle.panelIds() 不是 store 状态，订阅方靳此重取 */
  dockRevision: number

  registerDock(handle: DockHandle | null): void
  setActivePanel(id: PanelId | null): void
  /** 打开（或聚焦已打开的）面板；移动壳退化：source→setActiveBook，console→openConsole，Rail 面板→openMobileNav */
  openPanel(id: PanelId, opts?: OpenPanelOptions): void
  closePanel(id: PanelId): void
  focusPanel(id: PanelId): void
  focusNextPanel(dir: 1 | -1): void
  toggleMaximize(id?: PanelId): void
  applyPreset(id: LayoutPresetId): void
  /** C1/P04：案卷工作区一键三栏（dock 预设 + 左栏 + Agent 伴随栏）；布局不支持时 applyPreset 自身 fail-soft */
  openCasework(): void
  resetLayout(): void
  setCompareLock(on?: boolean): void
  setActiveBook(book: BookView): void
  setRightRailOpen(on?: boolean): void
  setRightRailSheetOpen(on?: boolean): void
  setRightRailColumnFits(fits: boolean): void
  /** 展开常驻列并登记「要亮出来」意图（见 rightRailReveal）；openReviewHost 的 rail-column 分支用 */
  revealRightRail(): void
  bumpDockRevision(): void
}

/** `source:claims` → {kind:'source', book:'claims'}；`pdf` → {kind:'pdf', book:null}；非法 kind → null */
export function parsePanelId(id: PanelId): { kind: PanelKind; book: BookView | null } | null {
  const [kind, book] = id.split(':') as [string, string | undefined]
  if (!(PANEL_KINDS as readonly string[]).includes(kind)) return null
  if (book !== undefined && !(BOOK_VIEWS as readonly string[]).includes(book)) return null
  return { kind: kind as PanelKind, book: (book as BookView | undefined) ?? null }
}

export function makePanelId(kind: PanelKind, book?: BookView | null): PanelId {
  return book ? `${kind}:${book}` : kind
}

const RAIL_KINDS = new Set<PanelKind>(['outline', 'history', 'search', 'figures', 'terms'])

export const layoutSlice: Slice<LayoutSlice> = (set, get) => ({
  dockHandle: null,
  activePanelId: null,
  layoutPreset: 'ai-assist',
  compareLock: false,
  activeBook: 'all',
  rightRailOpen: true,
  rightRailSheetOpen: false,
  rightRailColumnFits: true,
  rightRailReveal: false,
  dockRevision: 0,

  registerDock: (dockHandle) => set({ dockHandle, ...(dockHandle ? {} : { activePanelId: null }) }),
  setActivePanel: (id) => {
    if (get().activePanelId === id) return
    set({ activePanelId: id })
    const p = id ? parsePanelId(id) : null
    if (p && (p.kind === 'source' || p.kind === 'layout')) {
      // 活动卡片即当前编辑视图：editorView 持久化后刷新恢复 / 审阅栏「内嵌 vs Sheet」都读它
      set({ editorView: p.kind, ...(p.book ? { activeBook: p.book } : {}) })
    }
  },

  openPanel: (id, opts) => {
    const s = get()
    if (s.dockHandle) {
      s.dockHandle.openPanel(id, opts)
      s.bumpDockRevision()
      return
    }
    const p = parsePanelId(id)
    if (!p) return
    if (p.kind === 'source' || p.kind === 'layout') {
      s.setActiveBook(p.book ?? 'all')
      if (s.mobileTab !== (p.kind === 'source' ? 'edit' : 'preview')) s.setMobileTab(p.kind === 'source' ? 'edit' : 'preview')
      if (p.kind === 'layout') s.setMobilePreviewKind('layout')
    } else if (p.kind === 'pdf') {
      s.setMobileTab('preview')
      s.setMobilePreviewKind('pdf')
    } else if (p.kind === 'console' || p.kind === 'checks' || p.kind === 'oa') {
      s.openConsole(p.kind === 'console' ? undefined : p.kind)
    } else if (p.kind === 'settings') {
      s.toggleSettings(true)
    } else if (p.kind === 'import') {
      s.openDialog('import-docx')
    } else if (p.kind === 'file') {
      s.openMobileNav()
    } else if (RAIL_KINDS.has(p.kind)) {
      s.openMobileNav(p.kind as 'outline' | 'history' | 'search' | 'figures' | 'terms')
    }
  },
  closePanel: (id) => {
    get().dockHandle?.closePanel(id)
    get().bumpDockRevision()
  },
  focusPanel: (id) => get().dockHandle?.focusPanel(id),
  focusNextPanel: (dir) => get().dockHandle?.focusNext(dir),
  toggleMaximize: (id) => get().dockHandle?.toggleMaximize(id),
  applyPreset: (id) => {
    set({ layoutPreset: id })
    get().dockHandle?.applyPreset(id)
    get().bumpDockRevision()
  },
  resetLayout: () => {
    set({ layoutPreset: 'ai-assist', compareLock: false })
    get().dockHandle?.resetLayout()
    get().bumpDockRevision()
  },
  openCasework: () => {
    /* C1/P04：案卷协作三栏——dock 中正文满列（PDF 按需），左栏文件/材料 + 右栏 Agent 伴随栏同上下文展开。
       复核11：sideFilesCollapsed 持久态可能收着案卷文件块——显式展开保证材料入口真实可见可达。 */
    get().applyPreset('casework')
    if (!get().sideOpen) get().toggleSide(true)
    set({ sideFilesCollapsed: false, railTab: 'outline' })
    get().openCompanion('ai')
  },
  setCompareLock: (on) => set((s) => ({ compareLock: on ?? !s.compareLock })),
  setRightRailOpen: (on) => {
    const next = on ?? !get().rightRailOpen
    // 右侧互斥：展开审阅栏时伴随栏让位（先清让位记录，免得 closeCompanion 反过来恢复另一栏）
    if (next && get().companion) {
      set({ reviewHiddenByCompanion: null })
      get().closeCompanion()
    }
    set({ rightRailOpen: next, ...(next ? null : { rightRailReveal: false }) })
  },
  revealRightRail: () => {
    get().setRightRailOpen(true)
    set({ rightRailReveal: true })
  },
  setRightRailSheetOpen: (on) => {
    const next = on ?? !get().rightRailSheetOpen
    // 审阅 Sheet 打开时导航抽屉 / 更多 Sheet 让位；伴随栏与另两个审阅宿主一样让位（先清让位记录，免得 closeCompanion 反过来恢复另一栏）
    if (next) {
      if (get().mobileNav.open) get().closeMobileNav()
      if (get().moreOpen) get().toggleMore(false)
      if (get().companion) {
        set({ reviewHiddenByCompanion: null })
        get().closeCompanion()
      }
    }
    set({ rightRailSheetOpen: next })
  },
  bumpDockRevision: () => set((s) => ({ dockRevision: s.dockRevision + 1 })),
  setRightRailColumnFits: (fits) => {
    const s = get()
    const handover = s.rightRailReveal && !fits && s.rightRailOpen && !s.rightRailSheetOpen
    if (s.rightRailColumnFits !== fits || s.rightRailReveal) set({ rightRailColumnFits: fits, rightRailReveal: false })
    if (handover) s.setRightRailSheetOpen(true)
  },
  setActiveBook: (activeBook) => {
    if (get().activeBook !== activeBook) set({ activeBook })
  },
})
