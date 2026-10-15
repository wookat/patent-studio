// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { history, redo, undo, undoDepth } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { assembleBooks, splitBooks } from '@/lib/docset'
import type { Ast } from '@/types/ast'
import { blockAttrsOf } from '../../doc/bookSchema'
import { fromBookDoc } from '../../doc/fromBookDoc'
import { toBookDoc } from '../../doc/toBookDoc'
import { astTransaction, bookDecorations, buildDecorations, genIndex, partClass } from '../decorations'
import { paraLabel } from '@/components/block-model/model'
import { CLAIM_PREFIX_RE, bookBackspace, bookEnter, bookKeymap, splitClaim, topBlockAt } from '../keymap'
import { cursorAnchor, mergeBookDoc, mergeRemoteDoc, planIncoming, restoreCursor } from '../mergeDoc'
import { SAVE_IDLE_MS, SAVE_MAX_HOLDS, createSaveScheduler } from '../useBookSave'
import { bookDomParser, bookText, focusBlockStart } from '../bookView'
import { EquationNodeView } from '../EquationNodeView'
import { tablePlugins } from '../../table'
import astMethod from '../../../../../../backend/tests/fixtures/ast_rich.json'
import mdMethod from '../../../../../../backend/tests/fixtures/rich/content.md?raw'

const ast = astMethod as unknown as Ast
const md = mdMethod
const book = (b: 'abstract' | 'claims' | 'description') => splitBooks(md).books[b]!.text

function stateFor(b: 'abstract' | 'claims' | 'description', plugins = [history(), bookKeymap()]) {
  const doc = toBookDoc(ast, b, md)
  return EditorState.create({ doc, plugins })
}
/** 第 index 个顶层块内偏移 offset 处的光标 */
function cursorIn(state: EditorState, index: number, offset: number) {
  let pos = 0
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + 1 + offset)))
}
const run = (cmd: (s: EditorState, d: (tr: import('prosemirror-state').Transaction) => void) => boolean, state: EditorState) => {
  let next = state
  const ok = cmd(state, (tr) => (next = state.apply(tr)))
  return { ok, state: next }
}
const firstParaIndex = (s: EditorState) => {
  for (let i = 0; i < s.doc.childCount; i++) if (s.doc.child(i).type.name === 'ps_para' && s.doc.child(i).attrs.kind === 'paragraph') return i
  throw new Error('no paragraph')
}

