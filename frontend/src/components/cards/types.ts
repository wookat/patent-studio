import type { BookName } from '@/types/ast'
import type { BookView, PanelId, PanelKind } from '@/store/layout'
import type { ReactNode } from 'react'

/**
 * 卡片 = 书 × 视图（docs/plan/08-r4-dockview-design.md §4；D2 所有）。
 * 卡片组件只吃这组 props，由 layout/panels.tsx（D1）从 dockview panel props 适配而来；卡片不 import dockview。
 */

export interface CardProps {
  /** 面板 id，如 `source:claims`；卡片用它调 store.layout 的 focusPanel/closePanel */
  panelId: PanelId
  kind: PanelKind
  /** source / structure 的书视图；pdf 等全案 kind 为 'all' */
  book: BookView
  /** 是否为 dockview 活动面板（同步与快捷键只作用于活动卡片） */
  active: boolean
  /** 标题栏「书切换」：D1 通过 dockview api 换 params + 重算标题；卡片只发请求 */
  onSwitchBook?: (book: BookView) => void
}

/** 标题栏共用契约（CardHeader）：书切换器 + 「打开为…」+ 脏标 + 状态角标 */
export interface CardHeaderProps {
  title: string
  book: BookView
  dirty?: boolean
  /** 本卡片面板 id；有它才显示「打开为…」（拆分到右侧 / 下方 / 浮动，相对本面板放置） */
  panelId?: PanelId
  /** 可切换到的书视图；undefined = 不显示切换器（pdf / rail 面板） */
  switchable?: readonly BookView[]
  onSwitchBook?: (book: BookView) => void
  /** 右侧插槽（如 PDF 工具栏、结构视图「可编辑」开关） */
  actions?: ReactNode
}

/** 「打开为…」菜单的放置方式 → store.openPanel 的 OpenPanelOptions */
export type OpenPlacement = 'right' | 'below' | 'floating'

/** 单书源码卡片：只读的全文镜像用 FullTextCard（book='all'） */
export interface SourceCardProps extends CardProps {
  book: BookName
}

/** 跨卡片同步事件（sync.ts）：卡片向 store 报的都是全文行 / 块 id，卡片内部再换算到书相对行 */
export interface CardSyncTarget {
  blockId: string | null
  fullLine: number
  /** 来源卡片，接收方据此避免回环 */
  from: PanelId
}
