// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api'
import type { AuditEntry, ImportReport, Pat, ProjectDetail, Settings, Style, Template } from '@/lib/types'
import { useStudio } from '@/store'
import { IntegrationsPage } from '../IntegrationsPage'
import { TemplatesPage } from '@/components/templates'
import { parseTemplateJson } from '@/components/templates/templateJson'
import { ImportDocxDialog, ImportPanel, ImportReportPanel } from '@/components/importer'
import { flattenStyle, pickStyle } from '@/components/importer/styleLeaves'
import { MoreSheet } from '@/components/mobile/MoreSheet'
import { MobileSettings } from '@/components/mobile/MobileSettings'
import { PAGES } from '@/components/settings/schema'

/**
 * R7/R9 UI（docs/plan/10 §7 / §9）：
 * - 三 slice 对后端 501 置 *Unavailable 且不弹 toast（prep 契约，保留）；
 * - F4 实装：导入对话框（拖入 → 样式建议勾选 → 创建跳转 → 报告）、模板页（保存/列表/应用/删除/导入导出）、集成页（PAT 一次性明文/撤销/片段复制/审计）；
 * - 1440 与 375 两种断点各挂载一次，axe 0 违规。
 * fetch 统一 mock：默认 /api/pat /api/templates /api/projects/import/docx 返回 501（与 backend errors.not_implemented 形状一致），单测按需覆盖。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true
const testQC = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })

const json = (data: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const notImplemented = (unit: string) =>
  json({ detail: { kind: 'not_implemented', message: `${unit} 尚未实现`, line: null, detail: unit } }, 501)

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

const SETTINGS: Settings = { abstract_figure: ['1.png', 5], spec_figures: [], sub_except: ['x'], abstract_limit: 250, style: { fonts: { body_cjk: '仿宋' } } }

const TEMPLATES: Template[] = [
  {
    name: '仿宋版', description: '代理所常用', document_type: 'patent_cn_invention',
    settings: { style: { fonts: { body_cjk: '仿宋' } }, sub_except: null, abstract_limit: 300 },
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
  },
  {
    name: '紧凑', description: '', document_type: 'patent_cn_invention',
    settings: { style: { paragraph: { line_spacing: 1.2 } }, sub_except: ['CO2'], abstract_limit: null },
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-03T00:00:00Z',
  },
]

const PATS: Pat[] = [
  { id: 'p1', name: 'Codex 笔记本', prefix: 'pat_ab12', created_at: '2026-09-01T00:00:00Z', last_used_at: '2026-09-04T10:00:00Z' },
  { id: 'p2', name: 'Claude', prefix: 'pat_cd34', created_at: '2026-09-02T00:00:00Z', last_used_at: null },
]

const AUDIT: AuditEntry[] = Array.from({ length: 50 }, (_, i) => ({
  ts: `2026-09-05T01:${String(i % 60).padStart(2, '0')}:00Z`,
  who: i % 2 ? 'local' : 'alice@x.io',
  tool: i % 3 ? 'patch_block' : 'build',
  args: { block_id: `claims/${i}`, direct: false },
  result: i % 7 ? 'ok' : 'error:validation',
}))

const REPORT: ImportReport = {
  books: { abstract: 3, claims: 10, description: 40 },
  figures: ['1.png', '2.png'],
  items: [
    { code: 'title.guessed', para_index: 0, text: '一种装置', detail: null },
    { code: 'formula.partial', para_index: 7, text: 'x = ∑ y', detail: 'OMML 嵌套分式' },
    { code: 'unsupported.textbox', para_index: 12, text: '', detail: null },
  ],
  style_suggestion: null,
}

const SUGGESTION = {
  style: { fonts: { body_cjk: '仿宋', body_size_pt: 12 }, paragraph: { line_spacing: 1.5 } },
  evidence: { 'fonts.body_cjk': 'Normal 样式 eastAsia', 'paragraph.line_spacing': 'Normal w:spacing line=360' },
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q.includes('min-width') ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  desktop = true
  useStudio.getState().resetMcp()
  useStudio.getState().resetTemplates()
  useStudio.getState().resetImporter()
  useStudio.setState({ dialog: null, toasts: [], pid: null, settings: null, content: '', saved: '', dirtyGuard: { pending: null } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = urlOf(input)
    if (url.startsWith('/api/pat')) return notImplemented('F1-mcp-server')
    if (url.startsWith('/api/templates')) return notImplemented('F3-docx-import-templates')
    if (url.startsWith('/api/projects/import/docx') || url.startsWith('/api/import/docx')) return notImplemented('F3-docx-import-templates')
    return new Response('{}', { status: 404 })
  })
})

afterEach(async () => {
  testQC.clear()
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<QueryClientProvider client={testQC}><TooltipProvider>{el}</TooltipProvider></QueryClientProvider>))
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)!
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const pickFile = (input: HTMLInputElement, file: File) =>
  act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
const calls = () => vi.mocked(fetch).mock.calls.map(([u, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${urlOf(u)}`)
const bodyOf = (pattern: string) => {
  const c = vi.mocked(fetch).mock.calls.find(([u, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${urlOf(u)}` === pattern)!
  return (c[1] as RequestInit).body
}

/* ------------------------------------------------------------------ 集成页 */