describe('keymap：Enter 分段', () => {
  it('说明书段落中间 Enter → 两段，新段 blockId=null，源码多出一行；段数 +1', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const para = s0.doc.child(i)
    const s1 = cursorIn(s0, i, 3)
    const { ok, state } = run(bookEnter, s1)
    expect(ok).toBe(true)
    expect(state.doc.childCount).toBe(s0.doc.childCount + 1)
    expect(state.doc.child(i).textContent).toBe(para.textContent.slice(0, 3))
    expect(state.doc.child(i + 1).textContent).toBe(para.textContent.slice(3))
    expect(blockAttrsOf(state.doc.child(i))).toEqual({ blockId: para.attrs.blockId, kind: 'paragraph' })
    expect(blockAttrsOf(state.doc.child(i + 1))).toEqual({ blockId: null, kind: 'paragraph' })
    const out = fromBookDoc(state.doc)
    expect(out.split('\n').length).toBe(book('description').split('\n').length + 2)
    expect(out).toContain(`${para.textContent.slice(0, 3)}\n\n${para.textContent.slice(3)}`)
  })

  it('权项内 Enter → 新权项，前缀 N. 由位置决定；段号 / 权项号不进正文之外的文本', () => {
    const s0 = stateFor('claims')
    const c0 = s0.doc.child(0)
    const text = c0.firstChild!.textContent
    const s1 = cursorIn(s0, 0, 1 + 10) // ps_claim 内再进 ps_para（+1）
    const { ok, state } = run(splitClaim, s1)
    expect(ok).toBe(true)
    expect(state.doc.childCount).toBe(s0.doc.childCount + 1)
    expect(state.doc.child(0).firstChild!.textContent).toBe(text.slice(0, 10))
    expect(state.doc.child(1).type.name).toBe('ps_claim')
    expect(state.doc.child(1).firstChild!.textContent).toBe(`2.${text.slice(10)}`)
    expect(blockAttrsOf(state.doc.child(1))).toEqual({ blockId: null, kind: 'claim' })
    // 光标在新权项前缀之后
    expect(state.selection.$from.parent).toBe(state.doc.child(1).firstChild)
    expect(state.selection.$from.parentOffset).toBe(2)
    // 其后权项前缀按位置重写：源码编号连续 1..N+1，无 mismatch；引用文本（根据权利要求1）不动
    const out = fromBookDoc(state.doc)
    const nums = out.split('\n').map((l) => CLAIM_PREFIX_RE.exec(l)?.[1]).filter((x): x is string => !!x)
    expect(nums).toEqual(Array.from({ length: state.doc.childCount }, (_, k) => String(k + 1)))
    expect(state.doc.child(2).firstChild!.textContent.startsWith('3.根据权利要求1')).toBe(true)
    const set = buildDecorations(state.doc, ast, 'claims')
    const mismatch = set.find().filter((d) => (d as unknown as { type: { attrs?: Record<string, string> } }).type.attrs?.['data-claim-mismatch'] === 'true')
    expect(mismatch.length).toBe(0)
  })

  it('权项首段行首 Backspace → 去前缀并入上一权项末段，其后权项重编号；第 1 权项行首 Backspace 无事', () => {
    const s0 = stateFor('claims')
    const n = s0.doc.childCount
    const c1Last = s0.doc.child(0).lastChild!.textContent
    const c2 = s0.doc.child(1).firstChild!.textContent
    const s1 = cursorIn(s0, 1, 1)
    const { ok, state } = run(bookBackspace, s1)
    expect(ok).toBe(true)
    expect(state.doc.childCount).toBe(n - 1)
    const merged = state.doc.child(0)
    expect(merged.type.name).toBe('ps_claim')
    const joined = merged.child(s0.doc.child(0).childCount - 1)
    expect(joined.textContent).toBe(c1Last + c2.replace(CLAIM_PREFIX_RE, ''))
    expect(merged.textContent).not.toContain('2.根据')
    const out = fromBookDoc(state.doc)
    const nums = out.split('\n').map((l) => CLAIM_PREFIX_RE.exec(l)?.[1]).filter((x): x is string => !!x)
    expect(nums).toEqual(Array.from({ length: n - 1 }, (_, k) => String(k + 1)))
    expect(state.selection.$from.parent).toBe(joined)
    expect(state.selection.$from.parentOffset).toBe(c1Last.length)
    const r0 = run(bookBackspace, cursorIn(s0, 0, 1))
    expect(r0.ok).toBe(true)
    expect(r0.state.doc).toBe(s0.doc)
  })

  it('Shift+Enter 被吞掉（不产生软换行）；Tab / Shift-Tab 不改结构', () => {
    const s0 = cursorIn(stateFor('description'), firstParaIndex(stateFor('description')), 2)
    const km = bookKeymap()
    const handle = km.props.handleKeyDown!
    const dispatched: unknown[] = []
    const fakeView = {
      state: s0,
      dispatch: (tr: unknown) => dispatched.push(tr),
      endOfTextblock: () => false,
    } as unknown as import('prosemirror-view').EditorView
    for (const [key, shift] of [['Enter', true], ['Tab', false], ['Tab', true]] as const) {
      const ev = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true })
      expect(handle.call(km, fakeView, ev)).toBe(true)
    }
    expect(dispatched).toHaveLength(0)
  })

  it('表格单元内 Tab / Shift-Tab：按 BookEditor 插件顺序（bookKeymap 在 tablePlugins 之前）仍能换格', () => {
    const s0 = stateFor('description', [history(), bookKeymap(), ...tablePlugins()])
    let ti = -1
    for (let i = 0; i < s0.doc.childCount; i++) if (s0.doc.child(i).type.name === 'ps_table') { ti = i; break }
    expect(ti).toBeGreaterThanOrEqual(0)
    // 光标进第一行第一格
    let pos = 0
    for (let i = 0; i < ti; i++) pos += s0.doc.child(i).nodeSize
    const firstCell = pos + 1 + 1 + 1
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, firstCell)))
    const cellIndexOf = (s: EditorState) => s.selection.$from.index(s.selection.$from.depth - 1)
    expect(cellIndexOf(s1)).toBe(0)

    const el = document.createElement('div')
    const view = new EditorView(el, { state: s1 })
    const press = (shift: boolean) => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true })))
    expect(press(false)).toBe(true)
    expect(cellIndexOf(view.state)).toBe(1)
    expect(press(true)).toBe(true)
    expect(cellIndexOf(view.state)).toBe(0)
    expect(view.state.doc.eq(s1.doc)).toBe(true)
    view.destroy()
  })

  it('表格单元内 Mod-Alt-↑↓←→ / Mod-Alt-Backspace：按 BookEditor 插件顺序加行加列删行，表格外不改结构', () => {
    const s0 = stateFor('description', [history(), bookKeymap(), ...tablePlugins()])
    let ti = -1
    for (let i = 0; i < s0.doc.childCount; i++) if (s0.doc.child(i).type.name === 'ps_table') { ti = i; break }
    let pos = 0
    for (let i = 0; i < ti; i++) pos += s0.doc.child(i).nodeSize
    // 光标进第二行第一格（首行是表头，加行不应复制表头）
    const table = s0.doc.child(ti)
    const secondRow = pos + 1 + table.child(0).nodeSize
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, secondRow + 1 + 1)))
    const el = document.createElement('div')
    const view = new EditorView(el, { state: s1 })
    const press = (key: string) =>
      view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key, ctrlKey: true, altKey: true, bubbles: true })))
    const tbl = () => view.state.doc.child(ti)
    const rows = () => tbl().childCount
    const cols = () => tbl().child(0).childCount
    const r0 = rows()
    const c0 = cols()
    expect(press('ArrowDown')).toBe(true)
    expect(rows()).toBe(r0 + 1)
    expect(press('ArrowUp')).toBe(true)
    expect(rows()).toBe(r0 + 2)
    expect(press('ArrowRight')).toBe(true)
    expect(cols()).toBe(c0 + 1)
    expect(press('ArrowLeft')).toBe(true)
    expect(cols()).toBe(c0 + 2)
    expect(press('Backspace')).toBe(true)
    expect(rows()).toBe(r0 + 1)
    expect(view.state.doc.childCount).toBe(s1.doc.childCount)

    // 表格外：同一组快捷键不改文档
    const para = firstParaIndex(view.state)
    let ppos = 0
    for (let i = 0; i < para; i++) ppos += view.state.doc.child(i).nodeSize
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, ppos + 2)))
    const before = view.state.doc
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Backspace']) press(k)
    expect(view.state.doc.eq(before)).toBe(true)
    view.destroy()
  })

  it('W10.1 P1 回归：Mod-Alt-↓ 加的空行落源码为 `|  |  |`，服务端 AST 回流按块合并不吞掉该行，Ctrl+Z 仍能撤销', () => {
    const s0 = stateFor('description', [history(), bookKeymap(), ...tablePlugins()])
    let ti = -1
    for (let i = 0; i < s0.doc.childCount; i++) if (s0.doc.child(i).type.name === 'ps_table') { ti = i; break }
    let pos = 0
    for (let i = 0; i < ti; i++) pos += s0.doc.child(i).nodeSize
    const table = s0.doc.child(ti)
    const secondRow = pos + 1 + table.child(0).nodeSize
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, secondRow + 2)))
    const view = new EditorView(document.createElement('div'), { state: s1 })
    const r0 = table.childCount
    const cols = table.child(0).childCount
    expect(view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, altKey: true })))).toBe(true)
    expect(view.state.doc.child(ti).childCount).toBe(r0 + 1)

    // 落源码：相对 base 只多一行全空单元行
    const baseLines = book('description').split('\n')
    const local = fromBookDoc(view.state.doc)
    const localLines = local.split('\n')
    expect(localLines.length).toBe(baseLines.length + 1)
    const at = localLines.findIndex((l, i) => l !== baseLines[i])
    expect(localLines[at]).toMatch(/^\|(\s*\|)+$/)
    expect(localLines[at].split('|').length - 2).toBe(cols)

    // 服务端重新解析（parse_md / ast.py 把全空行留在 rows）后的 AST 与 content 回流
    const t = ast.description.find((b) => b.kind === 'table')!
    const next = structuredClone(ast)
    for (const b of next.description) {
      if (b.id === t.id && b.kind === 'table') {
        b.rows.splice(2, 0, Array.from({ length: cols }, () => ''))
        b.lines.end += 1
      } else if (b.lines.start > t.lines.end) {
        b.lines.start += 1
        b.lines.end += 1
      }
    }
    // 服务端重解析也会同步平移 figures[].caption_line（附图题注段的行号命中判定）
    for (const f of next.figures) if (f.caption_line !== null && f.caption_line > t.lines.end - 1) f.caption_line += 1
    const split = splitBooks(md)
    split.books.description = { ...split.books.description!, text: local }
    const nextDoc = toBookDoc(next, 'description', assembleBooks(split))
    expect(fromBookDoc(nextDoc)).toBe(local)
    expect(mergeBookDoc(view.state, nextDoc)).toBeNull()

    expect(undoDepth(view.state)).toBeGreaterThan(0)
    undo(view.state, view.dispatch)
    expect(view.state.doc.child(ti).childCount).toBe(r0)
    expect(fromBookDoc(view.state.doc)).toBe(book('description'))
    view.destroy()
  })

  it('标题末尾 Enter → 其后是普通段落（不是标题）', () => {
    const s0 = stateFor('description')
    const i = 0
    expect(s0.doc.child(i).type.name).toBe('ps_heading')
    const s1 = cursorIn(s0, i, s0.doc.child(i).content.size)
    const { state } = run(bookEnter, s1)
    expect(state.doc.child(i + 1).type.name).toBe('ps_para')
    expect(state.doc.child(i + 1).attrs).toEqual({ blockId: null, kind: 'paragraph' })
    expect(state.doc.child(i).textContent).toBe(s0.doc.child(i).textContent)
  })
})

