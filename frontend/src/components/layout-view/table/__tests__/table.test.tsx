// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { blockSource } from '@/store'
import type { Ast, AstTable } from '@/types/ast'
import type { EditableBlock } from '@/components/block-model/slots'
import astMethod from '../../../../../../backend/tests/fixtures/ast_rich.json'
import mdMethod from '../../../../../../backend/tests/fixtures/rich/content.md?raw'
import {
  MERGE_UP,
  MIN_ROWS,
  TableToolbar,
  applyCaptionNote,
  canRunTableCommand,
  collapseMerges,
  expandMerges,
  layoutSchema,
  parseColWidths,
  serializeLayout,
  setColWidths,
  tableCommand,
  tableNote,
  tableOptionState,
  tablePlugins,
  tableSource,
  toLayoutDoc,
  type TableCommand,
} from '..'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const { ps_table, ps_row, ps_cell, ps_header_cell } = layoutSchema.nodes
const cell = (t: string, attrs: Record<string, unknown> = {}) => ps_cell.create(attrs, t ? layoutSchema.text(t) : null)
const row = (...c: string[]) => ps_row.create(null, c.map((t) => cell(t)))
const table = (rows: ReturnType<typeof row>[], attrs: Record<string, unknown> = {}) =>
  ps_table.create({ three_line: false, repeat_header: false, num_left: false, col_widths: null, caption_after: null, ...attrs }, rows)

/** 三行两列的编辑器 state，光标落在 (r, c) 单元 */
function stateAt(t = collapseMerges(table([row('A', 'B'), row('1', '2'), row('3', '4')])), r = 1, c = 0) {
  const doc = layoutSchema.node('doc', null, [t])
  let pos = 1
  doc.firstChild!.forEach((rowNode, rowOffset, ri) => {
    rowNode.forEach((_cell, cellOffset, ci) => {
      if (ri === r && ci === c) pos = 1 + rowOffset + 1 + cellOffset + 1
    })
  })
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos), plugins: tablePlugins() })
}

const run = (state: EditorState, cmd: Exclude<TableCommand, 'col-widths' | 'caption-note'>): EditorState => {
  let next = state
  expect(tableCommand(cmd)(state, (tr) => (next = state.apply(tr)))).toBe(true)
  return next
}
const lines = (state: EditorState) => serializeLayout(state.doc).split('\n')

describe('GFM 表格文本拼装 ↔ 版面 schema 往返', () => {
  // 表格块只存在于 rich fixture（真语料指纹/可视化案均无表）
  const cases: [string, Ast, string][] = [['rich', astMethod as unknown as Ast, mdMethod]]
  const tables = (ast: Ast) => ast.description.filter((b): b is AstTable => b.kind === 'table')

  it.each(cases)('%s：golden 每个表格块 serializeLayout(toLayoutDoc(block)) === 源码', (_n, ast, md) => {
    const blocks = tables(ast)
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) {
      const doc = toLayoutDoc(b as EditableBlock)
      doc.check()
      expect(serializeLayout(doc)).toBe(blockSource(ast, md, b.id))
    }
  })

  it('toLayoutDoc：首行 ps_header_cell，其余 ps_cell', () => {
    const b = tables(astMethod as unknown as Ast)[0]
    const t = toLayoutDoc(b as EditableBlock).firstChild!
    t.forEach((r, _o, i) => r.forEach((c) => expect(c.type).toBe(i === 0 ? ps_header_cell : ps_cell)))
  })

  it('^^ 折叠为 rowspan，再展开逐字节还原（含选项行顺序：三线 重复表头 段号居左 列宽 表题后置）', () => {
    const src = table([row('参数', '值'), row('τ', '0.5'), row(MERGE_UP, '0.7'), row(MERGE_UP, '0.9')], {
      three_line: true,
      repeat_header: true,
      num_left: true,
      col_widths: [1, 2.5],
      caption_after: '表1 结果',
    })
    const folded = collapseMerges(src)
    folded.check()
    expect(folded.childCount).toBe(4)
    expect(folded.child(1).childCount).toBe(2)
    expect(folded.child(1).firstChild!.attrs.rowspan).toBe(3)
    expect(folded.child(2).childCount).toBe(1)
    expect(folded.child(3).childCount).toBe(1)
    const out = tableSource(folded)
    expect(out).toEqual([
      '<!-- 表格: 三线 重复表头 段号居左 列宽=1,2.5 表题后置=表1 结果 -->',
      '| 参数 | 值 |',
      '| --- | --- |',
      '| τ | 0.5 |',
      '| ^^ | 0.7 |',
      '| ^^ | 0.9 |',
    ])
    expect(tableSource(expandMerges(folded))).toEqual(out)
  })

  it('表头行的 ^^ 无上方单元：保留原文不合并', () => {
    const t = collapseMerges(table([row(MERGE_UP, 'B'), row('1', '2')]))
    expect(t.firstChild!.childCount).toBe(2)
    expect(tableSource(t)[0]).toBe('| ^^ | B |')
  })

  it('colspan>1（粘贴带入，内核不支持）展开为空单元占位保持矩形', () => {
    const t = ps_table.create(null, [
      ps_row.create(null, [ps_header_cell.create(null, layoutSchema.text('A')), ps_header_cell.create(null, layoutSchema.text('B'))]),
      ps_row.create(null, [cell('x', { colspan: 2 })]),
    ])
    expect(tableSource(t)).toEqual(['| A | B |', '| --- | --- |', '| x |  |'])
  })
})

