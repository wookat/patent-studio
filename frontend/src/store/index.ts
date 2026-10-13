import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { abstractNearThreshold } from '@/lib/abstractLimit'
import { acceptCritic } from '@/components/layout-view/review/criticParse'
import { paragraphAtLine } from '@/lib/outline'
import type { Studio } from './types'
import { projectSlice } from './project'
import { docSlice } from './doc'
import { buildSlice, clampDebounceMs, type BuildSlice } from './build'
import { diagnosticsSlice } from './diagnostics'
import { checksSlice } from './checks'
import { deliverSlice } from './deliver'
import { CONSOLE_TABS, CONSOLE_TO_BOTTOM, UI_PERSIST_KEYS, clampCompanionWidth, clampEditorFontSize, clampSideSplitRatio, uiSlice, type ConsoleTab, type UiPersisted } from './ui'
import { astSlice } from './ast'
import { figuresSlice } from './figures'
import { preflightSlice } from './preflight'
import { blocksSlice } from './blocks'
import { authSlice } from './auth'
import { commentsSlice } from './comments'
import { historySlice } from './history'
import { reviewSlice } from './review'
import { layoutSlice } from './layout'
import { splitBooks } from '@/lib/docset'
import type { BookName } from '@/types/ast'
import { ROLE_RANK } from '@/lib/types'
import { aiSlice } from './ai'
import { termsSlice } from './terms'
import { convertSlice } from './convert'
import { oaSlice } from './oa'
import { mcpSlice } from './mcp'
import { templatesSlice } from './templates'
import { importerSlice } from './importer'
import { collabSlice } from './collab'
import { dashboardSlice } from './dashboard'
import { figuresBookSlice } from './figuresBook'
import { attachmentsSlice } from './attachments'
import { collabCenterSlice } from './collabCenter'
import { layoutViewSlice } from './layoutView'
import { accountSlice } from './account'
import { focusSlice } from './focus'
import { AGENT_TABS, agentSlice, type AgentSlice, type AgentTab } from './agent'
import { deadlinesSlice } from './deadlines'
import { notifySlice } from './notify'
import { publicShareSlice } from './publicShare'
import { adminSlice } from './admin'

/**
 * 键名 v2（方案 C）：新增 pdfView / consoleTab / sideTab；v1 的布局偏好不迁移（壳网格已变）。
 * version 3（W4-E）：控制台去掉 xml / preflight tab（收敛到递交页），旧 consoleTab 迁移为 'all'；键名不变，其余偏好保留。
 * version 4（W5 prep）：新增 agentTab（AI 面板当前 tab）；旧快照无该字段 ⇒ 'chat'；MobileTab 增 'ai'（不持久化，无需迁移）。
 */
export const UI_STORAGE_KEY = 'patent-studio:ui:v2'
export const UI_STORAGE_VERSION = 4

/** 持久化字段 = ui slice 的布局偏好 + build.debounceMs（设置 › 偏好 › 构建防抖）+ agent.agentTab */
type Persisted = UiPersisted & Pick<BuildSlice, 'debounceMs'> & Pick<AgentSlice, 'agentTab'>
const PERSIST_KEYS: (keyof Persisted)[] = [...UI_PERSIST_KEYS, 'debounceMs', 'agentTab']

/**
 * 单一 store = 多个 slice 平铺（docs/ux/05-architecture.md §2；R1 加 ast slice，见 docs/plan/04-r1-design.md §5.3）。
 * - subscribeWithSelector：允许 hooks/组件外按字段订阅（如 beforeunload 守卫、hash 路由）
 * - persist：只把 ui slice 的布局偏好写入 localStorage，其余（doc/build/diagnostics）永不持久化
 */