describe('keymap：Backspace 行首并段 / 撤销', () => {
  it('段首 Backspace → 与上一段合并，块数 -1；Ctrl+Z 恢复，Ctrl+Shift+Z 重做', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    // 找到连续两个段落
    let j = i + 1
    while (s0.doc.child(j).type.name !== 'ps_para') j++
    if (s0.doc.child(j - 1).type.name !== 'ps_para') {
      // 先用 Enter 造一对相邻段落
      const split = run(bookEnter, cursorIn(s0, i, 3)).state
      const merged = run(bookBackspace, cursorIn(split, i + 1, 0))
      expect(merged.ok).toBe(true)
      expect(merged.state.doc.childCount).toBe(s0.doc.childCount)
      expect(merged.state.doc.child(i).textContent).toBe(s0.doc.child(i).textContent)
      // 历史：Enter+Backspace 在 newGroupDelay 内合为一组 → 一次撤销回到原文；重做前进到并段后
      const u1 = run(undo, merged.state).state
      expect(u1.doc.eq(s0.doc)).toBe(true)
      const r1 = run(redo, u1).state
      expect(r1.doc.eq(merged.state.doc)).toBe(true)
      return
    }
    const a = s0.doc.child(j - 1).textContent
    const b = s0.doc.child(j).textContent
    const { ok, state } = run(bookBackspace, cursorIn(s0, j, 0))
    expect(ok).toBe(true)
    expect(state.doc.childCount).toBe(s0.doc.childCount - 1)
    expect(state.doc.child(j - 1).textContent).toBe(a + b)
    expect(run(undo, state).state.doc.eq(s0.doc)).toBe(true)
  })

  it('topBlockAt 返回顶层块索引', () => {
    const s0 = stateFor('description')
    const s1 = cursorIn(s0, 2, 1)
    expect(topBlockAt(s1).index).toBe(2)
    expect(topBlockAt(s1).node).toBe(s0.doc.child(2))
  })
})