describe('prosemirror-tables 命令 → GFM 行数 / 列数 / ^^', () => {
  it('row-after / row-before：行数 +1，表头行始终是 ps_header_cell', () => {
    const s0 = stateAt()
    expect(lines(s0)).toHaveLength(4)
    const s1 = run(s0, 'row-after')
    expect(lines(s1)).toEqual(['| A | B |', '| --- | --- |', '| 1 | 2 |', '|  |  |', '| 3 | 4 |'])
    const s2 = run(stateAt(undefined, 0, 0), 'row-before')
    expect(lines(s2)[0]).toBe('|  |  |')
    s2.doc.firstChild!.forEach((r, _o, i) => r.forEach((c) => expect(c.type.name).toBe(i === 0 ? 'ps_header_cell' : 'ps_cell')))
  })

  it('col-after / col-before：表头与分隔行同步加列，列宽失效清除', () => {
    const s0 = stateAt(collapseMerges(table([row('A', 'B'), row('1', '2')], { col_widths: [1, 2] })))
    expect(lines(s0)[0]).toBe('<!-- 表格: 列宽=1,2 -->')
    const s1 = run(s0, 'col-after')
    expect(lines(s1)).toEqual(['| A |  | B |', '| --- | --- | --- |', '| 1 |  | 2 |'])
    const s2 = run(s0, 'col-before')
    expect(lines(s2)).toEqual(['|  | A | B |', '| --- | --- | --- |', '|  | 1 | 2 |'])
  })

  it('delete-row / delete-col：保留表头 + 至少一行数据、至少一列', () => {
    const s0 = stateAt()
    const s1 = run(s0, 'delete-row')
    expect(lines(s1)).toEqual(['| A | B |', '| --- | --- |', '| 3 | 4 |'])
    expect(s1.doc.firstChild!.childCount).toBe(MIN_ROWS)
    expect(canRunTableCommand(s1, 'delete-row')).toBe(false)
    const s2 = run(s0, 'delete-col')
    expect(lines(s2)).toEqual(['| B |', '| --- |', '| 2 |', '| 4 |'])
    expect(canRunTableCommand(s2, 'delete-col')).toBe(false)
  })

  it('merge-down → 下一行同列落 ^^；split 还原；末行 / 表头跨列不可合并', () => {
    const s0 = stateAt()
    expect(canRunTableCommand(s0, 'merge-down')).toBe(true)
    expect(canRunTableCommand(s0, 'split')).toBe(false)
    const s1 = run(s0, 'merge-down')
    expect(lines(s1)).toEqual(['| A | B |', '| --- | --- |', '| 13 | 2 |', '| ^^ | 4 |'])
    expect(s1.selection).toBeInstanceOf(TextSelection)
    expect(canRunTableCommand(s1, 'split')).toBe(true)
    const s2 = run(s1, 'split')
    expect(lines(s2)).toEqual(['| A | B |', '| --- | --- |', '| 13 | 2 |', '|  | 4 |'])
    expect(canRunTableCommand(stateAt(undefined, 2, 0), 'merge-down')).toBe(false)
  })

  it('表头单元向下合并：^^ 落在第一数据行（内核允许 vMerge 从表头起）', () => {
    const s1 = run(stateAt(undefined, 0, 1), 'merge-down')
    expect(lines(s1)).toEqual(['| A | B2 |', '| --- | --- |', '| 1 | ^^ |', '| 3 | 4 |'])
  })

  it('three-line / repeat-header / num-left 切换选项行，token 顺序固定；col-widths 校验列数', () => {
    let s = stateAt()
    expect(tableOptionState(s)).toMatchObject({ three_line: false, width: 2, height: 3 })
    s = run(s, 'num-left')
    s = run(s, 'three-line')
    expect(lines(s)[0]).toBe('<!-- 表格: 三线 段号居左 -->')
    s = run(s, 'repeat-header')
    expect(lines(s)[0]).toBe('<!-- 表格: 三线 重复表头 段号居左 -->')
    expect(setColWidths([1, 2, 3])(s)).toBe(false)
    setColWidths([1, 2.5])(s, (tr) => (s = s.apply(tr)))
    expect(lines(s)[0]).toBe('<!-- 表格: 三线 重复表头 段号居左 列宽=1,2.5 -->')
    s = run(s, 'three-line')
    expect(lines(s)[0]).toBe('<!-- 表格: 重复表头 段号居左 列宽=1,2.5 -->')
    setColWidths(null)(s, (tr) => (s = s.apply(tr)))
    s = run(s, 'repeat-header')
    s = run(s, 'num-left')
    expect(lines(s)[0]).toBe('| A | B |')
  })

  it('parseColWidths：逗号 / 中文逗号 / 空格分隔，空 = null，非正数无效', () => {
    expect(parseColWidths('1, 2.5')).toEqual([1, 2.5])
    expect(parseColWidths('1，2')).toEqual([1, 2])
    expect(parseColWidths('  ')).toBeNull()
    expect(parseColWidths('1,x')).toBeNull()
    expect(parseColWidths('0,1')).toBeNull()
  })

  it('光标不在表格：全部命令不可用', () => {
    const doc = layoutSchema.node('doc', null, [layoutSchema.nodes.ps_para.create(null, layoutSchema.text('段落'))])
    const s = EditorState.create({ doc, selection: TextSelection.create(doc, 1) })
    const all: TableCommand[] = ['row-before', 'row-after', 'col-before', 'col-after', 'delete-row', 'delete-col', 'merge-down', 'split', 'three-line', 'repeat-header', 'num-left', 'col-widths', 'caption-note']
    for (const c of all) expect(canRunTableCommand(s, c)).toBe(false)
  })

  it('批69 applyCaptionNote：无注表 → 设表题+插 ps_note 兄弟节点，「注：」前缀归一；清空注 = 删节点', () => {
    const s0 = stateAt()
    expect(tableNote(s0)).toBeNull()
    let s = s0
    expect(applyCaptionNote('表1 结果', '室温 25℃')(s, (tr) => (s = s.apply(tr)))).toBe(true)
    expect(lines(s)).toEqual([
      '<!-- 表格: 表题后置=表1 结果 -->',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '| 3 | 4 |',
      '',
      '注：室温 25℃',
    ])
    expect(tableOptionState(s)).toMatchObject({ caption_after: '表1 结果' })
    expect(tableNote(s)?.node.textContent).toBe('注：室温 25℃')
    // 已带前缀的输入不再加第二个
    applyCaptionNote('表1 结果', '注：重复')(s, (tr) => (s = s.apply(tr)))
    expect(tableNote(s)?.node.textContent).toBe('注：重复')
    // 清空表注 → 兄弟节点删除；表题同时清除
    applyCaptionNote('', '')(s, (tr) => (s = s.apply(tr)))
    expect(tableNote(s)).toBeNull()
    expect(lines(s)).toEqual(['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'])
    // 表格后还有别的段落时，注插到紧邻表格的位置而非段尾
    const doc2 = layoutSchema.node('doc', null, [
      collapseMerges(table([row('A', 'B'), row('1', '2')])),
      layoutSchema.nodes.ps_para.create(null, layoutSchema.text('段落')),
    ])
    let s2 = EditorState.create({ doc: doc2, selection: TextSelection.create(doc2, 3) })
    applyCaptionNote(null, 'x')(s2, (tr) => (s2 = s2.apply(tr)))
    expect(lines(s2)).toEqual(['| A | B |', '| --- | --- |', '| 1 | 2 |', '', '注：x', '段落'])
  })
})

