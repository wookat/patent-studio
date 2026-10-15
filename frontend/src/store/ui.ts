import { goDashboard } from '@/lib/hash'
import { COMPANION_WIDTH_DEFAULT, COMPANION_WIDTH_MAX, COMPANION_WIDTH_MIN, clampCompanionWidth } from '@/components/ui/companion-panel'
import type { BookName } from '@/types/ast'
import type { Slice, Studio } from './types'
import { REVIEW_HOST_FLAG, RIGHT_RAIL_QUERY, selectReviewHost, type ReviewHost } from './reviewHost'

export type Layout = 'split' | 'editor' | 'preview'
export type Theme = 'light' | 'dark' | 'system'
export type BottomTab = 'problems' | 'checks'
/** Rail 面板：案卷与大纲 / 版本历史 / 问题与检查 / 全文搜索 / 附图（R2）/ 审阅（R6：批注 + 修订）（侧栏下块随之切换） */
export type RailTab = 'outline' | 'history' | 'checks' | 'search' | 'figures' | 'review' | 'ai' | 'terms'
/** 07 §2.2：右栏显示 PDF 还是控制台（控制台替换 PDF 区） */
export type PdfView = 'pdf' | 'logs'
/** 控制台 tab：全部 / 错误 / 警告 / 提示 / 回归检查 / OA 答复（体检与 XML 校验已收敛到递交页，W4-E） */
export type ConsoleTab = 'all' | 'error' | 'warning' | 'info' | 'checks' | 'oa'
export const CONSOLE_TABS: readonly ConsoleTab[] = ['all', 'error', 'warning', 'info', 'checks', 'oa']
/** 209 侧栏上下分栏：文件树 / 大纲（保存当前展开的一栏） */
export type SideTab = 'files' | 'outline'
/** 移动底部 Tab（21 §4.3）：编辑 / 预览 / AI / 控制台；'ai' 页面由 mobile-workbench-frontend 单元实现（全屏 Sheet） */
export type MobileTab = 'edit' | 'preview' | 'ai' | 'console'
export type DialogId = 'create' | 'shortcuts' | 'about' | 'rename' | 'duplicate' | 'syntax' | 'convert' | 'import-docx' | 'palette'
/** UI 密度（App 根 data-density）：comfortable = 默认（07 原型尺寸）；compact = 列表/菜单/面板行高与内边距收紧 */
export type Density = 'compact' | 'comfortable'
/**
 * W6 伴随栏（05 §2.9 / S3；DesktopShell 第 4 栅格列，dockview 外侧）：同时只开一个 id。'palette' = ⌘K 命令面板（App 根挂载，dialog 驱动）。
 * 面板 id 由各单元认领（挂点，prep 只定义枚举 + 壳）：ai（ai-panel）/ review · history（collab-review-history）/
 * console · problems · terms · figures · search（shell-workbench）/ deadlines · notify（dashboard 在工作台内的入口）。
 * 业务内容由 shell-workbench 的 CompanionHost 按 id 路由到各单元组件；prep 只提供空面板骨架。
 */
export type CompanionId = 'ai' | 'review' | 'history' | 'console' | 'problems' | 'terms' | 'figures' | 'search' | 'deadlines' | 'notify' | 'lifecycle' | 'proposals' | 'materials'
export const COMPANION_IDS: readonly CompanionId[] = ['ai', 'review', 'history', 'console', 'problems', 'terms', 'figures', 'search', 'deadlines', 'notify', 'lifecycle', 'proposals', 'materials']
export const isCompanionId = (v: unknown): v is CompanionId => typeof v === 'string' && (COMPANION_IDS as readonly string[]).includes(v)
export { COMPANION_WIDTH_DEFAULT, COMPANION_WIDTH_MIN, COMPANION_WIDTH_MAX, clampCompanionWidth }
/** 预览缩放模式：适宽 / 适页 / null = 按 ui.zoom 百分比 */
export type ZoomFit = 'width' | 'page' | null
/** R1 04 §5.1：编辑器区显示源码（CodeMirror）还是只读结构预览（StructureView）；移动端强制 source */
export type EditorView = 'source' | 'layout'
/** R1 04 §5.5：移动端预览页『结构 ｜ PDF』子切换 */
export type MobilePreviewKind = 'layout' | 'pdf'
/** 375 PDF 长按 500ms（21 §4.7 / U8）：three-view 手势层解出块后 dispatch，PdfLongPressSheet 订阅并给出四项动作 */
export interface PdfLongPress {
  book: BookName
  blockId: string
  line?: number
  page?: number
}