describe('decorations：段号 / 权项 / 章节样式来自 AST，不进 doc', () => {
  it('genIndex：说明书段号来自 para_no，权项来自 claim_kind', () => {
    const d = genIndex(ast, 'description')
    const p = ast.description.find((b) => b.kind === 'paragraph')!
    expect(d.get(p.id)?.paraNo).toBe(p.para_no)
    const c = genIndex(ast, 'claims')
    expect(c.get(ast.claims[0].id)).toEqual({ claimKind: 'independent', claimNum: 1 })
    expect(genIndex(null, 'description').size).toBe(0)
    expect(paraLabel(1)).toBe('[0001]')
  })

  it('buildDecorations：段落 widget 不可编辑不可选、含 sr-only；节点装饰给 .ps-* 类；doc 文本不变', () => {
    const doc = toBookDoc(ast, 'description', md)
    const set = buildDecorations(doc, ast, 'description')
    const p = ast.description.find((b) => b.kind === 'paragraph')!
    const widgets = set.find(undefined, undefined, (spec) => typeof (spec as { key?: string }).key === 'string' && (spec as { key: string }).key.startsWith('pn-'))
    expect(widgets.length).toBe(ast.description.filter((b) => b.kind === 'paragraph' && b.para_no != null).length)
    const w = widgets[0]!
    const el = (w as unknown as { type: { toDOM: () => HTMLElement } }).type.toDOM()
    expect(el.getAttribute('contenteditable')).toBe('false')
    expect(el.dataset.generated).toBe('true')
    expect(el.classList.contains('ps-para-no')).toBe(true)
    expect(el.querySelector('.sr-only')).not.toBeNull()
    expect(el.textContent).toContain(paraLabel(p.para_no!))
    expect((w.spec as { ignoreSelection?: boolean }).ignoreSelection).toBe(true)
    // 节点装饰类
    doc.forEach((n) => {
      if (n.type.name === 'ps_heading') expect(partClass(n, 'description')).toMatch(/^ps-desc-h ps-desc-h[12]$/)
      if (n.type.name === 'ps_para' && n.attrs.kind === 'paragraph') expect(partClass(n, 'description')).toBe('ps-p ps-body')
    })
    expect(fromBookDoc(doc)).toBe(book('description'))
  })

  it('bookDecorations 插件：AST 事务不进历史、装饰随 AST 更新', () => {
    const doc = toBookDoc(ast, 'claims', md)
    const state = EditorState.create({ doc, plugins: [history(), bookDecorations('claims', null)] })
    const key = (state.plugins[1] as { spec: { key: unknown } }).spec.key as import('prosemirror-state').PluginKey
    const before = key.getState(state) as { set: import('prosemirror-view').DecorationSet }
    const claimWidgets = (s: import('prosemirror-view').DecorationSet) => s.find(undefined, undefined, (spec) => String((spec as { key?: string }).key).startsWith('claim-'))
    expect(claimWidgets(before.set).length).toBe(ast.claims.length)
    const tr = astTransaction(state, ast)
    expect(tr.getMeta('addToHistory')).toBe(false)
    const s2 = state.apply(tr)
    expect(s2.doc.eq(doc)).toBe(true)
    expect(claimWidgets((key.getState(s2) as { set: import('prosemirror-view').DecorationSet }).set).length).toBe(ast.claims.length)
    expect(undo(s2)).toBe(false)
  })
})

describe('mergeDoc：按块合并 + 光标恢复', () => {
  it('远端只改一段：其余块对象不变，光标 blockId+偏移恢复；事务不进历史', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const target = s0.doc.child(i + 3)
    const anchor = cursorAnchor(cursorIn(s0, i + 3, 2))
    expect(anchor).toEqual({ blockId: target.attrs.blockId, index: i + 3, offset: 3 })
    // 远端：修改第 i 段文本
    const lines = book('description').split('\n')
    const pText = s0.doc.child(i).textContent
    const li = lines.indexOf(pText)
    expect(li).toBeGreaterThanOrEqual(0)
    lines[li] = `${pText}（远端追加）`
    const newBook = lines.join('\n')
    const newMd = md.replace(book('description'), newBook)
    // toBookDoc 的块文本取自 AST：远端变更总是 content + 新 AST 一起到（BookEditor 以 astStale 拦不一致的中间态）
    const remoteAst = structuredClone(ast) as Ast
    const rb = remoteAst.description.find((b) => b.id === s0.doc.child(i).attrs.blockId)!
    if (rb.kind === 'paragraph') rb.text = lines[li]!
    const nextDoc = toBookDoc(remoteAst, 'description', newMd)
    const s1 = cursorIn(s0, i + 3, 2)
    const merged = mergeBookDoc(s1, nextDoc)!
    expect(merged).not.toBeNull()
    expect(merged.from).toBe(i)
    expect(merged.to).toBe(i + 1)
    expect(merged.tr.getMeta('addToHistory')).toBe(false)
    const s2 = s1.apply(merged.tr)
    expect(fromBookDoc(s2.doc)).toBe(newBook)
    expect(s2.doc.child(i + 3)).toBe(s1.doc.child(i + 3))
    expect(cursorAnchor(s2)).toEqual(anchor)
    expect(mergeBookDoc(s2, nextDoc)).toBeNull()
  })

  it('差异块内的整段选区与 storedMarks 经合并保留：选中「测试」后回写落地，Ctrl+I 仍作用于同一段字（ux-01）', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const para = s0.doc.child(i)
    let pos = 0
    for (let k = 0; k < i; k++) pos += s0.doc.child(k).nodeSize
    // 选中第 i 段第 2–4 字（anchor 在后、head 在前，模拟 Shift+← 两次）
    const s1 = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, pos + 1 + 4, pos + 1 + 2)))
    // 远端改了同一段（末尾追加）→ 该段落入差异区被整块替换
    const remoteAst = structuredClone(ast) as Ast
    const rb = remoteAst.description.find((b) => b.id === para.attrs.blockId)!
    if (rb.kind === 'paragraph') rb.text = `${para.textContent}X`
    const lines = book('description').split('\n')
    const li = lines.indexOf(para.textContent)
    lines[li] = `${para.textContent}X`
    const nextDoc = toBookDoc(remoteAst, 'description', md.replace(book('description'), lines.join('\n')))
    const merged = mergeBookDoc(s1, nextDoc)!
    expect(merged.from).toBe(i)
    const s2 = s1.apply(merged.tr)
    expect(s2.selection.$anchor.pos - pos - 1).toBe(4)
    expect(s2.selection.$head.pos - pos - 1).toBe(2)
    expect(s2.doc.textBetween(s2.selection.from, s2.selection.to)).toBe(para.textContent.slice(2, 4))
    // 光标态：刚按 Ctrl+B 未打字的 storedMarks 也不被回填清掉
    const c1 = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, pos + 1 + 2)).setStoredMarks([s0.schema.marks.strong!.create()]))
    expect(c1.storedMarks?.length).toBe(1)
    const c2 = c1.apply(mergeBookDoc(c1, nextDoc)!.tr)
    expect(c2.selection.empty).toBe(true)
    expect(c2.selection.from).toBe(pos + 1 + 2)
    expect(c2.storedMarks?.map((m) => m.type.name)).toEqual(['strong'])
  })

  it('restoreCursor：blockId 找不到时回退到同索引块', () => {
    const s0 = stateFor('description')
    const sel = restoreCursor(s0.doc, { blockId: 'nope', index: 2, offset: 1 })
    expect(sel.$from.index(0)).toBe(2)
  })

  it('本地已 Enter 分段（blockId=null）后收到回写：只回填 blockId，文本与光标不变', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const split = run(bookEnter, cursorIn(s0, i, 3)).state
    const localMd = md.replace(book('description'), fromBookDoc(split.doc))
    // 假装服务端解析后给新块 id
    const fakeAst = structuredClone(ast) as Ast
    const idx = fakeAst.description.findIndex((b) => b.id === s0.doc.child(i).attrs.blockId)
    const orig = fakeAst.description[idx]!
    if (orig.kind !== 'paragraph') throw new Error('expected paragraph')
    const t = split.doc.child(i).textContent
    const t2 = split.doc.child(i + 1).textContent
    fakeAst.description.splice(
      idx,
      1,
      { ...orig, text: t, lines: { start: orig.lines.start, end: orig.lines.start } },
      { ...orig, id: 'new-id', text: t2, lines: { start: orig.lines.start + 2, end: orig.lines.start + 2 } },
    )
    for (let k = idx + 2; k < fakeAst.description.length; k++) {
      const b = fakeAst.description[k]!
      b.lines = { start: b.lines.start + 2, end: b.lines.end + 2 }
    }
    const next = toBookDoc(fakeAst, 'description', localMd)
    expect(fromBookDoc(next)).toBe(fromBookDoc(split.doc))
    const merged = mergeBookDoc(split, next)!
    const s2 = split.apply(merged.tr)
    expect(s2.doc.child(i + 1).attrs.blockId).toBe('new-id')
    expect(s2.doc.textContent).toBe(split.doc.textContent)
    expect(s2.selection.$from.parentOffset).toBe(split.selection.$from.parentOffset)
  })
})

