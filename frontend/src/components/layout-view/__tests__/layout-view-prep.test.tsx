// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { tableNodeTypes } from 'prosemirror-tables'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import goldenMethod from '../../../../../backend/tests/fixtures/ast_rich.json'
import goldenSystem from '../../../../../backend/tests/golden/ast_system.json'
import { schema } from '@/components/block-model/edit/schema'
import { serialize } from '@/components/block-model/edit/serialize'
import { MobileLayoutToolbar } from '@/components/mobile/MobileLayoutToolbar'
import { LAYOUT_PRESET_IDS, PANEL_KINDS } from '@/store/layout'
import { LAYOUT_PRESETS } from '@/layout/presets'
import { renameStructureToLayout, type StoredLayout } from '@/layout/persistence'
import { ApiError, api } from '@/lib/api'
import { useStudio } from '@/store'
import type { Ast } from '@/types/ast'
import { LayoutView, SlashMenu, numberCandidates, toCritic } from '..'
import { EquationEditor } from '../equation'
import { TableToolbar, withTableRoles } from '../table'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const method = goldenMethod as unknown as Ast
const system = goldenSystem as unknown as Ast

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
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

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
}

describe('W4-D prep：三视图改名（16 §7）', () => {
  it('面板 kind / 预置 用 layout，不再有 structure', () => {
    expect(PANEL_KINDS).toContain('layout')
    expect(PANEL_KINDS).not.toContain('structure')
    expect(LAYOUT_PRESET_IDS).toContain('layout-pdf')
    expect(LAYOUT_PRESETS['layout-pdf'].label).toBe('版面 | PDF')
  })

  it('旧布局 structure:<book> / structure 组件 / structure-pdf 预置读入即重写为 layout*', () => {
    const old = {
      v: 1,
      preset: 'structure-pdf',
      compareLock: false,
      savedAt: 1,
      dock: {
        grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { views: ['structure:all'], activeView: 'structure:all', id: 'g-structure' } }] }, width: 1, height: 1, orientation: 'HORIZONTAL' },
        panels: { 'structure:all': { id: 'structure:all', contentComponent: 'structure', title: '结构' }, pdf: { id: 'pdf', contentComponent: 'pdf' } },
      },
    } as unknown as StoredLayout
    const out = renameStructureToLayout(old)
    expect(out.preset).toBe('layout-pdf')
    expect(Object.keys(out.dock.panels)).toEqual(['layout:all', 'pdf'])
    expect(out.dock.panels['layout:all'].contentComponent).toBe('layout')
    expect(JSON.stringify(out.dock.grid)).toContain('"layout:all"')
    expect(JSON.stringify(out)).not.toMatch(/"structure(:[a-z]+)?"|structure-pdf/)
    const fresh = { ...old, preset: 'default', dock: { ...old.dock, panels: { pdf: old.dock.panels.pdf }, grid: {} } } as unknown as StoredLayout
    expect(renameStructureToLayout(fresh)).toBe(fresh)
  })

  it('ui 持久化旧值 structure → layout（store merge）', () => {
    const merge = useStudio.persist.getOptions().merge!
    const cur = useStudio.getState()
    expect(merge({ editorView: 'structure', mobilePreviewKind: 'structure' }, cur).editorView).toBe('layout')
    expect(merge({ editorView: 'structure', mobilePreviewKind: 'structure' }, cur).mobilePreviewKind).toBe('layout')
    expect(merge({ editorView: 'source' }, cur).editorView).toBe('source')
    expect(merge({}, cur).editorView).toBe('source')
  })
})

describe('W4-D prep：layoutView slice + api.styleCss', () => {
  it('slice 默认值与动作', () => {
    const s = useStudio.getState()
    expect(s.layoutViewToolbar).toBe('none')
    s.setLayoutViewToolbar('table')
    s.bumpStyleCss()
    expect(useStudio.getState().layoutViewToolbar).toBe('table')
    expect(useStudio.getState().styleCssVersion).toBe(1)
    s.resetLayoutView()
    expect(useStudio.getState().layoutViewToolbar).toBe('none')
  })

  it('styleCss：501 → ApiError（单元名在 detail）；200 → 文本', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { kind: 'not_implemented', message: '尚未实现', line: null, detail: 'D1-style-css-parano' } }), { status: 501 }),
    )
    const err = await api.styleCss('method').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(501)
    expect((err as ApiError).detail?.detail).toBe('D1-style-css-parano')
    fetchMock.mockResolvedValueOnce(new Response(':root{--ps-page-w:21cm}', { status: 200, headers: { 'Content-Type': 'text/css' } }))
    await expect(api.styleCss('method')).resolves.toBe(':root{--ps-page-w:21cm}')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/method/style.css')
  })

  it('styleCss 单飞：同刻并发共享一次请求；单方 abort 不拖累其他调用方', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    let resolveFetch: ((r: Response) => void) | null = null
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => (resolveFetch = res)))
    const ac1 = new AbortController()
    const p1 = api.styleCss('method', ac1.signal)
    const p2 = api.styleCss('method')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    ac1.abort()
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    resolveFetch!(new Response(':root{a:1}', { status: 200 }))
    await expect(p2).resolves.toBe(':root{a:1}')
    // 请求已了结——下一调用重新发
    fetchMock.mockResolvedValueOnce(new Response(':root{a:2}', { status: 200 }))
    await expect(api.styleCss('method')).resolves.toBe(':root{a:2}')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('W4-D prep：编号补全数据源 = AST（16 §4.4）', () => {
  it('两案 图 / 表 / 式 候选', () => {
    expect(numberCandidates(method, '图').map((c) => c.label)).toEqual(['图1', '图2', '图3', '图4', '图5', '图6'])
    expect(numberCandidates(method, '表').map((c) => c.label)).toEqual(['表1', '表2'])
    expect(numberCandidates(method, '式')).toHaveLength(3)
    expect(numberCandidates(method, '式')[0]).toMatchObject({ kind: '式', label: '式（1）' })
    expect(numberCandidates(system, '图')).toHaveLength(6)
    expect(numberCandidates(system, '表')).toEqual([])
    expect(numberCandidates(system, '式')).toEqual([])
    expect(numberCandidates(null, '图')).toEqual([])
    for (const c of numberCandidates(method, '表')) expect(method.description.some((b) => b.id === c.blockId)).toBe(true)
  })

  it('toCritic：无改动原样返回；有改动落 CriticMarkup（细则见 layout-view-d3.test）', () => {
    expect(toCritic('a', 'a')).toBe('a')
    expect(toCritic('a', 'b')).toBe('{~~a~>b~~}')
  })
})