/** 桌面断点（02 §1：≥1024 三栏；<1024 移动壳） */
export const DESKTOP_QUERY = '(min-width: 1024px)'
export const isDesktopViewport = () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
/** 07 §3：1024–1279 窄桌面 —— 打开设置时自动折叠侧栏，关闭时恢复 */
export const NARROW_DESKTOP_MAX = 1279
export const isNarrowDesktop = () => isDesktopViewport() && window.innerWidth <= NARROW_DESKTOP_MAX

/** BottomTab（旧）→ ConsoleTab（新）；旧调用方 openBottom 在单元完成前仍能工作 */
export const BOTTOM_TO_CONSOLE: Record<BottomTab, ConsoleTab> = { problems: 'all', checks: 'checks' }
/** ConsoleTab → BottomTab：ConsolePanel 占位阶段包住 BottomPanelBody 时用 */
export const CONSOLE_TO_BOTTOM: Record<ConsoleTab, BottomTab> = {
  all: 'problems', error: 'problems', warning: 'problems', info: 'problems', checks: 'checks', oa: 'problems',
}

/** 会被 dirty 守卫拦截的导航动作（02 §5） */
export type NavAction =
  | { type: 'open-project'; pid: string }
  | { type: 'restore-backup'; name: string }
  | { type: 'create-project'; parent?: { pid: string; title: string } }
  | { type: 'dashboard' }
  | { type: 'custom'; label: string; run: () => void | Promise<void> }

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success' | 'warning'
}

/** 持久化到 localStorage 'patent-studio:ui:v2' 的字段 */
export interface UiPersisted {
  /** 侧栏（rail 右侧 209px）是否展开；`sideOpen` 是它的别名（二者始终相等） */
  outlineOpen: boolean
  /** 旧字段：与 `pdfView === 'logs'` 同步（控制台已替代底部面板） */
  bottomOpen: boolean
  bottomTab: BottomTab
  /** 07 §1 G4：设置面板替换编辑器区（不再是右侧 360px 抽屉） */
  settingsOpen: boolean
  layout: Layout
  theme: Theme
  railTab: RailTab
  zoom: number
  zoomFit: ZoomFit
  pdfView: PdfView
  consoleTab: ConsoleTab
  sideTab: SideTab
  /** 209 侧栏上下分栏：上块占（总高 − 把手）的比例 (0,1) */
  sideSplitRatio: number
  sideFilesCollapsed: boolean
  sideOutlineCollapsed: boolean
  /** 编辑器字号 px（CodeMirror 主题；默认 12） */
  editorFontSize: number
  density: Density
  editorView: EditorView
  mobilePreviewKind: MobilePreviewKind
  /** R1 04 §5.4：大纲中被折叠的节点（AST block id，如 `description/背景技术`）；与 `sideOutlineCollapsed`（整块折叠）无关 */
  outlineCollapsedIds: string[]
  /** R54-01：文件树三组的折叠 id 子集（'docs' | 'figs' | 'attachments'）；缺省 = 全展开 */
  fileTreeCollapsed: string[]
  /** R3 06 §5.1：结构视图可编辑（双击 / Enter 进入块编辑，块间悬浮「+」）；关闭 = R1 只读预览。移动端恒为只读，不看此值 */
  structureEditable: boolean
  /** W6 伴随栏宽度（320–480，默认 360；持久化）；打开与否不持久化（默认关） */
  companionWidth: number
}