describe('mergeRemoteDoc：本地有未落盘改动时三方合并（协同双 tab 不同段互不覆盖）', () => {
  /** 远端只改第 i 个顶层块的文本 → 新 doc */
  function remote(s0: EditorState, i: number, suffix: string) {
    const lines = book('description').split('\n')
    const pText = s0.doc.child(i).textContent
    const li = lines.indexOf(pText)
    expect(li).toBeGreaterThanOrEqual(0)
    lines[li] = `${pText}${suffix}`
    const newBook = lines.join('\n')
    const remoteAst = structuredClone(ast) as Ast
    const rb = remoteAst.description.find((b) => b.id === s0.doc.child(i).attrs.blockId)!
    if (rb.kind === 'paragraph') rb.text = lines[li]!
    return toBookDoc(remoteAst, 'description', md.replace(book('description'), newBook))
  }
  const typeAt = (s: EditorState, i: number, text: string) => {
    const s1 = cursorIn(s, i, 2)
    return s1.apply(s1.tr.insertText(text))
  }

  it('远端改前面的段、本地在后面的段打字：远端套上、本地保留、光标随映射', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const local = typeAt(s0, i + 5, '协同乙')
    const next = remote(s0, i, '协同甲')
    const r = mergeRemoteDoc(local, next, s0.doc)
    expect(r).not.toBeNull()
    expect(r).not.toBe('conflict')
    if (r === 'conflict' || r === null) return
    const s2 = local.apply(r.tr)
    expect(s2.doc.child(i).textContent.endsWith('协同甲')).toBe(true)
    expect(s2.doc.child(i + 5)).toBe(local.doc.child(i + 5))
    expect(s2.selection.from).toBe(local.selection.from + (s2.doc.child(i).nodeSize - local.doc.child(i).nodeSize))
    expect(r.tr.getMeta('addToHistory')).toBe(false)
    const out = fromBookDoc(s2.doc)
    expect(out).toContain('协同甲')
    expect(out).toContain('协同乙')
  })

  it('远端改后面的段、本地在前面分段（块数变化）：远端按偏移套到正确位置', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const split = run(bookEnter, cursorIn(s0, i, 3)).state
    expect(split.doc.childCount).toBe(s0.doc.childCount + 1)
    // 远端改动目标取 i 之后的首个段落块（语料里 i+4 可能落在章节/小节标题上）
    let ri = -1
    for (let k = i + 1; k < s0.doc.childCount; k++) {
      const n = s0.doc.child(k)
      if (n.type.name === 'ps_para' && n.attrs.kind === 'paragraph') { ri = k; break }
    }
    const next = remote(s0, ri, '远端')
    const r = mergeRemoteDoc(split, next, s0.doc)
    expect(r).not.toBe('conflict')
    if (r === 'conflict' || r === null) return
    const s2 = split.apply(r.tr)
    expect(s2.doc.childCount).toBe(s0.doc.childCount + 1)
    expect(s2.doc.child(ri + 1).textContent.endsWith('远端')).toBe(true)
    expect(s2.doc.child(i).textContent).toBe(s0.doc.child(i).textContent.slice(0, 3))
  })

  it('远端与本地改同一段的不同位置 → 字符级套上（同段互不覆盖）、本地光标不动；同一位置 → conflict（本地优先）', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const local = typeAt(s0, i, '本地')
    const next = remote(s0, i, '远端')
    const r = mergeRemoteDoc(local, next, s0.doc)
    expect(r).not.toBe('conflict')
    if (r === 'conflict' || r === null) return
    const s2 = local.apply(r.tr)
    const base = s0.doc.child(i).textContent
    expect(s2.doc.child(i).textContent).toBe(`${base.slice(0, 2)}本地${base.slice(2)}远端`)
    expect(s2.selection.from).toBe(local.selection.from)
    expect(s2.doc.childCount).toBe(s0.doc.childCount)
    expect(r.tr.getMeta('addToHistory')).toBe(false)
    // 两端都在段尾同一点插入 → 都保留（远端在前、本地在后），不丢字
    const end = cursorIn(s0, i, base.length)
    const localTail = end.apply(end.tr.insertText('本地'))
    const rt = mergeRemoteDoc(localTail, next, s0.doc)
    expect(rt).not.toBe('conflict')
    if (rt === 'conflict' || rt === null) return
    expect(localTail.apply(rt.tr).doc.child(i).textContent).toBe(`${base}远端本地`)
    // 本地删改的字符区间与远端替换区间重叠 → conflict（本地优先）
    const start = cursorIn(s0, i, 0)
    const localDel = start.apply(start.tr.delete(start.selection.from, start.selection.from + 3))
    const lines = book('description').split('\n')
    const li = lines.indexOf(base)
    lines[li] = `远${base.slice(2)}`
    const remoteAst = structuredClone(ast) as Ast
    const rb = remoteAst.description.find((b) => b.id === s0.doc.child(i).attrs.blockId)!
    if (rb.kind === 'paragraph') rb.text = lines[li]!
    const nextHead = toBookDoc(remoteAst, 'description', md.replace(book('description'), lines.join('\n')))
    expect(mergeRemoteDoc(localDel, nextHead, s0.doc)).toBe('conflict')
  })

  it('qa-01 回归：输入后 <1s 加粗（失焦 flush 已保存原文），保存回流到达时不得当远端改动三方合并 → 不重复正文', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const base = s0.doc.child(i).textContent
    // 1) 段尾输入唯一标记；失焦 flush 保存成功 → base.text 推进到已保存文本（BookEditor.save 回调）
    const end = cursorIn(s0, i, base.length)
    const typed = end.apply(end.tr.insertText('即刻寅卯辰巳'))
    const saved = fromBookDoc(typed.doc)
    // 2) 保存回流（服务端 / Yjs 回写 + 新 AST）尚未到，用户已 Shift+← 选末四字点 B
    const from = typed.selection.from - 4
    const withSel = typed.apply(typed.tr.setSelection(TextSelection.create(typed.doc, from, typed.selection.from)))
    const bold = withSel.apply(withSel.tr.addMark(from, typed.selection.from, withSel.schema.marks.strong.create()))
    const local = fromBookDoc(bold.doc)
    expect(local).toContain('即刻**寅卯辰巳**')
    // 3) 回流到达：content == saved（我们自己的正文），AST 跟上；调度器 pending（加粗尚未落盘）
    const remoteAst = structuredClone(ast) as Ast
    const rb = remoteAst.description.find((b) => b.id === s0.doc.child(i).attrs.blockId)!
    if (rb.kind === 'paragraph') rb.text = `${base}即刻寅卯辰巳`
    const next = toBookDoc(remoteAst, 'description', md.replace(book('description'), saved))
    // 旧逻辑：拿保存前的 base 三方合并 → 已保存文本被当成远端插入再套一遍（正文重复）
    const stale = mergeRemoteDoc(bold, next, s0.doc)
    expect(stale).not.toBe('conflict')
    if (stale !== 'conflict' && stale !== null) expect(bold.apply(stale.tr).doc.child(i).textContent).toBe(`${base}即刻寅卯辰巳即刻寅卯辰巳`)
    // 新逻辑：incoming == base.text → 只推进 base.doc，不合并
    const plan = planIncoming(bold, next, local, saved, { doc: s0.doc, text: saved }, true)
    expect(plan).toEqual({ merge: null, advance: 'doc' })
    expect(fromBookDoc(bold.doc)).toBe(local)
    // 真正的远端改动（≠ base.text）仍走三方合并；本地无未落盘输入时按块合并并推进 base
    const otherAst = structuredClone(remoteAst) as Ast
    const ob = otherAst.description.find((b) => b.id === s0.doc.child(i).attrs.blockId)!
    if (ob.kind === 'paragraph') ob.text = `${base}即刻寅卯辰巳远端`
    const other = toBookDoc(otherAst, 'description', md.replace(book('description'), saved.replace('即刻寅卯辰巳', '即刻寅卯辰巳远端')))
    const p2 = planIncoming(bold, other, local, fromBookDoc(other), { doc: next, text: saved }, true)
    expect(p2.advance).toBe('all')
    expect(p2.merge && bold.apply(p2.merge.tr).doc.child(i).textContent).toBe(`${base}即刻寅卯辰巳远端`)
    const p3 = planIncoming(typed, next, saved, saved, { doc: s0.doc, text: fromBookDoc(s0.doc) }, false)
    expect(p3.advance).toBe('all')
  })

  it('本地无改动时退化为 mergeBookDoc；远端无变化 → null', () => {
    const s0 = stateFor('description')
    const i = firstParaIndex(s0)
    const local = typeAt(s0, i, '本地')
    const next = remote(s0, i, '远端')
    const r = mergeRemoteDoc(s0, next, s0.doc)
    expect(r && r !== 'conflict' && r.from === i && r.to === i + 1).toBe(true)
    expect(mergeRemoteDoc(local, s0.doc, s0.doc)).toBeNull()
  })
})

