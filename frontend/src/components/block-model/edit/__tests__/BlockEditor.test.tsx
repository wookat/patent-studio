// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ast, AstClaim, AstEquation, AstParagraph, AstTable } from '@/types/ast'
import { BlockEditor } from '../BlockEditor'
import type { BlockEditorProps } from '../../slots'
import fixtureMethod from '../../../../../../backend/tests/fixtures/ast_rich.json'
import content from '../../../../../../backend/tests/fixtures/rich/content.md?raw'
import { blockSource } from '@/store'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const method = fixtureMethod as unknown as Ast
const src = (id: string) => blockSource(method, content, id)!

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // 桌面（≥1024）分支：编辑区 px-2 py-1、脚部 sm secondary/soft；移动分支见 block-editor/__tests__/host.test.tsx
  window.matchMedia ??= (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  // jsdom 没有布局：ProseMirror 计算光标/滚动时会取 range 的几何信息
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

type Props = Partial<BlockEditorProps> & Pick<BlockEditorProps, 'block' | 'book'>
async function mount(p: Props) {
  const props: BlockEditorProps = {
    markdown: src(p.block.id),
    onSubmit: vi.fn(async () => true),
    onCancel: vi.fn(),
    pending: false,
    ...p,
  }
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<BlockEditor {...props} />))
  return { el: host.querySelector<HTMLElement>('[data-testid="block-editor"]')!, props }
}
const rerender = (props: BlockEditorProps) => act(async () => root!.render(<BlockEditor {...props} />))

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const textbox = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="textbox"]')!
/** 节点正文（剔除生成物 widget） */
const textOf = (el: Element | null) =>
  Array.from(el?.childNodes ?? [])
    .filter((n) => !(n instanceof HTMLElement && n.dataset.generated))
    .map((n) => n.textContent)
    .join('')

/**
 * 模拟在某节点末尾打字：改 contenteditable 的文本节点并把 DOM 选区放到其后（浏览器里光标随输入移动），
 * ProseMirror 通过 MutationObserver / selectionchange 读回 DOM 变更。
 */
async function type(el: HTMLElement, selector: string, text: string) {
  await act(async () => {
    const node = el.querySelector(selector)!
    const last = node.lastChild instanceof HTMLBRElement ? node.lastChild.previousSibling : node.lastChild
    const tn = last instanceof Text ? last : node.insertBefore(document.createTextNode(''), node.lastChild instanceof HTMLBRElement ? node.lastChild : null)
    tn.data += text
    document.getSelection()!.collapse(tn, tn.data.length)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((r) => setTimeout(r, 0))
  })
}

const para = method.description.find((b): b is AstParagraph => b.id === 'description/发明内容/技术方案/p0013')!
const claim2 = method.claims[1] as AstClaim
const equation = method.description.find((b): b is AstEquation => b.kind === 'equation')!
const table = method.description.find((b): b is AstTable => b.kind === 'table' && b.note !== null)!

