// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import { OutlinePanel } from '../OutlinePanel'
import { FileTree } from '../FileTree'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1', content: SYNTH_MD, ast: SYNTH_AST, astPid: 'p1', astContent: SYNTH_MD, astError: null, astUnavailable: false, astLoading: false,
    cursor: { line: 1, col: 1 }, scrollRequest: null, activeBlock: null, items: [], outlineCollapsedIds: [], fileTreeCollapsed: [], settingsOpen: false, figs: ['fig1.svg', 'fig2.svg'],
    previewFig: null, previewAttachment: null, attachments: [], attachmentsPid: null, attachmentsUnavailable: false,
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** 文件拖放（jsdom 无 DragEvent 构造：用 Event + dataTransfer 属性） */
const dragFiles = (target: Element, type: string, files: File[]) =>
  act(async () => {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files } })
    target.dispatchEvent(ev)
  })

async function mount(el: React.ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const rows = (el: Element) =>
  Array.from(el.querySelectorAll<HTMLElement>('[role="treeitem"]')).map((r) => ({
    id: r.dataset.node,
    level: Number(r.getAttribute('aria-level')),
    text: r.textContent?.trim(),
    expanded: r.getAttribute('aria-expanded'),
    label: r.getAttribute('aria-label'),
  }))

const row = (el: Element, id: string) => el.querySelector<HTMLElement>(`[data-node="${id}"]`)!

const click = async (node: HTMLElement) => act(async () => node.click())
const key = async (node: HTMLElement, key: string) =>
  act(async () => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

describe('OutlinePanel（AST 驱动）', () => {
  it('golden：默认折叠态下可见行（id / 层级 / 文案 / aria）', async () => {
    const el = await mount(<OutlinePanel />)
    await expect(JSON.stringify(rows(el), null, 2)).toMatchFileSnapshot('./__golden__/outline-panel.rows.json')
    // 段落不成节点；权项独 / 从标签；缺省折叠：附图说明 / 技术方案 折叠，发明内容 / 具体实施方式 展开
    expect(el.querySelectorAll('[data-node^="description/"][data-node*="/p0"]').length).toBe(1) // 只有表 p0008 是叶子
    expect(row(el, 'claims/1').querySelector('[data-testid="claim-ref"]')?.textContent).toBe('独')
    expect(row(el, 'claims/3').querySelector('[data-testid="claim-ref"]')?.textContent).toBe('→1–2')
    expect(row(el, 'claims/4').querySelector('[data-testid="claim-ref"]')?.textContent).toBe('→5')
    expect(row(el, 'claims/3').getAttribute('aria-label')).toBe('权利要求 3，从属，引用 1、2')
    expect(row(el, 'description/附图说明').getAttribute('aria-expanded')).toBe('false')
    expect(row(el, 'description/发明内容/技术方案').getAttribute('aria-expanded')).toBe('false')
    expect(row(el, 'description/具体实施方式/p0008')).not.toBeNull()
    expect(el.querySelector('[data-node="figures/1"]')).toBeNull()
    expect(el.querySelectorAll('[role="treeitem"]').length).toBeLessThanOrEqual(20)
  })

  it('点击节点：gotoLine（scrollRequest）+ setActiveBlock(id, "outline") + 本地高亮', async () => {
    const el = await mount(<OutlinePanel />)
    await click(row(el, 'claims/2'))
    const s = useStudio.getState()
    expect(s.scrollRequest?.line).toBe(11)
    expect(s.activeBlock).toEqual({ id: 'claims/2', source: 'outline' })
    expect(row(el, 'claims/2').getAttribute('aria-selected')).toBe('true')

    await click(row(el, 'description/具体实施方式/p0008'))
    expect(useStudio.getState().scrollRequest?.line).toBe(50)
    expect(useStudio.getState().activeBlock?.id).toBe('description/具体实施方式/p0008')

    // 书级根节点 → 该书首块
    await click(row(el, 'description'))
    expect(useStudio.getState().scrollRequest?.line).toBe(18)
    expect(useStudio.getState().activeBlock?.id).toBe('description/技术领域')
  })

  it('桌面 dock 下点击：setFocus(source=outline, 带书 / 块 / 行) + setCursor，不看持久化的 editorView=layout，不发 scrollRequest；W5 走查 qa-02', async () => {
    useStudio.setState({ editorView: 'layout', focus: null, dockHandle: { panelIds: () => ['source:description', 'pdf'], isPanelVisible: () => true } as never })
    const el = await mount(<OutlinePanel />)
    await click(row(el, 'description/具体实施方式/p0008'))
    const s = useStudio.getState()
    expect(s.focus).toMatchObject({ book: 'description', blockId: 'description/具体实施方式/p0008', line: 50, source: 'outline' })
    expect(s.cursor.line).toBe(50)
    expect(s.scrollRequest).toBeNull()
    expect(s.activeBlock).toEqual({ id: 'description/具体实施方式/p0008', source: 'outline' })

    await click(row(el, 'claims/2'))
    expect(useStudio.getState().focus).toMatchObject({ book: 'claims', blockId: 'claims/2', line: 11, source: 'outline' })
    useStudio.setState({ dockHandle: null, editorView: 'source' })
  })

  it('折叠 / 展开写入 ui.outlineCollapsedIds（记录与默认相反的节点）并持久生效', async () => {
    const el = await mount(<OutlinePanel />)
    await click(row(el, 'description/附图说明').querySelector('button')!)
    expect(useStudio.getState().outlineCollapsedIds).toEqual(['description/附图说明'])
    expect(row(el, 'description/附图说明').getAttribute('aria-expanded')).toBe('true')
    expect(rows(el).filter((r) => r.id?.startsWith('figures/')).map((r) => r.text)).toEqual(['图3fig3.svg', '图1 本发明实施例的总体流程图fig1.svg', '图2 漂移分数曲线示意图fig2.svg'])
    expect(row(el, 'figures/1').getAttribute('aria-level')).toBe('3')

    await key(row(el, 'claims'), 'ArrowLeft')
    expect(useStudio.getState().outlineCollapsedIds).toEqual(['description/附图说明', 'claims'])
    expect(el.querySelector('[data-node="claims/1"]')).toBeNull()
    await key(row(el, 'claims'), 'ArrowRight')
    expect(useStudio.getState().outlineCollapsedIds).toEqual(['description/附图说明'])
  })

  it('光标移动：高亮所在节点并自动展开其折叠的祖先', async () => {
    const el = await mount(<OutlinePanel />)
    expect(el.querySelector('[data-current]')).toBeNull()
    await act(async () => useStudio.getState().setCursor({ line: 34, col: 1 }))
    expect(row(el, 'description/发明内容/技术方案').getAttribute('aria-expanded')).toBe('true')
    expect(row(el, 'description/发明内容/技术方案/eq1').getAttribute('aria-selected')).toBe('true')
    expect(useStudio.getState().outlineCollapsedIds).toEqual(['description/发明内容/技术方案'])
    // 手动再折叠不会被立刻撑开
    await key(row(el, 'description/发明内容/技术方案'), 'ArrowLeft')
    expect(el.querySelector('[data-node="description/发明内容/技术方案/eq1"]')).toBeNull()
    await act(async () => useStudio.getState().setCursor({ line: 42, col: 1 }))
    expect(row(el, 'figures/1').getAttribute('aria-selected')).toBe('true')
    expect(row(el, 'figures/1').tabIndex).toBe(0)
  })

  it('叶行去重：label 已含 tag 全文时 tag 芯片 / aria / title 不再重复（公式 （11）（11）→（11）；R115 批12）', async () => {
    const el = await mount(<OutlinePanel />)
    await act(async () => useStudio.getState().setCursor({ line: 34, col: 1 })) // 撑开技术方案露出 eq1
    const eq = row(el, 'description/发明内容/技术方案/eq1')
    expect(eq.textContent).toBe('公式 (1)')
    expect(eq.getAttribute('aria-label')).toBe('公式 (1)')
    expect(eq.getAttribute('title')).toBe('公式 (1)')
    // 有题注表格：tag=段号是独立信息，保留
    const table = row(el, 'description/具体实施方式/p0008')
    expect(table.textContent).toBe('表1 阈值表[0008]')
    expect(table.getAttribute('aria-label')).toBe('表格 表1 阈值表')
    expect(table.getAttribute('title')).toBe('表格 表1 阈值表 · [0008]')
  })

  it('键盘漫游沿用 treeKeys：↓ / End / Home 在可见行间移动焦点', async () => {
    const el = await mount(<OutlinePanel />)
    const tree = el.querySelector<HTMLElement>('[role="tree"]')!
    row(el, 'abstract').focus()
    await act(async () => tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(document.activeElement).toBe(row(el, 'claims'))
    await act(async () => tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(document.activeElement).toBe(row(el, 'description/工业实用性'))
    await act(async () => tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(document.activeElement).toBe(row(el, 'abstract'))
    await key(row(el, 'abstract'), 'Enter')
    expect(useStudio.getState().scrollRequest?.line).toBe(3)
  })

  it('/ast 未返回 → 等待解析，不崩；501 时 tooltip 说明', async () => {
    useStudio.setState({ ast: null, astUnavailable: true })
    const el = await mount(<OutlinePanel />)
    expect(el.querySelector('[data-testid="outline-waiting"]')?.textContent).toBe('等待解析')
    expect(el.querySelector('[data-testid="outline-waiting"]')?.getAttribute('title')).toContain('/ast')
    expect(el.querySelectorAll('[role="treeitem"]').length).toBe(0)
  })

  it('axe：无 critical / serious', async () => {
    const el = await mount(<OutlinePanel />)
    expect(el.querySelector('[role="tree"]')).not.toBeNull()
    expect(await violations(el)).toEqual([])
  })
})

describe('FileTree（三书）', () => {
  it('docs/abstract.md · claims.md · description.md + figs + attachments；内部文件 studio.json / content.md 不显示（05 §3.4）', async () => {
    const el = await mount(<FileTree />)
    expect(rows(el).map((r) => r.id)).toEqual([
      'dir:docs', 'file:docs/abstract.md', 'file:docs/claims.md', 'file:docs/description.md',
      'dir:figs', 'file:figs/fig1.svg', 'file:figs/fig2.svg', 'dir:attachments',
    ])
    expect(el.querySelector('[data-node="file:studio.json"]')).toBeNull()
    expect(el.querySelector('[data-node="file:content.md"]')).toBeNull()
    // 书行只显示书名（文件名 / 内部代号不外露），title 说明点击行为
    const claimsRow = row(el, 'file:docs/claims.md')
    expect(claimsRow.getAttribute('title')).toBe('权利要求书 · 点击跳到本书开头')
    expect(claimsRow.textContent).not.toContain('claims.md')
    expect(await violations(el)).toEqual([])
  })
  it('点击一本书 → gotoLine(books[book].offset)，不切换编辑器内容', async () => {
    const el = await mount(<FileTree />)
    await click(row(el, 'file:docs/claims.md'))
    expect(useStudio.getState().scrollRequest?.line).toBe(7)
    await click(row(el, 'file:docs/description.md'))
    expect(useStudio.getState().scrollRequest?.line).toBe(18)
    expect(useStudio.getState().content).toBe(SYNTH_MD)
  })
  it('桌面 dock 下点击一本书 → 露出 / 新开该书源码卡片（openPanel）+ focus{book, line}，不发无人消费的 scrollRequest（W11 走查 T5）', async () => {
    const openPanel = vi.fn()
    useStudio.setState({ dockHandle: { openPanel, panelIds: () => ['source:claims', 'pdf'], isPanelVisible: () => true } as never, activePanelId: 'pdf' })
    const el = await mount(<FileTree />)
    await click(row(el, 'file:docs/abstract.md'))
    expect(openPanel).toHaveBeenLastCalledWith('source:abstract', { position: { referencePanel: 'source:claims', direction: 'within' } })
    expect(useStudio.getState().focus).toMatchObject({ book: 'abstract', line: 3, source: 'outline' })
    expect(useStudio.getState().scrollRequest).toBeNull()
    useStudio.setState({ dockHandle: null })
  })
  it('figs/ 文件点击 → previewFig + openPanel(file)；hover → 跳到首个引用（W4-C）', async () => {
    const el = await mount(<FileTree />)
    await click(row(el, 'file:figs/fig1.svg'))
    expect(useStudio.getState().previewFig).toBe('fig1.svg')
    expect(useStudio.getState().scrollRequest).toBeNull()
    await click(el.querySelector<HTMLElement>('[data-node="file:figs/fig1.svg"] [data-testid="file-fig-goto"]')!)
    expect(useStudio.getState().scrollRequest?.line).toBeGreaterThan(0)
    expect(el.querySelector('[data-testid="file-figs-upload"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="file-figs-book"]')).not.toBeNull()
  })
  it('figs/ 目录行显示「附图 N · 资源 M」两口径（N = AST 附图块数，M = figs/ 文件数）；title / aria-label 解释口径（qa-07 / domain-05）', async () => {
    const el = await mount(<FileTree />)
    const caption = () => el.querySelector('[data-testid="file-figs-caption"]')?.textContent
    expect(caption()).toBe(`附图 ${SYNTH_AST.figures.length} · 资源 2`)
    expect(row(el, 'dir:figs').getAttribute('aria-label')).toContain(`附图 ${SYNTH_AST.figures.length} = 说明书附图块数`)
    expect(row(el, 'dir:figs').getAttribute('aria-label')).toContain('资源 2 = 已上传的图片文件数')
    expect(`${row(el, 'dir:figs').getAttribute('aria-label')} ${row(el, 'dir:figs').getAttribute('title')}`).not.toMatch(/figs\/|figures\.md|\/ast/)
    expect(row(el, 'dir:figs').getAttribute('title')).toContain('两个口径可不相等')
    // 附图块 6、figs/ 空目录（handoff qa-07 场景）：两数同时可见，不再把 0 个文件误显成「附图 0」
    const six = { ...SYNTH_AST, figures: Array.from({ length: 6 }, (_, i) => ({ ...SYNTH_AST.figures[0], id: `figures/${i + 1}`, num: i + 1, file: `fig${i + 1}.svg` })) }
    await act(async () => useStudio.setState({ ast: six, figs: [], figures: [] }))
    expect(caption()).toBe('附图 6 · 资源 0')
    expect(rows(el).filter((r) => r.id?.startsWith('file:figs/'))).toEqual([])
    // /ast 未返回 → 附图口径显「—」
    await act(async () => useStudio.setState({ ast: null, figs: ['fig1.svg'] }))
    expect(caption()).toBe('附图 — · 资源 1')
    expect(await violations(el)).toEqual([])
  })
  it('attachments/：列表行 + 点击预览；后端 501 → 「待实现」且上传禁用（W4-C）', async () => {
    useStudio.setState({
      attachmentsPid: 'p1', attachmentsUnavailable: false,
      attachments: [{ name: 'prior.pdf', ext: '.pdf', size: 2048, mtime: '2026-01-01T00:00:00Z', kind: 'pdf', url: '/api/projects/p1/attachments/prior.pdf' }],
    })
    const el = await mount(<FileTree />)
    expect(row(el, 'file:attachments/prior.pdf').textContent).toContain('2.0 KB')
    await click(row(el, 'file:attachments/prior.pdf'))
    expect(useStudio.getState().previewAttachment).toBe('prior.pdf')
    expect(useStudio.getState().previewFig).toBeNull()
    expect(await violations(el)).toEqual([])
    await act(async () => useStudio.setState({ attachments: [], attachmentsUnavailable: true }))
    expect(el.querySelector('[data-testid="file-attachments-todo"]')).not.toBeNull()
    expect(el.querySelector<HTMLButtonElement>('[data-testid="file-attachments-upload"]')?.disabled).toBe(true)
  })
  it('figs/ 图号来自 GET /figures（figures.md 行序），未编入的文件标「未编入」且无跳转按钮', async () => {
    const f = (name: string, num: number | null) => ({ name, ext: name.slice(name.lastIndexOf('.')), size: 1, num, alt: null, width: 15, is_abstract: false, abstract_width: null, preview: name, companions: [] })
    useStudio.setState({ figuresPid: 'p1', figures: [f('fig2.svg', 1), f('fig1.svg', 2), f('scan.png', null)] })
    const el = await mount(<FileTree />)
    const ids = rows(el).map((r) => r.id).filter((id) => id?.startsWith('file:figs/'))
    expect(ids).toEqual(['file:figs/fig2.svg', 'file:figs/fig1.svg', 'file:figs/scan.png'])
    expect(row(el, 'file:figs/fig2.svg').textContent).toContain('图1')
    expect(row(el, 'file:figs/scan.png').textContent).toContain('未编入')
    expect(row(el, 'file:figs/scan.png').querySelector('[data-testid="file-fig-goto"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })
  it('拖文件到 figs/：白名单外 toast 不上传；白名单内 POST /figures；拖到 attachments/ → POST /attachments', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/attachments')) return json({ items: [] })
      return json({ figures: [], settings: useStudio.getState().settings })
    })
    useStudio.setState({ toasts: [], attachmentsPid: 'p1' })
    const el = await mount(<FileTree />)
    const figsDrop = el.querySelector<HTMLElement>('[data-testid="file-figs-drop"]')!
    await dragFiles(row(el, 'file:figs/fig1.svg'), 'dragover', [])
    expect(figsDrop.dataset.dropping).toBe('true')
    await dragFiles(row(el, 'file:figs/fig1.svg'), 'drop', [new File(['x'], 'brief.pdf')])
    expect(figsDrop.dataset.dropping).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useStudio.getState().toasts.some((t) => t.text.includes('brief.pdf'))).toBe(true)
    await dragFiles(row(el, 'dir:figs'), 'drop', [new File(['x'], 'fig3.png')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/p1/figures')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')

    await dragFiles(row(el, 'dir:attachments'), 'drop', [new File(['x'], 'prior.pdf')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/projects/p1/attachments')
    await dragFiles(row(el, 'dir:attachments'), 'drop', [new File(['x'], 'virus.exe')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('attachments/ 行：下载链接 ?download=1；删除 → 确认对话框 → DELETE', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [] }))
    useStudio.setState({
      attachmentsPid: 'p1', attachmentsUnavailable: false,
      attachments: [{ name: 'prior.pdf', ext: '.pdf', size: 2048, mtime: '2026-01-01T00:00:00Z', kind: 'pdf', url: '/api/projects/p1/attachments/prior.pdf' }],
    })
    const el = await mount(<FileTree />)
    const r = row(el, 'file:attachments/prior.pdf')
    expect(r.querySelector<HTMLAnchorElement>('[data-testid="file-attachment-download"]')?.getAttribute('href')).toBe('/api/projects/p1/attachments/prior.pdf?download=1')
    await click(r.querySelector<HTMLElement>('[data-testid="file-attachment-delete"]')!)
    expect(useStudio.getState().previewAttachment).toBeNull()
    const dialog = document.querySelector<HTMLElement>('[data-testid="attachment-delete-dialog"]')!
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(dialog.textContent).toContain('prior.pdf')
    expect(fetchMock).not.toHaveBeenCalled()
    await click(document.querySelector<HTMLElement>('[data-testid="attachment-delete-confirm"]')!)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/p1/attachments/prior.pdf')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
    expect(document.querySelector('[data-testid="attachment-delete-dialog"]')).toBeNull()
  })
  it('attachments/ 行：可抽取类型（pdf/docx/md/txt）有「转为专利」→ 设来源并打开转换对话框；zip/png 没有', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [] }))
    useStudio.setState({
      attachmentsPid: 'p1', attachmentsUnavailable: false,
      attachments: [
        { name: 'prior.pdf', ext: '.pdf', size: 2048, mtime: '2026-01-01T00:00:00Z', kind: 'pdf', url: '/api/projects/p1/attachments/prior.pdf' },
        { name: 'pack.zip', ext: '.zip', size: 10, mtime: '2026-01-01T00:00:00Z', kind: 'zip', url: '/api/projects/p1/attachments/pack.zip' },
      ],
    })
    const el = await mount(<FileTree />)
    expect(row(el, 'file:attachments/pack.zip').querySelector('[data-testid="file-attachment-convert"]')).toBeNull()
    await click(row(el, 'file:attachments/prior.pdf').querySelector<HTMLElement>('[data-testid="file-attachment-convert"]')!)
    expect(useStudio.getState().convertAttachment).toEqual({ pid: 'p1', name: 'prior.pdf', size: 2048 })
    expect(useStudio.getState().convertFile).toBeNull()
    expect(useStudio.getState().dialog).toBe('convert')
    expect(useStudio.getState().previewAttachment).toBeNull()
  })
  it('/ast 未返回 → 三书置灰不可点', async () => {
    useStudio.setState({ ast: null })
    const el = await mount(<FileTree />)
    expect(row(el, 'file:docs/abstract.md').getAttribute('aria-disabled')).toBe('true')
    await click(row(el, 'file:docs/abstract.md'))
    expect(useStudio.getState().scrollRequest).toBeNull()
  })
  it('R54-01 三组折叠态进 fileTreeCollapsed 并持久化', async () => {
    const el = await mount(<FileTree />)
    await click(row(el, 'dir:docs'))
    expect(useStudio.getState().fileTreeCollapsed).toEqual(['docs'])
    expect(el.querySelector('[data-node="file:docs/abstract.md"]')).toBeNull()
    const persisted = JSON.parse(localStorage.getItem('patent-studio:ui:v2') ?? '{}')?.state?.fileTreeCollapsed
    expect(persisted).toEqual(['docs'])
    await click(row(el, 'dir:docs'))
    expect(useStudio.getState().fileTreeCollapsed).toEqual([])
    expect(el.querySelector('[data-node="file:docs/abstract.md"]')).not.toBeNull()
  })
  it('R54-02 只读角色（viewer）：上传/拖放/删除/转专利禁用或隐藏，下载保留', async () => {
    useStudio.setState({
      project: { id: 'p1', role: 'viewer' } as never,
      attachmentsPid: 'p1', attachmentsUnavailable: false,
      attachments: [{ name: 'prior.pdf', ext: '.pdf', size: 2048, mtime: '2026-01-01T00:00:00Z', kind: 'pdf', url: '/api/projects/p1/attachments/prior.pdf' }],
    })
    const el = await mount(<FileTree />)
    expect(el.querySelector<HTMLButtonElement>('[data-testid="file-figs-upload"]')?.disabled).toBe(true)
    expect(el.querySelector<HTMLButtonElement>('[data-testid="file-attachments-upload"]')?.disabled).toBe(true)
    const r = row(el, 'file:attachments/prior.pdf')
    expect(r.querySelector('[data-testid="file-attachment-delete"]')).toBeNull()
    expect(r.querySelector('[data-testid="file-attachment-convert"]')).toBeNull()
    expect(r.querySelector('[data-testid="file-attachment-download"]')).not.toBeNull()
    useStudio.setState({ project: null })
  })
})
