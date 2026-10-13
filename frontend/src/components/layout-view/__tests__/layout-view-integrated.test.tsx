// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import goldenMethod from '../../../../../backend/tests/golden/ast_method.json'
import content from '../../../../../examples/method/content.md?raw'
import { closeStructureDialog, useDialogStore } from '@/components/block-model/dialogs/state'
import { StructureDialogs } from '@/components/block-model/dialogs'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { MobilePreview } from '@/components/mobile/MobilePreview'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { blockSource, findBlockLines, useStudio } from '@/store'
import type { Ast, AstEquation, AstTable } from '@/types/ast'
import { LayoutView } from '..'

vi.mock('@/components/preview/PdfPreview', () => ({ PdfPreview: () => null }))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const method = goldenMethod as unknown as Ast
const initial = useStudio.getInitialState()

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  useStudio.setState({ ...initial, pid: 'method', content, saved: content, ast: method, astContent: content, activeBlock: null }, false)
  vi.spyOn(api, 'projects').mockResolvedValue([])
  vi.spyOn(api, 'getFigures').mockRejectedValue(new Error('offline'))
  vi.spyOn(api, 'styleCss').mockRejectedValue(new Error('offline'))
  vi.spyOn(api, 'mathml').mockResolvedValue({ mathml: '<math><mi>x</mi></math>' } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  // StructureDialogs 宿主在工作台壳单例挂载（B38-OBS1）——测试按壳的形状补挂
  await act(async () => root!.render(<>{el}<StructureDialogs /></>))
  return host
}
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))
const block = (el: HTMLElement, id: string) => {
  for (const b of el.querySelectorAll<HTMLElement>('[data-block-id]')) if (b.dataset.blockId === id) return b
  throw new Error(`block ${id} not rendered`)
}
const dblclick = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const gfmCols = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').length

describe('集成：版面视图 × D2 表格（prosemirror-tables → GFM → patchBlock）', () => {
  const table = () => method.description.find((b): b is AstTable => b.kind === 'table')!

  it('W9 整书编辑器：点进表格 → 表格工具条（无块弹窗）；「右侧加列」失焦落盘 → GFM 列数 +1、分隔行同步；光标离开表格工具条消失', async () => {
    const patch = vi.spyOn(api, 'patchBlock').mockResolvedValue({ content, block_id: table().id, ast: method } as never)
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    expect(el.querySelector('[data-testid="table-toolbar"]')).toBeNull()
    const view = el.querySelector<HTMLElement>('[data-testid="ps-book-description"] [role="textbox"]')!
    const tableEl = block(el, table().id)
    expect(view.contains(tableEl)).toBe(true)
    expect(tableEl.querySelector('th')).not.toBeNull()
    expect(el.querySelector('[data-testid="block-editor"]')).toBeNull()
    // 光标放进第一格（点击即光标；jsdom 无布局，先聚焦再放 DOM 选区）
    const cell = tableEl.querySelector('th, td')!
    view.focus()
    await act(async () => {
      document.getSelection()!.collapse(cell.firstChild ?? cell, 0)
      document.dispatchEvent(new Event('selectionchange'))
      await new Promise((r) => setTimeout(r, 0))
    })
    await click(cell)
    await act(async () => view.dispatchEvent(new FocusEvent('focus')))
    const toolbar = el.querySelector<HTMLElement>('[data-testid="table-toolbar"]')!
    expect(toolbar).not.toBeNull()
    expect(toolbar.getAttribute('data-variant')).toBe('floating')
    await click(toolbar.querySelector('[data-cmd="col-after"]')!)
    const before = blockSource(method, content, table().id)!
    const beforeRow = before.split('\n').find((l) => l.startsWith('|'))!
    // 失焦即落盘（无提交键）
    await act(async () => view.dispatchEvent(new FocusEvent('blur')))
    await flush()
    await flush()
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch.mock.calls[0][1]).toBe(table().id)
    const md = (patch.mock.calls[0][2] as { markdown: string }).markdown
    const rows = md.split('\n').filter((l) => l.startsWith('|'))
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (const r of rows) expect(gfmCols(r)).toBe(gfmCols(beforeRow) + 1)
    expect(rows[1]).toMatch(/^\|(\s*:?-+:?\s*\|)+$/)
    // 非表格行（表题 / 注 / 选项注释）原样保留
    for (const l of before.split('\n').filter((l) => !l.startsWith('|'))) expect(md).toContain(l)
    // 光标移到段落 → 工具条消失
    const para = method.description.find((b) => b.kind === 'paragraph')!
    await click(block(el, para.id))
    expect(el.querySelector('[data-testid="table-toolbar"]')).toBeNull()
  })

  it('readonly：表格不可编辑（contenteditable=false）、无工具条、双击不弹块编辑器', async () => {
    const el = await mount(<LayoutView mode="readonly" books={['description']} />)
    const view = el.querySelector<HTMLElement>('[data-testid="ps-book-description"] [role="textbox"]')!
    expect(view.getAttribute('contenteditable')).toBe('false')
    await dblclick(block(el, table().id))
    await click(block(el, table().id))
    expect(el.querySelector('[data-testid="block-editor"]')).toBeNull()
    expect(el.querySelector('[data-testid="table-toolbar"]')).toBeNull()
  })
})

