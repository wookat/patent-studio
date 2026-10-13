/** W4-E E1 递交页契约（docs/plan/17-w4e-deliver-admin-design.md §2.3；后端 app/routes/deliver.py） */
import type { Settings } from '@/lib/types'
/** 导出包六项；顺序即 ExportGrid 的展示顺序 */
export type ExportKind = 'docx' | 'pdf' | 'xml' | 'tracked' | 'figures' | 'bundle'
export const EXPORT_KINDS: readonly ExportKind[] = ['docx', 'pdf', 'xml', 'tracked', 'figures', 'bundle']

export const EXPORT_LABEL: Record<ExportKind, string> = {
  docx: '申请文件 DOCX',
  pdf: '申请文件 PDF',
  xml: 'CNIPA 五书 XML zip',
  tracked: '修订版 DOCX',
  figures: '附图 zip',
  bundle: '全部打包',
}

/** `GET /api/projects/{pid}/deliver` 每项：无产物时 at / size / url 皆 null */
export interface ExportEntry {
  kind: ExportKind
  label: string
  /** ISO 8601 */
  at: string | null
  /** 字节 */
  size: number | null
  /** 直接可下载的 URL（与 api.exportUrl / trackedDocxUrl / figuresExportUrl / deliverBundleUrl 同源） */
  url: string | null
}

export interface DeliverManifest {
  pid: string
  title: string
  items: ExportEntry[]
  /** W5（preflight-backend）：字段级错误；旧后端缺省 ⇒ 视为 [] */
  errors?: DeliverError[]
}

/** `POST /api/projects/{pid}/deliver/bundle`：不传 content/settings 时用磁盘上的 content.md + studio.json */
export interface BundleIn {
  content?: string
  settings?: Settings
  mode?: 'final' | 'markup'
}

/** FilingDialog 表单：先 PUT /case {dates:{filed, application_no}}，再 POST /case/status {status:'filed'} */
export interface FilingIn {
  /** YYYY-MM-DD */
  filed: string
  application_no: string
}

/** CNIPA 申请号：4 位年 + 1 位类别 + 7 位流水 + "." + 校验位（数字或 X），允许空格分隔——与后端 xml_export._APPLICATION_NO_RE 同规则（递交校验的唯一权威，双写须同步） */
export const APPLICATION_NO_RE = /^\d{4}\s?[1-9]\s?\d{7}\.[0-9X]$/


/* ---------- 递交页字段级错误（preflight-backend） ---------- */

export interface DeliverError {
  /** 案件表单字段路径（`dates.filed`、`applicants[0].name` …） */
  field: string
  code: string
  message: string
}

/* ---------- 构建 tagged PDF 开关（three-view） ---------- */