describe('R7 mcp slice + IntegrationsPage', () => {
  it('authStatus=off：loadPats 不发请求（无 501 控制台噪音）直接 patsUnavailable', async () => {
    useStudio.setState({ authStatus: 'off' })
    await useStudio.getState().loadPats()
    expect(useStudio.getState().patsUnavailable).toBe(true)
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => urlOf(u).endsWith('/api/pat'))).toEqual([])
    useStudio.setState({ authStatus: 'unknown' })
  })
  it('PAT 501 → patsUnavailable, page shows local-only text, no toast, no axe violations', async () => {
    const el = await mount(<IntegrationsPage />)
    expect(useStudio.getState().patsUnavailable).toBe(true)
    expect(el.querySelector('[data-testid="pat-unavailable"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="pat-create-form"]')).toBeNull()
    expect(el.textContent).toContain('python -m app.mcp')
    expect(el.textContent).toContain(`${window.location.origin}/mcp`)
    expect(el.querySelector('[data-testid="snippet-codex"]')!.textContent).toContain('[mcp_servers.patent-studio]')
    expect(el.querySelector('[data-testid="snippet-claude"]')!.textContent).toContain('claude mcp add patent-studio')
    expect(useStudio.getState().toasts).toEqual([])
    expect(await violations(el)).toEqual([])
  })

  function authOn() {
    let pats = [...PATS]
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = urlOf(input)
      const m = init?.method ?? 'GET'
      if (url === '/api/pat' && m === 'GET') return json(pats)
      if (url === '/api/pat' && m === 'POST') {
        const { name } = JSON.parse(String(init!.body)) as { name: string }
        const p: Pat = { id: 'p9', name, prefix: 'pat_ef56', created_at: '2026-09-05T00:00:00Z', last_used_at: null }
        pats = [p, ...pats]
        return json({ ...p, token: 'pat_ef56_PLAINTEXT_ONLY_ONCE' })
      }
      if (url.startsWith('/api/pat/') && m === 'DELETE') {
        pats = pats.filter((p) => !url.endsWith(p.id))
        return json(null, 204)
      }
      if (url.startsWith('/api/projects/demo/audit')) return json(AUDIT)
      return new Response('{}', { status: 404 })
    })
    useStudio.setState({ authStatus: 'authed', pid: 'demo' })
  }

  it('AUTH=on: lists PATs, creates one (token shown once, copy, dismiss), revokes with confirm; audit shows 50 rows', async () => {
    authOn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const el = await mount(<IntegrationsPage />)

    expect(el.querySelectorAll('[data-testid="pat-row"]')).toHaveLength(2)
    expect(el.textContent).toContain('pat_ab12…')
    expect(el.textContent).toContain('尚未使用')
    expect(calls()).toContain('GET /api/projects/demo/audit?limit=50')
    expect(el.querySelectorAll('[data-testid="audit-list"] li')).toHaveLength(50)
    expect(el.querySelector('[data-testid="audit-list"]')!.textContent).toContain('validation')

    await type(q<HTMLInputElement>('[data-testid="pat-name"]', el), 'CI 机器人')
    await click(q('[data-testid="pat-create"]', el))
    expect(JSON.parse(String(bodyOf('POST /api/pat')))).toEqual({ name: 'CI 机器人' })
    const banner = q('[data-testid="pat-new"]', el)
    expect(banner.textContent).toContain('明文只显示这一次')
    expect(q('[data-testid="pat-token"]', el).textContent).toBe('pat_ef56_PLAINTEXT_ONLY_ONCE')
    expect(el.querySelectorAll('[data-testid="pat-row"]')).toHaveLength(3)
    // 新令牌自动填进 Claude HTTP 片段
    expect(q('[data-testid="snippet-claude"]', el).textContent).toContain('Bearer pat_ef56_PLAINTEXT_ONLY_ONCE')
    expect(await violations(el)).toEqual([])

    await click(q('[data-testid="pat-token-copy"]', el))
    expect(writeText).toHaveBeenCalledWith('pat_ef56_PLAINTEXT_ONLY_ONCE')
    await click(q('[data-testid="copy-codex"]', el))
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('[mcp_servers.patent-studio]'))

    await click(q('[data-testid="pat-new-dismiss"]', el))
    expect(el.querySelector('[data-testid="pat-new"]')).toBeNull()
    expect(el.textContent).not.toContain('PLAINTEXT_ONLY_ONCE')

    await click(q('[data-testid="pat-revoke-p1"]', el))
    expect(calls()).not.toContain('DELETE /api/pat/p1')
    await click(q('[data-testid="pat-revoke-confirm-p1"]', el))
    expect(calls()).toContain('DELETE /api/pat/p1')
    expect(el.querySelectorAll('[data-testid="pat-row"]')).toHaveLength(2)
    expect(el.textContent).not.toContain('Codex 笔记本')
  })

  it('clipboard failure → error toast instead of crash', async () => {
    authOn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    const el = await mount(<IntegrationsPage />)
    await click(q('[data-testid="copy-claude"]', el))
    expect(useStudio.getState().toasts.map((t) => t.kind)).toEqual(['error'])
  })

  it('R115-批22：审计满窗 →「加载更早」扩容重查；窗口大于返回数后按钮消失', async () => {
    authOn()
    const el = await mount(<IntegrationsPage />)
    const more = q<HTMLButtonElement>('[data-testid="audit-load-more"]', el)!
    expect(more).not.toBeNull()  // 返回满窗 50 ⇒ 可能还有更早
    await click(more)
    expect(calls()).toContain('GET /api/projects/demo/audit?limit=100')
    expect(q('[data-testid="audit-load-more"]', el)).toBeNull()  // 50 < 100 ⇒ 到头
    expect(el.textContent).toContain('全部 50 条')
  })

  it('375: same sections, token cards, snippets horizontally scrollable, no axe violations', async () => {
    desktop = false
    authOn()
    const el = await mount(<IntegrationsPage />)
    expect(el.querySelectorAll('[data-testid="pat-row"]')).toHaveLength(2)
    expect(el.querySelectorAll('[data-testid="audit-list"] li')).toHaveLength(50)
    expect(q('[data-testid="snippet-codex"] pre', el).className).toContain('overflow-x-auto')
    expect(await violations(el)).toEqual([])
  })
})