export const useStudio = create<Studio>()(
  subscribeWithSelector(
    persist(
      (...a) => ({
        ...projectSlice(...a),
        ...docSlice(...a),
        ...buildSlice(...a),
        ...diagnosticsSlice(...a),
        ...checksSlice(...a),
        ...deliverSlice(...a),
        ...uiSlice(...a),
        ...astSlice(...a),
        ...figuresSlice(...a),
        ...preflightSlice(...a),
        ...blocksSlice(...a),
        ...authSlice(...a),
        ...commentsSlice(...a),
        ...historySlice(...a),
        ...reviewSlice(...a),
        ...layoutSlice(...a),
        ...aiSlice(...a),
        ...termsSlice(...a),
        ...convertSlice(...a),
        ...oaSlice(...a),
        ...mcpSlice(...a),
        ...templatesSlice(...a),
        ...importerSlice(...a),
        ...collabSlice(...a),
        ...dashboardSlice(...a),
        ...figuresBookSlice(...a),
        ...attachmentsSlice(...a),
        ...collabCenterSlice(...a),
        ...layoutViewSlice(...a),
        ...accountSlice(...a),
        ...focusSlice(...a),
        ...agentSlice(...a),
        ...deadlinesSlice(...a),
        ...notifySlice(...a),
        ...publicShareSlice(...a),
        ...adminSlice(...a),
      }),
      {
        name: UI_STORAGE_KEY,
        version: UI_STORAGE_VERSION,
        migrate: (persisted, version) => {
          let s = persisted as Partial<Persisted>
          if (version < 3 && !CONSOLE_TABS.includes(s.consoleTab as ConsoleTab)) s = { ...s, consoleTab: 'all' as const }
          if (version < 4 || !AGENT_TABS.includes(s.agentTab as AgentTab)) s = { ...s, agentTab: 'chat' as const }
          return s
        },
        partialize: (s): Persisted =>
          Object.fromEntries(PERSIST_KEYS.map((k) => [k, s[k]])) as unknown as Persisted,
        /** 恢复后同步别名字段：sideOpen = outlineOpen，bottomOpen = (pdfView === 'logs')；数值偏好带范围归一 */
        merge: (persisted, current) => {
          const s = { ...current, ...(persisted as Partial<Persisted>) }
          return {
            ...s,
            sideOpen: s.outlineOpen,
            bottomOpen: s.pdfView === 'logs',
            bottomTab: CONSOLE_TO_BOTTOM[s.consoleTab] ?? s.bottomTab,
            debounceMs: clampDebounceMs(Number.isFinite(s.debounceMs) ? s.debounceMs : current.debounceMs),
            editorFontSize: clampEditorFontSize(Number.isFinite(s.editorFontSize) ? s.editorFontSize : current.editorFontSize),
            sideSplitRatio: clampSideSplitRatio(Number.isFinite(s.sideSplitRatio) ? s.sideSplitRatio : current.sideSplitRatio),
            // W4-D：旧值 'structure'（结构视图）= 现在的 'layout'（版面视图）
            editorView: (s.editorView as string) === 'layout' || (s.editorView as string) === 'structure' ? 'layout' : 'source',
            mobilePreviewKind: s.mobilePreviewKind === 'pdf' ? 'pdf' : 'layout',
            structureEditable: s.structureEditable === true,
            companionWidth: clampCompanionWidth(Number.isFinite(s.companionWidth) ? s.companionWidth : current.companionWidth),
            outlineCollapsedIds: Array.isArray(s.outlineCollapsedIds)
              ? s.outlineCollapsedIds.filter((x): x is string => typeof x === 'string')
              : [],
            fileTreeCollapsed: Array.isArray(s.fileTreeCollapsed)
              ? s.fileTreeCollapsed.filter((x): x is string => typeof x === 'string')
              : [],
            agentTab: AGENT_TABS.includes(s.agentTab) ? s.agentTab : current.agentTab,
          }
        },
      },
    ),
  ),
)

