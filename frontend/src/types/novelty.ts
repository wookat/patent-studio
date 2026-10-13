/** W19 批4 查新记录卡：.studio/novelty.json（GET/PUT /api/projects/{pid}/novelty 与 MCP 工具同形） */

/** ECLA 检索报告相关度分类：X 破坏新颖性 / Y 影响创造性 / A 背景技术 / P 公开日在申请日前后之间 */
export const NOVELTY_RELEVANCES = ['X', 'Y', 'A', 'P'] as const
export type NoveltyRelevance = (typeof NOVELTY_RELEVANCES)[number]

export const NOVELTY_RELEVANCE_LABEL: Record<NoveltyRelevance, string> = {
  X: 'X · 破坏新颖性',
  Y: 'Y · 影响创造性',
  A: 'A · 背景技术',
  P: 'P · 申请日前后',
}

export interface NoveltyQuery {
  query: string
  provider: string
  ran_at: string
}

export interface NoveltyHit {
  number: string
  title: string
  relevance: NoveltyRelevance
  note: string
  link: string
}

export interface NoveltyRecord {
  updated_at: string | null
  queries: NoveltyQuery[]
  hits: NoveltyHit[]
  conclusion: string
}