/* ------------------------------------------------------------------ 模板页 */

describe('R9 templates slice + TemplatesPage', () => {
  it('templates 501 → templatesUnavailable, no toast, no axe violations', async () => {
    const el = await mount(<TemplatesPage />)
    expect(useStudio.getState().templatesUnavailable).toBe(true)
    expect(el.querySelector('[data-testid="templates-unavailable"]')).not.toBeNull()
    expect(useStudio.getState().toasts).toEqual([])
    expect(await violations(el)).toEqual([])
  })

  it('saveCurrentAsTemplate takes style/sub_except/abstract_limit only and posts TemplateIn', async () => {
    useStudio.setState({ settings: SETTINGS })
    const r = await useStudio.getState().saveCurrentAsTemplate('仿宋版')
    expect(r).toBeNull()
    const call = vi.mocked(fetch).mock.calls.find(([u]) => String(u) === '/api/templates')!
    const body = JSON.parse(String((call[1] as RequestInit).body))
    expect(body).toEqual({
      name: '仿宋版', description: '', document_type: 'patent_cn_invention',
      settings: { style: { fonts: { body_cjk: '仿宋' } }, sub_except: ['x'], abstract_limit: 250 },
    })
  })

  function templatesOn() {
    let list = [...TEMPLATES]
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = urlOf(input)
      const m = init?.method ?? 'GET'
      if (url === '/api/templates' && m === 'GET') return json(list)
      if (url === '/api/templates' && m === 'POST') {
        const t = JSON.parse(String(init!.body)) as Template
        const saved = { ...t, created_at: 'now', updated_at: 'now' }
        list = [...list, saved]
        return json(saved)
      }
      if (url.startsWith('/api/templates/') && m === 'PUT') {
        const t = JSON.parse(String(init!.body)) as Template
        const saved = { ...t, created_at: 'old', updated_at: 'now' }
        list = list.map((x) => (x.name === t.name ? saved : x))
        return json(saved)
      }
      if (url.startsWith('/api/templates/') && m === 'DELETE') {
        list = list.filter((t) => encodeURIComponent(t.name) !== url.slice('/api/templates/'.length))
        return json(null, 204)
      }
      if (url === '/api/projects/demo/templates/apply') return json({ settings: { ...SETTINGS, abstract_limit: 300 } })
      return new Response('{}', { status: 404 })
    })
    useStudio.setState({ pid: 'demo', settings: SETTINGS })
  }

  it('lists templates with read-only document_type; save form posts; same name → PUT overwrite', async () => {
    templatesOn()
    const el = await mount(<TemplatesPage />)
    const rows = el.querySelectorAll('[data-testid="template-row"]')
    expect(rows).toHaveLength(2)
    // 按 updated_at 倒序：紧凑(09-03) 在 仿宋版(09-02) 之前
    expect(rows[0].textContent).toContain('紧凑')
    expect(rows[1].textContent).toContain('仿宋版')
    expect(rows[1].textContent).toContain('代理所常用')
    expect(rows[0].textContent).toContain('下标例外 1')
    expect(el.querySelectorAll('[data-testid="template-doctype"]')).toHaveLength(2)
    expect(q('[data-testid="template-doctype"]', el).textContent).toBe('发明专利')
    expect(el.querySelector('input[name="document_type"], select[name="document_type"]')).toBeNull()
    expect(await violations(el)).toEqual([])

    await type(q<HTMLInputElement>('[data-testid="template-name"]', el), '新模板')
    await click(q('[data-testid="template-save"]', el))
    expect(JSON.parse(String(bodyOf('POST /api/templates'))).name).toBe('新模板')
    expect(el.querySelectorAll('[data-testid="template-row"]')).toHaveLength(3)
    expect(q<HTMLInputElement>('[data-testid="template-name"]', el).value).toBe('')

    await type(q<HTMLInputElement>('[data-testid="template-name"]', el), '仿宋版')
    expect(q('[data-testid="template-save"]', el).textContent).toContain('覆盖')
    await click(q('[data-testid="template-save"]', el))
    expect(calls()).toContain(`PUT /api/templates/${encodeURIComponent('仿宋版')}`)
    expect(el.querySelectorAll('[data-testid="template-row"]')).toHaveLength(3)
  })

  it('apply posts to current pid and updates settings; delete needs confirm; export downloads exact object', async () => {
    templatesOn()
    const createObjectURL = vi.fn((_b: Blob) => 'blob:x')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const el = await mount(<TemplatesPage />)

    await click(q(`[data-testid="template-apply-${'仿宋版'}"]`, el))
    expect(JSON.parse(String(bodyOf('POST /api/projects/demo/templates/apply')))).toEqual({ name: '仿宋版' })
    expect(useStudio.getState().settings?.abstract_limit).toBe(300)

    await click(q(`[data-testid="template-export-${'仿宋版'}"]`, el))
    expect(anchorClick).toHaveBeenCalled()
    const blob = createObjectURL.mock.calls[0]![0]
    expect(JSON.parse(await blob.text())).toEqual(TEMPLATES[0])

    await click(q(`[data-testid="template-delete-${'紧凑'}"]`, el))
    expect(calls().some((c) => c.startsWith('DELETE'))).toBe(false)
    await click(q(`[data-testid="template-delete-confirm-${'紧凑'}"]`, el))
    expect(calls()).toContain(`DELETE /api/templates/${encodeURIComponent('紧凑')}`)
    expect(el.querySelectorAll('[data-testid="template-row"]')).toHaveLength(1)
  })

  it('apply on a dirty document goes through the dirty guard', async () => {
    templatesOn()
    useStudio.setState({ content: 'edited', saved: 'orig' })
    const el = await mount(<TemplatesPage />)
    await click(q(`[data-testid="template-apply-${'仿宋版'}"]`, el))
    expect(useStudio.getState().dirtyGuard.pending).toMatchObject({ type: 'custom', label: '应用模板「仿宋版」' })
    expect(calls().some((c) => c.includes('/templates/apply'))).toBe(false)
  })

  it('import JSON: invalid → toast, valid → POST; empty state offers import', async () => {
    templatesOn()
    const el = await mount(<TemplatesPage />)
    const input = q<HTMLInputElement>('[data-testid="template-import-file"]', el)
    await pickFile(input, new File(['{"nope": 1}'], 'bad.json', { type: 'application/json' }))
    await act(async () => { await Promise.resolve() })
    expect(useStudio.getState().toasts.at(-1)).toMatchObject({ kind: 'error' })
    expect(useStudio.getState().toasts.at(-1)!.text).toContain('缺少 name')

    await pickFile(input, new File([JSON.stringify({ name: '外来', settings: { style: { fonts: { body_cjk: '楷体' } } } })], 'ok.json'))
    await act(async () => { await Promise.resolve() })
    const body = JSON.parse(String(bodyOf('POST /api/templates')))
    expect(body).toEqual({ name: '外来', description: '', document_type: 'patent_cn_invention', settings: { style: { fonts: { body_cjk: '楷体' } } } })
    expect(el.querySelectorAll('[data-testid="template-row"]')).toHaveLength(3)
  })

  it('empty state explains and offers JSON import', async () => {
    vi.mocked(fetch).mockImplementation(async () => json([]))
    const el = await mount(<TemplatesPage />)
    expect(el.querySelector('[data-testid="templates-empty"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="template-import"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="templates-list"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('375: rows wrap, actions collapse into ⋯ menu, no axe violations', async () => {
    desktop = false
    templatesOn()
    const el = await mount(<TemplatesPage />)
    expect(el.querySelector('[data-testid="template-apply-仿宋版"]')).toBeNull()
    expect(el.querySelectorAll('[data-testid^="template-more-"]')).toHaveLength(2)
    expect(await violations(el)).toEqual([])
  })

  it('parseTemplateJson rejects malformed input with a readable reason', () => {
    expect(() => parseTemplateJson('[]')).toThrow('不是 JSON 对象')
    expect(() => parseTemplateJson('{"name":"a"}')).toThrow('缺少 settings')
    expect(() => parseTemplateJson('{"name":"a","settings":{"style":[]}}')).toThrow('settings.style')
    expect(() => parseTemplateJson('{"name":"a","settings":{},"document_type":"thesis"}')).toThrow('document_type')
    expect(() => parseTemplateJson('not json')).toThrow()
    expect(parseTemplateJson('{"name":" a ","settings":{"abstract_limit":200,"sub_except":["x"]}}')).toEqual({
      name: 'a', description: '', document_type: 'patent_cn_invention', settings: { style: {}, abstract_limit: 200, sub_except: ['x'] },
    })
  })

})

