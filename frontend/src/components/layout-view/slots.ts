import type { ReactNode } from 'react'
import type { BookName } from '@/types/ast'
import type { EditorMode } from '@/types/collab-center'

/**
 * 版面视图对外契约（docs/plan/16 §12）：表格工具条 / 公式编辑器由 LayoutView 直接挂载（./table、./equation）；
 * 宿主（卡片 / MobileShell）只通过 slots 注入模式指示；D4 底部工具栏通过 store.layoutView 通信。
 */
export interface LayoutViewSlots {
  /** D4 / integrate：卡片头右侧模式指示（复用 collab-center/ModeIndicator） */
  modeIndicator?: ReactNode
  /** W9 决策 4：版面右侧 320 审阅栏（workbench/LayoutRightRail 包 review/ReviewRail），与纸面并排成 flex 行 */
  rightRail?: ReactNode
}

export interface LayoutViewProps {
  className?: string
  /** 不传 = 三书全渲染；单书卡片传 [book] */
  books?: readonly BookName[]
  /** edit：可进块编辑；review：提交前 toCritic；readonly：不可进块、`/` 不触发 */
  mode: EditorMode
  slots?: LayoutViewSlots
}

/** 纸面 part：三书 + 说明书附图（AST figures，随 description 一起渲染） */
export type PaperPart = BookName | 'figures'

/** 页眉书名字样缺省值（= style.DEFAULT_STYLE.header.labels）；有 settings.style.header.labels 覆盖时以覆盖为准 */
export const PART_HEADER_LABEL: Record<PaperPart, string> = {
  abstract: '说明书摘要',
  claims: '权利要求书',
  description: '说明书',
  figures: '说明书附图',
}
