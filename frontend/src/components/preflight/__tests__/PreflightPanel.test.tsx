// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import { selectPreflightStale, useStudio, type DockHandle } from '@/store'
import type { ClaimNode, PreflightReport, PreflightView } from '@/types/preflight'
import { PreflightPanel } from '../PreflightPanel'
import { groupByRule, orphanClaims, resolveBlockId } from '../preflightUtils'

/**
 * R2.5 A4：PreflightPanel 四视图 + 定位（源码行 / 结构块 / PDF）+ 陈旧横幅 + 空/加载/错误/501 态 + axe 冒烟。
 * jsdom 无布局：color-contrast / scrollable-region-focusable 禁用（真实浏览器 axe 见 testing skill）。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const notImplemented = () => json({ detail: { kind: 'not-implemented', message: 'R2.5 A2-preflight 未实现', line: null, detail: null } }, 501)

const emptyReport: PreflightReport = {
  version: 1,
  items: [],
  counts: { error: 0, warning: 1, info: 2 },
  claim_tree: [],
  numerals: [],
  support_map: [],
  figures: [],
}

const node = (num: number, refs: number[], children: number[], extra: Partial<ClaimNode> = {}): ClaimNode => ({
  num,
  kind: refs.length ? 'dependent' : 'independent',
  category: '方法',
  refs,
  alternative: refs.length > 1,
  line: 7 + num * 2,
  children,
  issues: [],
  ...extra,
})

/** 与 SYNTH_AST 行号一致的报告：权项 1 ← 2 ← 3（3 多引 1或2），4 前向引用 5；标记 101 不一致；术语「短信」无支持 */
const report: PreflightReport = {
  version: 1,
  items: [
    { rule: 'numerals.inconsistent', severity: 'warning', message: '标记 101 同号不同名：采集模块 / 采集单元', book: 'description', line: 44, block_id: 'description/附图说明/p0006', detail: '采集模块、采集单元' },
    { rule: 'claims.forward_ref', severity: 'error', message: '权利要求 4 引用了在后的权利要求 5', book: 'claims', line: 15, block_id: 'claims/4', detail: null },
    { rule: 'claims.unsupported_term', severity: 'warning', message: '权项术语「短信」在说明书中未出现', book: 'claims', line: 15, block_id: 'claims/4', detail: null },
    { rule: 'abstract.limit', severity: 'info', message: '摘要 28 字（上限 300）', book: 'abstract', line: 5, block_id: 'abstract', detail: null },
    { rule: 'figures.unreferenced', severity: 'warning', message: '图 3 未被正文引用', book: 'description', line: null, block_id: 'figures/3', detail: null },
  ],
  counts: { error: 1, warning: 3, info: 1 },
  claim_tree: [node(1, [], [2, 3]), node(2, [1], [3]), node(3, [1, 2], []), node(4, [5], [], { issues: ['claims.forward_ref'] })],
  numerals: [
    { num: '101', legend: '采集模块', legend_line: 42, names: ['采集模块', '采集单元'], lines: [42, 48], consistent: false },
    { num: '102', legend: '计算模块', legend_line: 44, names: ['计算模块'], lines: [44], consistent: true },
  ],
  support_map: [
    { term: '漂移分数', claims: [1, 2], matched: '漂移分数', description_lines: [32, 34], supported: true },
    { term: '短信', claims: [4], matched: null, description_lines: [], supported: false },
  ],
  figures: [],
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.setState({ ...initial, pid: 'method', content: '# 标题' }, false)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(props: Parameters<typeof PreflightPanel>[0] = {}) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<PreflightPanel {...props} />))
  return host
}

/** 直接把报告写进 store（跟 loadPreflight 成功后的状态一致），并挂上合成 AST 供结构块 / PDF 定位 */
async function mountWith(r: PreflightReport, view: PreflightView = 'items') {
  useStudio.setState({ content: SYNTH_MD, ast: SYNTH_AST, preflight: r, preflightContent: SYNTH_MD, preflightView: view })
  return mount()
}

async function axeViolations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(el: Element, sel: string) => el.querySelector<T>(sel)!
const qa = <T extends Element = HTMLElement>(el: Element, sel: string) => Array.from(el.querySelectorAll<T>(sel))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const nav = () => {
  const s = useStudio.getState()
  return { line: s.scrollRequest?.line ?? null, block: s.activeBlock?.id ?? null, pdf: s.pdfLocate?.query ?? null }
}

