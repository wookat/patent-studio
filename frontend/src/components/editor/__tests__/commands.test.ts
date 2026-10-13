// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import METHOD from '../../../../../examples/method/content.md?raw'
import { EditorView } from '@codemirror/view'
import { claimSubject, editorCommands, insertSpec, registerEditorView, replaceLineSpec, type InsertKind } from '../commands'
import { useStudio } from '@/store'

function apply(doc: string, cursor: number, kind: InsertKind) {
  const state = EditorState.create({ doc, selection: { anchor: cursor } })
  const spec = insertSpec(state, kind)
  if (!spec) return null
  const tr = state.update(spec)
  return { text: tr.state.doc.toString(), sel: tr.state.selection.main, selected: tr.state.sliceDoc(tr.state.selection.main.from, tr.state.selection.main.to) }
}

const lineStart = (doc: string, line: number) => EditorState.create({ doc }).doc.line(line).from

describe('insertSpec：标题', () => {
  it('空行加 ## 前缀，光标落在前缀后', () => {
    const r = apply('a\n\nb', 2, 'h2')!
    expect(r.text).toBe('a\n## \nb')
    expect(r.sel.head).toBe(5)
  })
  it('已有标题改级别（### → ##），非标题行加前缀', () => {
    expect(apply('### 技术领域', 3, 'h2')!.text).toBe('## 技术领域')
    expect(apply('技术领域', 2, 'h3')!.text).toBe('### 技术领域')
  })
})

describe('insertSpec：模板', () => {
  it('公式独占一行：非空行后另起一行并选中占位「公式」', () => {
    const r = apply('段落文字\n下一段', 2, 'formula')!
    expect(r.text).toBe('段落文字\n$$公式$$\n下一段')
    expect(r.selected).toBe('公式')
  })
  it('公式在空行原地插入', () => {
    const r = apply('a\n\nb', 2, 'formula')!
    expect(r.text).toBe('a\n$$公式$$\nb')
  })
  it('下标：无选区 → _{} 光标居中；有选区 → 包裹', () => {
    const r = apply('x', 1, 'subscript')!
    expect(r.text).toBe('x_{}')
    expect(r.sel.head).toBe(3)
    const state = EditorState.create({ doc: 'Xmax', selection: { anchor: 1, head: 4 } })
    const tr = state.update(insertSpec(state, 'subscript')!)
    expect(tr.state.doc.toString()).toBe('X_{max}')
  })
  it('表格：表号顺延（已有 表1 → 表2），选中表题', () => {
    const doc = '表1 汇总\n\n| a |\n| --- |\n| 1 |\n\n结尾'
    const r = apply(doc, doc.length, 'table')!
    expect(r.text.endsWith('结尾\n表2 表题\n\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |')).toBe(true)
    expect(r.selected).toBe('表题')
  })
  it('附图：正文引用最大图号；附图说明段落新增下一图', () => {
    const doc = '# T\n\n## 说明书\n\n### 附图说明\n\n图1为流程图；\n\n### 具体实施方式\n\n如图1所示，步骤。'
    const body = apply(doc, doc.length, 'figure')!
    expect(body.text.endsWith('如图1所示，步骤。如图1所示，')).toBe(true)
    const fig = apply(doc, lineStart(doc, 7) + 6, 'figure')!
    expect(fig.text).toContain('图1为流程图；\n图2为本发明实施例的示意图；')
  })
  it('权项引用：主题词取自权项 1，默认引用上一权项', () => {
    const doc = '# T\n\n## 权利要求书\n\n1.一种数据处理系统，其特征在于，包括A。\n\n2.根据权利要求1所述的系统，B。\n\n3.'
    expect(claimSubject(EditorState.create({ doc }).doc)).toBe('系统')
    const r = apply(doc, doc.length, 'claimRef')!
    expect(r.text.endsWith('3.根据权利要求2所述的系统，其特征在于，')).toBe(true)
    expect(r.selected).toBe('2')
  })
  it('真实案子 method：权项主题词为「方法」', () => {
    expect(claimSubject(EditorState.create({ doc: METHOD }).doc)).toBe('方法')
  })
})

describe('replaceLineSpec', () => {
  it('替换行内首个片段 / 整行；越界或找不到返回 null', () => {
    const state = EditorState.create({ doc: 'a\n权利要求9所述\nc' })
    const t1 = state.update(replaceLineSpec(state, 2, '权利要求9', '权利要求1')!)
    expect(t1.state.doc.line(2).text).toBe('权利要求1所述')
    const t2 = state.update(replaceLineSpec(state, 2, '', '## 摘要')!)
    expect(t2.state.doc.toString()).toBe('a\n## 摘要\nc')
    expect(replaceLineSpec(state, 2, '不存在', 'x')).toBeNull()
    expect(replaceLineSpec(state, 9, '', 'x')).toBeNull()
  })
})

