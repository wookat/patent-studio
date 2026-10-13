// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { EditorState as PmState, TextSelection } from 'prosemirror-state'
import { EditorView as PmView } from 'prosemirror-view'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import { applyMarks } from '@/store/review'
import type { Comment, CriticMark } from '@/lib/types'
import type { Ast } from '@/types/ast'
import sampleMethod from '../../../../../backend/tests/fixtures/ast_sample_method.json'
import { countDecorations, criticDecorations, criticExtension, editorSelection, revealMark, setCriticMarks } from '../criticExtension'
import { demotePmView, promotePmView } from '../../layout-view/editor/activeView'
import { bookSchema } from '../../layout-view/doc/bookSchema'
import { ReviewBody } from '../ReviewBody'
import { blockLabel, groupComments, markSummary } from '../reviewUtils'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

/** 与后端 critic.parse 同形的 fixture：一行内 5 类各一条（前端不解析，这里手写偏移） */
const DOC = 'A {++加++} B {--删--} C {~~旧~>新~~} D {>>批<<} E {==高==} F'
function span(kind: CriticMark['kind'], open: string, id: string, a: string, b: string, final: string, original: string): CriticMark {
  const from = DOC.indexOf(open)
  const close = { ins: '++}', del: '--}', sub: '~~}', comment: '<<}', mark: '==}' }[kind]
  const to = DOC.indexOf(close, from) + 3
  return { id, kind, line: 1, from, to, a, b, final, original }
}
const MARKS: CriticMark[] = [
  span('ins', '{++', 'i', '', '加', '加', ''),
  span('del', '{--', 'd', '删', '', '', '删'),
  span('sub', '{~~', 's', '旧', '新', '新', '旧'),
  span('comment', '{>>', 'c', '批', '', '', ''),
  span('mark', '{==', 'm', '高', '', '高', '高'),
]

let view: EditorView | null = null
const pmViews: PmView[] = []
let root: Root | null = null
let host: HTMLElement

/** 版面态（ProseMirror）视图：doc 直建 schema 节点，blockId 挂 sampleMethod 的 abstract/p1（全文行 5） */
function makePmView(blockId: string | null = 'abstract/p1', text = '摘要里的一段话') {
  const para = bookSchema.nodes.ps_para.create({ blockId, kind: 'paragraph' }, bookSchema.text(text))
  const doc = bookSchema.nodes.doc.create({ book: 'abstract' }, [para])
  const el = document.createElement('div')
  document.body.appendChild(el)
  const pv = new PmView(el, { state: PmState.create({ doc }) })
  promotePmView(pv)
  pmViews.push(pv)
  return pv
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1', content: DOC, comments: [], marks: [], reviewMode: 'final', ast: null,
    commentsUnavailable: false, marksUnavailable: false, activeCommentId: null, cursor: { line: 1, col: 1 },
    activePanelId: 'source:all', editorView: 'source', commentDraft: null, replyBodies: {},
    loadComments: async () => {},
  })
})

