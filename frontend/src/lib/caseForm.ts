import type { Case, CaseKind, CasePatch, RelatedCase } from '@/types/case'
import { APPLICATION_NO_RE } from '@/types/deliver'

/**
 * 案件元数据表单（21 §2 R-CASE-02）的纯函数：表单值 ⇄ case.json 字段。
 * 日期全部在 `dates.*`（filed = 申请日 / publication / exam_request / grant），后端 CasePatch 为 extra=forbid；
 * 顶层新字段 priority[] / attorney / reviewer / client_contact / fee_status。
 * 旧 case.json 没有这些键 ⇒ 表单显示空值，不写回未改动的字段。
 */
export type FeeStatus = 'unbilled' | 'billed' | 'paid' | 'overdue' | 'waived'
export const FEE_STATUSES: readonly FeeStatus[] = ['unbilled', 'billed', 'paid', 'overdue', 'waived']
export const FEE_STATUS_LABEL: Record<FeeStatus, string> = { unbilled: '未开票', billed: '已开票', paid: '已收款', overdue: '逾期未付', waived: '免收' }

export interface Priority {
  /** ISO 3166-1 两位国别 / 地区码（CN / US / EP / WO …） */
  country: string
  /** YYYY-MM-DD */
  date: string
  number: string
}

/** R-CASE-02 扩展字段（全部可空；后端 normalize_case 兼容旧文件） */
export interface CaseMeta {
  priority: Priority[]
  attorney: string | null
  reviewer: string | null
  client_contact: string | null
  fee_status: FeeStatus | null
  related: RelatedCase[]
}

export type CaseWithMeta = Case & Partial<CaseMeta>
export type CaseMetaPatch = CasePatch & Partial<CaseMeta>

export interface CaseFormValues {
  caseNo: string
  kind: CaseKind
  client: string
  clientContact: string
  /** 一行一个 */
  applicants: string
  inventors: string
  attorney: string
  reviewer: string
  opened: string
  targetFiling: string
  applicationNo: string
  /** dates.filed */
  filingDate: string
  priority: Priority[]
  publicationDate: string
  examRequestDate: string
  grantDate: string
  feeStatus: FeeStatus | ''
  related: RelatedCase[]
}

export type CaseFormErrors = Partial<
  Record<keyof CaseFormValues | `priority.${number}.${keyof Priority}` | `related.${number}.${keyof RelatedCase}`, string>
>

/** 本地「今天」`YYYY-MM-DD`——不用 `toISOString().slice(0,10)`（UTC 日，东八区 0–8 点会落到昨天） */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 新建案卷对话框（shell/CreateProjectDialog）用的三字段版本 */
export function caseFieldsFromForm(f: { caseNo: string; client: string; opened: string }): CasePatch | undefined {
  const out: CasePatch = {}
  if (f.caseNo.trim()) out.case_no = f.caseNo.trim()
  if (f.client.trim()) out.client = f.client.trim()
  if (f.opened) out.dates = { opened: f.opened }
  return Object.keys(out).length ? out : undefined
}

const lines = (xs: string[] | undefined) => (xs ?? []).join('\n')
const splitLines = (s: string) => s.split(/\r?\n|[,，;；]/).map((x) => x.trim()).filter(Boolean)

/** case.json（含无新字段的旧文件）→ 表单初值 */
export function caseFormValues(c?: CaseWithMeta | null): CaseFormValues {
  return {
    caseNo: c?.case_no ?? '',
    kind: c?.kind ?? 'invention',
    client: c?.client ?? '',
    clientContact: c?.client_contact ?? '',
    applicants: lines(c?.applicants),
    inventors: lines(c?.inventors),
    attorney: c?.attorney ?? '',
    reviewer: c?.reviewer ?? '',
    opened: c?.dates?.opened ?? '',
    targetFiling: c?.dates?.target_filing ?? '',
    applicationNo: c?.dates?.application_no ?? '',
    filingDate: c?.dates?.filed ?? '',
    priority: (c?.priority ?? []).map((p) => ({ country: p.country ?? '', date: p.date ?? '', number: p.number ?? '' })),
    publicationDate: c?.dates?.publication ?? '',
    examRequestDate: c?.dates?.exam_request ?? '',
    grantDate: c?.dates?.grant ?? '',
    feeStatus: c?.fee_status ?? '',
    related: (c?.related ?? []).map((r) => ({ pid: r.pid ?? '', kind: r.kind ?? 'associated', note: r.note ?? '' })),
  }
}

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