describe('editorCommands 行基换算（单书卡片注册的视图）', () => {
  it('全文行 = 视图行 + lineBase；落在本书之外返回 false（交给 store 回退）', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '1.一种方法\n2.根据权利要求9所述' }) })
    // 卡片第 1 行 = 全文第 11 行
    registerEditorView(view, () => 10)
    expect(editorCommands.replaceLine(12, '权利要求9', '权利要求1')).toBe(true)
    expect(view.state.doc.line(2).text).toBe('2.根据权利要求1所述')
    expect(editorCommands.replaceLine(2, '', 'x')).toBe(false)
    expect(editorCommands.replaceLines(13, 14, 'x')).toBe(false)
    expect(editorCommands.replaceLines(11, 12, '{--旧--}{++新++}')).toBe(true)
    expect(view.state.doc.toString()).toBe('{--旧--}{++新++}')
    registerEditorView(null)
    expect(editorCommands.replaceLine(11, '', 'x')).toBe(false)
    view.destroy()
  })
  it('默认行基 0：全文编辑器按原行号写', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'a\nb' }) })
    registerEditorView(view)
    expect(editorCommands.replaceLine(2, 'b', 'c')).toBe(true)
    expect(view.state.doc.toString()).toBe('a\nc')
    registerEditorView(null)
    view.destroy()
  })
})

describe('openSearch 冷路径 DOM 回退（编辑器从未聚焦）', () => {
  // R115-D1：registerEditorView 只在聚焦时注册（多卡仲裁），未聚焦过的编辑器令 openSearch 静默 false——
  // rail 搜索「在编辑器中查找替换」/ Mod-f 冷路径死端；改为按光标所在书在 DOM 里找回卡片视图并注册
  it('按光标所在书找回卡片内 CM 视图，行基 = 该书 offset', () => {
    const content = '# T\n## 摘要\n\n## 权利要求书\n\n1.一种方法\n'
    useStudio.setState({ content, cursor: { line: 5, col: 1 }, project: null, toasts: [] } as never)
    const host = document.createElement('div')
    host.setAttribute('data-testid', 'card-source-claims')
    document.body.appendChild(host)
    const view = new EditorView({ state: EditorState.create({ doc: '\n1.一种方法\n' }), parent: host })
    expect(editorCommands.openSearch()).toBe(true)
    expect(view.dom.querySelector('.cm-panel.cm-search')).toBeTruthy()
    // 行基注册为 claims offset（4）：全文第 6 行 = 视图第 2 行
    expect(editorCommands.replaceLine(6, '一种方法', '一种装置')).toBe(true)
    expect(view.state.doc.line(2).text).toContain('一种装置')
    view.destroy()
    host.remove()
    registerEditorView(null)
    useStudio.setState({ content: '', cursor: { line: 1, col: 1 }, toasts: [] } as never)
  })
  it('只读卡片同样可找回（查找是读操作）；卡片未挂载 → false 走调用方回退', () => {
    useStudio.setState({ content: '# T\n## 摘要\n\nx', cursor: { line: 3, col: 1 }, project: { role: 'viewer' }, toasts: [] } as never)
    const host = document.createElement('div')
    host.setAttribute('data-testid', 'card-source-abstract')
    document.body.appendChild(host)
    const view = new EditorView({ state: EditorState.create({ doc: '\nx' }), parent: host })
    expect(editorCommands.openSearch()).toBe(true)
    view.destroy()
    host.remove()
    registerEditorView(null)
    // 无任何源码卡挂载（版面视图）：返回 false，调用方走原回退（toast / gotoLine 重试）
    expect(editorCommands.openSearch()).toBe(false)
    useStudio.setState({ content: '', cursor: { line: 1, col: 1 }, project: null, toasts: [] } as never)
  })
})

describe('只读角色写门控（R69-01）', () => {
  it('viewer：insert/insertText/replaceLine/replaceLines 一律 false + toast，文档不变', () => {
    useStudio.setState({ project: { role: 'viewer' }, toasts: [] } as never)
    const view = new EditorView({ state: EditorState.create({ doc: 'a\nb' }) })
    registerEditorView(view)
    expect(editorCommands.insert('h2')).toBe(false)
    expect(editorCommands.insertText('图1')).toBe(false)
    expect(editorCommands.replaceLine(1, 'a', 'x')).toBe(false)
    expect(editorCommands.replaceLines(1, 2, 'x')).toBe(false)
    expect(view.state.doc.toString()).toBe('a\nb')
    expect(useStudio.getState().toasts.at(-1)?.text).toBe('只读模式：无法编辑')
    registerEditorView(null)
    view.destroy()
    useStudio.setState({ project: null, toasts: [] } as never)
  })
  it('写者不受影响；查找替换等读操作在只读下仍可用', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'a\nb' }), parent: document.body })
    registerEditorView(view)
    expect(editorCommands.replaceLine(1, 'a', 'x')).toBe(true)
    expect(view.state.doc.line(1).text).toBe('x')
    useStudio.setState({ project: { role: 'viewer' }, toasts: [] } as never)
    expect(editorCommands.openSearch()).toBe(true)
    view.destroy()
    registerEditorView(null)
    useStudio.setState({ project: null, toasts: [] } as never)
  })
})