describe('TableToolbar', () => {
  let root: Root | null = null
  let host: HTMLElement
  let view: EditorView | null = null

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    view?.destroy()
    view = null
    host?.remove()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function mount(el: ReactElement) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(el))
    return host
  }

  function makeView(state = stateAt()) {
    const mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    view = new EditorView(mountEl, { state })
    return view
  }

  const btn = (el: HTMLElement, cmd: TableCommand) => el.querySelector<HTMLButtonElement>(`button[data-cmd="${cmd}"]`)!
  const click = (b: HTMLElement) => act(async () => b.click())

  async function violations(el: Element) {
    const res = await axe.run(el, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    })
    return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
  }

  it('view=null：12 个命令按钮全部渲染且禁用；无横向合并 / 列对齐；axe 0 serious/critical', async () => {
    const el = await mount(<TableToolbar view={null} variant="floating" />)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[data-cmd]')]
    expect(buttons.map((b) => b.dataset.cmd)).toEqual([
      'row-before', 'row-after', 'col-before', 'col-after', 'delete-row', 'delete-col', 'merge-down', 'split',
      'three-line', 'repeat-header', 'num-left', 'col-widths', 'caption-note',
    ])
    for (const b of buttons) {
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('aria-label')).toBeTruthy()
    }
    expect(el.textContent).not.toMatch(/横向|对齐/)
    expect(await violations(el)).toEqual([])
  })

  it('点击加列 → view 文档多一列并落 GFM；onCommand 回调；选项按钮 aria-pressed 跟随', async () => {
    const v = makeView()
    const onCommand = vi.fn()
    const el = await mount(<TableToolbar view={v} variant="floating" onCommand={onCommand} />)
    expect(btn(el, 'col-after').disabled).toBe(false)
    expect(btn(el, 'split').disabled).toBe(true)
    await click(btn(el, 'col-after'))
    expect(lines(v.state)).toEqual(['| A |  | B |', '| --- | --- | --- |', '| 1 |  | 2 |', '| 3 |  | 4 |'])
    expect(onCommand).toHaveBeenCalledWith('col-after')

    expect(btn(el, 'three-line').getAttribute('aria-pressed')).toBe('false')
    await click(btn(el, 'three-line'))
    expect(btn(el, 'three-line').getAttribute('aria-pressed')).toBe('true')
    expect(lines(v.state)[0]).toBe('<!-- 表格: 三线 -->')

    await click(btn(el, 'merge-down'))
    expect(lines(v.state)).toContain('| ^^ |  | 4 |')
    expect(btn(el, 'split').disabled).toBe(false)
  })

  it('列宽：输入 → 应用写入表格选项行；非法输入不提交', async () => {
    const v = makeView()
    const el = await mount(<TableToolbar view={v} variant="floating" />)
    await click(btn(el, 'col-widths'))
    const input = el.querySelector<HTMLInputElement>('form input')!
    expect(input.placeholder).toBe('1,1')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '1,x')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(el.querySelector<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(true)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '1, 2.5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => el.querySelector('form')!.requestSubmit())
    expect(lines(v.state)[0]).toBe('<!-- 表格: 列宽=1,2.5 -->')
    expect(el.querySelector('form')).toBeNull()
    expect(btn(el, 'col-widths').getAttribute('aria-pressed')).toBe('true')
  })

  it('批69 表题/表注：popover 预填现状，应用落选项行+ps_note；再开清空即删', async () => {
    const t = collapseMerges(table([row('A', 'B'), row('1', '2')], { caption_after: '表1' }))
    const v = makeView(stateAt(t))
    const el = await mount(<TableToolbar view={v} variant="floating" />)
    expect(btn(el, 'caption-note').getAttribute('aria-pressed')).toBe('true')
    await click(btn(el, 'caption-note'))
    const cap = el.querySelector<HTMLInputElement>('[data-testid="table-caption-input"]')!
    const note = el.querySelector<HTMLInputElement>('[data-testid="table-note-input"]')!
    expect(cap.value).toBe('表1')
    const setVal = async (input: HTMLInputElement, val: string) =>
      act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, val)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await setVal(cap, '表2 对比')
    await setVal(note, '数据为均值')
    await act(async () => el.querySelectorAll('form')[0]!.requestSubmit())
    expect(lines(v.state)).toContain('注：数据为均值')
    expect(lines(v.state)[0]).toBe('<!-- 表格: 表题后置=表2 对比 -->')
    expect(btn(el, 'caption-note').getAttribute('aria-pressed')).toBe('true')
    // 再开：表注预填去前缀；清空应用 → 节点删除
    await click(btn(el, 'caption-note'))
    expect(el.querySelector<HTMLInputElement>('[data-testid="table-note-input"]')!.value).toBe('数据为均值')
    await setVal(el.querySelector<HTMLInputElement>('[data-testid="table-caption-input"]')!, '')
    await setVal(el.querySelector<HTMLInputElement>('[data-testid="table-note-input"]')!, '')
    await act(async () => el.querySelectorAll('form')[0]!.requestSubmit())
    expect(tableNote(v.state)).toBeNull()
    expect(btn(el, 'caption-note').getAttribute('aria-pressed')).toBe('false')
  })

  it('mobile 变体：按钮 size=icon（≥44px 触控）+ 横向滚动类；axe 0 serious/critical', async () => {
    const v = makeView()
    const el = await mount(<TableToolbar view={v} variant="mobile" />)
    const bar = el.querySelector<HTMLElement>('[data-testid="table-toolbar"]')!
    expect(bar.dataset.variant).toBe('mobile')
    expect(bar.className).toContain('ps-table-toolbar--mobile')
    for (const b of el.querySelectorAll<HTMLButtonElement>('button[data-cmd]')) expect(b.className).toContain('size-touch')
    expect(await violations(el)).toEqual([])
  })
})
