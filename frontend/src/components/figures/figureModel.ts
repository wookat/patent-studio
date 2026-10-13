import type { Announcements, Over, ScreenReaderInstructions } from '@dnd-kit/core'
import type { Ast } from '@/types/ast'
import type { FigureItem, FigureRef } from '@/types/figures'
import type { PreflightReport } from '@/types/preflight'

/** 与后端 projects.DOCX_FIG_EXTS 一致（svg 只能做伴生预览，不能上传为主图） */
export const FIGURE_ACCEPT = '.emf,.png,.jpg,.jpeg,.gif,.bmp,.tiff'

/** 卡片灰显的图号文案；未编入 spec_figures 的文件没有图号 */
export const figureLabel = (f: FigureItem) => (f.num != null ? `图${f.num}` : '未编入')

export interface FigureCaption {
  text: string | null
  /** 全文 1-based 行号（books.description.offset + caption_line），无题注为 null */
  line: number | null
}

/** 题注只来自 AST（内核解析「图N为…」），面板不自己扫源码 */
export function captionOf(ast: Ast | null, num: number | null): FigureCaption {
  if (!ast || num == null) return { text: null, line: null }
  const fig = ast.figures.find((f) => f.num === num)
  if (!fig) return { text: null, line: null }
  return { text: fig.caption, line: fig.caption_line != null ? ast.books.description.offset + fig.caption_line : null }
}

/** 正文「图N」引用：来自体检报告 figures 表；报告不属于当前案子或未跑时为 null（卡片不显示引用数） */
export function refsOf(report: PreflightReport | null, num: number | null): FigureRef[] | null {
  if (!report || num == null) return null
  return report.figures.find((r) => r.num === num)?.refs ?? []
}

/** dnd-kit 中文播报（设计 §7：「已抓起 图3」「图3 移到第 2 位」）；位置取 over 的 sortable.index */
export function figureAnnouncements(labelOf: (name: string) => string): Announcements {
  const label = (id: string | number) => labelOf(String(id))
  const pos = (over: Over) => {
    const index = (over.data.current as { sortable?: { index: number } } | undefined)?.sortable?.index
    return index != null ? `第 ${index + 1} 位` : `${label(over.id)} 处`
  }
  return {
    onDragStart: ({ active }) => `已抓起 ${label(active.id)}`,
    onDragOver: ({ active, over }) => {
      if (over?.id === active.id) return undefined
      return over ? `${label(active.id)} 移到${pos(over)}` : `${label(active.id)} 已移出列表`
    },
    onDragEnd: ({ active, over }) => (over ? `${label(active.id)} 放在${pos(over)}` : `${label(active.id)} 已放回原位`),
    onDragCancel: ({ active }) => `已取消，${label(active.id)} 回到原位`,
  }
}

export const FIGURE_SR_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: '按空格或回车抓起附图，用上下方向键移动，再按空格放下；Esc 取消。',
}
