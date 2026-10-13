// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { CompletionContext } from '@codemirror/autocomplete'
import { useStudio } from '@/store'
import { cursorFocusDriver } from '@/lib/focusSync'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import { PATENT_SNIPPETS, focusDriverExtension, headingFoldRange, patentSnippetSource } from '../threeView'
import { zhPhrases } from '../theme'

const DOC = ['# 一种控制方法', '', '## 技术领域', '[0001] 本发明涉及。', '', '### 子标题', '[0002] 子段。', '', '## 背景技术', '[0003] 现有技术。', '', '# 权利要求书', '1. 一种方法。'].join('\n')

describe('片段补全 eq / tbl / claim / fig（R-SRC-06）', () => {
  it('四个片段齐全，且都是 snippet（含占位符）', () => {
    expect(PATENT_SNIPPETS.map((c) => c.label).sort()).toEqual(['claim', 'eq', 'fig', 'tbl'])
    PATENT_SNIPPETS.forEach((c) => expect(typeof c.apply).toBe('function'))
  })

  it('英文小写前缀触发；中文正文 / 空格后不触发', () => {
    const at = (doc: string, pos: number, explicit = false) => patentSnippetSource(new CompletionContext(EditorState.create({ doc }), pos, explicit))
    const r = at('段落 eq', 5)
    expect(r).not.toBeNull()
    expect(r!.from).toBe(3)
    expect(r!.options).toBe(PATENT_SNIPPETS)
    expect(at('本发明涉及', 5)).toBeNull()
    expect(at('abc ', 4)).toBeNull()
    expect(at('abc ', 4, true)).toBeNull()
    expect(at('claim', 5)?.from).toBe(0)
  })
})

describe('## / ### 折叠区间', () => {
  const state = EditorState.create({ doc: DOC })
  it('## 折到下一个同级或更高级标题前；### 只折自己的段；非标题行 null', () => {
    const l = (n: number) => state.doc.line(n)
    // 第 3 行「## 技术领域」→ 到第 8 行（空行）末，不吞第 9 行「## 背景技术」
    expect(headingFoldRange(state, 3)).toEqual({ from: l(3).to, to: l(8).to })
    // 第 6 行「### 子标题」→ 到第 8 行
    expect(headingFoldRange(state, 6)).toEqual({ from: l(6).to, to: l(8).to })
    // 第 9 行「## 背景技术」→ 到第 11 行，遇「# 权利要求书」停
    expect(headingFoldRange(state, 9)).toEqual({ from: l(9).to, to: l(11).to })
    expect(headingFoldRange(state, 4)).toBeNull()
    expect(headingFoldRange(state, 1)).toBeNull()
    // 末行标题无正文 → null
    expect(headingFoldRange(EditorState.create({ doc: '## 空' }), 1)).toBeNull()
  })
})

describe('光标块变化 → Focus{source:source}', () => {
  let view: EditorView | null = null
  afterEach(() => {
    view?.destroy()
    view = null
    vi.useRealTimers()
  })

  it('鼠标点击（userEvent select.pointer）立刻广播；键盘移动只在对照锁下去抖广播', () => {
    vi.useFakeTimers()
    useStudio.setState({ focus: null, compareLock: false } as never)
    const driver = cursorFocusDriver('source')
    const doc = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
    view = new EditorView({ state: EditorState.create({ doc, extensions: [focusDriverExtension(driver, () => SYNTH_AST)] }), parent: document.body })
    const para = SYNTH_AST.description.find((b) => b.kind === 'paragraph')!
    const line = SYNTH_AST.books.description.offset + para.lines.start
    const pos = view.state.doc.line(line).from

    view.dispatch({ selection: { anchor: pos }, userEvent: 'select.pointer' })
    expect(useStudio.getState().focus).toMatchObject({ blockId: para.id, source: 'source', line })
    const seq = useStudio.getState().focus!.seq

    const paras = SYNTH_AST.description.filter((b) => b.kind === 'paragraph')
    const line2 = SYNTH_AST.books.description.offset + paras[1].lines.start
    view.dispatch({ selection: { anchor: view.state.doc.line(line2).from }, userEvent: 'select' })
    vi.advanceTimersByTime(500)
    expect(useStudio.getState().focus!.seq).toBe(seq)

    useStudio.setState({ compareLock: true } as never)
    view.dispatch({ selection: { anchor: view.state.doc.line(line2).from + 1 }, userEvent: 'select' })
    expect(useStudio.getState().focus!.seq).toBe(seq)
    vi.advanceTimersByTime(150)
    expect(useStudio.getState().focus).toMatchObject({ blockId: paras[1].id, source: 'source' })
    driver.dispose()
  })
})

describe('zhPhrases 中文化表（R115 批14）', () => {
  it('折叠槽/查找面板等 CM 文案键全部有中译', () => {
    const s = EditorState.create({ doc: '', extensions: [EditorState.phrases.of(zhPhrases)] })
    for (const key of ['Fold line', 'Unfold line', 'folded code', 'unfold', 'Folded lines', 'Unfolded lines', 'to', 'Control character', 'Selection deleted', 'Completions']) {
      expect(s.phrase(key), key).not.toBe(key)
    }
    expect(s.phrase('Fold line')).toBe('折叠本节')
  })
})