describe('bookDomParser：DOM 重读忽略生成物', () => {
  it('段落 DOM 内含 [0002] widget → 解析出的段落文本不含生成物；普通 DOM 照常解析', () => {
    const el = document.createElement('div')
    el.innerHTML = `<p data-block-id="p1" data-kind="paragraph"><span class="ps-gen ps-para-no" data-generated="true" contenteditable="false"><span class="sr-only">生成段号 </span>[0002]</span>正文甲</p><p data-block-id="p2" data-kind="paragraph">正文乙</p>`
    const doc = bookDomParser.parse(el)
    expect(doc.textContent).toBe('正文甲正文乙')
    expect(doc.textContent).not.toContain('0002')
    expect(doc.textContent).not.toContain('生成段号')
    const slice = bookDomParser.parseSlice(el)
    expect(slice.content.textBetween(0, slice.content.size)).not.toContain('0002')
  })
})

describe('useBookSave：600ms 空闲 / flush / 组字 / pending 合并', () => {
  function harness(md0 = 'A') {
    vi.useFakeTimers()
    let current = md0
    let composing = false
    let holding = false
    const saves: string[] = []
    let resolveSave: ((ok: boolean) => void) | null = null
    const sched = createSaveScheduler({
      read: () => current,
      save: (m) =>
        new Promise<boolean>((res) => {
          saves.push(m)
          resolveSave = res
        }),
      composing: () => composing,
      holding: () => holding,
    })
    sched.markSaved(md0)
    return {
      sched,
      saves,
      type: (m: string) => {
        current = m
        sched.touch()
      },
      setComposing: (v: boolean) => (composing = v),
      setHolding: (v: boolean) => (holding = v),
      finish: async (ok = true) => {
        resolveSave?.(ok)
        resolveSave = null
        await Promise.resolve()
        await Promise.resolve()
      },
    }
  }

  it('SAVE_IDLE_MS = 600；停止输入 600ms 才保存一次，中途输入重置计时', async () => {
    expect(SAVE_IDLE_MS).toBe(600)
    const h = harness()
    h.type('AB')
    vi.advanceTimersByTime(500)
    h.type('ABC')
    vi.advanceTimersByTime(599)
    expect(h.saves).toEqual([])
    vi.advanceTimersByTime(1)
    expect(h.saves).toEqual(['ABC'])
    await h.finish()
    expect(h.sched.pending).toBe(false)
    vi.useRealTimers()
  })

  it('内容与上次保存一致时不发请求；flush 立即保存（失焦 / 切视图）', async () => {
    const h = harness()
    h.type('A')
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual([])
    h.type('AX')
    const p = h.sched.flush()
    expect(h.saves).toEqual(['AX'])
    await h.finish()
    await expect(p).resolves.toBe(true)
    vi.useRealTimers()
  })

  it('保存中继续输入：不阻塞、不并发；完成后合并为一次追加保存', async () => {
    const h = harness()
    h.type('A1')
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['A1'])
    expect(h.sched.pending).toBe(true)
    h.type('A12')
    h.type('A123')
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['A1']) // 仍在保存中，不并发
    await h.finish()
    expect(h.saves).toEqual(['A1', 'A123'])
    await h.finish()
    expect(h.sched.pending).toBe(false)
    vi.useRealTimers()
  })

  it('IME 组字期间不保存；compositionend 后一个空闲周期再保存', () => {
    const h = harness()
    h.setComposing(true)
    h.type('A中')
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual([])
    expect(h.sched.pending).toBe(true)
    h.setComposing(false)
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['A中'])
    vi.useRealTimers()
  })

  it('保存失败：saved 不前进，下次输入会重发；dispose 只取消未到期定时器', async () => {
    const h = harness()
    h.type('AZ')
    vi.advanceTimersByTime(600)
    await h.finish(false)
    h.type('AZ')
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['AZ', 'AZ'])
    await h.finish()
    h.type('AZQ')
    h.sched.dispose()
    expect(h.sched.pending).toBe(false)
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['AZ', 'AZ'])
    vi.useRealTimers()
  })

  it('StrictMode 式 mount→cleanup→mount 复用同一调度器后，idle 保存仍然发生（回归：dispose 不得永久关掉 touch）', () => {
    const h = harness()
    void h.sched.flush()
    h.sched.dispose()
    h.type('AS')
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['AS'])
    vi.useRealTimers()
  })

  it('holding（远端文本已到、AST 未跟上）：到期不保存而重排 idle，解除后下一拍保存；最多等 SAVE_MAX_HOLDS 拍', () => {
    const h = harness()
    h.setHolding(true)
    h.type('AH')
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual([])
    h.setHolding(false)
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['AH'])
    vi.useRealTimers()
  })

  it('holding 一直为真（AST 请求失败）：等满 SAVE_MAX_HOLDS 拍后照常保存，不会永久卡住', () => {
    const h = harness()
    h.setHolding(true)
    h.type('AK')
    vi.advanceTimersByTime(600 * SAVE_MAX_HOLDS)
    expect(h.saves).toEqual([])
    vi.advanceTimersByTime(600)
    expect(h.saves).toEqual(['AK'])
    vi.useRealTimers()
  })
})

