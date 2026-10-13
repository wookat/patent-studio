import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { history, redo, undo } from 'prosemirror-history'
import type { BlockTemplate } from '@/lib/api'
import { bookSchema } from '../../doc/bookSchema'
import { fromBookDoc } from '../../doc/fromBookDoc'
import { inlineNodes } from '../../doc/inline'
import {
  FORMAT_KEYS,
  activeMarks,
  canSetBlockKind,
  currentBlockKind,
  insertBlock,
  isMarkActive,
  nodeFromTemplate,
  selectionText,
  setBlockKind,
  toggleMarkCmd,
} from '../commands'

const { ps_para, ps_heading, ps_claim, ps_equation } = bookSchema.nodes

const para = (text: string, blockId: string | null = 'description/1', kind: string | null = 'paragraph') => ps_para.create({ blockId, kind }, inlineNodes(text))

function stateOf(nodes: ReturnType<typeof para>[], book: string | null, from: number, to = from) {
  const doc = bookSchema.node('doc', { book, lead: 1, trail: 1 }, nodes)
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to), plugins: [history()] })
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state
  const ok = cmd(state, (tr) => {
    next = state.apply(tr)
  })
  expect(ok).toBe(true)
  return next
}

describe('toggleMark：五种 mark，序列化为内核行内语法，上下标互斥', () => {
  it('选中「两个」→ strong → 源码出现 **两个**；再切一次还原', () => {
    // doc > para > text：文本从 pos 1 开始，「两个」= [3, 5)
    const s0 = stateOf([para('选中两个字')], 'description', 3, 5)
    expect(selectionText(s0)).toBe('两个')
    const s1 = run(s0, toggleMarkCmd('strong'))
    expect(isMarkActive(s1, 'strong')).toBe(true)
    expect(fromBookDoc(s1.doc)).toBe('\n选中**两个**字\n\n')
    const s2 = run(s1, toggleMarkCmd('strong'))
    expect(fromBookDoc(s2.doc)).toBe('\n选中两个字\n\n')
  })

  it('em / underline / subscript / superscript 各自序列化', () => {
    const s0 = stateOf([para('abc')], 'description', 2, 3)
    expect(fromBookDoc(run(s0, toggleMarkCmd('em')).doc)).toBe('\na*b*c\n\n')
    expect(fromBookDoc(run(s0, toggleMarkCmd('underline')).doc)).toBe('\na<u>b</u>c\n\n')
    // W9 domain-01：后接字母数字时裸 `_b` 会被内核吞成 `_bc`，必须写 `_{b}`
    expect(fromBookDoc(run(s0, toggleMarkCmd('subscript')).doc)).toBe('\na_{b}c\n\n')
    expect(fromBookDoc(run(s0, toggleMarkCmd('superscript')).doc)).toBe('\na^{b}c\n\n')
  })

  it('下标上再加上标 → 下标被去掉（互斥）', () => {
    const s0 = stateOf([para('x2')], 'description', 2, 3)
    const sub = run(s0, toggleMarkCmd('subscript'))
    expect(activeMarks(sub)).toEqual(new Set(['subscript']))
    const sup = run(sub, toggleMarkCmd('superscript'))
    expect(activeMarks(sup)).toEqual(new Set(['superscript']))
    expect(fromBookDoc(sup.doc)).toBe('\nx^2\n\n')
  })

  it('光标（空选区）落在 strong 内 → isMarkActive 为真；多 mark 嵌套 → activeMarks 全部报告', () => {
    const s0 = stateOf([para('a**b**c')], 'description', 3)
    expect(isMarkActive(s0, 'strong')).toBe(true)
    const s1 = run(stateOf([para('abc')], 'description', 2, 3), toggleMarkCmd('em'))
    const s2 = run(s1, toggleMarkCmd('strong'))
    expect(activeMarks(s2)).toEqual(new Set(['strong', 'em']))
  })

  it('FORMAT_KEYS：Mod-b 等价于 strong toggle（Ctrl+B）', () => {
    const s0 = stateOf([para('选中两个字')], 'description', 3, 5)
    const s1 = run(s0, FORMAT_KEYS['Mod-b'])
    expect(fromBookDoc(s1.doc)).toBe('\n选中**两个**字\n\n')
    expect(run(s1, undo)).toBeDefined()
  })
})

