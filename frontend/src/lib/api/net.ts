import type { Backup, LintReport, StyleOverride } from '../types'
import type { Ast, BookName } from '@/types/ast'
import type { FigureRef } from '@/types/figures'

export interface PutDocInput {
  content: string
  base_sha?: string | null
}
/** PUT /docs/{book} 返回；ast / content / changed_lines / sha 由 W9 prep-kernel 加，旧后端只有 ok / backup / backups */
export interface PutDocResult {
  ok: boolean
  backup: string | null
  backups: Backup[]
  ast?: Ast
  content?: string
  changed_lines?: { start: number; end: number }
  sha?: string
}

/** W9 prep-kernel：GET /history/diff?format=blocks 的块级变化（patent_docx/blockdiff.py） */
export type BlockChangeKind = 'added' | 'removed' | 'changed'
export interface BlockChange {
  book: BookName
  block_id: string
  kind: BlockChangeKind
  /** b 版全文 1-based 闭区间；removed 为空区间 [p+1, p] */
  lines: [number, number]
}
export interface HistoryBlocksDiff {
  a: string
  b: string
  diff: string
  blocks: BlockChange[] | null
  blocks_error: { kind: string; message: string; line?: number | null; detail?: string | null } | null
}

/** R3 块补丁契约（docs/plan/06-r3-structure-edit-design.md §3；后端 routes/patch.py / block_templates.py） */
export type BlockKind = 'paragraph' | 'section' | 'subsection' | 'equation' | 'table' | 'claim' | 'figure-ref' | 'figure'
export interface BlockTemplate {
  kind: BlockKind
  label: string
  /** 可插入的书 */
  book: BookName[]
  /** 多行内核 Markdown 样板 */
  markdown: string
  /** 样板内建议光标（1-based 行 / 列） */
  cursor: { line: number; col: number }
}

/** POST/DELETE /blocks 成功响应：新 AST + 新全文 + 变更行区间（全文 1-based 闭区间；删除时 end = start - 1） */
export interface BlockEditResult {
  ast: Ast
  content: string
  changed_lines: { start: number; end: number }
  /** 新 AST 里该块的 id（删除为 null） */
  block_id: string | null
  backup: string | null
}

export interface InsertBlockInput {
  kind: BlockKind
  /** 二选一：紧接某块之后 / 某书末尾 */
  after_block_id?: string
  book?: BookName
  /** 缺省用后端模板 */
  markdown?: string
}

/** 块 id 含中文与 `/`（如 description/发明内容/技术方案/p0013）：逐段编码，`/` 保留供路由 {block_id:path} 匹配 */
export const blockPath = (blockId: string) => blockId.split('/').map(encodeURIComponent).join('/')

export const EMPTY_LINT: LintReport = { diagnostics: [], counts: { error: 0, warning: 0, info: 0 } }

/** 后端结构错误（422）形状：/ast、/build、/lint 的 `detail` 为 {kind, message, line, detail} */
export interface ErrorDetail {
  kind: string
  message: string
  /** 全文 1-based 行号；无法定位时 null */
  line: number | null
  detail: string | null
}

const isErrorDetail = (d: unknown): d is ErrorDetail =>
  typeof d === 'object' && d !== null && typeof (d as ErrorDetail).message === 'string'