export type { Studio } from './types'
export type { ProjectSlice } from './project'
export { SCROLL_REQUEST_FRESH_MS } from './doc'
export type { DocSlice, Cursor, EditorHandle, EditorSnippetKind, ScrollRequest } from './doc'
export type { BuildSlice, BuildPhase, BuildReason } from './build'
export { DEBOUNCE_MS, DEBOUNCE_MIN, DEBOUNCE_MAX, clampDebounceMs } from './build'
export type { DiagnosticsSlice } from './diagnostics'
export type { ChecksSlice, LintRun, CheckAllRun } from './checks'
export type { DeliverSlice } from './deliver'
export type {
  UiSlice, UiPersisted, Layout, Theme, BottomTab, RailTab, MobileTab, PdfView, ConsoleTab, SideTab, DialogId, Density, NavAction, Toast, ZoomFit,
  EditorView, MobilePreviewKind, PdfLongPress,
} from './ui'
export type { AstSlice, ActiveBlock, ActiveBlockSource } from './ast'
export { AST_DEBOUNCE_MS, selectAstStale } from './ast'
export type { FiguresSlice } from './figures'
export type { PreflightSlice } from './preflight'
export { selectPreflightStale } from './preflight'
export type { BlocksSlice } from './blocks'
export { spliceBlock, blockSource, findBlockLines } from './blocks'
export type { AuthSlice, AuthStatus } from './auth'
export type { CommentsSlice } from './comments'
export { selectOpenCommentCount } from './comments'
export type { HistorySlice } from './history'
export type { ReviewSlice } from './review'
export { MARKS_DEBOUNCE_MS, applyMarks } from './review'
export type { LayoutSlice, PanelKind, PanelId, BookView, LayoutPresetId, DockHandle, OpenPanelOptions } from './layout'
export { PANEL_KINDS, BOOK_VIEWS, LAYOUT_PRESET_IDS, parsePanelId, makePanelId } from './layout'
export type { AiSlice } from './ai'
export { selectAiEnabled, selectAiRunning } from './ai'
export type { TermsSlice } from './terms'
export { selectTermIssueCount } from './terms'
export type { DashboardSlice, DashScope, DashView } from './dashboard'
export { selectDashboardRows, selectDueRows } from './dashboard'
export type { ConvertSlice, ConvertStep } from './convert'
export { selectConvertJob, selectConvertResult } from './convert'
export type { OaSlice } from './oa'
export { selectOaJob } from './oa'
export type { McpSlice } from './mcp'
export type { TemplatesSlice } from './templates'
export type { ImporterSlice, ImportPhase } from './importer'
export type { CollabSlice, CollabStatus, CollabPeer } from './collab'
export { selectCollabActive } from './collab'
export type { FiguresBookSlice } from './figuresBook'
export { FIG_WIDTH_MIN, FIG_WIDTH_MAX, clampFigWidth } from './figuresBook'
export type { AttachmentsSlice } from './attachments'
export type { CollabCenterSlice } from './collabCenter'
export type { AccountSlice } from './account'
export { selectEditorMode, selectCanSwitchMode, selectOnlineCount, selectCanManage, peerNameOf } from './collabCenter'
export type { LayoutViewSlice, LayoutViewToolbar } from './layoutView'
export type { FocusSlice } from './focus'
export type { AgentSlice, AgentTab } from './agent'
export { AGENT_TABS, selectProposalsPending, selectAgentRunning } from './agent'
export type { DeadlinesSlice, DeadlinesFilter } from './deadlines'
export type { NotifySlice } from './notify'
export type { PublicShareSlice } from './publicShare'
export { GUEST_NAME_KEY } from './publicShare'
export type { AdminSlice } from './admin'
export {
  DESKTOP_QUERY, isDesktopViewport, NARROW_DESKTOP_MAX, isNarrowDesktop, BOTTOM_TO_CONSOLE, CONSOLE_TO_BOTTOM,
  EDITOR_FONT_MIN, EDITOR_FONT_MAX, EDITOR_FONT_DEFAULT, clampEditorFontSize, clampSideSplitRatio,
  COMPANION_IDS, isCompanionId, COMPANION_WIDTH_DEFAULT, COMPANION_WIDTH_MIN, COMPANION_WIDTH_MAX, clampCompanionWidth,
} from './ui'
export type { CompanionId } from './ui'

/* ---------- 派生 selector（用法：useStudio(selectDirty)） ---------- */

/**
 * 只读壳（R6 viewer）：后端 `GET /api/projects/{pid}` 带 role（AUTH=on）或 /collab 探测 readonly。
 * 编辑器 / 卡片 / 结构视图 / 保存 / AI 改写等写动作全部以此为准；服务端仍独立 403。
 * 源码编辑器锁定：viewer 与 reviewer 一律只读（14 D5.2：reviewer 的协同 Channel 只读，建议经版面视图 toCritic → HTTP 落盘），
 * 角色一到就锁，不等 GET /collab 返回 collabReadonly，避免加载后短暂可键入却被丢弃的窗口。
 */
export const selectReadonly = (s: Studio) =>
  !selectRoleKnown(s) || s.project?.role === 'viewer' || s.project?.role === 'reviewer' || s.collabReadonly

/** GET /api/projects/{pid} 已返回当前案的角色；openProject 发出到返回之前视为未知→上锁 */
export const selectRoleKnown = (s: Pick<Studio, 'projectLoading'>) => !s.projectLoading

/**
 * 能否改段落 / 标题样式（studio.json.style，经 PUT /settings）：需 editor 及以上（服务端同口径 403）。
 * reviewer / viewer 与只读协同一律不可；`project.role` 缺省（AUTH=off）视为可改。
 */
export const selectCanEditStyle = (s: Pick<Studio, 'project' | 'projectLoading' | 'collabReadonly'>) =>
  selectRoleKnown(s) && !s.collabReadonly && (!s.project?.role || ROLE_RANK[s.project.role] >= ROLE_RANK.editor)

/** 有未保存修改；协同已连接时由服务端去抖写盘，不存在本地脏态；只读角色无脏态 */
export const selectDirty = (s: Studio) => s.collabStatus === 'off' && !selectReadonly(s) && s.content !== s.saved