/* ------------------------------------------------------------------ 导入 */

describe('R9 importer slice + ImportDocxDialog', () => {
  it('importDocx 501 → importUnavailable + phase error; dialog opens via DialogId import-docx', async () => {
    await mount(<ImportDocxDialog />)
    await act(async () => useStudio.getState().openDialog('import-docx'))
    expect(document.querySelector('[data-testid="import-docx-dialog"]')).not.toBeNull()
    const ok = await useStudio.getState().importDocx(new File(['x'], 'a.docx'))
    expect(ok).toBe(false)
    const s = useStudio.getState()
    expect(s.importPhase).toBe('error')
    expect(s.importUnavailable).toBe(true)
    expect(s.toasts).toEqual([])
    expect(await violations(document.body)).toEqual([])
  })

  it('ImportReportPanel renders three book cards, figures, expandable items with code/para/text/detail', async () => {
    const el = await mount(<ImportReportPanel report={REPORT} />)
    const report = q('[data-testid="import-report"]', el)
    expect(report.textContent).toContain('权利要求书')
    expect(report.textContent).toContain('10')
    expect(report.textContent).toContain('摘要')
    expect(report.textContent).toContain('说明书')
    expect(q('[data-testid="import-report-figures"]', el).textContent).toContain('2')
    const details = q<HTMLDetailsElement>('[data-testid="import-report-items"]', el)
    expect(details.tagName).toBe('DETAILS')
    expect(details.querySelector('summary')!.textContent).toContain('3')
    expect(details.textContent).toContain('formula.partial')
    expect(details.textContent).toContain('第 7 段')
    expect(details.textContent).toContain('x = ∑ y')
    expect(details.textContent).toContain('OMML 嵌套分式')
    expect(details.textContent).toContain('不支持的元素已丢弃（textbox）')
    expect(details.textContent).toContain('（空段落）')
    expect(await violations(el)).toEqual([])
  })

  it('ImportPanel (dockview 导入面板): empty → entry button opens wizard via dirtyGuard; with report → renders it and locates lines', async () => {
    const el = await mount(<ImportPanel />)
    expect(el.querySelector('[data-testid="import-report"]')).toBeNull()
    useStudio.setState({ content: 'edited', saved: 'orig' })
    await act(async () => q<HTMLButtonElement>('[data-testid="import-panel-open"]', el).click())
    expect(useStudio.getState().dialog).toBeNull()
    const pending = useStudio.getState().dirtyGuard.pending
    if (pending?.type !== 'custom') throw new Error('expected custom nav action')
    expect(pending.label).toBe('导入 Word 文档')
    await act(async () => pending.run())
    expect(useStudio.getState().dialog).toBe('import-docx')

    useStudio.setState({ dialog: null, saved: 'x', content: '第一段\nx = ∑ y 公式段\n', pid: 'imp', importedPid: 'imp', importReport: REPORT })
    await act(async () => {})
    expect(q('[data-testid="import-report"]', el).textContent).toContain('权利要求书')
    expect(el.textContent).toContain('本案由 Word 导入生成')
    const details = q<HTMLDetailsElement>('[data-testid="import-report-items"]', el)
    const item = [...details.querySelectorAll('button')].find((b) => b.textContent?.includes('x = ∑ y'))!
    await act(async () => item.click())
    expect(useStudio.getState().scrollRequest?.line).toBe(2)
    expect(await violations(el)).toEqual([])
  })

  it('ImportReportPanel hides item section when nothing was unmapped', async () => {
    const el = await mount(<ImportReportPanel report={{ ...REPORT, items: [], figures: [] }} />)
    expect(el.querySelector('[data-testid="import-report-items"]')).toBeNull()
    expect(q('[data-testid="import-report-figures"]', el).textContent).toContain('0')
  })

  function importOn() {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = urlOf(input)
      const m = init?.method ?? 'GET'
      if (url === '/api/import/docx/styles') return json(SUGGESTION)
      if (url === '/api/projects/import/docx') {
        const form = init!.body as FormData
        return json({
          project: { id: String(form.get('id') ?? 'x'), title: String(form.get('title') ?? ''), created_at: 'now', updated_at: 'now' },
          report: { ...REPORT, style_suggestion: SUGGESTION },
        })
      }
      if (url === '/api/projects' && m === 'GET') return json([])
      if (url.startsWith('/api/projects/') && url.endsWith('/settings') && m === 'PUT') return json({ settings: JSON.parse(String(init!.body)), effective_style: {} })
      if (url.startsWith('/api/projects/') && m === 'GET') return json({ id: 'my-invention', title: '', settings: SETTINGS, content: '', figures: [], docs: {}, created_at: 'now', updated_at: 'now' })
      return new Response('{}', { status: 404 })
    })
  }

  it('pick .docx → suggestions default-checked → create with all styles → report shown', async () => {
    importOn()
    await mount(<ImportDocxDialog />)
    await act(async () => useStudio.getState().openDialog('import-docx'))
    const dlg = q('[data-testid="import-docx-dialog"]')
    expect(dlg.querySelector('[data-testid="import-dropzone"]')).not.toBeNull()
    expect(q('[data-testid="import-submit"]').hasAttribute('disabled')).toBe(true)

    await pickFile(q<HTMLInputElement>('[data-testid="import-docx-file"]'), new File(['x'], 'My Invention.docx'))
    await act(async () => { await Promise.resolve() })
    expect(calls()).toContain('POST /api/import/docx/styles')
    expect(q<HTMLInputElement>('#import-pid').value).toBe('my-invention')
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid^="style-suggest-"]'))
    expect(boxes.map((b) => b.dataset.testid)).toEqual(['style-suggest-fonts.body_cjk', 'style-suggest-fonts.body_size_pt', 'style-suggest-paragraph.line_spacing'])
    expect(boxes.every((b) => b.checked)).toBe(true)
    expect(q('[data-testid="import-style-suggestions"]').textContent).toContain('Normal 样式 eastAsia')
    expect(await violations(document.body)).toEqual([])

    await type(q<HTMLInputElement>('#import-title'), '一种装置')
    await click(q('[data-testid="import-submit"]'))
    const form = bodyOf('POST /api/projects/import/docx') as FormData
    expect(form.get('id')).toBe('my-invention')
    expect(form.get('title')).toBe('一种装置')
    expect(form.get('apply_styles')).toBe('true')
    expect(calls().some((c) => c.startsWith('PUT '))).toBe(false)
    expect(document.querySelector('[data-testid="import-report"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="import-done"]')).not.toBeNull()
    expect(useStudio.getState().importedPid).toBe('my-invention')
    expect(await violations(document.body)).toEqual([])
  })

  it('form 包装使输入框 Enter = 提交（requestSubmit → POST /projects/import/docx）', async () => {
    importOn()
    await mount(<ImportDocxDialog />)
    await act(async () => useStudio.getState().openDialog('import-docx'))
    await pickFile(q<HTMLInputElement>('[data-testid="import-docx-file"]'), new File(['x'], 't.docx'))
    await act(async () => { await Promise.resolve() })
    const sent = () => calls().filter((c) => c === 'POST /api/projects/import/docx').length
    const before = sent()
    const form = q<HTMLFormElement>('[data-testid="import-docx-dialog"] form')!
    await act(async () => form.requestSubmit())
    expect(sent()).toBe(before + 1)
    expect(document.querySelector('[data-testid="import-done"]')).not.toBeNull()
  })

  it('unchecking part of the suggestions sends only the picked leaves as `style` (no follow-up PUT)', async () => {
    importOn()
    await mount(<ImportDocxDialog />)
    await act(async () => useStudio.getState().openDialog('import-docx'))
    await pickFile(q<HTMLInputElement>('[data-testid="import-docx-file"]'), new File(['x'], 'a.docx'))
    await act(async () => { await Promise.resolve() })
    await click(q('[data-testid="style-suggest-fonts.body_size_pt"]'))
    expect(q<HTMLInputElement>('[data-testid="style-suggest-fonts.body_size_pt"]').checked).toBe(false)
    await click(q('[data-testid="import-submit"]'))
    const form = bodyOf('POST /api/projects/import/docx') as FormData
    expect(form.get('apply_styles')).toBe('false')
    expect(JSON.parse(String(form.get('style')))).toEqual({ fonts: { body_cjk: '仿宋' }, paragraph: { line_spacing: 1.5 } })
    expect(calls().some((c) => c.startsWith('PUT '))).toBe(false)
  })

  it('rejects non-docx and shows error inside the dialog; 375 uses full-screen layout', async () => {
    desktop = false
    importOn()
    await mount(<ImportDocxDialog />)
    await act(async () => useStudio.getState().openDialog('import-docx'))
    const dlg = q('[data-testid="import-docx-dialog"]')
    expect(dlg.className).toContain('h-dvh')
    await pickFile(q<HTMLInputElement>('[data-testid="import-docx-file"]'), new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    expect(q('[data-testid="import-error"]').textContent).toContain('.docx')
    expect(calls()).not.toContain('POST /api/import/docx/styles')
    expect(await violations(document.body)).toEqual([])
  })

  it('R63 选件期透出：styles 提取失败即在对话框内见错误（此前静默到提交才 400）', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      urlOf(input) === '/api/import/docx/styles' ? json({ detail: '不是有效的 DOCX 文件' }, 400) : new Response('{}', { status: 404 }))
    await mount(<ImportDocxDialog />)
    await act(async () => useStudio.getState().openDialog('import-docx'))
    await pickFile(q<HTMLInputElement>('[data-testid="import-docx-file"]'), new File(['x'], 'bad.docx'))
    await act(async () => { await Promise.resolve() })
    expect(q('[data-testid="import-error"]').textContent).toContain('不是有效的 DOCX 文件')
  })

  it('styleLeaves: flatten/pick round-trip', () => {
    const leaves = flattenStyle(SUGGESTION.style)
    expect(leaves.map((l) => l.key)).toEqual(['fonts.body_cjk', 'fonts.body_size_pt', 'paragraph.line_spacing'])
    expect(pickStyle(SUGGESTION.style, new Set(['paragraph.line_spacing']))).toEqual({ paragraph: { line_spacing: 1.5 } })
    expect(pickStyle(SUGGESTION.style, new Set())).toEqual({})
  })
})

