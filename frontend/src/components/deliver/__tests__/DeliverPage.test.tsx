// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { fmtBytes, fmtDateTimeIso } from '@/lib/format'
import { APPLICATION_NO_RE, type DeliverManifest } from '@/types/deliver'
import type { PreflightItem, PreflightReport } from '@/types/preflight'
import { DeliverPage } from '../DeliverPage'
import { DeadlineCard, FilingReadinessCard } from '../DeliverSide'
import { ExportGrid, gridEntries } from '../ExportGrid'
import { itemState } from '../ExportItem'
import { FilingDialog } from '../FilingDialog'
import { PreflightSummary } from '../PreflightSummary'
import * as preflightUtils from '@/components/preflight/preflightUtils'

vi.mock('@/lib/download', () => ({ downloadFile: vi.fn(async () => undefined) }))

/**
 * W4-E E1（docs/plan/17 §2）：递交页的 DOM 合约 + axe 冒烟。
 *  - PreflightSummary：按严重度分组、点击定位回调、501 / 空 / 陈旧态
 *  - ExportGrid / ExportItem：六项固定顺序、状态机 missing → running → ready / error、重新生成回调、XML 展开区、「生成递交包」回调
 *  - FilingDialog：申请号格式校验、提交回调；页内按钮门槛 agent+
 *  - DeliverPage：1440 双栏 / 375 Tabs；重新生成接 build.enqueue / runXmlExport；两种断点 axe 无 serious/critical
 * jsdom 无布局：color-contrast / scrollable-region-focusable 禁用（真实浏览器 axe 见 testing skill）。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true
const initial = useStudio.getInitialState()

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q === DESKTOP_QUERY ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  useStudio.setState(initial, true)
  desktop = true
  window.location.hash = '#/p/method/deliver'
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function serious(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel)
const qa = (sel: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLElement>(sel))
const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}

const item = (rule: string, severity: PreflightItem['severity'], line: number | null, block_id: string | null): PreflightItem => ({
  rule,
  severity,
  message: `${rule} @ ${line ?? block_id}`,
  book: 'claims',
  line,
  block_id,
  detail: null,
})

const report: PreflightReport = {
  version: 1,
  items: [
    item('abstract.limit', 'info', 5, 'abstract'),
    item('claims.forward_ref', 'error', 15, 'claims/4'),
    item('claims.unsupported_term', 'warning', 15, 'claims/4'),
    item('numerals.inconsistent', 'warning', 44, 'description/附图说明/p0006'),
  ],
  counts: { error: 1, warning: 2, info: 1 },
  claim_tree: [],
  numerals: [],
  support_map: [],
  figures: [],
}

const manifest: DeliverManifest = {
  pid: 'method',
  title: '一种方法',
  items: [
    { kind: 'docx', label: 'DOCX', at: '2026-09-05T10:00:00+00:00', size: 40960, url: '/api/projects/method/export/docx?build_id=b1' },
    { kind: 'pdf', label: 'PDF', at: '2026-09-05T10:00:00+00:00', size: 204800, url: '/api/projects/method/export/pdf?build_id=b1' },
    { kind: 'xml', label: 'CNIPA XML', at: null, size: null, url: null },
    { kind: 'tracked', label: '修订版 DOCX', at: null, size: null, url: '/api/projects/method/export/docx-tracked' },
    { kind: 'figures', label: '附图 zip', at: null, size: null, url: '/api/projects/method/figures/export.zip' },
    { kind: 'bundle', label: '全部打包', at: null, size: null, url: null },
  ],
}

describe('PreflightSummary（左栏）', () => {
  it('按 error → warning → info 分组，点击条目回调 onLocate', async () => {
    const onLocate = vi.fn()
    useStudio.setState({ ast: SYNTH_AST })
    await mount(<PreflightSummary report={report} loading={false} error={null} unavailable={false} stale={false} onRerun={() => {}} onLocate={onLocate} />)
    const groups = qa('[data-testid="preflight-summary-group"]').map((g) => g.dataset.severity)
    expect(groups).toEqual(['error', 'warning', 'info'])
    const rows = qa('[data-testid="preflight-summary-item"]')
    expect(rows).toHaveLength(4)
    // W11 三批：位置是用户可读的「权利要求 4」，不露 content.md / 行号
    expect(rows[0].textContent).toContain('权利要求 4')
    expect(rows[0].textContent).not.toMatch(/content\.md|第 15 行/)
    await click(rows[0])
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ rule: 'claims.forward_ref', line: 15 }))
    expect(q('[data-testid="preflight-summary-counts"]')?.textContent).toContain('1')
  })
  it('501 → 不可用提示；无问题 → 空态；陈旧 → 横幅', async () => {
    await mount(<PreflightSummary report={null} loading={false} error={null} unavailable stale={false} onRerun={() => {}} onLocate={() => {}} />)
    expect(q('[data-testid="preflight-summary-unavailable"]')).not.toBeNull()
    await act(async () => root?.unmount())
    root = null
    const empty = { ...report, items: [], counts: { error: 0, warning: 0, info: 0 } }
    await mount(<PreflightSummary report={empty} loading={false} error={null} unavailable={false} stale onRerun={() => {}} onLocate={() => {}} />)
    expect(q('[data-testid="preflight-summary-empty"]')).not.toBeNull()
    expect(q('[data-testid="preflight-summary-stale"]')).not.toBeNull()
  })
})

describe('ExportGrid（右栏）', () => {
  it('六项固定顺序；bundle 单独置顶；manifest 为空时用 fallbackHref，缺 URL 的项下载禁用', async () => {
    expect(gridEntries(null).map((e) => e.kind)).toEqual(['docx', 'pdf', 'xml', 'tracked', 'figures', 'bundle'])
    const onDownload = vi.fn()
    const onBundle = vi.fn()
    await mount(
      <ExportGrid
        manifest={null}
        loading={false}
        unavailable={false}
        error={null}
        bundleRunning={false}
        fallbackHref={{ docx: '/x.docx', tracked: '/t.docx' }}
        onBundle={onBundle}
        onDownload={onDownload}
      />,
    )
    expect(q('[data-testid="export-grid-bundle"] [data-testid="export-item-bundle"]')).not.toBeNull()
    expect(qa('[data-testid="export-grid-items"] li')).toHaveLength(5)
    expect(q<HTMLButtonElement>('[data-testid="export-download-docx"]')?.disabled).toBe(false)
    expect(q<HTMLButtonElement>('[data-testid="export-download-pdf"]')?.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="export-download-bundle"]')?.disabled).toBe(true)
    await click(q('[data-testid="export-download-docx"]'))
    expect(onDownload).toHaveBeenCalledWith('/x.docx')
    await click(q('[data-testid="export-bundle-run"]'))
    expect(onBundle).toHaveBeenCalledTimes(1)
  })
  it('manifest 提供时显示时间与大小；501 → 提示且「生成递交包」禁用', async () => {
    await mount(
      <ExportGrid manifest={manifest} loading={false} unavailable error="not-implemented" bundleRunning={false} fallbackHref={{}} onBundle={() => {}} onDownload={() => {}} />,
    )
    expect(q('[data-testid="export-item-pdf"] [data-testid="export-item-meta"]')?.textContent).toContain('200.0 KB')
    expect(q('[data-testid="export-grid-unavailable"]')).not.toBeNull()
    expect(q<HTMLButtonElement>('[data-testid="export-bundle-run"]')?.disabled).toBe(true)
    expect(fmtBytes(null)).toBe('—')
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(fmtDateTimeIso(null)).toBe('尚未生成')
  })
  it('导出项状态机：missing → running → ready；失败 → error 保留旧产物可下载；running 时两按钮禁用', async () => {
    expect(itemState(null)).toBe('missing')
    expect(itemState(null, { running: true })).toBe('running')
    expect(itemState('/a.docx', { running: false })).toBe('ready')
    expect(itemState('/a.docx', { running: false, error: '失败' })).toBe('error')
    expect(itemState('/a.docx', { running: true, error: '失败' })).toBe('running')

    const run = vi.fn()
    const onDownload = vi.fn()
    const grid = (regen: Parameters<typeof ExportGrid>[0]['regen']) => (
      <ExportGrid manifest={manifest} loading={false} unavailable={false} error={null} bundleRunning={false} fallbackHref={{}} regen={regen} onBundle={() => {}} onDownload={onDownload} />
    )
    await mount(grid({ docx: { run, running: false }, xml: { run, running: false } }))
    expect(q('[data-testid="export-item-docx"]')?.dataset.state).toBe('ready')
    expect(q('[data-testid="export-item-xml"]')?.dataset.state).toBe('missing')
    expect(q('[data-testid="export-item-tracked"]')?.dataset.state).toBe('ready')
    expect(q('[data-testid="export-regen-tracked"]')).toBeNull()
    await click(q('[data-testid="export-regen-docx"]'))
    expect(run).toHaveBeenCalledTimes(1)

    await act(async () => root!.render(grid({ docx: { run, running: true }, xml: { run, running: true } })))
    const docx = q('[data-testid="export-item-docx"]')!
    expect(docx.dataset.state).toBe('running')
    expect(q('[data-testid="export-item-meta"]', docx)?.textContent).toContain('正在生成')
    expect(q<HTMLButtonElement>('[data-testid="export-regen-docx"]')?.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="export-download-docx"]')?.disabled).toBe(true)

    await act(async () => root!.render(grid({ docx: { run, running: false, error: '附图无法读取' }, xml: { run, running: false, error: 'DTD 失败' } })))
    expect(q('[data-testid="export-item-docx"]')?.dataset.state).toBe('error')
    expect(q('[data-testid="export-item-docx"] [data-testid="export-item-error"]')?.textContent).toContain('附图无法读取')
    expect(q<HTMLButtonElement>('[data-testid="export-download-docx"]')?.disabled).toBe(false)
    expect(q<HTMLButtonElement>('[data-testid="export-download-xml"]')?.disabled).toBe(true)
    await click(q('[data-testid="export-download-docx"]'))
    expect(onDownload).toHaveBeenCalledWith('/api/projects/method/export/docx?build_id=b1')
    expect(await serious(host)).toEqual([])
  })
  it('detail.xml → XML 卡片带展开区并独占一行；bundle 卡片只反映 running 不出重建按钮', async () => {
    await mount(
      <ExportGrid
        manifest={manifest}
        loading={false}
        unavailable={false}
        error={null}
        bundleRunning
        fallbackHref={{}}
        detail={{ xml: <p data-testid="xml-detail-stub">五书</p> }}
        onBundle={() => {}}
        onDownload={() => {}}
      />,
    )
    const xml = q('[data-testid="export-item-xml"]')!
    expect(q('[data-testid="export-item-detail"] [data-testid="xml-detail-stub"]', xml)).not.toBeNull()
    expect(xml.className).toContain('col-span-full')
    expect(q('[data-testid="export-item-bundle"]')?.dataset.state).toBe('running')
    expect(q('[data-testid="export-regen-bundle"]')).toBeNull()
    expect(q<HTMLButtonElement>('[data-testid="export-bundle-run"]')?.disabled).toBe(true)
  })
})

describe('FilingDialog（标记已递交）', () => {
  it('申请号格式：CNIPA 4位年+类别+7位流水+校验位（与后端 xml_export._APPLICATION_NO_RE 同规则——R115-批30 双写对齐）', () => {
    expect(APPLICATION_NO_RE.test('202610000001.X')).toBe(true)
    expect(APPLICATION_NO_RE.test('202410123456.7')).toBe(true)
    expect(APPLICATION_NO_RE.test('2026 1 0123456.7')).toBe(true) // 空格分隔放行（后端接受）
    expect(APPLICATION_NO_RE.test('2026100000012.3')).toBe(false)
    expect(APPLICATION_NO_RE.test('20261000.X')).toBe(false) // 非 4+1+7 结构（旧 8-12 位口径已弃）
    expect(APPLICATION_NO_RE.test('CN2026100000012')).toBe(false)
    expect(APPLICATION_NO_RE.test('20261000.')).toBe(false)
  })
  it('非法申请号阻止提交并给 alert；合法时以 {filed, application_no} 回调', async () => {
    const onSubmit = vi.fn(async () => true)
    await mount(<FilingDialog open onOpenChange={() => {}} initial={{ filed: '2026-09-05', application_no: '' }} onSubmit={onSubmit} />)
    const no = q<HTMLInputElement>('[data-testid="filing-no"]')!
    const set = (v: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(no, v)
      no.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => set('bad'))
    await act(async () => q<HTMLFormElement>('[data-testid="filing-form"]')!.requestSubmit())
    expect(q('[data-testid="filing-error"]')).not.toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => set('202610000001.X'))
    await act(async () => q<HTMLFormElement>('[data-testid="filing-form"]')!.requestSubmit())
    expect(onSubmit).toHaveBeenCalledWith({ filed: '2026-09-05', application_no: '202610000001.X' })
    expect(await serious(q('[data-testid="filing-dialog"]')!)).toEqual([])
  })
})

describe('DeliverPage（路由页）', () => {
  const project = {
    id: 'method',
    title: '一种方法',
    mtime: 0,
    collaborators: [],
    last_modified_by: null,
    my_role: 'owner' as const,
    list_state: 'active' as const,
    figs: [],
    settings: {} as never,
    has_settings_file: false,
    content: '# x',
    backups: [],
  }
  beforeEach(() => {
    useStudio.setState({
      pid: 'method',
      project: project as never,
      authStatus: 'off',
      preflight: report,
      preflightContent: '# x',
      content: '# x',
      manifest,
    })
    useStudio.setState({ loadPreflight: vi.fn(async () => report), loadManifest: vi.fn(async () => manifest) })
  })

  it('1440：双栏（体检左 / 导出右）+ 标记已递交按钮 + axe', async () => {
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="deliver-desktop"]')).not.toBeNull()
    expect(q('[data-testid="deliver-mobile"]')).toBeNull()
    expect(q('[data-testid="check-section"]')).not.toBeNull()
    // T10：文件真源体检标注为递交就绪/流程条的判定依据
    expect(q('[data-testid="deliver-checks-gate-note"]')?.textContent).toContain('递交就绪')
    expect(q('[data-testid="export-grid"]')).not.toBeNull()
    expect(q('[data-testid="deliver-file"]')).not.toBeNull()
    expect(useStudio.getState().loadManifest).toHaveBeenCalledWith('method')
    expect(await serious(host)).toEqual([])
  })
  it('375：Tabs「体检 / 导出包」，默认导出包 + axe', async () => {
    desktop = false
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="deliver-mobile"]')).not.toBeNull()
    expect(q('[data-testid="deliver-desktop"]')).toBeNull()
    expect(q('[data-testid="deliver-tab-exports"]')?.getAttribute('aria-selected')).toBe('true')
    expect(q('[data-testid="export-grid"]')).not.toBeNull()
    expect(await serious(host)).toEqual([])
  })
  it('点击体检「定位」→ 回工作台 #/p/<pid>（无 AST 时不带 focus）', async () => {
    useStudio.setState({ items: [{ id: 'd1', severity: 'error', code: 'claims.forward_ref', message: '前引', line: 15, source: 'lint' }] as never })
    await mount(<DeliverPage pid="method" />)
    await click(q('[data-testid="check-locate"]'))
    expect(window.location.hash).toBe('#/p/method')
  })
  it('开案失败 → 错误提示', async () => {
    useStudio.setState({ project: null, projectError: '案不存在' })
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="deliver-error"]')?.textContent).toContain('案不存在')
  })
  it('R55-01 下载单飞：同拍双击只发一次下载', async () => {
    const { downloadFile } = await import('@/lib/download')
    await mount(<DeliverPage pid="method" />)
    const btn = q<HTMLButtonElement>('[data-testid="export-download-docx"]')!
    await act(async () => {
      btn.click()
      btn.click()
    })
    expect(downloadFile).toHaveBeenCalledTimes(1)
  })
  it('重新生成：docx → enqueue(manual, immediate)；xml → runXmlExport 后重拉清单；新构建落地（lastOkAt 变）也重拉', async () => {
    const enqueue = vi.fn()
    const runXmlExport = vi.fn(async () => ({ status: 'ok', valid: true, books: [], warnings: [], zip_url: '/z.zip' }) as never)
    useStudio.setState({ enqueue, runXmlExport })
    await mount(<DeliverPage pid="method" />)
    const loadManifest = useStudio.getState().loadManifest
    expect(loadManifest).toHaveBeenCalledTimes(1)
    await click(q('[data-testid="export-regen-docx"]'))
    expect(enqueue).toHaveBeenCalledWith('manual', true)
    await click(q('[data-testid="export-regen-xml"]'))
    expect(runXmlExport).toHaveBeenCalledTimes(1)
    expect(loadManifest).toHaveBeenCalledTimes(2)
    await act(async () => useStudio.setState({ phase: 'building' }))
    expect(q('[data-testid="export-item-pdf"]')?.dataset.state).toBe('running')
    await act(async () => useStudio.setState({ phase: 'ok', lastOkAt: Date.now() }))
    expect(loadManifest).toHaveBeenCalledTimes(3)
    await act(async () => useStudio.setState({ phase: 'error', netError: '后端不可达' }))
    expect(q('[data-testid="export-item-docx"]')?.dataset.state).toBe('error')
  })
  it('XML 导出结果展开在 XML 卡片内（五书表 + 校验徽章）', async () => {
    useStudio.setState({
      xmlAt: Date.now(),
      xmlResult: {
        status: 'ok',
        valid: true,
        zip_url: '/z.zip',
        ms: 1200,
        warnings: [],
        counts: { claims: 3, paragraphs: 20, figures: 1, equations: 0, tables: 0, abstract_chars: 120 },
        books: [{ code: '100001', name: '权利要求书', file: '100001.xml', valid: true, errors: [], images: [], xml_url: '/x', preview_url: '/p' }],
      } as never,
    })
    await mount(<DeliverPage pid="method" />)
    const xml = q('[data-testid="export-item-xml"]')!
    expect(q('[data-testid="xml-valid"]', xml)?.textContent).toContain('1/1')
    expect(q('[data-testid="xml-valid"]', xml)?.textContent).not.toContain('5/5')
    expect(q('[data-testid="xml-book-100001"]', xml)).not.toBeNull()
    expect(q('[data-testid="dtd-notice"]', xml)).toBeNull()
    expect(await serious(host)).toEqual([])
  })
  it('XML 内容错误（如权利要求书为空）：失败态显示人话原因 + 「定位 · 权利要求书」按钮，点击回到工作台并定位到 `## 权利要求书`', async () => {
    const locate = vi.fn()
    useStudio.setState({
      ast: SYNTH_AST,
      xmlAt: Date.now(),
      xmlResult: {
        status: 'error',
        xid: 'x1',
        error: { kind: 'content', message: '权利要求书为空：官方 DTD 要求至少 1 项权利要求，请先补写权利要求', line: 7, section: '权利要求书' },
      } as never,
    })
    vi.spyOn(preflightUtils, 'usePreflightLocate').mockReturnValue(locate)
    await mount(<DeliverPage pid="method" />)
    const xml = q('[data-testid="export-item-xml"]')!
    expect(xml.dataset.state).toBe('error')
    expect(q('[data-testid="export-item-error"]', xml)?.textContent).toContain('权利要求书为空')
    const btn = q<HTMLButtonElement>('[data-testid="xml-error-locate"]', xml)!
    expect(btn.textContent).toContain('权利要求书')
    expect(btn.textContent).not.toMatch(/L\d+|第 \d+ 行/)
    await click(btn)
    expect(locate).toHaveBeenCalledWith(7, null)
    expect(window.location.hash).toBe('#/p/method')
    expect(await serious(host)).toEqual([])
  })
  it('标记已递交门槛：已登录且 viewer/editor 不渲染；agent/owner/superuser 渲染；点开对话框预填 case.dates', async () => {
    useStudio.setState({ authStatus: 'authed', project: { ...project, role: 'editor', case: { dates: { filed: '2026-01-02', application_no: '202610000001.X' }, status: 'drafting' } } as never })
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="deliver-file"]')).toBeNull()
    await act(async () => useStudio.setState({ project: { ...project, role: 'agent', case: { dates: { filed: '2026-01-02', application_no: '202610000001.X' }, status: 'drafting' } } as never }))
    await click(q('[data-testid="deliver-file"]'))
    expect(useStudio.getState().filingOpen).toBe(true)
    expect(q<HTMLInputElement>('[data-testid="filing-date"]')?.value).toBe('2026-01-02')
    expect(q<HTMLInputElement>('[data-testid="filing-no"]')?.value).toBe('202610000001.X')
    await act(async () => useStudio.setState({ filingOpen: false, project: { ...project, role: 'viewer' } as never, user: { id: 'u1', email: 'root@example.com', is_superuser: true } as never }))
    expect(q('[data-testid="deliver-file"]')).not.toBeNull()
  })
})

describe('DeadlineCard 目标递交（W7 ux-04）', () => {
  const base = { case_no: 'PS-1', client: null, applicants: [], inventors: [], status: 'drafting', deadlines: [], next_deadline: null }

  it('无法定期限、有 target_filing ⇒ lg Countdown 显示目标递交而非「没有待办期限」，并标注机构自定非法定', async () => {
    await mount(<DeadlineCard kase={{ ...base, dates: { target_filing: '2026-09-17' }, target_filing_days_left: 10 } as never} loading={false} />)
    const card = q('[data-testid="deliver-deadline"]')!
    expect(card.textContent).not.toContain('没有待办期限')
    const tf = q('[data-testid="deliver-target-filing"]', card)!
    expect(q('[data-slot="countdown-value"]', tf)?.textContent).toBe('剩 10 天')
    expect(q('[data-slot="countdown-date"]', tf)?.textContent).toBe('2026-09-17')
    expect(tf.textContent).toContain('目标递交（机构自定，非法定期限）')
    expect(await serious(host)).toEqual([])
  })

  it('法定期限优先居首；目标递交作副行；两者皆无 ⇒ 空文案；后端 days_left=null（无 target_filing）⇒ 不显示', async () => {
    await mount(
      <DeadlineCard
        kase={{ ...base, dates: { target_filing: '2026-09-17' }, target_filing_days_left: 10, next_deadline: { kind: 'oa_reply', due: '2026-09-12', note: '', days_left: 5, level: 'yellow' } } as never}
        loading={false}
      />,
    )
    const card = q('[data-testid="deliver-deadline"]')!
    const values = [...card.querySelectorAll('[data-slot="countdown-value"]')].map((n) => n.textContent)
    expect(values).toEqual(['剩 5 天', '剩 10 天'])
    expect(card.textContent).toContain('答复 OA')
    const tfRow = q('[data-testid="deliver-target-filing"]', card)!
    expect(q('[data-slot="countdown"], [data-slot="countdown-value"]', tfRow)?.closest('.shrink-0')).not.toBeNull()
    expect(q('[data-testid="deliver-target-filing"]', card)?.textContent).toContain('2026-09-17')
    await act(async () => root?.unmount())
    host.remove()

    await mount(<DeadlineCard kase={{ ...base, dates: { target_filing: null }, target_filing_days_left: null } as never} loading={false} />)
    expect(q('[data-testid="deliver-target-filing"]')).toBeNull()
    expect(q('[data-testid="deliver-deadline"]')?.textContent).toContain('没有待办期限')
  })

  it('法定期限种类（priority / exam_request / annual_fee）显示中文标签而非英文 slug', async () => {
    for (const [kind, label] of [['priority', '优先权'], ['exam_request', '实审请求'], ['annual_fee', '年费']] as const) {
      await mount(<DeadlineCard kase={{ ...base, dates: {}, next_deadline: { kind, due: '2026-10-08', note: '', days_left: 30, level: 'green' } } as never} loading={false} />)
      const text = q('[data-testid="deliver-deadline"]')!.textContent!
      expect(text).toContain(label)
      expect(text).not.toContain(kind)
      await act(async () => root?.unmount())
      host.remove()
    }
  })
})

describe('FilingReadinessCard 递交就绪（W19 批2）', () => {
  it('ok/缺/可选三态渲染 + 还差计数只算必填缺失', async () => {
    const h = await mount(
      <FilingReadinessCard
        loading={false}
        items={[
          { id: 'a', label: '申请人', ok: true },
          { id: 'b', label: '附图', ok: false, hint: '未上传' },
          { id: 'c', label: '优先权（可选）', ok: null, hint: '无在先申请' },
        ]}
      />,
    )
    expect(h.querySelector('[data-testid="readiness-summary"]')?.textContent).toContain('还差 1 项')
    expect(h.querySelector('[data-testid="readiness-list"]')?.textContent).toContain('未上传')
    expect(h.querySelector('[data-testid="readiness-list"]')?.textContent).toContain('无在先申请')
  })

  it('全齐 → 要素齐备；缺失项的「去补」触发 onFix', async () => {
    const onFix = vi.fn()
    let h = await mount(
      <FilingReadinessCard
        loading={false}
        items={[
          { id: 'a', label: '申请人', ok: true },
          { id: 'b', label: '发明人', ok: true },
        ]}
      />,
    )
    expect(h.querySelector('[data-testid="readiness-summary"]')?.textContent).toContain('要素齐备')
    await act(async () => root?.unmount())
    host.remove()

    h = await mount(<FilingReadinessCard loading={false} items={[{ id: 'a', label: '申请人', ok: false, hint: '请求书必填', onFix }]} />)
    await act(async () => (h.querySelector('[data-testid="readiness-fix-a"]') as HTMLElement).click())
    expect(onFix).toHaveBeenCalledOnce()
  })

  it('loading → 骨架；axe 无 serious/critical', async () => {
    const h = await mount(<FilingReadinessCard loading items={[]} />)
    expect(h.querySelector('[data-testid="readiness-list"]')).toBeNull()
    await act(async () => root?.unmount())
    host.remove()

    const h2 = await mount(
      <FilingReadinessCard
        loading={false}
        items={[
          { id: 'a', label: '申请人', ok: false, hint: '请求书必填', onFix: () => {} },
          { id: 'b', label: '发明人', ok: true },
        ]}
      />,
    )
    expect(await serious(h2)).toEqual([])
  })
})