/** splitBooks 结果按文本记忆化：selector 在每次 store 变更（按键/cursor/toast）都会评估，重复整篇切分浪费；
 * content / saved / serverContent 三路并发，Map 保 4 个最近源（插入序驱逐） */
const splitMemo = new Map<string, ReturnType<typeof splitBooks>['books']>()
const memoSplitBooks = (source: string) => {
  const hit = splitMemo.get(source)
  if (hit) {
    splitMemo.delete(source)
    splitMemo.set(source, hit)
    return hit
  }
  const books = splitBooks(source).books
  splitMemo.set(source, books)
  if (splitMemo.size > 4) splitMemo.delete(splitMemo.keys().next().value as string)
  return books
}

/** 服务端已落盘全文的某书切片（'content' = 全文）；协同关闭或无记录时为 null，编辑器据此跳过对 Y.Text 的重复写入 */
export const selectServerSlice = (book: BookName | 'content') => (s: Studio): string | null => {
  if (s.serverContent === null) return null
  if (book === 'content') return s.serverContent
  return memoSplitBooks(s.serverContent)[book]?.text ?? null
}

/** R4：某一书有未保存修改（卡片 tab 脏标）；非规范文件退化为全文 dirty */
export const selectBookDirty = (book: BookName) => (s: Studio) => {
  if (!selectDirty(s)) return false
  const a = memoSplitBooks(s.content)[book]
  const b = memoSplitBooks(s.saved)[book]
  return !a || !b ? true : a.text !== b.text
}

/**
 * 预览落后于编辑：最近构建失败仍显示上次成功 PDF，
 * 或当前编辑晚于 lastOk 对应的编辑时刻（构建仍在路上）。
 */
export const selectStale = (s: Studio) =>
  s.stale || (s.lastOk !== null && s.lastOkEditAt !== null && s.contentEditedAt > s.lastOkEditAt)

export interface AbstractLive {
  chars: number
  limit: number
  over: boolean
  /** 接近上限（≥ 95%，且未超限）：与 abstractLint ABSTRACT_NEAR_RATIO 同阈，UI 用警告色 */
  near: boolean
}

let abstractMemo: { content: string; limit: number; value: AbstractLive } | null = null

/**
 * 摘要实时字数（含标点、不含空白；对应 patent_studio.kernel 300 字上限）。
 * 按 (content, limit) 缓存结果对象，直接 useStudio(selectAbstractLive) 不会因返回新对象而无限重渲染。
 */
export const selectAbstractLive = (s: Studio): AbstractLive => {
  const limit = s.settings?.abstract_limit ?? 300
  if (abstractMemo && abstractMemo.content === s.content && abstractMemo.limit === limit) return abstractMemo.value
  const lines = s.content.split('\n')
  const start = lines.findIndex((l) => /^#{1,3}\s*摘要\s*$/.test(l))
  let body = ''
  if (start >= 0) {
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => /^#{1,3}\s/.test(l))
    body = (end >= 0 ? rest.slice(0, end) : rest).join('\n')
  }
  const chars = acceptCritic(body).replace(/\s+/g, '').length
  const value = { chars, limit, over: chars > limit, near: chars <= limit && chars >= abstractNearThreshold(limit) }
  abstractMemo = { content: s.content, limit, value }
  return value
}

/** 排版设置相对默认值有改动（style 覆盖 / abstract_limit / sub_except；附图选择不计） */
export const selectSettingsChanged = (s: Studio): boolean => {
  const st = s.settings
  if (!st) return false
  const d = s.defaultSettings
  const subDefault = d?.sub_except ?? ['tsf_guard', 'on_matured']
  const sub = st.sub_except ?? subDefault
  return (
    Object.keys(st.style ?? {}).length > 0 ||
    st.abstract_limit !== (d?.abstract_limit ?? 300) ||
    sub.length !== subDefault.length ||
    sub.some((w, i) => w !== subDefault[i])
  )
}

/** 光标所在说明书段号（[0012] → 12；来自 /ast 的 para_no）；不在编号段内或 AST 尚未返回为 null。 */
export const selectCursorPara = (s: Studio): number | null => paragraphAtLine(s.ast, s.cursor.line)

/** 状态栏摘要：优先当前成功结果，其次上次成功 */
export const selectSummary = (s: Studio) => s.outcome?.summary ?? s.lastOk?.summary ?? null

export const selectErrorCount = (s: Studio) => s.items.filter((d) => d.severity === 'error').length
export const selectWarningCount = (s: Studio) => s.items.filter((d) => d.severity === 'warning').length
/** 当前案 + 构建结果对应的 PDF URL（预览挂在 lastOk 上，失败不清空） */
export const selectPdfUrl = (s: Studio) => s.lastOk?.pdf_url ?? null
