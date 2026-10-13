import { currentView, type ViewSwitchState } from '@/components/workbench/viewSwitchPlan'

/** ≥1280：版面卡审阅栏为常驻可折叠列；<1280：同一开关驱动 Sheet（W9 决策 4） */
export const RIGHT_RAIL_QUERY = '(min-width: 1280px)'

/** 当前视图 = 版面时审阅栏内嵌在版面卡（LayoutRightRail），否则由 ReviewDrawer 承载 */
export const selectRailEmbedded = (s: Pick<ViewSwitchState, 'activePanelId' | 'editorView'>) => currentView(s).view === 'layout'

/** 版面卡审阅栏是否以常驻列呈现（否则 Sheet）：≥1280 视口且版面卡身够宽 */
export const selectRailAsColumn = (wide: boolean, s: { rightRailColumnFits: boolean }) => wide && s.rightRailColumnFits

/**
 * 审阅栏当前的唯一宿主（23-w12 §4 第二步：一个入口、一个面板 ReviewRail）：
 * - 桌面（≥1024）且当前视图 = 版面：栏内嵌在版面卡——卡身够宽为常驻列 `rightRailOpen`，否则为其 Sheet `rightRailSheetOpen`；
 * - 其余（源码 / PDF 视图，或 <1024）：ReviewDrawer（≥1280 右侧非模态 Sheet / 其下底部 Sheet）`reviewDrawerOpen`。
 * 顶栏「审阅」按钮、审阅模式自动展开、`?c=<cid>` 深链、伴随栏让位都经此选择宿主，三个开关不再各走一套。
 */
export type ReviewHost = 'rail-column' | 'rail-sheet' | 'drawer'

export type ReviewHostState = Pick<ViewSwitchState, 'activePanelId' | 'editorView'> & { rightRailColumnFits: boolean }

export const selectReviewHost = (s: ReviewHostState, desktop: boolean, wide: boolean): ReviewHost => {
  if (!desktop || !selectRailEmbedded(s)) return 'drawer'
  return selectRailAsColumn(wide, s) ? 'rail-column' : 'rail-sheet'
}

export type ReviewHostFlag = 'rightRailOpen' | 'rightRailSheetOpen' | 'reviewDrawerOpen'

/** 宿主 → 其开关字段名（让位 / 恢复时只动这一个字段） */
export const REVIEW_HOST_FLAG: Record<ReviewHost, ReviewHostFlag> = {
  'rail-column': 'rightRailOpen',
  'rail-sheet': 'rightRailSheetOpen',
  drawer: 'reviewDrawerOpen',
}

/** 某宿主此刻是否打开（三个开关里只读当前宿主对应的那一个） */
export const selectReviewHostOpen = (s: Record<ReviewHostFlag, boolean>, host: ReviewHost): boolean => s[REVIEW_HOST_FLAG[host]]