describe('BlockEditor（ProseMirror）', () => {
  it('段落：源码进 doc（无段号）、段号以只读装饰呈现、挂载即聚焦', async () => {
    const { el } = await mount({ block: para, book: 'description' })
    const tb = textbox(el)
    expect(document.activeElement).toBe(tb)
    expect(textOf(tb.querySelector('p.ps-para'))).toBe(src(para.id))
    const gen = tb.querySelector<HTMLElement>('[data-generated]')!
    expect(gen.textContent).toContain('[0013]')
    expect(gen.contentEditable).toBe('false')
    expect(el.dataset.blockKind).toBe('paragraph')
  })

  it('脚部按钮：secondary「取消」+ soft「提交并重建」，不出现 primary（05 §3.18 / §0.1 一屏一个绿色实底；W7 ux-02）', async () => {
    const { el } = await mount({ block: para, book: 'description' })
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[data-variant]')]
    expect(buttons.map((b) => [b.textContent, b.dataset.variant])).toEqual([
      ['取消', 'secondary'],
      ['提交并重建', 'soft'],
    ])
    expect(buttons.some((b) => b.dataset.variant === 'primary' || b.dataset.variant === 'default')).toBe(false)
  })

  it('Esc 取消不提交；Ctrl+Enter 未改动 → 直接退出不发请求', async () => {
    const { el, props } = await mount({ block: para, book: 'description' })
    await key(textbox(el), 'Escape')
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onSubmit).not.toHaveBeenCalled()

    const m2 = await mount({ block: para, book: 'description' })
    await key(textbox(m2.el), 'Enter', { ctrlKey: true })
    expect(m2.props.onSubmit).not.toHaveBeenCalled()
    expect(m2.props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('打字后 Ctrl+Enter 提交序列化后的 Markdown 行；Cmd+Enter 同', async () => {
    const { el, props } = await mount({ block: para, book: 'description' })
    await type(el, 'p.ps-para', '增补')
    await key(textbox(el), 'Enter', { metaKey: true })
    expect(props.onSubmit).toHaveBeenCalledWith(src(para.id) + '增补')
  })

  it('IME：isComposing 的 Enter / Esc 不提交不取消；compositionstart 后到 compositionend 前同', async () => {
    const { el, props } = await mount({ block: para, book: 'description' })
    await type(el, 'p.ps-para', 'x')
    const tb = textbox(el)
    await key(tb, 'Enter', { ctrlKey: true, isComposing: true })
    await key(tb, 'Escape', { isComposing: true })
    await act(async () => tb.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await key(tb, 'Enter', { ctrlKey: true })
    await key(tb, 'Escape')
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
    await act(async () => tb.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await key(tb, 'Enter', { ctrlKey: true })
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('失焦提交（焦点移到编辑器外）；焦点在编辑器内移动不提交', async () => {
    const { el, props } = await mount({ block: para, book: 'description' })
    await type(el, 'p.ps-para', 'y')
    const btn = el.querySelector<HTMLButtonElement>('button')!
    await act(async () => btn.focus())
    expect(props.onSubmit).not.toHaveBeenCalled()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    await act(async () => outside.focus())
    expect(props.onSubmit).toHaveBeenCalledWith(src(para.id) + 'y')
    outside.remove()
  })

  it('pending：只读、按钮禁用、Ctrl+Enter 不提交；提交失败编辑器保留输入', async () => {
    const { el, props } = await mount({ block: para, book: 'description', onSubmit: vi.fn(async () => false) })
    await type(el, 'p.ps-para', 'z')
    await rerender({ ...props, pending: true })
    expect(textbox(el).getAttribute('contenteditable')).toBe('false')
    for (const b of el.querySelectorAll('button')) expect(b.disabled).toBe(true)
    await key(textbox(el), 'Enter', { ctrlKey: true })
    expect(props.onSubmit).not.toHaveBeenCalled()
    await rerender({ ...props, pending: false })
    expect(textbox(el).getAttribute('contenteditable')).toBe('true')
    await key(textbox(el), 'Enter', { ctrlKey: true })
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(textOf(textbox(el).querySelector('p'))).toBe(src(para.id) + 'z')
  })

  it('撤销 / 重做：Ctrl+Z 回到原文，Shift+Ctrl+Z 恢复', async () => {
    const { el } = await mount({ block: para, book: 'description' })
    await type(el, 'p.ps-para', 'w')
    const tb = textbox(el)
    expect(textOf(tb.querySelector('p'))).toBe(src(para.id) + 'w')
    await key(tb, 'z', { ctrlKey: true })
    expect(textOf(tb.querySelector('p'))).toBe(src(para.id))
    await key(tb, 'z', { ctrlKey: true, shiftKey: true })
    expect(textOf(tb.querySelector('p'))).toBe(src(para.id) + 'w')
  })

  it('权项：首行编号原文保留、公式段为只读节点、性质徽标为生成物；Enter 拆行后序列化为多行', async () => {
    const { el, props } = await mount({ block: claim2, book: 'claims' })
    const tb = textbox(el)
    const paras = tb.querySelectorAll('p.ps-para')
    expect(paras[0].textContent!.startsWith('2.')).toBe(true)
    const eq = tb.querySelector<HTMLElement>('.ps-equation')!
    expect(eq.contentEditable).toBe('false')
    expect(eq.dataset.source).toBe(claim2.segments[1].text)
    expect(el.querySelector('[data-generated]')!.textContent).toContain('从属权项')
    await type(el, 'p.ps-para:last-of-type', '。补充')
    await key(tb, 'Enter', { ctrlKey: true })
    expect(props.onSubmit).toHaveBeenCalledWith(src(claim2.id) + '。补充')
  })

  it('Enter：段落内拆行 → 两行；标题内 Enter = 提交', async () => {
    const { el, props } = await mount({ block: para, book: 'description' })
    const tb = textbox(el)
    await type(el, 'p.ps-para', '第二段')
    await key(tb, 'Enter')
    expect(tb.querySelectorAll('p.ps-para').length).toBe(2)
    await type(el, 'p.ps-para:last-of-type', '新段')
    await key(tb, 'Enter', { ctrlKey: true })
    expect(props.onSubmit).toHaveBeenCalledWith(src(para.id) + '第二段\n新段')

    const section = method.description.find((b) => b.kind === 'section')!
    const m2 = await mount({ block: section, book: 'description' })
    expect(textOf(textbox(m2.el).querySelector('h3.ps-heading'))).toBe(src(section.id).slice(4))
    await type(m2.el, 'h3.ps-heading', '改')
    await key(textbox(m2.el), 'Enter')
    expect(m2.props.onSubmit).toHaveBeenCalledWith(src(section.id) + '改')
  })

  it('公式块：双击公式节点打开 dialogs 的公式对话框（带当前源码），提交后回写节点', async () => {
    const { useDialogStore } = await import('../../dialogs/state')
    const { el, props } = await mount({ block: equation, book: 'description' })
    const eq = textbox(el).querySelector<HTMLElement>('.ps-equation')!
    expect(eq.querySelector('[role="math"]') ?? eq.querySelector('code')).not.toBeNull()
    await act(async () => eq.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const { open, payload } = useDialogStore.getState()
    expect(open).toBe(true)
    expect(payload?.kind).toBe('formula')
    if (payload?.kind !== 'formula') throw new Error('formula dialog not opened')
    expect(payload.initial).toBe(equation.source)
    await act(async () => payload.onSubmit('E = mc^2'))
    useDialogStore.getState().close()
    await key(textbox(el), 'Enter', { ctrlKey: true })
    expect(props.onSubmit).toHaveBeenCalledWith(src(equation.id).replace(equation.source, 'E = mc^2'))
  })

  it('表格：单元格可编辑，段号 / 表注段号是装饰；Tab 移到下一格；提交序列化整表', async () => {
    const { el, props } = await mount({ block: table, book: 'description' })
    const tb = textbox(el)
    const cells = tb.querySelectorAll<HTMLElement>('td.ps-cell')
    expect(cells.length).toBe(table.rows.flat().length)
    expect(tb.querySelectorAll('[data-generated]').length).toBe(2)
    expect(textOf(tb.querySelector('p.ps-note'))).toBe(table.note!.text)
    await type(el, 'td.ps-cell', '改')
    await key(tb, 'Tab')
    const sel = document.getSelection()!
    expect(cells[1].contains(sel.anchorNode)).toBe(true)
    expect(sel.toString()).toBe(table.rows[0][1])
    await key(tb, 'Enter')
    expect(tb.querySelectorAll('td.ps-cell').length).toBe(cells.length) // 单元格内 Enter 不拆格
    await key(tb, 'Enter', { ctrlKey: true })
    const expected = src(table.id).split('\n')
    const headerIdx = expected.findIndex((l) => l.includes(table.rows[0][0]))
    expected[headerIdx] = expected[headerIdx].replace(table.rows[0][0], table.rows[0][0] + '改')
    expect(props.onSubmit).toHaveBeenCalledWith(expected.join('\n'))
  })

  it('axe 冒烟：段落 / 权项 / 表格编辑态无 critical/serious 违规', async () => {
    for (const [block, book] of [[para, 'description'], [claim2, 'claims'], [table, 'description']] as const) {
      const { el } = await mount({ block, book })
      const res = await axe.run(el, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false } } })
      expect(res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id)).toEqual([])
      await act(async () => root?.unmount())
      host.remove()
    }
  })
})
