/** 轨道 E · OA 答复工作台契约（docs/plan/09 §3.4；backend/app/oa/*） */

/** 后端确定性分类（backend/app/oa/parse.py `_kind`） */
export type OaKind = 'novelty' | 'inventiveness' | 'support' | 'clarity' | 'formal' | 'other'

export const OA_KIND_LABEL: Record<OaKind, string> = {
  novelty: '新颖性',
  inventiveness: '创造性',
  support: '支持',
  clarity: '清楚',
  formal: '形式',
  other: '其他',
}

/** 逐条证据链状态（GET …/oa/items 透出，Z23）：待答 / 已答 / 已交付（所属轮次已登记递交） */
export type OaItemStatus = 'pending' | 'answered' | 'delivered'

/** POST …/oa/parse 拆出的一条审查意见 */
export interface OaItem {
  id: string
  /** 涉及的权利要求号 */
  claims: number[]
  kind: OaKind
  text: string
  /** 拆条挂接的轮次 id（无挂接 ⇒ null / 缺省） */
  round_id?: string | null
  status?: OaItemStatus
}

export interface OaParseResult {
  items: OaItem[]
  warnings: string[]
}

export interface OaClaimEdit {
  claim: number
  /** 该权项的 CriticMarkup 整行，写入 claims 走 patch（不直接改写） */
  critic_line: string
}

/** 每条意见的答复（job.result.answers[]，亦落 .studio/oa/<id>.json；用户改要点走 PUT …/oa/answers/{item_id}，导出读盘上版本） */
export interface OaAnswer {
  item_id: string
  points: string[]
  claim_edits: OaClaimEdit[]
  amend_summary: string
  /** 用户是否已把 claim_edits 作为 CriticMarkup 建议写入权利要求书 */
  applied?: boolean
}

/* ---------- OA 轮次（oa-import-backend） ---------- */

export type OaRoundKind = 'first' | 'subsequent' | 'reexam' | 'rejection'
export type OaDelivery = 'electronic' | 'mail'

export interface OaRound {
  id: string
  kind: OaRoundKind
  /** 发文日 YYYY-MM-DD */
  issued_on: string
  delivery: OaDelivery
  /** 对应 deadlines[] 条目 */
  deadline_id: string | null
  /** 拆条结果条数 */
  items: number
  extensions: { months: number; requested_at: string }[]
  /** 答复递交日 YYYY-MM-DD（填了 ⇒ 期限标 done）；R35 起列表透出 */
  filed_on?: string | null
  created_at: number
}

export interface OaRoundIn {
  kind: OaRoundKind
  issued_on: string
  delivery: OaDelivery
}

