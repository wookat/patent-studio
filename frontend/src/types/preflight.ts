import type { Severity } from '@/lib/types'
import type { BookName } from './ast'
import type { FigureRef } from './figures'

/** `POST /api/projects/{pid}/preflight` 响应（docs/plan/05-r2-figures-preflight-design.md §3.2） */
export interface PreflightReport {
  version: 1
  items: PreflightItem[]
  counts: Record<Severity, number>
  /** 森林：独立权项为根 */
  claim_tree: ClaimNode[]
  numerals: NumeralRow[]
  support_map: SupportRow[]
  /** 每图的引用行（附图面板与删除守卫共用） */
  figures: FigureRefRow[]
}

export interface PreflightItem {
  /** 规则 id（§4），如 "claims.cycle" */
  rule: string
  severity: Severity
  message: string
  book: BookName | null
  /** 全文 1-based */
  line: number | null
  /** AST block id，如 "claims/9"、"description/12" */
  block_id: string | null
  detail: string | null
}

export interface ClaimNode {
  num: number
  kind: 'independent' | 'dependent'
  category: string
  refs: number[]
  /** 多引时是否用「或/任一」择一 */
  alternative: boolean
  line: number
  children: number[]
  /** 命中的规则 id */
  issues: string[]
}

export interface NumeralRow {
  num: string
  legend: string | null
  legend_line: number | null
  names: string[]
  lines: number[]
  consistent: boolean
}

export interface SupportRow {
  term: string
  claims: number[]
  /** 说明书中命中的最长前缀；未支持为 null */
  matched: string | null
  /** 前 5 处 */
  description_lines: number[]
  supported: boolean
}

export interface FigureRefRow {
  num: number
  file: string
  caption_line: number | null
  refs: FigureRef[]
}

export type PreflightView = 'items' | 'claims' | 'numerals' | 'support'