afterEach(async () => {
  for (const pv of pmViews.splice(0)) {
    demotePmView(pv)
    pv.destroy()
    pv.dom.parentElement?.remove()
  }
  view?.destroy()
  view = null
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

function makeView(doc: string, actions?: { accept(id: string): void; reject(id: string): void }) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({ state: EditorState.create({ doc, extensions: [criticExtension(actions)] }), parent })
  return view
}

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/** React 受控 textarea：绕过 value tracker 用原生 setter 再派发 input */
async function type(ta: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(ta, text)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const comment = (id: string, o: Partial<Comment> & { line?: number; block?: string } = {}): Comment => ({
  id,
  anchor: { block_id: o.block ?? 'blk-1', line: o.line ?? 3, quote: `引 ${id}`, stale: false },
  body: `正文 ${id}`,
  author: { id: null, name: 'me' },
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  resolved: false,
  replies: [],
  ...o,
})

describe('criticExtension：按 marks 渲染装饰（07 §5.3 / §7.1）', () => {
  it('无 marks 时无装饰；推入 5 类 marks 后：每类 1 个按钮组，ins/del/sub 两段/comment/mark 内文装饰，标记符弱化', () => {
    const v = makeView(DOC)
    expect(countDecorations(criticDecorations(v.state))).toBe(0)
    v.dispatch({ effects: setCriticMarks.of(MARKS) })
    const set = criticDecorations(v.state)
    expect(countDecorations(set, 'widget')).toBe(5)
    // ins 1 + sub 的新文 1
    expect(countDecorations(set, 'cm-critic-ins')).toBe(2)
    // del 1 + sub 的旧文 1
    expect(countDecorations(set, 'cm-critic-del')).toBe(2)
    expect(countDecorations(set, 'cm-critic-comment')).toBe(1)
    expect(countDecorations(set, 'cm-critic-mark')).toBe(1)
    // 标记符：ins/del/comment/mark 各 2，sub 3（{~~ ~> ~~}）
    expect(countDecorations(set, 'cm-critic-sym')).toBe(11)
    expect(v.contentDOM.querySelectorAll('.cm-critic-ins')).toHaveLength(2)
    expect(v.contentDOM.querySelectorAll('.cm-critic-del')).toHaveLength(2)
    expect(v.contentDOM.querySelectorAll('[data-testid="critic-actions"]')).toHaveLength(5)
  })

  it('接受 / 拒绝按钮：ins/del/sub 各两枚，comment/mark 只有「去除」；点击调 actions（默认走 store）', () => {
    const accept = vi.fn()
    const reject = vi.fn()
    const v = makeView(DOC, { accept, reject })
    v.dispatch({ effects: setCriticMarks.of(MARKS) })
    const groups = [...v.contentDOM.querySelectorAll<HTMLElement>('[data-testid="critic-actions"]')]
    const byId = (id: string) => groups.find((g) => g.dataset.markId === id)!
    expect(byId('i').querySelectorAll('button')).toHaveLength(2)
    expect(byId('c').querySelectorAll('button')).toHaveLength(1)
    expect(byId('m').querySelectorAll('button')).toHaveLength(1)
    byId('s').querySelector<HTMLButtonElement>('.cm-critic-btn-accept')!.click()
    byId('d').querySelector<HTMLButtonElement>('.cm-critic-btn-reject')!.click()
    expect(accept).toHaveBeenCalledWith('s')
    expect(reject).toHaveBeenCalledWith('d')
    for (const b of v.contentDOM.querySelectorAll('button')) expect(b.getAttribute('aria-label')).toBeTruthy()
  })

  it('默认 actions 走 store.acceptMark → doc.content 按 mark.final 回写（接受一条后源码变化）', () => {
    const v = makeView(DOC)
    useStudio.setState({ marks: MARKS })
    v.dispatch({ effects: setCriticMarks.of(MARKS) })
    const g = [...v.contentDOM.querySelectorAll<HTMLElement>('[data-testid="critic-actions"]')].find((x) => x.dataset.markId === 's')!
    g.querySelector<HTMLButtonElement>('.cm-critic-btn-accept')!.click()
    const s = useStudio.getState()
    expect(s.content).toBe(applyMarks(DOC, [MARKS[2]], 'final'))
    expect(s.content).toContain(' C 新 D ')
    expect(s.marks.map((m) => m.id)).not.toContain('s')
  })

  it('qa-06：按钮视觉保持行内紧凑，触摸 / 375 媒体查询下用 ::after 伪元素把命中区扩到 44（--h-touch），两枚之间拉开间距', () => {
    const v = makeView(DOC)
    v.dispatch({ effects: setCriticMarks.of(MARKS) })
    const css = [...document.head.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n')
    const compact = css.match(/\.cm-critic-btn \{[^}]*\}/)?.[0] ?? ''
    expect(compact).toContain('padding: 1px 4px')
    expect(compact).toContain('position: relative')
    const touch = css.match(/@media \(max-width: 767px\), \(pointer: coarse\) \{[\s\S]*?\}\}/)?.[0] ?? ''
    expect(touch).toMatch(/\.cm-critic-btn::after \{[^}]*width: var\(--h-touch\)/)
    expect(touch).toMatch(/\.cm-critic-btn::after \{[^}]*height: var\(--h-touch\)/)
    // 热区从按钮左边起向右延伸（不伸到 gutter 上），控件组提到相邻文本之上
    expect(touch).toMatch(/\.cm-critic-btn::after \{[^}]*left: 0/)
    expect(touch).toMatch(/\.cm-critic-btn::after \{[^}]*translateY\(-50%\)/)
    expect(touch).toMatch(/\.cm-critic-actions \{[^}]*gap: calc\(var\(--h-touch\) - 1em\)/)
    expect(touch).toMatch(/\.cm-critic-actions \{[^}]*z-index: 1/)
    // 控件组撑到 44 高：软换行后上下两组标记的热区不互盖
    expect(touch).toMatch(/\.cm-critic-actions \{[^}]*height: var\(--h-touch\)/)
    // 视觉按钮仍是 2 枚小按钮（DOM 上不额外插入热区节点，装饰 eq/映射不受影响）
    const g = [...v.contentDOM.querySelectorAll<HTMLElement>('[data-testid="critic-actions"]')].find((x) => x.dataset.markId === 'i')!
    expect(g.children).toHaveLength(2)
    expect([...g.children].every((c) => c.tagName === 'BUTTON')).toBe(true)
  })

  it('偏移与文本对不上（过期 mark）时退化为整段单色，不抛错；越界行 / 越界列被跳过', () => {
    const v = makeView('short\nline2')
    v.dispatch({
      effects: setCriticMarks.of([
        { id: 'x', kind: 'ins', line: 1, from: 0, to: 5, a: '', b: '', final: '', original: '' },
        { id: 'y', kind: 'del', line: 9, from: 0, to: 2, a: '', b: '', final: '', original: '' },
        { id: 'z', kind: 'del', line: 2, from: 0, to: 99, a: '', b: '', final: '', original: '' },
      ]),
    })
    const set = criticDecorations(v.state)
    expect(countDecorations(set, 'cm-critic-ins')).toBe(1)
    expect(countDecorations(set, 'cm-critic-sym')).toBe(0)
    expect(countDecorations(set, 'widget')).toBe(1)
  })

  it('文档编辑后装饰随 changes 映射；editorSelection / revealMark 读写当前视图', () => {
    const v = makeView(DOC)
    v.dispatch({ effects: setCriticMarks.of(MARKS) })
    v.dispatch({ changes: { from: 0, insert: 'XY' } })
    expect(countDecorations(criticDecorations(v.state), 'widget')).toBe(5)
    v.dispatch({ selection: { anchor: 4, head: 8 } })
    expect(editorSelection()).toEqual({ line: 1, quote: v.state.sliceDoc(4, 8), empty: false })
    expect(revealMark(MARKS[4])).toBe(true)
    expect(v.state.selection.main.head).toBe(MARKS[4].from)
    expect(revealMark({ ...MARKS[0], line: 42 })).toBe(false)
  })
})

describe('editorSelection 版面态（ProseMirror）分派（W12 R12-05）', () => {
  const layout = () => useStudio.setState({ activePanelId: 'layout:all', editorView: 'layout', ast: sampleMethod as unknown as Ast })

  it('版面态：PM 选区 → 锚块首行 + 选区引文（sampleMethod abstract/p1 → 全文行 5）', () => {
    layout()
    const pv = makePmView()
    pv.dispatch(pv.state.tr.setSelection(TextSelection.create(pv.state.doc, 1, 5)))
    expect(editorSelection()).toEqual({ line: 5, quote: '摘要里的', empty: false })
  })

  it('版面态：PM 空选区（光标块）→ 行=块首行、quote=该行 md 文本；blockId 未回填 → 退 cursor.line 由调用方判锚', () => {
    layout()
    const doc = Array.from({ length: 6 }, (_, i) => `第${i + 1}行`).join('\n')
    useStudio.setState({ content: doc, cursor: { line: 9, col: 1 } })
    makePmView()
    expect(editorSelection()).toEqual({ line: 5, quote: '第5行', empty: true })
    const pv2 = makePmView(null)
    expect(editorSelection()).toEqual({ line: 9, quote: '', empty: true })
    expect(pv2.state.selection.empty).toBe(true)
  })

  it('版面态忽略仍存活的 CM 视图（375 隐藏编辑器陈旧选区回归）；源码态仍走 CM', () => {
    layout()
    const cv = makeView('旧行一\n旧行二旧行三')
    cv.dispatch({ selection: { anchor: 5, head: 8 } })
    makePmView()
    expect(editorSelection()!.line).toBe(5)
    useStudio.setState({ activePanelId: 'source:all', editorView: 'source' })
    expect(editorSelection()).toEqual({ line: 2, quote: '行二旧', empty: false })
  })

  it('版面态无 PM 视图 → null（按钮 toast 路径不变）', () => {
    layout()
    expect(editorSelection()).toBeNull()
  })
})

describe('reviewUtils', () => {
  it('markSummary 五类；groupComments 按块分组、块按首行排序', () => {
    expect(MARKS.map(markSummary)).toEqual(['+ 加', '− 删', '旧 → 新', '批', '高'])
    const gs = groupComments([comment('a', { line: 9, block: 'B' }), comment('b', { line: 2, block: 'A' }), comment('c', { line: 5, block: 'B' })])
    expect(gs.map((g) => [g.blockId, g.items.map((c) => c.id)])).toEqual([['A', ['b']], ['B', ['c', 'a']]])
    expect(blockLabel(null, '')).toBe('未定位')
    expect(blockLabel(null, 'abstract')).toBe('说明书摘要')
    expect(blockLabel(null, 'blk')).toBe('blk')
  })

  it('blockLabel：后端 reanchor 落到摘要段落 id（abstract/pN）也显示「说明书摘要」（W12 R3-08）', () => {
    expect(blockLabel(null, 'abstract/p1')).toBe('说明书摘要')
    expect(blockLabel(null, 'abstract/p12')).toBe('说明书摘要')
  })
})

describe('ReviewPanel：修订列表 + 批注线程（07 §7.2 / §7.4）', () => {
  it('修订列表逐条 / 全部接受拒绝写回 content；axe 无违规', async () => {
    useStudio.setState({ marks: MARKS })
    const el = await mount(<ReviewBody pid="p1" />)
    expect(el.querySelectorAll('[data-testid="review-mark"]')).toHaveLength(5)
    expect(el.textContent).toContain('修订 5 处')
    expect(await violations(el)).toEqual([])

    const rows = [...el.querySelectorAll<HTMLElement>('[data-testid="review-mark"]')]
    // comment/mark 没有拒绝按钮
    expect(rows.find((r) => r.dataset.markId === 'c')!.querySelector('[data-testid="review-reject"]')).toBeNull()
    await act(async () => rows.find((r) => r.dataset.markId === 'd')!.querySelector<HTMLButtonElement>('[data-testid="review-reject"]')!.click())
    expect(useStudio.getState().content).toContain(' B 删 C ')
    expect(el.querySelectorAll('[data-testid="review-mark"]')).toHaveLength(4)

    // 同行其余 mark 的偏移要等后端 /critic 刷新（store.scheduleMarks）；这里模拟刷新回到初始 fixture 再全部接受
    await act(async () => useStudio.setState({ content: DOC, marks: MARKS }))
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-accept-all"]')!.click())
    expect(useStudio.getState().content).toBe('A 加 B  C 新 D  E 高 F')
    expect(useStudio.getState().marks).toEqual([])
    expect(el.textContent).toContain('无修订标记')
  })

  it('R115-批24：全部拒绝两阶确认——首击只 arm，取消不丢，确认才全丢', async () => {
    useStudio.setState({ marks: MARKS })
    const el = await mount(<ReviewBody pid="p1" />)
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-reject-all"]')!.click())
    expect(useStudio.getState().marks).toHaveLength(5)   // arm 不丢
    expect(el.querySelector('[data-testid="review-reject-all-confirm"]')).not.toBeNull()
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-reject-all-cancel"]')!.click())
    expect(useStudio.getState().marks).toHaveLength(5)
    expect(el.querySelector('[data-testid="review-reject-all-confirm"]')).toBeNull()

    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-reject-all"]')!.click())
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-reject-all-confirm"]')!.click())
    expect(useStudio.getState().marks).toEqual([])        // 确认后全丢
    expect(el.textContent).toContain('无修订标记')
  })

  it('批注：未解决优先按块分组、已解决折叠；点击定位 gotoLine + setActiveComment + setActiveBlock；解决 / 回复 / 删除走 store', async () => {
    const gotoLine = vi.fn()
    const setActiveBlock = vi.fn()
    const resolveComment = vi.fn(async (_p: string, cid: string, resolved = true) => {
      useStudio.setState({ comments: useStudio.getState().comments.map((c) => (c.id === cid ? { ...c, resolved } : c)) })
    })
    const replyComment = vi.fn(async (_p: string, cid: string, body: string) => {
      useStudio.setState({
        comments: useStudio.getState().comments.map((c) =>
          c.id === cid ? { ...c, replies: [...c.replies, { id: 'r1', body, author: { id: null, name: 'me' }, created_at: 1 }] } : c,
        ),
      })
    })
    const deleteComment = vi.fn(async (_p: string, cid: string) => {
      useStudio.setState({ comments: useStudio.getState().comments.filter((c) => c.id !== cid) })
    })
    useStudio.setState({
      comments: [comment('done', { resolved: true, line: 1, block: 'X' }), comment('b', { line: 8, block: 'Y' }), comment('a', { line: 4, block: 'X' })],
      gotoLine, setActiveBlock, resolveComment, replyComment, deleteComment,
    })
    const el = await mount(<ReviewBody pid="p1" />)
    expect(el.textContent).toContain('未解决批注 2 条')
    const groups = el.querySelectorAll('[data-testid="review-comment-group"]')
    expect(groups).toHaveLength(2)
    expect([...el.querySelectorAll<HTMLElement>('[data-testid="review-comment"]')].map((c) => c.dataset.commentId)).toEqual(['a', 'b'])
    expect(el.querySelector('[data-testid="review-toggle-resolved"]')?.textContent).toContain('已解决 1 条')
    expect(await violations(el)).toEqual([])

    const card = (id: string) => [...el.querySelectorAll<HTMLElement>('[data-testid="review-comment"]')].find((c) => c.dataset.commentId === id)!
    await act(async () => card('b').querySelector<HTMLButtonElement>('button')!.click())
    expect(gotoLine).toHaveBeenCalledWith(8)
    expect(setActiveBlock).toHaveBeenCalledWith('Y', 'outline')
    expect(useStudio.getState().activeCommentId).toBe('b')

    await act(async () => card('a').querySelector<HTMLButtonElement>('[data-testid="review-reply-open"]')!.click())
    await type(card('a').querySelector<HTMLTextAreaElement>('textarea')!, '回一句')
    await act(async () => card('a').querySelector<HTMLButtonElement>('[data-testid="review-reply-submit"]')!.click())
    expect(replyComment).toHaveBeenCalledWith('p1', 'a', '回一句')
    expect(card('a').querySelectorAll('[data-testid="review-reply"]')).toHaveLength(1)

    await act(async () => card('a').querySelector<HTMLButtonElement>('[data-testid="review-resolve"]')!.click())
    expect(resolveComment).toHaveBeenCalledWith('p1', 'a', true)
    expect(el.textContent).toContain('未解决批注 1 条')
    expect(el.querySelector('[data-testid="review-toggle-resolved"]')?.textContent).toContain('已解决 2 条')

    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-toggle-resolved"]')!.click())
    expect(card('done').textContent).toContain('已解决')
    await act(async () => card('done').querySelector<HTMLButtonElement>('[data-testid="review-resolve"]')!.click())
    expect(resolveComment).toHaveBeenCalledWith('p1', 'done', false)

    /* 批63：删除批注改两阶确认——先 arm 再 confirm（PatPanel/OA 轮次同惯例） */
    await act(async () => card('b').querySelector<HTMLButtonElement>('[data-testid="review-delete"]')!.click())
    expect(deleteComment).not.toHaveBeenCalledWith('p1', 'b')
    await act(async () => card('b').querySelector<HTMLButtonElement>('[data-testid="review-delete-confirm"]')!.click())
    expect(deleteComment).toHaveBeenCalledWith('p1', 'b')
    expect(el.querySelectorAll('[data-testid="review-comment"]').length).toBe(2)
  })

  it('添加批注：取编辑器选区为引文 → addComment(pid, {block_id, line, quote}, body)；无编辑器 / 光标不在任何块内时 toast 不开草稿（W12 R3-02）', async () => {
    const addComment = vi.fn(async () => null)
    const toast = vi.fn()
    useStudio.setState({ addComment, toast })
    const el = await mount(<ReviewBody pid="p1" />)
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-add-comment"]')!.click())
    expect(toast).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[data-testid="review-draft"]')).toBeNull()

    // 有编辑器但 AST 未就绪（block_id 推不出）：不开草稿，提示把光标放到段落里，不再提到后端才报 422
    const v = makeView('第一行\n第二行选中文字')
    v.dispatch({ selection: { anchor: 7, head: 11 } })
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-add-comment"]')!.click())
    expect(toast).toHaveBeenCalledTimes(2)
    expect(toast.mock.calls[1]![0]).toContain('光标')
    expect(el.querySelector('[data-testid="review-draft"]')).toBeNull()
    expect(addComment).not.toHaveBeenCalled()

    // AST 就绪：method 样例第 5 行属于摘要块 → 开草稿并提交 block_id='abstract'
    const ast = sampleMethod as unknown as Ast
    const doc = Array.from({ length: 6 }, (_, i) => `第${i + 1}行`).join('\n')
    v.destroy()
    await act(async () => useStudio.setState({ ast, content: doc }))
    const v2 = makeView(doc)
    const l5 = v2.state.doc.line(5)
    v2.dispatch({ selection: { anchor: l5.from, head: l5.to } })
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-add-comment"]')!.click())
    const form = el.querySelector<HTMLFormElement>('[data-testid="review-draft"]')!
    expect(form.textContent).toContain('批注位置')
    expect(form.textContent).toContain('说明书摘要')
    expect(form.querySelector('[data-testid="review-draft-unanchored"]')).toBeNull()
    await type(form.querySelector<HTMLTextAreaElement>('textarea')!, '这里要改')
    await act(async () => form.querySelector<HTMLButtonElement>('[data-testid="review-draft-submit"]')!.click())
    expect(addComment).toHaveBeenCalledWith('p1', { block_id: 'abstract', line: 5, quote: '第5行' }, '这里要改')
    expect(el.querySelector('[data-testid="review-draft"]')).toBeNull()
  })

  it('批注草稿 Esc：非脏直接收表单 + 焦点回「添加批注」；脏稿先弹 DiscardDialog（W12 R12-02 + 批69 守卫）', async () => {
    const ast = sampleMethod as unknown as Ast
    const doc = Array.from({ length: 6 }, (_, i) => `第${i + 1}行`).join('\n')
    useStudio.setState({ ast, content: doc })
    const el = await mount(<ReviewBody pid="p1" />)
    const v = makeView(doc)
    const l5 = v.state.doc.line(5)
    v.dispatch({ selection: { anchor: l5.from, head: l5.to } })
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-add-comment"]')!.click())
    const form = el.querySelector<HTMLFormElement>('[data-testid="review-draft"]')!
    expect(form.hasAttribute('data-esc-local')).toBe(true)
    // 非脏：Esc 直接收，不问
    await act(async () => form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    await act(async () => new Promise((r) => setTimeout(r, 20)))
    expect(el.querySelector('[data-testid="review-draft"]')).toBeNull()
    expect(document.querySelector('[data-testid="discard-dialog"]')).toBeNull()
    expect(document.activeElement?.getAttribute('data-testid')).toBe('review-add-comment')
    // 脏稿：Esc → DiscardDialog；留下保草稿，放弃才收
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-add-comment"]')!.click())
    const form2 = el.querySelector<HTMLFormElement>('[data-testid="review-draft"]')!
    await type(form2.querySelector<HTMLTextAreaElement>('textarea')!, '未发送')
    await act(async () => form2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(el.querySelector('[data-testid="review-draft"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="discard-dialog"]')).not.toBeNull()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="discard-stay"]')!.click())
    expect(el.querySelector('textarea')!.value).toBe('未发送')
    await act(async () => form2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="discard-confirm"]')!.click())
    expect(el.querySelector('[data-testid="review-draft"]')).toBeNull()
    expect(el.querySelector('[data-esc-local]')).toBeNull()
  })

  it('批69 标记「回复」换锚宿主守卫：脏稿在时改点另一标记先问，放弃后换新锚清空；非脏直接换', async () => {
    useStudio.setState({ marks: MARKS })
    const el = await mount(<ReviewBody pid="p1" />)
    const replyBtn = (id: string) =>
      [...el.querySelectorAll<HTMLElement>('[data-testid="review-mark"]')].find((r) => r.dataset.markId === id)!.querySelector<HTMLButtonElement>('button[aria-label^="回复"]')!
    await act(async () => replyBtn('i').click())
    const form = el.querySelector<HTMLFormElement>('[data-testid="review-draft"]')!
    expect(form).not.toBeNull()
    await type(form.querySelector<HTMLTextAreaElement>('textarea')!, '写到一半')
    // 脏稿时点另一标记的「回复」→ 宿主守卫先问
    await act(async () => replyBtn('d').click())
    expect(document.querySelector('[data-testid="discard-dialog"]')).not.toBeNull()
    // 留下：草稿仍在、锚仍是 i 的引文
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="discard-stay"]')!.click())
    expect(el.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('写到一半')
    // 放弃：换新锚，正文清空
    await act(async () => replyBtn('d').click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="discard-confirm"]')!.click())
    const form2 = el.querySelector<HTMLFormElement>('[data-testid="review-draft"]')!
    expect(form2).not.toBeNull()
    expect(form2.querySelector('textarea')!.value).toBe('')
    // 非脏：直接换锚不问
    await act(async () => replyBtn('s').click())
    expect(document.querySelector('[data-testid="discard-dialog"]')).toBeNull()
    expect(el.querySelector('[data-testid="review-draft"]')).not.toBeNull()
  })

  it('批69 批注卡回复脏稿守卫：Esc/取消先弹 DiscardDialog，放弃才收表单', async () => {
    useStudio.setState({ comments: [comment('a', { line: 4, block: 'X' })] })
    const el = await mount(<ReviewBody pid="p1" />)
    const card = el.querySelector<HTMLElement>('[data-testid="review-comment"]')!
    await act(async () => card.querySelector<HTMLButtonElement>('[data-testid="review-reply-open"]')!.click())
    const form = card.querySelector<HTMLElement>('[data-testid="review-reply-form"]')!
    await type(form.querySelector<HTMLTextAreaElement>('textarea')!, '回到一半')
    await act(async () => form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(card.querySelector('[data-testid="review-reply-form"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="discard-dialog"]')).not.toBeNull()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="discard-stay"]')!.click())
    expect(card.querySelector('textarea')!.value).toBe('回到一半')
    await act(async () => card.querySelector<HTMLButtonElement>('[data-testid="review-reply-form"] button[type="button"]')!.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="discard-confirm"]')!.click())
    expect(card.querySelector('[data-testid="review-reply-form"]')).toBeNull()
  })

  it('批注草稿已开后锚点失效（AST 重解析后该行不在任何块内）：提交禁用并显示引导，不发请求（W12 R3-02）', async () => {
    const addComment = vi.fn(async () => null)
    const ast = sampleMethod as unknown as Ast
    const doc = Array.from({ length: 6 }, (_, i) => `第${i + 1}行`).join('\n')
    useStudio.setState({ addComment, ast, content: doc })
    const el = await mount(<ReviewBody pid="p1" />)
    const v = makeView(doc)
    const l5 = v.state.doc.line(5)
    v.dispatch({ selection: { anchor: l5.from, head: l5.to } })
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-add-comment"]')!.click())
    const form = el.querySelector<HTMLFormElement>('[data-testid="review-draft"]')!
    await type(form.querySelector<HTMLTextAreaElement>('textarea')!, '这里要改')
    expect(form.querySelector<HTMLButtonElement>('[data-testid="review-draft-submit"]')!.disabled).toBe(false)

    await act(async () => useStudio.setState({ ast: null }))
    expect(form.textContent).toContain('未定位')
    expect(form.querySelector('[data-testid="review-draft-unanchored"]')?.textContent).toContain('光标')
    expect(form.querySelector<HTMLButtonElement>('[data-testid="review-draft-submit"]')!.disabled).toBe(true)
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(addComment).not.toHaveBeenCalled()
    expect(await violations(el)).toEqual([])
  })

  it('批70 草稿上提 store：ReviewBody 卸载重挂（切 Tab / 关栏重开）不丢输入中的草稿与回复表单', async () => {
    useStudio.setState({ marks: MARKS, comments: [comment('a', { line: 4, block: 'X' })] })
    const el = await mount(<ReviewBody pid="p1" />)
    const replyBtn = [...el.querySelectorAll<HTMLElement>('[data-testid="review-mark"]')]
      .find((r) => r.dataset.markId === 'i')!.querySelector<HTMLButtonElement>('button[aria-label^="回复"]')!
    await act(async () => replyBtn.click())
    await type(el.querySelector<HTMLTextAreaElement>('[data-testid="review-draft-body"]')!, '宿主卸载前的输入')
    const card = el.querySelector<HTMLElement>('[data-testid="review-comment"]')!
    await act(async () => card.querySelector<HTMLButtonElement>('[data-testid="review-reply-open"]')!.click())
    await type(card.querySelector<HTMLTextAreaElement>('[data-testid="review-reply-body"]')!, '回复到一半')
    expect(useStudio.getState().commentDraft?.body).toBe('宿主卸载前的输入')
    expect(useStudio.getState().replyBodies['a']).toBe('回复到一半')
    // 宿主卸载——与切 Tab / 关栏重开同生命周期
    await act(async () => root?.unmount())
    root = null
    host.remove()
    const el2 = await mount(<ReviewBody pid="p1" />)
    expect(el2.querySelector<HTMLTextAreaElement>('[data-testid="review-draft-body"]')!.value).toBe('宿主卸载前的输入')
    expect(el2.querySelector<HTMLTextAreaElement>('[data-testid="review-reply-body"]')!.value).toBe('回复到一半')
    expect(await violations(el2)).toEqual([])
  })
})