describe('bookView：PDF 选块 → 光标到同块开头；表注段号；公式节点视图', () => {
  it('focusBlockStart：光标落在目标块正文起点（可编辑 view），未知 blockId 返回 false', () => {
    const doc = toBookDoc(ast, 'description', md)
    const el = document.createElement('div')
    document.body.append(el)
    const view = new EditorView(el, { state: EditorState.create({ doc, plugins: [bookKeymap()] }) })
    const target = ast.description.filter((b) => b.kind === 'paragraph')[3]!
    expect(focusBlockStart(view, target.id)).toBe(true)
    const $from = view.state.selection.$from
    expect(blockAttrsOf($from.node(1)).blockId).toBe(target.id)
    expect($from.parentOffset).toBe(0)
    expect(focusBlockStart(view, 'nope/999')).toBe(false)
    view.destroy()
    el.remove()
  })

  it('bookText：全文 → 某书正文；表注 ps_note 段号来自 table.note.para_no', () => {
    expect(bookText(md, 'claims')).toBe(book('claims'))
    const table = ast.description.find((b) => b.kind === 'table' && b.note?.para_no != null)!
    const doc = toBookDoc(ast, 'description', md)
    const set = buildDecorations(doc, ast, 'description')
    const labels = set
      .find()
      .map((d) => (d as unknown as { type: { toDOM?: () => HTMLElement } }).type.toDOM?.())
      .filter((e): e is HTMLElement => !!e)
      .map((e) => e.textContent?.replace('生成段号 ', ''))
    expect(labels).toContain(paraLabel(table.kind === 'table' ? table.note!.para_no! : -1))
  })

  it('EquationNodeView：顶层公式 .ps-eq + 式号；权项内公式 .ps-claim-eq；MathML 为空显示线性源码；contenteditable=false', () => {
    const doc = toBookDoc(ast, 'description', md)
    const el = document.createElement('div')
    document.body.append(el)
    const opened: number[] = []
    const view = new EditorView(el, {
      state: EditorState.create({ doc }),
      nodeViews: { ps_equation: (n, v, getPos) => new EquationNodeView(n, v, getPos, (p) => opened.push(p)) },
    })
    const eq = ast.description.find((b) => b.kind === 'equation')!
    const dom = el.querySelector<HTMLElement>('.ps-eq')!
    expect(dom.getAttribute('contenteditable')).toBe('false')
    expect(dom.querySelector('.ps-eq-label')?.textContent).toBe(eq.kind === 'equation' ? eq.label : '')
    expect(dom.classList.contains('ps-claim-eq')).toBe(false)
    dom.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(opened.length).toBe(1)
    view.destroy()

    const cdoc = toBookDoc(ast, 'claims', md)
    const cview = new EditorView(el, {
      state: EditorState.create({ doc: cdoc }),
      nodeViews: { ps_equation: (n, v, getPos) => new EquationNodeView(n, v, getPos, () => {}) },
    })
    const claimEq = el.querySelector<HTMLElement>('.ps-claim .ps-eq')
    if (claimEq) {
      expect(claimEq.classList.contains('ps-claim-eq')).toBe(true)
      expect(claimEq.querySelector('.ps-eq-label')).toBeNull()
    }
    cview.destroy()
    el.remove()
  })

  it('公式 NodeView 被销毁重建（整书重绘）后恢复横向滚动位置；属性不变的 update 不重排 MathML', async () => {
    const doc = toBookDoc(ast, 'description', md)
    const el = document.createElement('div')
    document.body.append(el)
    const mk = (n: import('prosemirror-model').Node, v: EditorView, getPos: () => number | undefined) => new EquationNodeView(n, v, getPos, () => {})
    const view = new EditorView(el, { state: EditorState.create({ doc }), nodeViews: { ps_equation: mk } })
    const math = el.querySelector<HTMLElement>('.ps-eq .ps-eq-math')!
    const eqDom = math.parentElement!
    // jsdom 无布局：用可写属性模拟用户已横滑到 69px
    Object.defineProperty(math, 'scrollLeft', { value: 69, writable: true, configurable: true })
    // 位置在 scroll 事件时记住（PM 重绘先建新 NodeView 再 destroy 旧的，destroy 时写来不及）
    math.dispatchEvent(new Event('scroll'))

    // 不改公式的事务（方式依然是 update）：MathML 子树不应重建
    const mathChild = math.firstElementChild
    view.dispatch(view.state.tr.insertText('x', 2))
    expect(el.querySelector('.ps-eq .ps-eq-math')).toBe(math)
    expect(math.firstElementChild).toBe(mathChild)

    // 整书重绘：同一 doc 换一套 nodeViews 属性强制 destroy + 重建
    view.setProps({ nodeViews: { ps_equation: (n, v, g) => mk(n, v, g) } })
    const math2 = el.querySelector<HTMLElement>('.ps-eq .ps-eq-math')!
    expect(math2).not.toBe(math)
    expect(math2.parentElement).not.toBe(eqDom)
    const writes: number[] = []
    Object.defineProperty(math2, 'scrollLeft', { get: () => writes.at(-1) ?? 0, set: (v: number) => writes.push(v), configurable: true })
    await Promise.resolve()
    expect(writes).toEqual([69])
    view.destroy()
    el.remove()
  })
})

describe('decorations：生成物 widget key 按块身份，上文改动不重建下文段号', () => {
  it('在首段打字后，其后段的段号 DOM 节点保持同一对象', () => {
    const doc = toBookDoc(ast, 'description', md)
    const el = document.createElement('div')
    const view = new EditorView(el, { state: EditorState.create({ doc, plugins: [bookKeymap(), bookDecorations('description', ast)] }) })
    const nos = Array.from(el.querySelectorAll('.ps-para-no'))
    expect(nos.length).toBeGreaterThan(3)
    const idx = firstParaIndex(view.state)
    let pos = 0
    for (let i = 0; i < idx; i++) pos += view.state.doc.child(i).nodeSize
    view.dispatch(view.state.tr.insertText('新', pos + 1))
    const after = Array.from(el.querySelectorAll('.ps-para-no'))
    expect(after.length).toBe(nos.length)
    // 除被编辑段本身可能重绘外，其余段号节点不应重建
    const kept = after.filter((n, i) => n === nos[i]).length
    expect(kept).toBeGreaterThanOrEqual(nos.length - 1)
    view.destroy()
  })
})
