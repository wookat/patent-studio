import { EMPTY_LINT, P, REQ_TIMEOUT_MS, handle, netFetch, req } from './net'
import type { PutDocInput, PutDocResult } from './net'
import type { Backup, BuildOutcome, CheckResult, Health, LintReport, ProjectDetail, ProjectSummary, ReviewMode, Settings, Style, XmlExportResult } from '../types'
import type { Ast, BookName } from '@/types/ast'
import type { CasePatch } from '@/types/case'

/** R49-O1：版面视图每书各一个 LayoutView 实例会同刻重取 style.css——单飞共享 in-flight 请求；各调用方 abort 只取消自己 */
const styleCssInflight = new Map<string, Promise<string>>()

export const coreApi = {
  health: () => req<Health>('/api/health'),
  projects: () => req<ProjectSummary[]>('/api/projects'),
  project: (id: string) => req<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),
  /** W4-A：新建案卷可附台账字段（案号 / 客户 / 责任人…），直接写入 case.json；
      W19 批7：parentPid ⇒ 建分案，后端自动与母案双向互链 related */
  createProject: (id: string, title: string, caseFields?: CasePatch, parentPid?: string) =>
    req<ProjectDetail>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ id, title, case: caseFields, ...(parentPid ? { parent_pid: parentPid } : {}) }),
    }),
  /** 乐观并发（批76）：base = 客户端自认与盘一致的内容 sha256（contentSha() 产出）；
      与现值不符 ⇒ 409 conflict。多页签/多会话防静默覆盖，putDoc base_sha 同族 */
  saveContent: (id: string, content: string, base?: string) =>
    req<{ ok: boolean; backup: string | null; backups: Backup[] }>(
      `/api/projects/${encodeURIComponent(id)}/content`,
      { method: 'PUT', body: JSON.stringify({ content, base }) },
    ),
  backup: (id: string, name: string) =>
    req<{ name: string; content: string }>(
      `/api/projects/${encodeURIComponent(id)}/backups/${encodeURIComponent(name)}`,
    ),
  defaults: () => req<{ style: Style; settings: Settings }>('/api/settings/defaults'),
  saveSettings: (id: string, settings: Settings) =>
    req<{ settings: Settings; effective_style: Style }>(
      `/api/projects/${encodeURIComponent(id)}/settings`,
      { method: 'PUT', body: JSON.stringify(settings) },
    ),
  build: async (
    id: string,
    body: { content?: string; settings?: Settings; pdf?: boolean; mode?: ReviewMode },
    signal?: AbortSignal,
  ) => {
    const out = await req<BuildOutcome>(`/api/projects/${encodeURIComponent(id)}/build`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
      timeout: false, // LO 构建 PDF 常超 2 分钟
    })
    return { ...out, diagnostics: Array.isArray(out.diagnostics) ? out.diagnostics : [] }
  },
  /** 当前案形式检查（POST /api/projects/{pid}/lint；不传 content/settings 时后端用磁盘上的） */
  lint: async (id: string, body: { content?: string; settings?: Settings }) => {
    const r = await req<LintReport>(`/api/projects/${encodeURIComponent(id)}/lint`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { diagnostics: r.diagnostics ?? [], counts: { ...EMPTY_LINT.counts, ...(r.counts ?? {}) } }
  },
  check: () => req<CheckResult>('/api/check', { method: 'POST' }),
  exportXml: (id: string, body: { content?: string; settings?: Settings; mode?: ReviewMode }) =>
    req<XmlExportResult>(`/api/projects/${encodeURIComponent(id)}/export/xml`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: false, // 同步跑整包构建
    }),
  exportUrl: (id: string, fmt: 'docx' | 'pdf', buildId?: string | null) =>
    `/api/projects/${encodeURIComponent(id)}/export?fmt=${fmt}${buildId ? `&build_id=${buildId}` : ''}`,
  figUrl: (id: string, name: string, v?: number) =>
    `/api/projects/${encodeURIComponent(id)}/figs/${encodeURIComponent(name)}${v ? `?v=${v}` : ''}`,
  /** R1：POST /api/projects/{pid}/ast；不传 content/settings 时后端用磁盘上的（04-r1-design §4） */
  getAst: (id: string, body: { content?: string; settings?: Settings } = {}, signal?: AbortSignal) =>
    req<Ast>(`/api/projects/${encodeURIComponent(id)}/ast`, { method: 'POST', body: JSON.stringify(body), signal }),
  putDoc: (id: string, book: BookName, body: PutDocInput) =>
    req<PutDocResult>(`/api/projects/${encodeURIComponent(id)}/docs/${book}`, {
      method: 'PUT',
      body: JSON.stringify(body.base_sha ? body : { content: body.content }),
    }),
  /** R2 附图（05-r2 §3.1）：全部返回 {figures, settings}，settings 已归一化可直接 set */
  styleCss: (id: string, signal?: AbortSignal) => {
    let p = styleCssInflight.get(id)
    if (!p) {
      p = (async () => {
        const r = await netFetch(`${P(id)}/style.css`, { signal: AbortSignal.timeout(REQ_TIMEOUT_MS) })
        if (!r.ok) return handle<never>(r)
        return r.text()
      })().finally(() => styleCssInflight.delete(id))
      styleCssInflight.set(id, p)
    }
    if (!signal) return p
    return new Promise<string>((res, rej) => {
      if (signal.aborted) return rej(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      const onAbort = () => rej(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      p.then(res, rej).finally(() => signal.removeEventListener('abort', onAbort))
    })
  },
  /** R3：线性公式 → MathML（复用 omml.to_mathml；prep 已实现） */
  mathml: (source: string, signal?: AbortSignal) =>
    req<{ mathml: string }>('/api/mathml', { method: 'POST', body: JSON.stringify({ source }), signal }),
  trackedDocxUrl: (id: string) => `${P(id)}/export/docx?mode=tracked`,

  /* ---------- R9 Word 导入（docs/plan/10 §5.3）；`style` = 部分采纳的样式建议（优先于 apply_styles） ---------- */
}