/* ------------------------------------------------------------------ 375 入口（集成：MoreSheet 导入 · MobileSettings 页面下拉可达模板/集成） */

const STYLE: Style = {
  fonts: { body_cjk: '宋体', heading_cjk: '黑体', ascii: 'Times New Roman', label_ascii: 'Times New Roman', mono: 'Consolas' },
  sizes: { body: 10.5, title: 16, section_heading: 12, subsection_heading: 10.5, header: 9, footer: 9, page_number: 9, para_number: 10.5, table: 9, equation: 10.5, code: 9 },
  paragraph: { line_spacing: 1.5, first_indent_pt: 21, space_after: { body: 0 } },
  page: { width_cm: 21, height_cm: 29.7, margin_top_mm: 25, margin_bottom_mm: 20, margin_left_mm: 25, margin_right_mm: 20, header_distance_cm: 1.5, footer_distance_cm: 1.5, line_pitch: 15.6, default_tab_stop: 420 },
  header: { labels: { abstract: '说明书摘要', abstract_figure: '摘要附图', claims: '权利要求书', description: '说明书', figures: '说明书附图' }, spacing_short: 0, spacing_long: 0, rule_sz: 4, rule_space: 1 },
  footer: { codes: { abstract: '1', abstract_figure: '2', claims: '3', description: '4', figures: '5' }, year_text: '', rule_sz: 4, rule_space: 1 },
  table: { defaults: {}, cell_space_after: 0, rule_outer_sz: 8, rule_head_sz: 4 },
  equation: { side_cm: 1 },
}

