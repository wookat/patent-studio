import type { Settings } from '@/lib/types'
import type { BookName } from './ast'

/** `GET /api/projects/{pid}/figures` 元素（docs/plan/05-r2-figures-preflight-design.md §2.2） */
export interface FigureItem {
  /** 主文件名（含后缀），figs/ 内唯一 */
  name: string
  /** 小写后缀，如 ".emf" */
  ext: string
  /** bytes */
  size: number
  /** docs/figures.md「# 说明书附图」下的行序 + 1；未编入为 null（图号由内核按顺序生成，源码不写号） */
  num: number | null
  /** figures.md 该行的 alt（`![图N 题注](figs/…)`）；只做显示与体检 figures.alt_mismatch，未编入 null（W4-C） */
  alt: string | null
  /** 说明书宽度 cm；未编入 null */
  width: number | null
  is_abstract: boolean
  abstract_width: number | null
  /** 可显示的伴生文件名（png/svg/jpg）；URL 用 api.figUrl(pid, preview) */
  preview: string | null
  /** 同 stem 的其他后缀文件 */
  companions: string[]
  /** figures.md marks 表：标记号 → 名称（仅已编入说明书节的图；未编入 null） */
  marks?: Record<string, string> | null
}

export interface FiguresResponse {
  figures: FigureItem[]
  settings: Settings
  /** 批6：仅上传动作返回——被跳过的文件及原因（重名/格式不支持/不可解码）；无跳过为空数组 */
  skipped?: { name: string; reason: string }[]
}

/** 正文中一处「图N」引用（全文 1-based 行） */
export interface FigureRef {
  book: BookName
  line: number
  text: string
}

/** figs-src/*.mmd 绘制图源（W16）：list 返回条目 */
export interface FigureSource {
  name: string
  size: number
}

/** GET figures-src/{name} 全件 */
export interface FigureSourceDoc {
  name: string
  source: string
}

export interface FigurePatch {
  width?: number
  abstract?: boolean
  abstract_width?: number
  marks?: Record<string, string>
}