describe('PreflightPanel 头部 / tab / 状态', () => {
  it('渲染头部 / 四个二级 tab；挂载（打开 tab）即自动 POST /preflight 带编辑区 content；axe 零违规', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(emptyReport))
    const el = await mount()
    expect(el.querySelector('[data-slot="PreflightPanel"]')).not.toBeNull()
    const tabs = qa<HTMLButtonElement>(el, '[role="tab"]')
    expect(tabs.map((t) => t.textContent)).toEqual(['问题', '权利要求树', '附图标记', '支持性'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/method/preflight')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ content: '# 标题' })
    expect(q(el, '[data-testid="preflight-empty"]').textContent).toBe('未发现问题')
    expect(await axeViolations(el)).toEqual([])
  })

  it('换案加载窗（content 清空）不自动 POST；saved 落地后触发（批43 回归）', async () => {
    useStudio.setState({ content: '', saved: '' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(emptyReport))
    await mount()
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => useStudio.setState({ content: '# 新案', saved: '# 新案' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ content: '# 新案' })
  })

  it('二级 tab 点击 / → ← Home End 漫游写入 store.preflightView', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(emptyReport))
    const el = await mount()
    const tablist = q<HTMLDivElement>(el, '[role="tablist"]')
    await click(q(el, '[data-testid="preflight-tab-numerals"]'))
    expect(useStudio.getState().preflightView).toBe('numerals')
    const key = (k: string) => act(async () => tablist.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
    await key('ArrowRight')
    expect(useStudio.getState().preflightView).toBe('support')
    await key('ArrowRight')
    expect(useStudio.getState().preflightView).toBe('items')
    await key('ArrowLeft')
    expect(useStudio.getState().preflightView).toBe('support')
    await key('Home')
    expect(useStudio.getState().preflightView).toBe('items')
    await key('End')
    expect(useStudio.getState().preflightView).toBe('support')
    expect(q(el, '[role="tabpanel"]').getAttribute('aria-labelledby')).toBe('preflight-tab-support')
  })

  it('POST /preflight 501 → preflightUnavailable，空态显示未实现文案，不弹 toast；不自动重试，「重新体检」才再请求', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => notImplemented())
    const el = await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/method/preflight')
    const s = useStudio.getState()
    expect(s.preflightUnavailable).toBe(true)
    expect(s.preflight).toBeNull()
    expect(s.toasts).toEqual([])
    expect(q(el, '[data-testid="preflight-empty"]').textContent).toContain('尚未实现')
    await act(async () => useStudio.setState({ saved: '另存' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await click(q(el, '[data-testid="preflight-run"]'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('成功报告 → counts chip + 耗时；content 变更后陈旧不自动重跑；保存成功（saved 变化）再跑一次并消除陈旧', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(emptyReport))
    const el = await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(q(el, '[data-testid="preflight-counts"]').textContent).toBe('0 错误 · 1 警告 · 2 提示')
    expect(q(el, '[data-testid="preflight-elapsed"]').textContent).toMatch(/^耗时 \d+ ms$/)
    expect(q(el, '[data-testid="preflight-empty"]').textContent).toBe('未发现问题')
    expect(selectPreflightStale(useStudio.getState())).toBe(false)
    expect(el.querySelector('[data-testid="preflight-stale"]')).toBeNull()
    await act(async () => useStudio.setState({ content: '# 标题\n改了' }))
    expect(selectPreflightStale(useStudio.getState())).toBe(true)
    expect(el.querySelector('[data-testid="preflight-stale"]')).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => useStudio.setState({ saved: '# 标题\n改了' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ content: '# 标题\n改了' })
    expect(selectPreflightStale(useStudio.getState())).toBe(false)
    expect(el.querySelector('[data-testid="preflight-stale"]')).toBeNull()
  })

  it('无案子 / 加载中 / 失败（无旧报告）→ 面板级空态；失败但有旧报告 → 保留报告 + 头部错误', async () => {
    useStudio.setState({ pid: null })
    let el = await mount()
    expect(q(el, '[data-testid="preflight-empty"]').textContent).toBe('尚未打开案子')
    expect(q<HTMLButtonElement>(el, '[data-testid="preflight-run"]').disabled).toBe(true)
    await act(async () => root!.unmount())
    host.remove()

    useStudio.setState({ pid: 'method', preflightLoading: true })
    el = await mount()
    expect(q(el, '[data-testid="preflight-empty"]').textContent).toBe('正在体检…')
    expect(q(el, '[data-testid="preflight-run"]').textContent).toContain('体检中')
    expect(q(el, '[data-testid="preflight-panel"]').getAttribute('aria-busy')).toBe('true')
    await act(async () => root!.unmount())
    host.remove()

    useStudio.setState({ preflightLoading: false, preflightError: '后端 500' })
    el = await mount()
    expect(q(el, '[data-testid="preflight-empty"]').textContent).toBe('体检失败：后端 500')
    await act(async () => root!.unmount())
    host.remove()

    useStudio.setState({ preflight: report, preflightContent: '# 标题' })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    el = await mount()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(el.querySelector('[data-testid="preflight-empty"]')).toBeNull()
    expect(q(el, '[data-testid="preflight-error"]').textContent).toContain('后端 500')
    expect(qa(el, '[data-testid="preflight-item"]')).toHaveLength(5)
  })
})

describe('问题视图', () => {
  it('按规则分组、组按 error→warning→info 排；tab 上显示条数', async () => {
    const el = await mountWith(report)
    const groups = qa(el, '[data-testid="preflight-rule-group"]')
    expect(groups.map((g) => g.dataset.rule)).toEqual(['claims.forward_ref', 'numerals.inconsistent', 'claims.unsupported_term', 'figures.unreferenced', 'abstract.limit'])
    expect(groups.map((g) => g.dataset.severity)).toEqual(['error', 'warning', 'warning', 'warning', 'info'])
    expect(q(el, '#preflight-rule-claims\\.forward_ref').textContent).toContain('从属权项前向引用')
    expect(q(el, '[data-testid="preflight-tab-items"]').textContent).toBe('问题5')
    expect(q(el, '[data-testid="preflight-tab-claims"]').textContent).toBe('权利要求树4')
    expect(await axeViolations(el)).toEqual([])
  })

  it('点击条目 → gotoLine(line) + setActiveBlock(block_id) + locateInPdf(pdfQueryForBlock)', async () => {
    const el = await mountWith(report)
    const items = qa(el, '[data-testid="preflight-item"] button')
    // W11 三批：条目位置是用户可读的「权利要求 4」，不露 content.md / 行号 / 块 id
    expect(items[0].textContent).toContain('权利要求 4')
    expect(items[0].textContent).not.toMatch(/content\.md|· L15\b|claims\/4/)
    expect(items[0].title).toBe('在源码中定位到权利要求 4')
    await click(items[0])
    expect(nav()).toEqual({ line: 15, block: 'claims/4', pdf: '4.' })
    expect(useStudio.getState().activeBlock?.source).toBe('outline')
    await click(items[1])
    expect(nav()).toEqual({ line: 44, block: 'description/附图说明/p0006', pdf: '[0006]' })
  })

  it('domain-02：有 dock 时点击条目 → revealView(source, item.book) 开对应书源码卡片 + focus{book,line}（三本书各一条）', async () => {
    const openPanel = vi.fn()
    const dock = { openPanel, panelIds: () => ['source:description', 'pdf'], isPanelVisible: () => true } as unknown as DockHandle
    useStudio.setState({ dockHandle: dock, activePanelId: 'pdf', activeBook: 'description' })
    const el = await mountWith(report)
    const items = qa(el, '[data-testid="preflight-item"] button')
    const focusOf = () => {
      const f = useStudio.getState().focus
      return f ? { book: f.book, line: f.line, source: f.source } : null
    }
    await click(items[0]) // claims.forward_ref · claims L15
    expect(openPanel).toHaveBeenLastCalledWith('source:claims', { position: { referencePanel: 'source:description', direction: 'within' } })
    expect(focusOf()).toEqual({ book: 'claims', line: 15, source: 'problems' })
    expect(items[0].getAttribute('title')).toContain('权利要求 4')
    await click(items[1]) // numerals.inconsistent · description L44
    expect(openPanel).toHaveBeenLastCalledWith('source:description', undefined)
    expect(focusOf()).toEqual({ book: 'description', line: 44, source: 'problems' })
    const abs = qa(el, '[data-testid="preflight-rule-group"][data-rule="abstract.limit"] button')[0]
    await click(abs) // abstract.limit · abstract L5
    expect(openPanel).toHaveBeenLastCalledWith('source:abstract', { position: { referencePanel: 'source:description', direction: 'within' } })
    expect(focusOf()).toEqual({ book: 'abstract', line: 5, source: 'problems' })
    expect(useStudio.getState().cursor).toEqual({ line: 5, col: 1 })
    expect(useStudio.getState().editorView).toBe('source')
  })

  it('无行号的附图条目（figures/3 无题注）→ 不滚源码、不定位 PDF；有题注的 figures/1 落到题注段', async () => {
    const el = await mountWith(report)
    const fig = qa(el, '[data-testid="preflight-rule-group"][data-rule="figures.unreferenced"] button')[0]
    await click(fig)
    expect(nav()).toEqual({ line: null, block: null, pdf: null })
    expect(resolveBlockId(SYNTH_AST, 'figures/1', null)).toBe('description/附图说明/p0005')
    expect(resolveBlockId(SYNTH_AST, null, 42)).toBe('description/附图说明/p0005')
    expect(resolveBlockId(null, 'claims/2', 11)).toBe('claims/2')
  })

  it('groupByRule 保留组内顺序，未知规则名回退到 id', () => {
    const g = groupByRule(report.items)
    expect(g[0].items.map((i) => i.rule)).toEqual(['claims.forward_ref'])
    expect(groupByRule([{ ...report.items[0], rule: 'x.y' }]).map((x) => x.rule)).toEqual(['x.y'])
  })
})

describe('权利要求树', () => {
  it('独立权项为根、从属按 children 挂树，多引显示「多引」，前向引用红点且列入「未挂树」', async () => {
    const el = await mountWith(report, 'claims')
    const trees = qa(el, '[role="tree"]')
    expect(trees).toHaveLength(2)
    const rows = qa(trees[0], '[role="treeitem"]')
    expect(rows.map((r) => `${r.dataset.node}@${r.getAttribute('aria-level')}`)).toEqual(['claim-1@1', 'claim-2@2', 'claim-3@3', 'claim-3@2'])
    expect(rows[3].textContent).toContain('多引')
    expect(rows[3].textContent).toContain('→1/2')
    const orphans = qa(q(el, '[data-testid="claim-orphans"]'), '[role="treeitem"]')
    expect(orphans.map((r) => r.dataset.node)).toEqual(['claim-4'])
    expect(q(orphans[0], '[data-testid="row-mark"]').dataset.tone).toBe('error')
    expect(orphans[0].className).toContain('text-danger-fg')
    expect(orphans[0].getAttribute('aria-label')).toContain('从属权项前向引用')
    expect(await axeViolations(el)).toEqual([])
  })

  it('循环引用 3⇄4：不无限递归，环内权项各渲染一次并标红', async () => {
    const cyc: PreflightReport = {
      ...report,
      claim_tree: [node(1, [], [2]), node(2, [1], []), node(3, [4], [4], { issues: ['claims.cycle'] }), node(4, [3], [3], { issues: ['claims.cycle'] })],
    }
    expect(orphanClaims(cyc.claim_tree).map((n) => n.num)).toEqual([3, 4])
    const el = await mountWith(cyc, 'claims')
    const orphans = qa(q(el, '[data-testid="claim-orphans"]'), '[role="treeitem"]')
    expect(orphans.map((r) => `${r.dataset.node}@${r.getAttribute('aria-level')}`)).toEqual(['claim-3@1', 'claim-4@2'])
    expect(orphans.every((r) => r.className.includes('text-danger-fg'))).toBe(true)
    expect(orphans[0].getAttribute('aria-label')).toContain('权项循环引用')
  })

  it('点节点 → 跳权项首行 + claims/N 高亮 + PDF「N.」；折叠隐藏子树；键盘 ↓ 漫游', async () => {
    const el = await mountWith(report, 'claims')
    const tree = qa(el, '[role="tree"]')[0]
    const row2 = qa(tree, '[role="treeitem"]')[1]
    await click(row2)
    expect(nav()).toEqual({ line: 11, block: 'claims/2', pdf: '2.' })
    expect(row2.getAttribute('aria-selected')).toBe('true')
    await click(q(row2, 'button[aria-label="折叠"]'))
    expect(qa(tree, '[role="treeitem"]').map((r) => r.dataset.node)).toEqual(['claim-1', 'claim-2', 'claim-3'])
    const row1 = qa(tree, '[role="treeitem"]')[0]
    row1.focus()
    await act(async () => tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement?.getAttribute('data-node')).toBe('claim-2')
  })
})

describe('附图标记表', () => {
  it('语义表格：标记 / 图例 / 正文名称 / 出现位置；不一致行标红 + 图标，与图例不同的名称加粗', async () => {
    const el = await mountWith(report, 'numerals')
    const table = q<HTMLTableElement>(el, '[data-testid="preflight-numerals"] table')
    expect(qa(table, 'thead th').map((h) => h.textContent)).toEqual(['标记', '图例名称', '正文名称', '出现位置'])
    expect(table.textContent).not.toMatch(/L\d+|第 \d+ 行/)
    expect(table.caption?.textContent).toContain('2 个标记，1 个不一致')
    const rows = qa<HTMLTableRowElement>(table, '[data-testid="numeral-row"]')
    expect(rows.map((r) => r.dataset.consistent)).toEqual(['false', 'true'])
    expect(rows[0].className).toContain('text-danger-fg')
    expect(q(rows[0], '[role="img"]').getAttribute('aria-label')).toBe('不一致')
    const names = qa(rows[0], '[data-testid="numeral-name"]')
    expect(names.map((n) => [n.textContent, n.className.includes('text-danger-fg')])).toEqual([['采集模块', false], ['采集单元', true]])
    expect(rows[1].querySelector('[role="img"]')).toBeNull()
    expect(await axeViolations(el)).toEqual([])
  })

  it('点出现位置「[0007]」→ gotoLine(48) + 该行所在块高亮 + PDF 段号；点图例「[0005]」→ 42（芯片不露行号）', async () => {
    const el = await mountWith(report, 'numerals')
    const rows = qa(el, '[data-testid="numeral-row"]')
    const hit = q(rows[0], 'button[aria-label="标记 101 出现：[0007]"]')
    expect(hit.textContent).toBe('[0007]')
    await click(hit)
    expect(nav()).toEqual({ line: 48, block: 'description/具体实施方式/p0007', pdf: '[0007]' })
    await click(q(rows[0], 'button[aria-label="标记 101 图例：[0005]"]'))
    expect(nav()).toEqual({ line: 42, block: 'description/附图说明/p0005', pdf: '[0005]' })
  })
})

describe('支持性映射表', () => {
  it('语义表格：术语 / 权项 / 命中 / 说明书位置；无支持行标红 + 图标 + 「无」', async () => {
    const el = await mountWith(report, 'support')
    const table = q<HTMLTableElement>(el, '[data-testid="preflight-support"] table')
    expect(qa(table, 'thead th').map((h) => h.textContent)).toEqual(['权项术语', '权项', '说明书命中', '说明书位置'])
    expect(table.caption?.textContent).toContain('1 个无说明书支持')
    const rows = qa<HTMLTableRowElement>(table, '[data-testid="support-row"]')
    expect(rows.map((r) => r.dataset.supported)).toEqual(['true', 'false'])
    expect(rows[0].cells[2].textContent).toBe('完全匹配')
    expect(rows[1].cells[2].textContent).toBe('无')
    expect(rows[1].cells[3].textContent).toBe('—')
    expect(rows[1].className).toContain('text-danger-fg')
    expect(await axeViolations(el)).toEqual([])
  })

  it('点说明书位置芯片「公式」→ gotoLine；点「权4」→ 从 AST 反查权项首行 15 + claims/4 + PDF「4.」', async () => {
    const el = await mountWith(report, 'support')
    const rows = qa(el, '[data-testid="support-row"]')
    await click(q(rows[0], 'button[aria-label="术语「漂移分数」说明书：公式"]'))
    expect(nav()).toEqual({ line: 34, block: 'description/发明内容/技术方案/eq1', pdf: '[0003]' })
    await click(q(rows[1], 'button[aria-label="术语「短信」出现于权利要求 4"]'))
    expect(nav()).toEqual({ line: 15, block: 'claims/4', pdf: '4.' })
  })
})

describe('mobile variant', () => {
  it('variant=mobile：data-variant 透传，四视图均可渲染，axe 零违规', async () => {
    useStudio.setState({ content: SYNTH_MD, ast: SYNTH_AST, preflight: report, preflightContent: SYNTH_MD, preflightView: 'numerals' })
    const el = await mount({ variant: 'mobile' })
    expect(q(el, '[data-testid="preflight-panel"]').dataset.variant).toBe('mobile')
    expect(q(el, '[data-testid="preflight-body-numerals"] table')).not.toBeNull()
    for (const v of ['support', 'claims', 'items'] as const) {
      await click(q(el, `[data-testid="preflight-tab-${v}"]`))
      expect(q(el, `[data-testid="preflight-body-${v}"]`).children.length).toBeGreaterThan(0)
    }
    expect(await axeViolations(el)).toEqual([])
  })
})