describe('mobile entries (375)', () => {
  beforeEach(() => { desktop = false })

  it('MoreSheet「导入 Word 文档…」opens the import dialog through dirtyGuard', async () => {
    useStudio.setState({ moreOpen: true })
    await mount(<MoreSheet />)
    await click(q('[data-testid="more-import-docx"]'))
    expect(useStudio.getState().dialog).toBe('import-docx')
    expect(useStudio.getState().moreOpen).toBe(false)
  })

  it('MobileSettings page dropdown lists every PAGES entry and reaches 模板 / 集成', async () => {
    const project: ProjectDetail = { id: 'demo', title: '示例', mtime: 0, figs: [], settings: SETTINGS, has_settings_file: true, content: '', backups: [] }
    useStudio.setState({ pid: 'demo', project, figs: [], defaults: STYLE, defaultSettings: { ...SETTINGS, style: {} }, settings: SETTINGS })
    const el = await mount(<MobileSettings />)
    expect(el.querySelector('[data-testid="settings-page-page"]')).not.toBeNull()

    const trigger = q('[data-testid="mobile-settings-page-select"]')
    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })))
    const options = Array.from(document.querySelectorAll('[data-testid^="mobile-settings-page-option-"]'))
    expect(options.map((o) => o.getAttribute('data-testid'))).toEqual(PAGES.map((p) => `mobile-settings-page-option-${p.id}`))
    await click(q('[data-testid="mobile-settings-page-option-templates"]'))
    expect(el.querySelector('[data-testid="settings-page-templates"]')).not.toBeNull()
    expect(trigger.textContent).toContain('模板')

    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })))
    await click(q('[data-testid="mobile-settings-page-option-integrations"]'))
    expect(el.querySelector('[data-testid="settings-page-integrations"]')).not.toBeNull()
    expect(await violations(el)).toEqual([])
  })
})

describe('api error shape', () => {
  it('ApiError carries structured detail from 501', async () => {
    const { api } = await import('@/lib/api')
    const err = await api.templates().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(501)
    expect((err as ApiError).detail?.kind).toBe('not_implemented')
  })
})