describe('W4-D prep：prosemirror-tables 与现 schema 兼容（16 E6 / §4.2）', () => {
  it('withTableRoles 后 tableNodeTypes 解析出四角色，现有节点名不变', () => {
    const s = withTableRoles(schema)
    const roles = tableNodeTypes(s)
    expect(roles.table.name).toBe('ps_table')
    expect(roles.row.name).toBe('ps_row')
    expect(roles.cell.name).toBe('ps_cell')
    expect(roles.header_cell.name).toBe('ps_header_cell')
    expect(s.nodes.ps_cell.spec.attrs).toMatchObject({ colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } })
    for (const n of Object.keys(schema.nodes)) expect(s.nodes[n]).toBeDefined()
  })

  it('扩展 schema 建出的表格仍能被现 serialize 落成 GFM 源码（不读新 attrs）', () => {
    const s = withTableRoles(schema)
    const cell = (t: string) => s.nodes.ps_cell.create(null, s.text(t))
    const table = s.nodes.ps_table.create(null, [s.nodes.ps_row.create(null, [cell('参数'), cell('值')]), s.nodes.ps_row.create(null, [cell('τ'), cell('0.5')])])
    const doc = s.nodes.doc.create(null, [table])
    expect(serialize(doc)).toBe('| 参数 | 值 |\n| --- | --- |\n| τ | 0.5 |')
  })
})

describe('W4-D prep：占位组件可渲染、axe 0 serious/critical', () => {
  it('LayoutView：三张纸 + 页眉书名；data-mode', async () => {
    const el = await mount(<LayoutView mode="readonly" />)
    const papers = el.querySelectorAll('.ps-paper')
    expect(papers).toHaveLength(3)
    expect(papers[0].getAttribute('aria-label')).toBe('说明书摘要')
    expect(el.querySelector('[data-testid="ps-paper-claims"] .ps-header')?.textContent).toBe('权利要求书')
    expect(el.querySelector('[data-testid="layout-view"]')?.getAttribute('data-mode')).toBe('readonly')
    expect(await violations(el)).toEqual([])
  })

  it('LayoutView 单书 + modeIndicator 槽', async () => {
    const el = await mount(<LayoutView mode="edit" books={['description']} slots={{ modeIndicator: <span data-testid="mi">编辑</span> }} />)
    expect(el.querySelectorAll('.ps-paper')).toHaveLength(1)
    expect(el.querySelector('[data-testid="mi"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="layout-view"]')?.getAttribute('data-mode')).toBe('edit')
  })

  it('SlashMenu / EquationEditor / TableToolbar / MobileLayoutToolbar 骨架', async () => {
    const onSelect = vi.fn()
    const el = await mount(
      <div>
        <SlashMenu
          open
          anchor={null}
          items={[{ kind: 'table', label: '表格', book: ['description'], markdown: '', cursor: { line: 1, col: 1 } }]}
          onSelect={onSelect}
          onClose={() => {}}
        />
        <EquationEditor open variant="popover" anchor={null} initial={{ source: 'a/b', label: '' }} onSubmit={() => true} onClose={() => {}} />
        <TableToolbar view={null} variant="floating" />
        <MobileLayoutToolbar mode="edit" onAction={() => {}} />
      </div>,
    )
    await act(async () => el.querySelector<HTMLLIElement>('.ps-slash-item')!.click())
    expect(onSelect).toHaveBeenCalledWith('table')
    expect(el.querySelector('[data-testid="equation-editor"]')?.textContent).toContain('a/b 分式')
    expect(el.querySelector('[data-testid="table-toolbar"]')?.getAttribute('role')).toBe('toolbar')
    expect(el.querySelector('[data-testid="mobile-layout-toolbar"]')?.getAttribute('aria-label')).toBe('版面工具')
    expect(await violations(el)).toEqual([])
  })
})