describe('setBlockKind：正文 ↔ #### 小节 ↔ 权项 等 schema 允许的转换，blockId 保留', () => {
  it('正文 → 小节标题 → 章节标题 → 正文，序列化前缀随之变化', () => {
    const s0 = stateOf([para('步骤一')], 'description', 2)
    expect(currentBlockKind(s0)).toBe('paragraph')
    const s1 = run(s0, setBlockKind('subsection'))
    expect(currentBlockKind(s1)).toBe('subsection')
    expect(s1.doc.firstChild!.attrs.blockId).toBe('description/1')
    expect(fromBookDoc(s1.doc)).toBe('\n#### 步骤一\n\n')
    const s2 = run(s1, setBlockKind('section'))
    expect(fromBookDoc(s2.doc)).toBe('\n### 步骤一\n\n')
    const s3 = run(s2, setBlockKind('paragraph'))
    expect(fromBookDoc(s3.doc)).toBe('\n步骤一\n\n')
    expect(currentBlockKind(s3)).toBe('paragraph')
  })

  it('同一样式再设置一次 → false（按钮禁用态）', () => {
    const s0 = stateOf([para('x')], 'description', 2)
    expect(canSetBlockKind(s0, 'paragraph')).toBe(false)
    expect(canSetBlockKind(s0, 'subsection')).toBe(true)
  })

  it('正文 → 表题 / 图题 只改 kind（用于版面居中）；标记保留', () => {
    const s0 = stateOf([para('表1 **参数**')], 'description', 2)
    const s1 = run(s0, setBlockKind('table-caption'))
    expect(currentBlockKind(s1)).toBe('table-caption')
    expect(fromBookDoc(s1.doc)).toBe('\n表1 **参数**\n\n')
  })

  it('权利要求书：正文 ↔ 权项（包 / 解 ps_claim），blockId 保留，权项号不入文本', () => {
    const s0 = stateOf([para('一种方法，其特征在于', 'claims/1')], 'claims', 2)
    const s1 = run(s0, setBlockKind('claim'))
    expect(s1.doc.firstChild!.type).toBe(ps_claim)
    expect(s1.doc.firstChild!.attrs.blockId).toBe('claims/1')
    expect(currentBlockKind(s1)).toBe('claim')
    expect(fromBookDoc(s1.doc)).toBe('\n1.一种方法，其特征在于\n\n')
    const s2 = run(s1, setBlockKind('paragraph'))
    expect(s2.doc.firstChild!.type).toBe(ps_para)
    expect(s2.doc.firstChild!.attrs.blockId).toBe('claims/1')
    expect(fromBookDoc(s2.doc)).toBe('\n一种方法，其特征在于\n\n')
  })

  it('书约束：权利要求书不能设标题；摘要只能正文；说明书不能设权项', () => {
    expect(canSetBlockKind(stateOf([para('x', 'claims/1')], 'claims', 2), 'subsection')).toBe(false)
    expect(canSetBlockKind(stateOf([para('x', 'abstract/1')], 'abstract', 2), 'subsection')).toBe(false)
    expect(canSetBlockKind(stateOf([para('x')], 'description', 2), 'claim')).toBe(false)
  })

  it('结构块（公式）不可转换', () => {
    const eq = ps_equation.create({ source: 'E=mc^2', blockId: 'description/2', kind: 'equation' })
    const doc = bookSchema.node('doc', { book: 'description' }, [para('x'), eq])
    const s0 = EditorState.create({ doc, selection: TextSelection.create(doc, 4) })
    expect(canSetBlockKind(s0, 'paragraph')).toBe(false)
  })

  it('撤销 / 重做经 prosemirror-history 生效', () => {
    const s0 = stateOf([para('x')], 'description', 2)
    const s1 = run(s0, setBlockKind('subsection'))
    const s2 = run(s1, undo)
    expect(s2.doc.firstChild!.type).toBe(ps_para)
    const s3 = run(s2, redo)
    expect(s3.doc.firstChild!.type).toBe(ps_heading)
  })
})

const T = (kind: BlockTemplate['kind'], markdown: string, book: BlockTemplate['book'] = ['description']): BlockTemplate => ({
  kind,
  label: kind,
  book,
  markdown,
  cursor: { line: 0, col: 0 },
})

describe('insertBlock：复用后端 block-templates 样板建节点并插到当前块后', () => {
  it('段落 / 小节 / 公式 / 权项 / 表格样板 → 节点（createChecked 通过）', () => {
    for (const t of [
      T('paragraph', '……'),
      T('section', '### 章节标题'),
      T('subsection', '#### 小节标题'),
      T('equation', '$$E = mc^2$$'),
      T('claim', '1.一种……，其特征在于，', ['claims']),
      T('table', '<!-- 表格: 三线 -->\n| 列1 | 列2 |\n| --- | --- |\n| | |'),
      T('figure-ref', '图1为……示意图。'),
    ]) {
      const n = nodeFromTemplate(t)!
      expect(n, t.kind).toBeTruthy()
      expect(() => n.check()).not.toThrow()
    }
    expect(nodeFromTemplate(T('equation', '$$E = mc^2$$'))!.attrs.source).toBe('E = mc^2')
    expect(nodeFromTemplate(T('subsection', '#### 小节标题'))!.textContent).toBe('小节标题')
    expect(nodeFromTemplate(T('claim', '3.一种……', ['claims']))!.textContent).toBe('3.一种……')
    const tbl = nodeFromTemplate(T('table', '<!-- 表格: 三线 -->\n| 列1 | 列2 |\n| --- | --- |\n| | |'))!
    expect(tbl.attrs.three_line).toBe(true)
    expect(tbl.childCount).toBe(2)
    expect(tbl.firstChild!.childCount).toBe(2)
  })

  it('插入到光标所在块之后并把光标放进新块；书不匹配 → false', () => {
    const s0 = stateOf([para('甲'), para('乙', 'description/2')], 'description', 2)
    const s1 = run(s0, insertBlock(T('subsection', '#### 小节标题')))
    expect(s1.doc.childCount).toBe(3)
    expect(s1.doc.child(1).type).toBe(ps_heading)
    expect(s1.selection.$from.parent.type).toBe(ps_heading)
    expect(fromBookDoc(s1.doc)).toBe('\n甲\n\n#### 小节标题\n\n乙\n\n')
    expect(insertBlock(T('subsection', '#### 小节标题'))(stateOf([para('x', 'claims/1')], 'claims', 2))).toBe(false)
  })

  it('权项样板插到权利要求书，光标落在权项内段落', () => {
    const s0 = stateOf([ps_claim.create({ blockId: 'claims/1', kind: 'claim' }, para('1.一种方法', null, null))], 'claims', 3)
    const s1 = run(s0, insertBlock(T('claim', '2.一种……，其特征在于，', ['claims'])))
    expect(s1.doc.childCount).toBe(2)
    expect(s1.selection.$from.node(1).type).toBe(ps_claim)
    expect(fromBookDoc(s1.doc)).toBe('\n1.一种方法\n\n2.一种……，其特征在于，\n\n')
  })
})