describe('集成：版面视图 × D2 公式（EquationEditor → equationLine → patchBlock / insertBlock）', () => {
  const eq = () => method.description.find((b): b is AstEquation => b.kind === 'equation')!

  it('双击已有公式块 → EquationEditor（initial = AST source / label）；保存 → patchBlock 收到 `$$…$$ 编号`', async () => {
    const patch = vi.spyOn(api, 'patchBlock').mockResolvedValue({ content, block_id: eq().id, ast: method } as never)
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    await dblclick(block(el, eq().id))
    expect(el.querySelector('[data-testid="block-editor"]')).toBeNull()
    const ed = document.querySelector<HTMLElement>('[data-testid="equation-editor"]')!
    expect(ed).not.toBeNull()
    const src = ed.querySelector<HTMLTextAreaElement>('[data-testid="eq-source"]')!
    expect(src.value).toBe(eq().source)
    expect(ed.querySelector<HTMLInputElement>('[data-testid="eq-label"]')!.value).toBe(eq().label ?? '')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(src, `${eq().source} + 1`)
      src.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(ed.querySelector('[data-testid="eq-submit"]')!)
    await flush()
    expect(patch).toHaveBeenCalledTimes(1)
    const [pid, id, body] = patch.mock.calls[0]
    expect(pid).toBe('method')
    expect(id).toBe(eq().id)
    expect((body as { markdown: string }).markdown).toBe(`$$${eq().source} + 1$$ ${eq().label ?? ''}`.trimEnd())
    expect(document.querySelector('[data-testid="equation-editor"]')).toBeNull()
  })

  it('review 模式：公式改动落 CriticMarkup（整块 {--旧--} / {++新++}），不直写', async () => {
    const patch = vi.spyOn(api, 'patchBlock').mockResolvedValue({ content, block_id: eq().id, ast: method } as never)
    const el = await mount(<LayoutView mode="review" books={['description']} />)
    await dblclick(block(el, eq().id))
    const ed = document.querySelector<HTMLElement>('[data-testid="equation-editor"]')!
    const src = ed.querySelector<HTMLTextAreaElement>('[data-testid="eq-source"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(src, 'y = 2')
      src.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(ed.querySelector('[data-testid="eq-submit"]')!)
    await flush()
    const md = (patch.mock.calls[0][2] as { markdown: string }).markdown
    expect(md).toContain('{--')
    expect(md).toContain('{++$$y = 2$$')
  })

  it('移动底部工具栏「公式」（store.layoutViewToolbar）：当前块非公式 → 在其后插入；保存走 insertBlock，编号 = AST 式数 + 1；关闭回写 none', async () => {
    const insert = vi.spyOn(api, 'insertBlock').mockResolvedValue({ content, block_id: 'new-eq', ast: method } as never)
    const para = method.description.find((b) => b.kind === 'paragraph')!
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    await click(block(el, para.id))
    await act(async () => useStudio.getState().setLayoutViewToolbar('equation'))
    const ed = document.querySelector<HTMLElement>('[data-testid="equation-editor"]')!
    expect(ed).not.toBeNull()
    const n = method.description.filter((b) => b.kind === 'equation').length
    expect(ed.querySelector<HTMLInputElement>('[data-testid="eq-label"]')!.value).toBe(`（${n + 1}）`)
    const src = ed.querySelector<HTMLTextAreaElement>('[data-testid="eq-source"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(src, 'a = b')
      src.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(ed.querySelector('[data-testid="eq-submit"]')!)
    await flush()
    expect(insert).toHaveBeenCalledTimes(1)
    const body = insert.mock.calls[0][1] as { kind: string; after_block_id?: string; markdown: string }
    expect(body.kind).toBe('equation')
    expect(body.after_block_id).toBe(para.id)
    expect(body.markdown).toBe(`$$a = b$$ （${n + 1}）`)
    expect(useStudio.getState().layoutViewToolbar).toBe('none')
  })

  it('readonly：工具栏面板状态不弹任何编辑器', async () => {
    await mount(<LayoutView mode="readonly" books={['description']} />)
    await act(async () => useStudio.getState().setLayoutViewToolbar('equation'))
    expect(document.querySelector('[data-testid="equation-editor"]')).toBeNull()
  })
})

describe('集成：PDF 双击定位 → 版面（W9 走查 P2）', () => {
  it('光标原在文末段：Focus(source=pdf) 到前段后 activeBlock / cursor 停在目标块，不被「源码光标 → 当前块」拉回旧块', async () => {
    const paras = method.description.filter((b) => b.kind === 'paragraph')
    const target = paras[2]
    const last = paras[paras.length - 1]
    const lineOf = (id: string) => {
      const loc = findBlockLines(method, id)!
      return loc.offset + loc.start
    }
    const scrolled: string[] = []
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      const b = (this as HTMLElement).closest<HTMLElement>('[data-block-id]')
      if (b?.dataset.blockId) scrolled.push(b.dataset.blockId)
    }
    try {
      const el = await mount(<LayoutView mode="edit" books={['description']} />)
      await act(async () => useStudio.getState().setCursor({ line: lineOf(last.id), col: 1, section: '具体实施方式' }))
      await flush()
      expect(useStudio.getState().activeBlock?.id).toBe(last.id)
      scrolled.length = 0
      await act(async () => useStudio.getState().setFocus({ book: 'description', blockId: target.id, line: lineOf(target.id), source: 'pdf' }))
      await flush()
      await act(async () => new Promise((r) => setTimeout(r, 400)))
      const s = useStudio.getState()
      expect(s.activeBlock?.id).toBe(target.id)
      expect(s.cursor.line).toBe(lineOf(target.id))
      expect(scrolled).toContain(target.id)
      expect(scrolled).not.toContain(last.id)
      expect(block(el, target.id)).not.toBeNull()
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  })
})

describe('集成：`/` 插入「附图…」复用 figure-book', () => {
  const templates = [
    { kind: 'paragraph' as const, label: '段落', book: ['abstract', 'claims', 'description'] as const, markdown: '', cursor: { line: 1, col: 1 } },
  ]

  it('说明书：菜单末项 figure-book，选中 → openPanel(figures)（dock 面板 / 375 抽屉页签），不调 insertBlock', async () => {
    const insert = vi.spyOn(api, 'insertBlock')
    const openPanel = vi.fn()
    useStudio.setState({ blockTemplates: [...templates], openPanel } as never, false)
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    await click(el.querySelector('[data-testid="layout-insert"]')!)
    const list = el.querySelector<HTMLElement>('[data-testid="slash-menu"]')!
    const kinds = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).map((o) => o.dataset.kind)
    expect(kinds).toEqual(['paragraph', 'figure-book'])
    await click(list.querySelector('[data-kind="figure-book"]')!)
    expect(openPanel).toHaveBeenCalledWith('figures')
    expect(insert).not.toHaveBeenCalled()
    expect(el.querySelector('[data-testid="slash-menu"]')).toBeNull()
  })

  it('说明书：菜单「公式」→ EquationEditor → 插入 → insertBlock 收到 `$$…$$ 编号`（after_block_id = 当前块）；W5 走查 domain-01', async () => {
    const insert = vi.spyOn(api, 'insertBlock').mockResolvedValue({ content, block_id: 'new-eq', ast: method } as never)
    useStudio.setState(
      { blockTemplates: [...templates, { kind: 'equation', label: '公式', book: ['description'], markdown: '$$$$', cursor: { line: 1, col: 3 } }] } as never,
      false,
    )
    const para = method.description.find((b) => b.kind === 'paragraph')!
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    await click(block(el, para.id))
    await click(el.querySelector('[data-testid="layout-insert"]')!)
    await click(el.querySelector('[data-testid="slash-menu"] [data-kind="equation"]')!)
    expect(el.querySelector('[data-testid="slash-menu"]')).toBeNull()
    const ed = document.querySelector<HTMLElement>('[data-testid="equation-editor"]')!
    expect(ed).not.toBeNull()
    const src = ed.querySelector<HTMLTextAreaElement>('[data-testid="eq-source"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(src, 'y_t = a/b + x_t')
      src.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(ed.querySelector('[data-testid="eq-submit"]')!)
    await flush()
    expect(insert).toHaveBeenCalledTimes(1)
    const body = insert.mock.calls[0][1] as { kind: string; after_block_id?: string; markdown: string; content: string }
    const n = method.description.filter((b) => b.kind === 'equation').length
    expect(body).toMatchObject({ kind: 'equation', after_block_id: para.id, markdown: `$$y_t = a/b + x_t$$ （${n + 1}）` })
    expect(body.content).toBe(content)
    expect(document.querySelector('[data-testid="equation-editor"]')).toBeNull()
  })

  it('权利要求书：无「附图…」项', async () => {
    useStudio.setState({ blockTemplates: [...templates] } as never, false)
    const el = await mount(<LayoutView mode="edit" books={['claims']} />)
    await click(el.querySelector('[data-testid="layout-insert"]')!)
    const kinds = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="slash-menu"] [role="option"]')).map((o) => o.dataset.kind)
    expect(kinds).toEqual(['paragraph'])
  })

  it('权利要求书：内嵌公式双击 → 公式对话框（backlog #3：claim segment 无 blockId 不再死端）', async () => {
    const el = await mount(<LayoutView mode="edit" books={['claims']} />)
    const eq = el.querySelector<HTMLElement>('.ps-claim .ps-eq')
    expect(eq).not.toBeNull()
    await act(async () => eq!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const src = document.querySelector<HTMLTextAreaElement>('[data-testid="formula-source"]')
    expect(src?.value.length).toBeGreaterThan(0)
    const state = useDialogStore.getState()
    expect(state.payload?.kind).toBe('formula')
    const payload = state.payload
    if (payload?.kind === 'formula') {
      // 初始值 = 该权项首个 equation segment 的源码（golden claims/2/seg/1）
      expect(payload.initial).toBe('g_t,c = [ē_b,c/(ē_b,c+ē_ret,c)]·clip(conf_t,c, 0, 1)')
      await act(async () => payload.onSubmit('x = 1'))
      await act(async () => Promise.resolve())
      expect(api.mathml).toHaveBeenCalledWith('x = 1')
      // 节点源码已落 doc（mathml 异步补，addToHistory:false）
    }
    closeStructureDialog()
  })

  it('只读模式：权项公式双击 → 只读提示（双击不再静默吞掉），不开对话框', async () => {
    const el = await mount(<LayoutView mode="readonly" books={['claims']} />)
    const eq = el.querySelector<HTMLElement>('.ps-claim .ps-eq')
    expect(eq).not.toBeNull()
    await act(async () => eq!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('只读')
    expect(document.querySelector('[data-testid="formula-source"]')).toBeNull()
    // 对话框未开（payload 跨测试保留，open 才是活态）
    expect(useDialogStore.getState().open).toBe(false)
  })

  it('只读模式：说明书公式双击 → 落 gotoLine 定位（与块文本双击一致），不开编辑器', async () => {
    const el = await mount(<LayoutView mode="readonly" books={['description']} />)
    const descEq = method.description.find((b): b is AstEquation => b.kind === 'equation')!
    await dblclick(block(el, descEq.id))
    const sr = useStudio.getState().scrollRequest
    expect(sr).not.toBeNull()
    expect(typeof sr?.line).toBe('number')
    expect(document.querySelector('[data-testid="equation-editor"]')).toBeNull()
  })
})

describe('集成：入口下线 —— EditorToolbar etb-mode → ViewTabs；MobilePreview layout → 只读版面', () => {
  it('EditorToolbar 桌面：渲染 view-tabs（源码 / 版面 / PDF），不再有 etb-mode', async () => {
    const el = await mount(
      <TooltipProvider>
        <EditorToolbar />
      </TooltipProvider>,
    )
    expect(el.querySelector('[data-testid="etb-mode"]')).toBeNull()
    expect(el.querySelector('[data-testid="view-tabs"]')).not.toBeNull()
    // 无 dockview（测试里未挂 dock）时只列 源码 / 版面；PDF 段由 ViewTabs 自身测试覆盖
    for (const v of ['source', 'layout']) expect(el.querySelector(`[data-testid="view-tabs-${v}"]`)).not.toBeNull()
  })

  it('MobilePreview kind=layout：渲染 LayoutView（readonly，无 contenteditable），保留「编辑源码」', async () => {
    useStudio.setState({ mobilePreviewKind: 'layout' })
    const el = await mount(<MobilePreview />)
    const lv = el.querySelector('[data-testid="layout-view"]')!
    expect(lv).not.toBeNull()
    expect(lv.getAttribute('data-mode')).toBe('readonly')
    expect(el.querySelectorAll('[contenteditable="true"]')).toHaveLength(0)
    expect(el.querySelector('[data-testid="mpv-edit-source"]')).not.toBeNull()
  })

  it('375 只读版面：单击公式块 → 公式 Sheet（R-LAY-04）', async () => {
    const mm = window.matchMedia
    window.matchMedia = (q: string) =>
      ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    try {
      const el = await mount(<LayoutView mode="readonly" />)
      const eq = method.description.find((b): b is AstEquation => b.kind === 'equation')!
      await click(block(el, eq.id))
      await flush()
      const sheet = document.querySelector('[data-testid="layout-equation-sheet"]')
      expect(sheet).not.toBeNull()
      expect(sheet!.textContent).toContain(eq.source)
    } finally {
      window.matchMedia = mm
    }
  })
})

describe('批66 工具条「删除块」入口（D-B66-1：DeleteDialog 接线）', () => {
  it('禁用矩阵：未选中 / 法定章节 / 摘要整块与 title 不可删；段与权项可删', async () => {
    const { deleteDisabledReason } = await import('@/components/block-model/dialogs/lookup')
    const { TITLE_ID } = await import('@/components/block-model/model')
    expect(deleteDisabledReason(method, null)).toBe('先选中一个块')
    expect(deleteDisabledReason(method, TITLE_ID)).toBe('该块不可删除')
    expect(deleteDisabledReason(method, method.abstract.id)).toBe('该块不可删除')
    expect(deleteDisabledReason(method, method.abstract.paragraphs[0]!.id)).toBeNull()
    expect(deleteDisabledReason(method, method.claims[0]!.id)).toBeNull()
    const sec = method.description.find((b) => b.kind === 'section' && b.part === 'technical-field')!
    expect(deleteDisabledReason(method, sec.id)).toBe('法定章节不能删除')
  })

  it('选中普通块 → 删除钮启用 → DeleteDialog → 确认调 deleteBlock', async () => {
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    const del = () => el.querySelector<HTMLButtonElement>('[data-testid="layout-delete"]')!
    expect(del().disabled).toBe(true)
    expect(del().title).toBe('先选中一个块')
    const sec = method.description.find((b) => b.kind === 'section' && b.part === 'technical-field')!
    await click(block(el, sec.id))
    expect(del().disabled).toBe(true)
    expect(del().title).toBe('法定章节不能删除')
    const para = method.description.find((b) => b.kind === 'paragraph')!
    await click(block(el, para.id))
    expect(del().disabled).toBe(false)
    expect(del().title).toBe('')
    const spy = vi.spyOn(api, 'deleteBlock').mockResolvedValue({ content: content + '\n', ast: method } as never)
    await click(del())
    const dlg = document.querySelector<HTMLElement>('[data-testid="delete-dialog"]')!
    expect(dlg).not.toBeNull()
    await click(dlg.querySelector<HTMLElement>('[data-testid="delete-confirm"]')!)
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('method')
    expect(spy.mock.calls[0][1]).toBe(para.id)
    expect(document.querySelector('[data-testid="delete-dialog"]')).toBeNull()
  })
})