export const UI_PERSIST_KEYS: (keyof UiPersisted)[] = [
  'outlineOpen', 'bottomOpen', 'bottomTab', 'settingsOpen', 'layout', 'theme', 'railTab', 'zoom', 'zoomFit',
  'pdfView', 'consoleTab', 'sideTab', 'sideSplitRatio', 'sideFilesCollapsed', 'sideOutlineCollapsed', 'editorFontSize', 'density',
  'editorView', 'mobilePreviewKind', 'outlineCollapsedIds', 'fileTreeCollapsed', 'structureEditable', 'companionWidth',
]

/** 编辑器字号（05 §1.3）：默认 14 / 行高 1.7；最小 11（全站禁 ≤10px） */
export const EDITOR_FONT_MIN = 11
export const EDITOR_FONT_MAX = 20
export const EDITOR_FONT_DEFAULT = 14
export const clampEditorFontSize = (px: number) => Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, Math.round(px)))
export const clampSideSplitRatio = (r: number) => Math.min(0.9, Math.max(0.1, r))

export interface UiSlice extends UiPersisted {
  /** outlineOpen 的别名（新单元用 sideOpen/toggleSide；旧组件用 outlineOpen/toggleOutline） */
  sideOpen: boolean
  /** 窄桌面下因打开设置而自动折叠了侧栏，关闭设置时恢复 */
  sideAutoCollapsed: boolean
  mobileTab: MobileTab
  /** 移动端排版设置全屏 Sheet（与桌面 settingsOpen 分开：桌面设置替换编辑器区，移动是覆层） */
  mobileSettingsOpen: boolean
  dirtyGuard: { pending: NavAction | null }
  dialog: DialogId | null
  /** 「新建分案」上下文：非空时 CreateProjectDialog 以本案为母案建子案（W19 批7） */
  createParent: { pid: string; title: string } | null
  toasts: Toast[]
  /** react-pdf 当前页/总页数（PdfToolbar 展示） */
  pageInfo: { page: number; total: number } | null
  /** 页码跳转请求（seq 递增保证同一页可重复跳），由 PdfPreview 消费 */
  pageRequest: { page: number; seq: number } | null
  /** 适宽/适页时 PdfPreview 回填的实际缩放（相对 A4 100%），供工具条展示 */
  effectiveZoom: number
  /** 预览滚动位置（以“页高+间距”为单位），PdfPreview 卸载/重挂后恢复 */
  previewScroll: number
  /** PDF 内查找条（工具条放大镜 / PDF 区 Ctrl+F） */
  pdfFindOpen: boolean
  /** 大纲点击 → PDF 定位：不开查找条，直接高亮首个命中并滚到（seq 递增；编辑正文后清除） */
  pdfLocate: { query: string; seq: number } | null
  /** 移动端左侧 NavDrawer（大纲/历史/检查/案卷文件）；tab 不复用 railTab（setRailTab 会联动桌面 outlineOpen）。
      'files' 只在 NavDrawer 出现（R99：此前用组件本地 state 顶住） */
  mobileNav: { open: boolean; tab: RailTab | 'files' }
  /** 移动端 ⋯ 更多操作 Sheet */
  moreOpen: boolean
  /** 案件时间线 Drawer（桌面 rail 钮与移动端「更多→时间线」同一开关） */
  timelineOpen: boolean
  /** 批71：时间线「添加备注」草稿——CaseTimelinePanel 随 Drawer 关闭卸载，本地态草稿随实例死；
     null=未在撰写、''=已开撰写未输入（与 replyBodies 键存在语义同契，卸载丢草稿族收口） */
  timelineNote: string | null
  /** 批74：另一页签也开着当前案卷（lib/dupTab 心跳检测）——StatusBar 在协同未连时告警互相覆盖风险 */
  dupTabOther: boolean
  /** 移动端 PDF 长按定位 Sheet（null = 关闭） */
  pdfLongPress: PdfLongPress | null
  /** W6 伴随栏：当前打开的面板 id（null = 关，默认）；同时只开一个 */
  companion: CompanionId | null
  /** <1024 打开伴随栏时自动收起了侧栏，关闭伴随栏时恢复（与 sideAutoCollapsed 同型） */
  companionAutoCollapsedSide: boolean
  /**
   * 右侧同一时刻只留一栏：打开伴随栏时审阅栏让位，关伴随栏时恢复；null = 未让位。
   * 只让位**当前视图 / 视口可见的那个宿主**（selectReviewHost：版面卡列 rightRailOpen / 版面卡 Sheet rightRailSheetOpen / 源码·PDF 的 reviewDrawerOpen）——
   * 三个开关同时为真很常见（rightRailOpen 默认 true 且不随视图清零），按字段顺序让位会关掉看不见的那一个、留下可见的那一个（W12 R9-06 双 Sheet）
   */
  reviewHiddenByCompanion: ReviewHost | null

