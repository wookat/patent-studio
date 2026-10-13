import type { ReviewMode } from '@/lib/types'

/**
 * 四档标记（docs/plan/22 决策 4）：
 * all      所有标记（审阅模式默认）：正文 ins 下划线 / del 删除线 / 批注高亮 + 左侧竖线；可编辑
 * simple   简单标记：只留左侧竖线，正文显示 final；只读
 * none     无标记：= 最新 = 编辑模式所见（critic.accept）；只读
 * original 原始：critic.reject；只读
 * 同一状态驱动 PDF 卡的 original / final / markup（store.review.reviewMode）。
 * 本文件保持零实体依赖（store 也 import 它）；依赖 prosemirror-model 的投影在 ./projectDoc。
 */
export type MarkupLevel = 'all' | 'simple' | 'none' | 'original'
export const MARKUP_LEVELS: readonly MarkupLevel[] = ['all', 'simple', 'none', 'original']
export const MARKUP_LEVEL_LABEL: Record<MarkupLevel, string> = { all: '所有标记', simple: '简单标记', none: '无标记', original: '原始' }

export const isEditableLevel = (level: MarkupLevel) => level === 'all'

/** 版面四档 → PDF 三档 */
export function reviewModeFor(level: MarkupLevel): ReviewMode {
  if (level === 'all') return 'markup'
  if (level === 'original') return 'original'
  return 'final'
}

/** PDF 三档 → 版面四档（final 保留当前 simple / none 的选择） */
export function levelForReviewMode(mode: ReviewMode, current: MarkupLevel): MarkupLevel {
  if (mode === 'markup') return 'all'
  if (mode === 'original') return 'original'
  return current === 'simple' ? 'simple' : 'none'
}