export class ApiError extends Error {
  status: number
  /** 结构化 detail（仅 422 结构错误有；其余为 null） */
  detail: ErrorDetail | null
  constructor(status: number, message: string, detail: ErrorDetail | null = null) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

/** DELETE /figures/{name} 409：detail 在 ErrorDetail 之外多带 refs（05-r2 §2.4） */
export const isFigureReferenced = (e: unknown): e is ApiError & { detail: ErrorDetail & { refs: FigureRef[] } } =>
  e instanceof ApiError && e.status === 409 && e.detail?.kind === 'figure-referenced' && Array.isArray((e.detail as { refs?: unknown }).refs)

/** 乐观并发的客户端侧哈希：对「自认与盘一致」的文本求摘要 hex；
    crypto.subtle 不可用的环境（非安全上下文/测试桩）退化为 undefined ⇒ 不校验 */
const digestHex = async (algo: 'SHA-256' | 'SHA-1', text: string): Promise<string | undefined> => {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return undefined
    const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}
/** PUT /content 用（批76）：整篇 sha256 */
export const contentSha = (text: string): Promise<string | undefined> => digestHex('SHA-256', text)
/** PUT /docs/{book} 用（批78）：书正文 sha1——与后端 book_sha 同算法同输入（splitBooks 书文），
    自认与盘一致的书级并发断言 */
export const bookSha = (text: string): Promise<string | undefined> => digestHex('SHA-1', text)

/** W5 后端错误码（backend/app/errors.py ErrorKind）；前端按 kind 选文案，不解析 message */
export type W5ErrorKind = 'not_implemented' | 'ai_disabled_by_org' | 'ai_disabled' | 'budget' | 'share.expired' | 'share.revoked' | 'oa.pdf_no_text' | 'not_found' | 'forbidden'

export const errorKind = (e: unknown): W5ErrorKind | string | null => (e instanceof ApiError ? (e.detail?.kind ?? null) : null)
/** 501 占位（单元未落地）：页面渲染 EmptyState「功能开发中」，不弹 toast */
export const isNotImplemented = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 501
/** 机构级禁用 AI（403 ai_disabled_by_org）→「机构已禁用 AI」；案级关闭（403 ai_disabled）→「在设置中开启外发」 */
export const isAiDisabledByOrg = (e: unknown): boolean => errorKind(e) === 'ai_disabled_by_org'
/** heavy job 超预算（429 budget） */
export const isBudgetExceeded = (e: unknown): boolean => e instanceof ApiError && e.status === 429 && errorKind(e) === 'budget'
/** 公开链接过期 / 撤销（410） */
export const isShareExpired = (e: unknown): boolean => errorKind(e) === 'share.expired' || errorKind(e) === 'share.revoked'
/** 公开链接 token 不存在（404 not_found）：链接失效，与过期 / 撤销（410）区分 */
export const isShareNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404

type QueryValue = string | number | boolean | null | undefined
export const qs = <T extends object>(params: T) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params) as [string, QueryValue][]) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** R24-04：网络层失败（DNS/断网/连接重置，fetch 抛 TypeError）统一 toast 一次——此前离线点构建/保存静默无反馈 */
let lastNetToastAt = 0
function toastNetFailure() {
  const now = Date.now()
  if (now - lastNetToastAt < 3000) return
  lastNetToastAt = now
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  // 动态引入避免 api → store 静态环（store 依赖 api）
  void import('@/store').then((m) => m.useStudio.getState().toast(offline ? '网络已离线，操作未发送' : '网络不可用，请检查连接', 'error'))
}

/** 所有出站请求统一入口：网络层失败（TypeError）toast 一次后照旧抛出，调用方逻辑不变 */


export async function netFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (e) {
    if (e instanceof TypeError) toastNetFailure()
    throw e
  }
}

/** JSON 读/写默认超时：半开连接（服务端 wedged 但内核活着）下 fetch 无原生超时——
    请求可挂死数小时只剩转圈。120s 余量给足慢读（审计/历史 diff）；
    build / export/xml / deliver/bundle 等同步长任务传 timeout:false 豁免，
    FormData 上传自动豁免（后端 read_bounded 自管体量）。 */
export const REQ_TIMEOUT_MS = 120_000
type ReqInit = RequestInit & { timeout?: number | false }

/** 组件内裸 fetch（PDF/附件等二进制拉取）复合调用方 signal + 默认超时——
    与 req() 同口径，半开 wedge 不再无限转圈。 */
export function withFetchTimeout(caller: AbortSignal | undefined, ms: number = REQ_TIMEOUT_MS): AbortSignal | undefined {
  return reqSignal(caller, ms)
}

