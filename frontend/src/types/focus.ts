import type { BookName } from './ast'

/**
 * 三视图共享定位契约（docs/plan/21-w5-spec.md §5.2）。
 * 任一来源写 `Focus` → store/focus.ts `setFocus` 递增 seq → 三视图（源码 / 版面 / PDF）各自订阅并滚动/闪烁到 blockId；
 * 写入方永不直接调对方组件；`seq` 保证同一 block 连点两次也触发。
 */
export type FocusSource = 'source' | 'layout' | 'pdf' | 'outline' | 'problems' | 'review' | 'ai'

export interface Focus {
  book: BookName
  /** AST block_id（`claims/3`、`description/p-0012` …） */
  blockId: string
  /** 全文 1-based 行（源码侧可直接滚动） */
  line?: number
  /** PDF 页（1-based；PdfBlockIndex 命中时带） */
  page?: number
  source: FocusSource
  /** 单调递增；订阅者用它判重 */
  seq: number
}

/** PDF 定位失败原因（PdfPreview 空态文案 / 状态栏 aria-live） */
export type PdfLocateFail =
  /** 生成物（PDF 未构建 / 构建失败） */
  | 'generated'
  /** 附图页 / 图像块无文本层 */
  | 'figure'
  /** 多个候选（弹候选 ≤3） */
  | 'ambiguous'
  /** 文本太短无法唯一匹配 */
  | 'short'
  /** PDF 落后于源码（stale） */
  | 'stale'
  /** 无匹配 */
  | 'nomatch'

export const PDF_LOCATE_FAIL_LABEL: Record<PdfLocateFail, string> = {
  generated: 'PDF 尚未生成，构建后可定位',
  figure: '附图页无文本层，无法定位',
  ambiguous: '多处匹配，请选择候选',
  short: '文本过短，无法唯一定位',
  stale: 'PDF 落后于源码，重新构建后定位',
  nomatch: 'PDF 中未找到对应段落',
}

/** 索引命中版式生成文字（书名标题 / 页眉页脚 / Artifact）时的 generated 文案：PDF 已存在，只是源码里没有对应块 */
export const PDF_LOCATE_ARTIFACT_LABEL = '此处为版式生成文字（标题 / 页眉页脚），源码中无对应块'
