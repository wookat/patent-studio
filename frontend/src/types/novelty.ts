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
  /** Z31：公开日期（YYYY-MM-DD；可空 = 待核对） */
  publication_date: string
}

/** Z31 证据对照状态：hit 命中 / partial 部分命中 / missing 未见披露 / pending 待核对（无全文原句） */
export const EVIDENCE_STATUSES = ['hit', 'partial', 'missing', 'pending'] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
  hit: '命中（已披露）',
  partial: '部分命中',
  missing: '未见披露',
  pending: '待核对',
}

export interface NoveltyEvidence {
  id: string
  /** 对比文件公开号（无号按标题） */
  hit: string
  /** 锚定权项编号；null = 整篇级 */
  claim: number | null
  feature: string
  quote: string
  status: EvidenceStatus
}

export interface NoveltyRecord {
  updated_at: string | null
  queries: NoveltyQuery[]
  hits: NoveltyHit[]
  evidence: NoveltyEvidence[]
  conclusion: string
}