const DATE_FIELDS = ['opened', 'targetFiling', 'filingDate', 'publicationDate', 'examRequestDate', 'grantDate'] as const

/** 客户端校验：日期格式、优先权行必填项、申请日不早于优先权日、授权日不早于申请日 */
export function validateCaseForm(v: CaseFormValues): CaseFormErrors {
  const errors: CaseFormErrors = {}
  for (const k of DATE_FIELDS) if (v[k] && !isIsoDate(v[k])) errors[k] = '日期格式应为 YYYY-MM-DD'
  // 与 FilingDialog 同口径（批30 唯一权威 APPLICATION_NO_RE）：坏值若放行落库，到递交校验才炸（D-B49-OBS）
  if (v.applicationNo.trim() && !APPLICATION_NO_RE.test(v.applicationNo.trim()))
    errors.applicationNo = '申请号格式应为 4 位年份 + 类别 + 7 位流水 + 校验位，如 202610123456.7'
  v.priority.forEach((p, i) => {
    if (!p.country.trim()) errors[`priority.${i}.country`] = '请填写国别'
    if (!p.date) errors[`priority.${i}.date`] = '请填写优先权日'
    else if (!isIsoDate(p.date)) errors[`priority.${i}.date`] = '日期格式应为 YYYY-MM-DD'
    if (!p.number.trim()) errors[`priority.${i}.number`] = '请填写优先权申请号'
  })
  v.related.forEach((r, i) => {
    if (!r.pid.trim()) errors[`related.${i}.pid`] = '请填写关联案卷标识'
  })
  if (v.filingDate && isIsoDate(v.filingDate)) {
    const earliest = v.priority.map((p) => p.date).filter(isIsoDate).sort()[0]
    if (earliest && v.filingDate < earliest) errors.filingDate = '申请日不应早于优先权日'
    if (v.grantDate && isIsoDate(v.grantDate) && v.grantDate < v.filingDate) errors.grantDate = '授权日不应早于申请日'
  }
  return errors
}

const nul = (s: string) => (s.trim() ? s.trim() : null)

/** 只带改动过的字段（PUT /case 语义：未给出的键不动） */
export function casePatchFromForm(v: CaseFormValues, prev: CaseFormValues): CaseMetaPatch {
  const out: CaseMetaPatch = {}
  if (v.caseNo !== prev.caseNo) out.case_no = v.caseNo.trim()
  if (v.kind !== prev.kind) out.kind = v.kind
  if (v.client !== prev.client) out.client = v.client.trim()
  if (v.clientContact !== prev.clientContact) out.client_contact = nul(v.clientContact)
  if (v.applicants !== prev.applicants) out.applicants = splitLines(v.applicants)
  if (v.inventors !== prev.inventors) out.inventors = splitLines(v.inventors)
  if (v.attorney !== prev.attorney) out.attorney = nul(v.attorney)
  if (v.reviewer !== prev.reviewer) out.reviewer = nul(v.reviewer)
  const dates: NonNullable<CaseMetaPatch['dates']> = {}
  if (v.opened !== prev.opened) dates.opened = nul(v.opened)
  if (v.targetFiling !== prev.targetFiling) dates.target_filing = nul(v.targetFiling)
  if (v.applicationNo !== prev.applicationNo) dates.application_no = nul(v.applicationNo)
  if (v.filingDate !== prev.filingDate) dates.filed = nul(v.filingDate)
  if (v.publicationDate !== prev.publicationDate) dates.publication = nul(v.publicationDate)
  if (v.examRequestDate !== prev.examRequestDate) dates.exam_request = nul(v.examRequestDate)
  if (v.grantDate !== prev.grantDate) dates.grant = nul(v.grantDate)
  if (Object.keys(dates).length) out.dates = dates
  if (v.feeStatus !== prev.feeStatus) out.fee_status = v.feeStatus || null
  if (JSON.stringify(v.priority) !== JSON.stringify(prev.priority)) {
    out.priority = v.priority.map((p) => ({ country: p.country.trim().toUpperCase(), date: p.date, number: p.number.trim() }))
  }
  if (JSON.stringify(v.related) !== JSON.stringify(prev.related)) {
    out.related = v.related.map((r) => ({ pid: r.pid.trim(), kind: r.kind, note: r.note.trim() }))
  }
  return out
}