  /** 打开伴随栏（已开同 id → 不动；不同 id → 切换）；<1024 且侧栏开 → 自动收起侧栏 */
  openCompanion(id: CompanionId): void
  closeCompanion(): void
  /** 同 id 再点 = 关；不同 id = 切换 */
  toggleCompanion(id: CompanionId): void
  setCompanionWidth(px: number): void

  toggleOutline(open?: boolean): void
  /** = toggleOutline */
  toggleSide(open?: boolean): void
  setSideTab(tab: SideTab): void
  setSideSplitRatio(ratio: number): void
  setSideFilesCollapsed(collapsed: boolean): void
  setSideOutlineCollapsed(collapsed: boolean): void
  setEditorFontSize(px: number): void
  setDensity(density: Density): void
  setEditorView(view: EditorView): void
  toggleEditorView(): void
  setMobilePreviewKind(kind: MobilePreviewKind): void
  setStructureEditable(on: boolean): void
  toggleStructureEditable(): void
  locateInPdf(query: string): void
  clearPdfLocate(): void
  /** 切换大纲节点折叠；collapsed 缺省为取反 */
  toggleOutlineCollapsed(id: string, collapsed?: boolean): void
  /** R54-01：切换文件树组折叠（'docs' | 'figs' | 'attachments'）；collapsed 缺省为取反 */
  toggleFileTreeCollapsed(id: string, collapsed?: boolean): void
  /** 旧动作：等价于 setPdfView(open ? 'logs' : 'pdf')（并同步 bottomOpen） */
  toggleBottom(open?: boolean): void
  setBottomTab(tab: BottomTab): void
  /** 旧动作：映射到 openConsole（problems→all，checks→checks，deliver→xml） */
  openBottom(tab: BottomTab): void
  setPdfView(view: PdfView): void
  togglePdfView(): void
  setConsoleTab(tab: ConsoleTab): void
  /** 打开控制台：桌面 → pdfView='logs'；移动 → mobileTab='console'；tab 缺省保持当前 consoleTab */
  openConsole(tab?: ConsoleTab): void
  /** 桌面：设置面板替换编辑器区；≤1279 时打开自动折叠侧栏、关闭恢复。移动壳仍用它控制 MobileSettings（与 toggleMobileSettings 同步） */
  toggleSettings(open?: boolean): void
  toggleMobileSettings(open?: boolean): void
  /** 窗口尺寸变化后重算“设置打开 → 窄桌面折叠侧栏”（DesktopShell resize 监听调用） */
  syncSideAutoCollapse(): void
  setLayout(layout: Layout): void
  cycleLayout(): void
  setTheme(theme: Theme): void
  toggleTheme(): void
  setRailTab(tab: RailTab): void
  setMobileTab(tab: MobileTab): void
  openMobileNav(tab?: RailTab | 'files'): void
  closeMobileNav(): void
  toggleMore(open?: boolean): void
  toggleTimeline(open?: boolean): void
  setTimelineNote(note: string | null): void
  /** 批74：由 lib/dupTab 观察器驱动 */
  setDupTabOther(dup: boolean): void
  setPdfLongPress(target: PdfLongPress | null): void
  setZoom(zoom: number): void
  setZoomFit(fit: ZoomFit): void
  setEffectiveZoom(z: number): void
  setPageInfo(info: { page: number; total: number } | null): void
  /** 清预览侧状态（页码 / 跳转 / 滚动 / 查找）：登出、关案 */
  resetPreview(): void
  requestPage(page: number): void
  consumePageRequest(): void
  setPreviewScroll(v: number): void
  setPdfFindOpen(open: boolean): void
  openDialog(id: DialogId): void
  closeDialog(): void
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: number): void
  /** F8 / Shift+F8：按行号循环跳到下一条 / 上一条可定位的诊断，并打开问题面板 */

  /**
   * dirty 守卫：未保存时把动作挂到 dirtyGuard.pending 并由 DirtyGuardDialog 处理；
   * 已保存则直接执行。
   */
  requestNavigation(action: NavAction): void
  /** DirtyGuardDialog 三选一：save → 保存后执行；discard → 直接执行；cancel → 放弃 */
  resolveNavigation(choice: 'save' | 'discard' | 'cancel'): Promise<void>
  /** 不经守卫直接执行动作（内部/守卫回调用） */
  runNavigation(action: NavAction): Promise<void>
}

