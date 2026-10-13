import type { CaseSummary, Collaborator, ListState, UserBrief } from '@/types/case'

export interface ProjectSummary {
  id: string
  title: string
  /** content.md 最后修改时间（Unix 秒） */
  mtime: number
  /** W4-A：GET /api/projects 始终返回以下字段（旧 mock 可省）；台账摘要 + next_deadline */
  case?: CaseSummary
  /** 责任人账号（不经 ACL 直查，可能已不在 collaborators 里）；无 owner / auth=off / 账号已删 ⇒ null */
  owner?: UserBrief | null
  /** ACL 成员（面板头像）；auth=off ⇒ [] */
  collaborators?: Collaborator[]
  /** .studio/history 最近一次提交的作者；无历史 ⇒ null */
  last_modified_by?: string | null
  /** 当前用户在本案的角色；off ⇒ null */
  my_role?: Role | null
  /** 当前用户视角：进行中 / 已归档 / 回收站 */
  list_state?: ListState
}

export interface Style {
  fonts: { body_cjk: string; heading_cjk: string; ascii: string; label_ascii: string; mono: string }
  sizes: Record<
    | 'body' | 'title' | 'section_heading' | 'subsection_heading' | 'header' | 'footer'
    | 'page_number' | 'para_number' | 'table' | 'equation' | 'code',
    number
  >
  paragraph: {
    line_spacing: number
    first_indent_pt: number
    space_after: Record<string, number>
  }
  page: {
    width_cm: number
    height_cm: number
    margin_top_mm: number
    margin_bottom_mm: number
    margin_left_mm: number
    margin_right_mm: number
    header_distance_cm: number
    footer_distance_cm: number
    line_pitch: number
    default_tab_stop: number
  }
  header: {
    labels: Record<'abstract' | 'abstract_figure' | 'claims' | 'description' | 'figures', string>
    spacing_short: number
    spacing_long: number
    rule_sz: number
    rule_space: number
  }
  footer: {
    codes: Record<'abstract' | 'abstract_figure' | 'claims' | 'description' | 'figures', string>
    year_text: string
    rule_sz: number
    rule_space: number
  }
  table: {
    defaults: Record<string, boolean>
    cell_space_after: number
    rule_outer_sz: number
    rule_head_sz: number
  }
  equation: { side_cm: number }
}

export type StyleOverride = Partial<{ [K in keyof Style]: Partial<Style[K]> }> & Record<string, unknown>

export interface Settings {
  abstract_figure: [string, number] | null
  spec_figures: [string, number][]
  sub_except: string[]
  abstract_limit: number
  style: StyleOverride
  /** 轨道 E（09 §2.5）：允许把本案内容发送到 AI 中转站；后端默认 false，旧 studio.json 无此键 */
  ai_enabled?: boolean
  /** 通知外发 webhook（设置›集成可配；空 = 回落环境变量，再回落日志通道） */
  notify_webhook_url?: string
}

export interface ProjectDetail extends ProjectSummary {
  /** AUTH=on 时当前用户在本案的角色（superuser ⇒ owner）；off ⇒ null（可写） */
  role?: Role | null
  /** W4-A：台账全量 + next_deadline（顶栏状态徽章）；详情路由始终返回 */
  case?: CaseSummary
  figs: string[]
  settings: Settings
  has_settings_file: boolean
  content: string
  backups: Backup[]
}

export interface Backup {
  name: string
  size: number
  mtime: number
}

export interface BuildError {
  kind: string
  message: string
  line: number | null
  detail: string
}

export interface BuildSummary {
  title: string
  abstract_chars: number
  claims: number
  paragraphs: number
  pages: number | null
}

/* ---- 诊断契约（docs/ux/05-architecture.md §5）---- */
export type Severity = 'error' | 'warning' | 'info'
export type DiagnosticSource = 'build' | 'lint' | 'boundary' | 'client'

/** boundary.* 诊断的修正载荷（backend/patent_docx/boundary_lint.py）：直接喂 patchBlock */
export interface BoundaryFix {
  block_id: string
  markdown: string
}

export interface Diagnostic {
  /** 稳定 id：'abstract.limit' | 'claims.forward_ref#2' | 'build.equation' … */
  id: string
  severity: Severity
  source: DiagnosticSource
  /** 用户可读中文 */
  message: string
  /** 1-based；无法定位时为 null */
  line: number | null
  /** '摘要' | '权利要求书' | '说明书/背景技术' */
  section?: string
  /** 技术详情（原始异常） */
  detail?: string
  /** lint：一句话建议；boundary：修正后的整块 Markdown */
  fix?: string | BoundaryFix
  /** terms.alias（09 §4）：同一行 from → to 的机器可读替换，一键修复 = editor.replaceLine(line, from, to) */
  replace?: TermReplace
}