export function reqSignal(caller: AbortSignal | undefined, ms: number | false): AbortSignal | undefined {
  if (ms === false) return caller
  const t = AbortSignal.timeout(ms)
  return caller ? AbortSignal.any([caller, t]) : t
}

export async function req<T>(url: string, init?: ReqInit): Promise<T> {
  const { timeout, ...rest } = init ?? {}
  const form = rest.body instanceof FormData
  try {
    const r = await netFetch(url, {
      ...rest,
      signal: reqSignal(rest.signal ?? undefined, form ? false : (timeout ?? REQ_TIMEOUT_MS)),
      headers: form ? rest.headers : { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
    })
    return await handle<T>(r)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new ApiError(0, '请求超时，请检查网络后重试')
    throw e
  }
}

/** 非 JSON 错误体（CF 边缘 / 反代 / 裸 4xx）的兜底中文文案：statusText 是英文协议文案，不上屏。
    响应带结构化 detail 时永远以 detail 为准（见下） */
const STATUS_ZH: Record<number, string> = {
  400: '请求不合法',
  401: '未登录或登录已过期',
  403: '没有权限执行此操作',
  404: '资源不存在',
  405: '请求方法不允许',
  409: '操作冲突，请刷新后重试',
  410: '链接已过期或已撤销',
  413: '请求体过大',
  422: '参数校验失败',
  429: '请求过于频繁，请稍后再试',
  500: '服务端错误',
  502: '网关错误，请稍后再试',
  503: '服务暂不可用，请稍后再试',
}

/** pydantic 422 的 detail 是 [{loc:[...,field], msg}] 数组——译常见 msg、其余附字段名原样透出 */
function pydanticDetailText(detail: unknown[]): string | null {
  const parts = detail.map((d) => {
    if (typeof d !== 'object' || d === null) return null
    const msg = (d as { msg?: unknown }).msg
    if (typeof msg !== 'string' || !msg) return null
    const loc = (d as { loc?: unknown }).loc
    const field = Array.isArray(loc) && typeof loc.at(-1) === 'string' ? String(loc.at(-1)) : ''
    const zh = /not a valid email/i.test(msg)
      ? '邮箱格式无效'
      : /field required/i.test(msg)
        ? '缺少必填字段'
        : /at least (\d+) characters?/i.test(msg)
          ? `至少 ${msg.match(/at least (\d+) characters?/i)?.[1]} 个字符`
          : msg
    return field && field !== 'body' ? `${field}：${zh}` : zh
  })
  const ok = parts.filter((p): p is string => Boolean(p))
  return ok.length ? ok.join('；') : null
}

export async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    /* 会话中 401 ⇒ 服务端会话失效：翻回登录墙（expireSession 内只认 authed；
       登录页自身的 401 / 启动探测不触发）。动态引入避免 api → store 静态环 */
    if (r.status === 401) void import('@/store').then((m) => m.useStudio.getState().expireSession())
    let msg = STATUS_ZH[r.status] ?? r.statusText
    let detail: ErrorDetail | null = null
    try {
      const j = (await r.json()) as { detail?: unknown }
      if (typeof j.detail === 'string') msg = j.detail
      else if (isErrorDetail(j.detail)) {
        detail = j.detail
        msg = detail.message
      } else if (Array.isArray(j.detail)) {
        /* pydantic 校验错误是对象数组——原样 JSON.stringify 上屏不可读 */
        msg = pydanticDetailText(j.detail) ?? STATUS_ZH[r.status] ?? r.statusText
      } else if (j.detail) msg = JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new ApiError(r.status, msg, detail)
  }
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}

export const P = (id: string) => `/api/projects/${encodeURIComponent(id)}`
export const PUB = (token: string) => `/api/public/${encodeURIComponent(token)}`

export interface ImportDocxOpts {
  id?: string
  title?: string
  apply_styles?: boolean
  style?: StyleOverride
}