const LAYOUTS: Layout[] = ['split', 'editor', 'preview']
let toastSeq = 0

export const uiSlice: Slice<UiSlice> = (set, get) => ({
  outlineOpen: true,
  sideOpen: true,
  sideAutoCollapsed: false,
  bottomOpen: false,
  bottomTab: 'problems',
  settingsOpen: false,
  layout: 'split',
  theme: 'system',
  railTab: 'outline',
  zoom: 1,
  zoomFit: 'width',
  pdfView: 'pdf',
  consoleTab: 'all',
  sideTab: 'outline',
  sideSplitRatio: 0.5,
  sideFilesCollapsed: false,
  sideOutlineCollapsed: false,
  editorFontSize: EDITOR_FONT_DEFAULT,
  density: 'comfortable',
  editorView: 'source',
  mobilePreviewKind: 'layout',
  outlineCollapsedIds: [],
  fileTreeCollapsed: [],
  structureEditable: false,
  mobileTab: 'edit',
  mobileSettingsOpen: false,
  dirtyGuard: { pending: null },
  dialog: null,
  createParent: null,
  toasts: [],
  pageInfo: null,
  pageRequest: null,
  effectiveZoom: 1,
  previewScroll: 0,
  pdfFindOpen: false,
  pdfLocate: null,
  mobileNav: { open: false, tab: 'outline' },
  moreOpen: false,
  timelineOpen: false,
  timelineNote: null,
  dupTabOther: false,
  pdfLongPress: null,
  companion: null,
  companionWidth: COMPANION_WIDTH_DEFAULT,
  companionAutoCollapsedSide: false,
  reviewHiddenByCompanion: null,

  openCompanion: (id) =>
    set((s) => {
      if (s.companion === id) return s
      const next: Partial<Studio> = { companion: id }
      // 右侧互斥：当前可见的审阅宿主让位（已开的伴随栏换 id 时沿用之前记的让位项）
      const hasWindow = typeof window !== 'undefined'
      const host = selectReviewHost(
        s,
        hasWindow ? window.matchMedia(DESKTOP_QUERY).matches : true,
        hasWindow ? window.matchMedia(RIGHT_RAIL_QUERY).matches : true,
      )
      const flag = REVIEW_HOST_FLAG[host]
      if (s[flag]) Object.assign(next, { [flag]: false, reviewHiddenByCompanion: host })
      // 右侧同一时刻只留一栏：协同抽屉（Sheet 覆盖整右侧）与伴随栏互斥
      if (s.collabCenterOpen) Object.assign(next, { collabCenterOpen: false })
      // 时间线抽屉（桌面右侧 320 非模态）同区互斥——与伴随栏并列会互挤
      if (s.timelineOpen) Object.assign(next, { timelineOpen: false })
      // 1024–1279：伴随栏与侧栏互斥（05 §1.10 断点表）；<1024 由 MobileShell/Sheet 呈现，不动侧栏
      const narrow = isNarrowDesktop()
      if (narrow && s.outlineOpen) Object.assign(next, { outlineOpen: false, sideOpen: false, companionAutoCollapsedSide: true })
      return next
    }),
  closeCompanion: () =>
    set((s) => {
      if (s.companion === null) return s
      const next: Partial<Studio> = { companion: null }
      if (s.companionAutoCollapsedSide) Object.assign(next, { companionAutoCollapsedSide: false, outlineOpen: true, sideOpen: true })
      if (s.reviewHiddenByCompanion) Object.assign(next, { [REVIEW_HOST_FLAG[s.reviewHiddenByCompanion]]: true, reviewHiddenByCompanion: null })
      return next
    }),
  toggleCompanion: (id) => (get().companion === id ? get().closeCompanion() : get().openCompanion(id)),
  setCompanionWidth: (px) => set({ companionWidth: clampCompanionWidth(px) }),

  toggleOutline: (open) =>
    set((s) => {
      const next = open ?? !s.outlineOpen
      return { outlineOpen: next, sideOpen: next, sideAutoCollapsed: false }
    }),
  toggleSide: (open) => get().toggleOutline(open),
  setSideTab: (sideTab) => set({ sideTab }),
  setSideSplitRatio: (r) => set({ sideSplitRatio: clampSideSplitRatio(r) }),
  setSideFilesCollapsed: (sideFilesCollapsed) => set({ sideFilesCollapsed, sideTab: sideFilesCollapsed ? 'outline' : 'files' }),
  setSideOutlineCollapsed: (sideOutlineCollapsed) => set({ sideOutlineCollapsed, sideTab: sideOutlineCollapsed ? 'files' : 'outline' }),
  setEditorFontSize: (px) => set({ editorFontSize: clampEditorFontSize(px) }),
  setDensity: (density) => set({ density }),
  setEditorView: (editorView) => set({ editorView }),
  toggleEditorView: () => set((s) => ({ editorView: s.editorView === 'source' ? 'layout' : 'source' })),
  setMobilePreviewKind: (mobilePreviewKind) => set({ mobilePreviewKind }),
  setStructureEditable: (structureEditable) => set({ structureEditable }),
  toggleStructureEditable: () => set((s) => ({ structureEditable: !s.structureEditable })),
  toggleOutlineCollapsed: (id, collapsed) =>
    set((s) => {
      const has = s.outlineCollapsedIds.includes(id)
      const next = collapsed ?? !has
      if (next === has) return s
      return { outlineCollapsedIds: next ? [...s.outlineCollapsedIds, id] : s.outlineCollapsedIds.filter((x) => x !== id) }
    }),
  toggleFileTreeCollapsed: (id, collapsed) =>
    set((s) => {
      const has = s.fileTreeCollapsed.includes(id)
      const next = collapsed ?? !has
      if (next === has) return s
      return { fileTreeCollapsed: next ? [...s.fileTreeCollapsed, id] : s.fileTreeCollapsed.filter((x) => x !== id) }
    }),
  toggleBottom: (open) => get().setPdfView((open ?? get().pdfView !== 'logs') ? 'logs' : 'pdf'),
  setBottomTab: (bottomTab) => set({ bottomTab, consoleTab: BOTTOM_TO_CONSOLE[bottomTab] }),
  openBottom: (bottomTab) => get().openConsole(BOTTOM_TO_CONSOLE[bottomTab]),
  setPdfView: (pdfView) => set({ pdfView, bottomOpen: pdfView === 'logs' }),
  togglePdfView: () => get().setPdfView(get().pdfView === 'logs' ? 'pdf' : 'logs'),
  setConsoleTab: (consoleTab) => set({ consoleTab, bottomTab: CONSOLE_TO_BOTTOM[consoleTab] }),
  openConsole: (tab) => {
    const s = get()
    const consoleTab = tab ?? s.consoleTab
    const bottomTab = CONSOLE_TO_BOTTOM[consoleTab]
    if (isDesktopViewport()) set({ consoleTab, bottomTab, pdfView: 'logs', bottomOpen: true })
    else set({ consoleTab, bottomTab, mobileTab: 'console', moreOpen: false, mobileNav: { ...s.mobileNav, open: false } })
  },
  toggleSettings: (open) => {
    const s = get()
    const next = open ?? !s.settingsOpen
    if (next === s.settingsOpen) return
    if (!isDesktopViewport()) {
      set({ settingsOpen: next, mobileSettingsOpen: next })
      return
    }
    if (next) {
      const collapse = isNarrowDesktop() && s.outlineOpen
      set({
        settingsOpen: true,
        mobileSettingsOpen: false,
        ...(collapse ? { outlineOpen: false, sideOpen: false, sideAutoCollapsed: true } : {}),
      })
    } else {
      set({
        settingsOpen: false,
        mobileSettingsOpen: false,
        ...(s.sideAutoCollapsed ? { outlineOpen: true, sideOpen: true } : {}),
        sideAutoCollapsed: false,
      })
    }
  },
  toggleMobileSettings: (open) => {
    const next = open ?? !get().mobileSettingsOpen
    set({ mobileSettingsOpen: next, settingsOpen: next })
  },
  syncSideAutoCollapse: () => {
    const s = get()
    if (!s.settingsOpen || !isDesktopViewport()) return
    if (isNarrowDesktop() && s.outlineOpen) set({ outlineOpen: false, sideOpen: false, sideAutoCollapsed: true })
    else if (!isNarrowDesktop() && s.sideAutoCollapsed) set({ outlineOpen: true, sideOpen: true, sideAutoCollapsed: false })
  },
  setLayout: (layout) => set({ layout }),
  cycleLayout: () => set((s) => ({ layout: LAYOUTS[(LAYOUTS.indexOf(s.layout) + 1) % LAYOUTS.length] })),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => {
    const cur = get().theme
    const dark =
      cur === 'dark' || (cur === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    set({ theme: dark ? 'light' : 'dark' })
  },
  setRailTab: (railTab) =>
    set((s) => {
      const open = s.railTab === railTab ? !s.outlineOpen : true
      return { railTab, outlineOpen: open, sideOpen: open, sideAutoCollapsed: false }
    }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  openMobileNav: (tab) =>
    set((s) => ({
      // 「审阅」页签是启动器（挂载即开审阅 Sheet 并关抽屉），不能作为记住的页签，否则再开抽屉会被立刻关掉
      mobileNav: { open: true, tab: tab ?? (s.mobileNav.tab === 'review' ? 'outline' : s.mobileNav.tab) },
      moreOpen: false,
      ...(s.reviewDrawerOpen ? { reviewDrawerOpen: false } : null),
      ...(s.rightRailSheetOpen ? { rightRailSheetOpen: false } : null),
    })),
  closeMobileNav: () => set((s) => (s.mobileNav.open ? { mobileNav: { ...s.mobileNav, open: false } } : s)),
  toggleMore: (open) => set((s) => ({ moreOpen: open ?? !s.moreOpen })),
  toggleTimeline: (open) => {
    const next = open ?? !get().timelineOpen
    // 开启时与伴随栏同区互斥（时间线抽屉占右栏 320）；走 closeCompanion 复原让位项
    if (next && get().companion) get().closeCompanion()
    set({ timelineOpen: next })
  },
  setTimelineNote: (note) => set({ timelineNote: note }),
  setDupTabOther: (dup) => set({ dupTabOther: dup }),
  setPdfLongPress: (pdfLongPress) => set({ pdfLongPress }),
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.5, Math.round(zoom * 100) / 100)) }),
  setZoomFit: (zoomFit) => set({ zoomFit }),
  setEffectiveZoom: (effectiveZoom) => set((s) => (s.effectiveZoom === effectiveZoom ? s : { effectiveZoom })),
  setPageInfo: (pageInfo) => set({ pageInfo }),
  resetPreview: () => set({ pageInfo: null, pageRequest: null, previewScroll: 0, pdfFindOpen: false, pdfLocate: null }),
  requestPage: (page) => set((s) => ({ pageRequest: { page, seq: (s.pageRequest?.seq ?? 0) + 1 } })),
  consumePageRequest: () => set({ pageRequest: null }),
  setPreviewScroll: (previewScroll) => set((s) => (s.previewScroll === previewScroll ? s : { previewScroll })),
  setPdfFindOpen: (pdfFindOpen) => set({ pdfFindOpen }),
  locateInPdf: (query) => set((s) => ({ pdfLocate: { query, seq: (s.pdfLocate?.seq ?? 0) + 1 } })),
  clearPdfLocate: () => set((s) => (s.pdfLocate ? { pdfLocate: null } : s)),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  toast: (text, kind = 'info') => {
    // R89：网络层失败（fetch TypeError）已由 api.netFetch 全局 toast 过——调用方再把原文拼进「X失败：…」会双报；
    // 按 fetch 失败文案特征过滤（非 fetch 的 TypeError 如属性访问错误照常报）
    if (kind === 'error' && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(text)) return
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 5000 : 2500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  requestNavigation: (action) => {
    const s = get()
    // 与 selectDirty 同口径：协同在线时正文由房间落盘，content/saved 差异不是「未保存」
    if (s.collabStatus === 'off' && s.content !== s.saved) set({ dirtyGuard: { pending: action } })
    else void s.runNavigation(action)
  },

  resolveNavigation: async (choice) => {
    const { dirtyGuard, save, runNavigation } = get()
    const action = dirtyGuard.pending
    set({ dirtyGuard: { pending: null } })
    if (!action || choice === 'cancel') return
    if (choice === 'save') {
      const ok = await save()
      if (!ok) return
    } else {
      // 放弃 = 正文回到已落盘版本；否则回面板再开同一案（openProject 同 pid 早退）会带回被放弃的编辑
      const s = get()
      if (s.content !== s.saved) {
        set({ content: s.saved, contentEditedAt: 0 })
        s.scheduleAst()
        s.scheduleMarks()
        s.clearPdfLocate()
      }
    }
    await runNavigation(action)
  },

  runNavigation: async (action) => {
    const s = get()
    switch (action.type) {
      case 'open-project':
        await s.openProject(action.pid)
        break
      case 'restore-backup':
        await s.restore(action.name)
        break
      case 'create-project':
        set({ createParent: action.parent ?? null })
        s.openDialog('create')
        break
      case 'dashboard':
        goDashboard()
        break
      case 'custom':
        // custom run 的失败无人兜底（如 viewer 点恢复 → 403）：统一 toast，不再裸抛 unhandled rejection
        try {
          await action.run()
        } catch (e) {
          s.toast(`${action.label}失败：${e instanceof Error ? e.message : String(e)}`, 'error')
        }
        break
    }
  },
})