export interface TermReplace {
  from: string
  to: string
}

export interface LintReport {
  diagnostics: Diagnostic[]
  counts: Record<Severity, number>
}

export interface BuildOutcome {
  status: 'ok' | 'error' | 'superseded'
  build_id: string | null
  seq: number
  timings: { queue_ms?: number; docx_ms?: number; pdf_ms?: number; pdf_backend?: 'unoserver' | 'cli'; total_ms?: number }
  summary: BuildSummary | null
  error: BuildError | null
  pdf_url: string | null
  docx_url: string | null
  /** 后端 lint 结果（B1 落地前为空数组，由 api.build 归一） */
  diagnostics: Diagnostic[]
  /** W5（21 §5.1）：unoserver 路径生成 tagged PDF（文本层可 struct 配对）⇒ true；CLI 路径 / 旧后端缺省 ⇒ false */
  pdf_tagged?: boolean
}

/** 大纲节点（lib/outline.ts 由 F2 实现；此处只定义 store 承载的最小形状） */
export interface OutlineNode {
  id: string
  kind: 'title' | 'abstract' | 'claims' | 'claim' | 'description' | 'section' | 'figures' | 'figure'
  label: string
  /** 1-based */
  line: number
  /** 从属权项引用的编号（kind='claim'） */
  ref?: number | null
  /** 章节缺失（灰斜体占位） */
  missing?: boolean
  children?: OutlineNode[]
}

export interface XmlBook {
  code: string
  name: string
  file: string
  valid: boolean
  errors: string[]
  images: string[]
  xml_url: string
  preview_url: string
}

export interface XmlExportResult {
  status: 'ok' | 'error'
  xid: string
  valid?: boolean
  books?: XmlBook[]
  warnings?: string[]
  counts?: { claims: number; paragraphs: number; figures: number; equations: number; tables: number; abstract_chars: number }
  zip_url?: string
  ms?: number
  error?: BuildError
}

export interface CheckResult {
  ok: boolean
  exit_code: number | null
  duration_ms: number
  output: string
  results: { status: 'PASS' | 'FAIL' | 'SKIP'; name: string }[]
  docx_source: Record<string, string>
}

/* ---- R6 地基（docs/plan/07-r6-collab-foundation-design.md §4）---- */

/** 成员角色：owner > agent（代理人）> editor > reviewer（审阅者，只能提 CriticMarkup 建议 / 批注；W4-B 14 §4.1）> viewer */
export type Role = 'owner' | 'agent' | 'editor' | 'reviewer' | 'viewer'
export const ROLE_RANK: Record<Role, number> = { viewer: 0, reviewer: 1, editor: 2, agent: 3, owner: 4 }
export const ROLE_LABEL: Record<Role, string> = { owner: '所有者', agent: '代理人', editor: '编辑者', reviewer: '审阅者', viewer: '查看者' }

export interface User {
  id: string
  email: string
  display_name: string
  is_superuser: boolean
  /** W4-E E2：展示用头衔（''/代理师/发明人/管理员/助理）；后端总是返回，可选只为兼容旧测试夹具 */
  title?: string
  /** W4-E E2：头像色名（'' = 未选，按名字派生） */
  avatar_color?: string
}

export interface Member {
  user_id: string
  email: string
  display_name: string
  /** 账户预设头像色名；'' / 缺省 = 按名派生（collab/colors userColor） */
  avatar_color?: string
  role: Role
}

export interface ShareLink {
  token: string
  role: Exclude<Role, 'owner'>
  /** ISO 时间；null = 永久 */
  expires_at: string | null
  /** `<origin>/#/share/<token>` */
  url: string
  created_at: string
  /** 经此链接进入的用户（W4-B 14 §4；同一人重复领取只记首次） */
  accepted_by: ShareAccept[]
}

export interface ShareAccept {
  user_id: string
  email: string
  display_name: string
  avatar_color?: string
  accepted_at: string
}

/** CriticMarkup 渲染模式：final=接受全部 / original=拒绝全部 / markup=保留标记文本（07 §6.3） */
export type ReviewMode = 'final' | 'original' | 'markup'
export const REVIEW_MODE_LABEL: Record<ReviewMode, string> = { original: '原文', final: '修订后', markup: '标记' }

export type CriticKind = 'ins' | 'del' | 'sub' | 'comment' | 'mark'

/** POST /critic 返回的一条标记：`line` 全文 1-based；`from/to` 为该行内 0-based UTF-16 code unit 偏移（含标记符；与 string.slice / CodeMirror pos 一致，非 Python 码点下标） */
export interface CriticMark {
  id: string
  kind: CriticKind
  line: number
  from: number
  to: number
  a: string
  b: string
  /** 接受后 [from,to) 应替换成的文本 */
  final: string
  /** 拒绝后 [from,to) 应替换成的文本 */
  original: string
  /** 落盘时记录的作者（无记录 ⇒ null；旧数据 / 未登录写入） */
  author?: string | null
  /** 落盘时间（Unix 秒；无记录 ⇒ null） */
  at?: number | null
}

/** 与后端 comments.CommentIn/ReplyIn.body max_length=4000 一致（双写须同步） */
export const COMMENT_BODY_MAX = 4000

export interface CommentAnchor {
  block_id: string
  /** 全文 1-based */
  line: number
  quote: string
  /** GET /comments 重锚后：block 内与全文都找不到 quote ⇒ true（POST/PATCH 返回 false；前端发起新增时不带） */
  stale?: boolean
}

export interface CommentAuthor {
  /** auth=off 时 null */
  id: string | null
  name: string
}

export interface CommentReply {
  id: string
  body: string
  author: CommentAuthor
  created_at: number
}

export interface Comment {
  id: string
  anchor: CommentAnchor
  body: string
  author: CommentAuthor
  created_at: number
  updated_at: number
  resolved: boolean
  replies: CommentReply[]
  /** 后端写入：成员 human / AI 审阅 ai / 客户公开链接 client；缺省视为 human */
  source?: 'human' | 'ai' | 'client'
}

export interface Version {
  sha: string
  /** Unix 秒 */
  at: number
  message: string
  author: string
  /** content.md 相对上一版的增/删行数 */
  added: number
  deleted: number
}

export interface Health {
  ok: boolean
  soffice: boolean
  soffice_bin: string
  projects_dir: string
  unoserver?: boolean
  unoserver_url?: string
  pdf_backend?: 'unoserver' | 'cli' | null
}

/* ---------- R7 MCP（docs/plan/10 §3.4 / §7.2） ---------- */

export interface Pat {
  id: string
  name: string
  /** `pat_` + 8 hex，仅供列表辨认 */
  prefix: string
  created_at: string
  last_used_at: string | null
}

/** POST /api/pat 响应：token 仅此一次返回 */
export interface PatCreated extends Pat {
  token: string
}

/** `.studio/audit.jsonl` 一行 */
export interface AuditEntry {
  ts: string
  who: string
  tool: string
  args: Record<string, unknown>
  result: string
}

/* ---------- R9 模板预设（docs/plan/10 §6） ---------- */

export type DocumentType = 'patent_cn_invention'

export interface TemplateSettings {
  style: StyleOverride
  sub_except?: string[] | null
  abstract_limit?: number | null
}

export interface TemplateIn {
  name: string
  document_type: DocumentType
  description: string
  settings: TemplateSettings
}

export interface Template extends TemplateIn {
  created_at: string
  updated_at: string
}

/* ---------- R9 Word 导入（docs/plan/10 §5） ---------- */

export interface ImportReportItem {
  /** `heading.unmapped` `table.merged` `formula.partial` `omml.raw` `element.unknown` … */
  code: string
  para_index: number
  text: string
  detail: string | null
}

export interface StyleSuggestion {
  style: StyleOverride
  /** 字段 → 取自 DOCX 何处（如 "docDefaults rFonts eastAsia"） */
  evidence: Record<string, string>
}

export interface ImportReport {
  /** 三书各切到多少行 */
  books: Record<string, number>
  figures: string[]
  items: ImportReportItem[]
  style_suggestion: StyleSuggestion | null
  /** 已由后端写进新案 studio.json：图设置与字面下划线标识符 */
  figure_settings?: { abstract_figure?: [string, number] | null; spec_figures?: [string, number][] }
  sub_except?: string[]
}

/** POST /api/projects/import/docx 201 */
export interface ImportResult {
  project: { id: string; title: string; content: string }
  report: ImportReport
}
