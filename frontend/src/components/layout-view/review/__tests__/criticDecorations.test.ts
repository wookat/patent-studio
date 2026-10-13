import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import { bookSchema } from '../../doc/bookSchema'
import { fromBookDoc } from '../../doc/fromBookDoc'
import { parseInline } from '../../doc/inline'
import {
  breaksSigil,
  criticDecorations,
  criticIds,
  criticKey,
  criticPosOf,
  setCriticActive,
  setCriticLevel,
} from '../criticDecorations'
import { projectDoc } from '../projectDoc'
import type { MarkupLevel } from '../markupLevel'

const para = (id: string, text: string) => bookSchema.nodes.ps_para!.create({ blockId: id, kind: 'para' }, parseInline(text))
const doc = (...ps: ReturnType<typeof para>[]) => bookSchema.nodes.doc!.create({ book: 'claims', lead: 1, trail: 1 }, ps)

const P1 = '一种装置，{++包括壳体，++}其特征在于{--多余--}'
const P2 = '连接件{~~旧~>新~~}固定{>>请核对<<}'

const mk = (level?: MarkupLevel, onActivate?: (id: string | null) => void) =>
  EditorState.create({ doc: doc(para('claims/1', P1), para('claims/2', P2)), plugins: [criticDecorations({ level, onActivate, lineOf: (_id, li) => (_id === 'claims/1' ? 3 : 5) + li })] })

type Deco = { from: number; to: number; cls: string; kind: string | null; id: string | null; widget: boolean }
const decos = (state: EditorState): Deco[] => {
  const set = criticKey.getState(state)!.decorations
  return set.find().map((d) => {
    const spec = d.spec as Record<string, unknown>
    const inline = d as unknown as { type: { attrs?: Record<string, string> } }
    const attrs = inline.type.attrs ?? {}
    return { from: d.from, to: d.to, cls: attrs.class ?? '', kind: attrs['data-critic-kind'] ?? null, id: (spec.criticId as string | undefined) ?? null, widget: typeof spec.key === 'string' }
  })
}
const textAt = (state: EditorState, d: Deco) => state.doc.textBetween(d.from, d.to)

describe('criticDecorations：装饰而不改 doc', () => {
  it('标记符隐藏（ps-critic-sym）、插入下划线 / 删除删除线 / 替换相邻 / 批注高亮；doc 文本原样、fromBookDoc 序列化含标记', () => {
    const st = mk('all')
    const ds = decos(st)
    const syms = ds.filter((d) => d.cls === 'ps-critic-sym').map((d) => textAt(st, d))
    expect(syms).toEqual(['{++', '++}', '{--', '--}', '{~~', '~>', '~~}', '{>>', '<<}'])
    const body = (cls: string) => ds.filter((d) => d.cls.startsWith(cls)).map((d) => textAt(st, d))
    expect(body('ps-critic-ins')).toEqual(['包括壳体，', '新'])
    expect(body('ps-critic-del')).toEqual(['多余', '旧'])
    expect(body('ps-critic-comment')).toEqual(['请核对'])
    // 替换：删除线段与下划线段相邻（中间只隔 `~>` 两个隐藏字符）
    const sub = ds.filter((d) => d.kind === 'sub' && !d.cls.includes('sym'))
    expect(sub.length).toBe(2)
    expect(sub[1]!.from - sub[0]!.to).toBe(2)
    expect(st.doc.textContent).toBe(P1 + P2)
    expect(fromBookDoc(st.doc)).toBe(`\n${P1}\n\n${P2}\n\n`)
  })

  it('每个含标记的 textblock 有一个左边距竖线 widget；none / original 档无竖线', () => {
    expect(decos(mk('all')).filter((d) => d.widget).length).toBe(2)
    expect(decos(mk('simple')).filter((d) => d.widget).length).toBe(2)
    expect(decos(mk('none')).filter((d) => d.widget).length).toBe(0)
    expect(decos(mk('original')).filter((d) => d.widget).length).toBe(0)
  })

  it('id 与 store.review CriticMark.id（`line:from`）同口径；criticPosOf 给出卡片 → 正文的文档区间', () => {
    const st = mk('all')
    expect(criticIds(st)).toEqual([`3:${P1.indexOf('{++')}`, `3:${P1.indexOf('{--')}`, `5:${P2.indexOf('{~~')}`, `5:${P2.indexOf('{>>')}`])
    const pos = criticPosOf(st, '5:3')!
    expect(st.doc.textBetween(pos.from, pos.to)).toBe('旧~>新')
    expect(criticPosOf(st, 'nope')).toBeNull()
  })

  it('setCriticLevel 切档：simple 隐藏删除侧、正文只留 final；original 隐藏插入侧；setCriticActive 只给该 id 加 ps-critic-active', () => {
    let st = mk('all')
    st = st.apply(setCriticLevel(st.tr, 'simple'))
    const hidden = decos(st).filter((d) => d.cls === 'ps-critic-sym').map((d) => textAt(st, d))
    expect(hidden).toContain('多余')
    expect(hidden).toContain('旧')
    expect(hidden).toContain('请核对')
    expect(hidden).not.toContain('包括壳体，')
    expect(decos(st).some((d) => d.cls.startsWith('ps-critic-ins'))).toBe(false)
    st = st.apply(setCriticLevel(st.tr, 'original'))
    const hid2 = decos(st).filter((d) => d.cls === 'ps-critic-sym').map((d) => textAt(st, d))
    expect(hid2).toContain('包括壳体，')
    expect(hid2).toContain('新')
    expect(hid2).not.toContain('多余')
    const delId = `3:${P1.indexOf('{--')}`
    st = st.apply(setCriticActive(setCriticLevel(st.tr, 'all'), delId))
    const active = decos(st).filter((d) => d.cls.includes('ps-critic-active'))
    expect(active.map((d) => d.id)).toEqual([delId])
    expect(textAt(st, active[0]!)).toBe('多余')
  })

  it('filterTransaction：不能把标记符打碎（删一半 `{+`、在 `{++` 中间插入）；整段删除 / 标记外编辑放行', () => {
    const st = mk('all')
    const base = 1 // doc → 首段内容起点
    const open = base + P1.indexOf('{++')
    // 删 `{+`（部分覆盖开口符）
    const bad1 = st.tr.delete(open, open + 2)
    expect(st.applyTransaction(bad1).transactions.length).toBe(0)
    // 在 `{+|+` 中插入
    const bad2 = st.tr.insertText('x', open + 2)
    expect(st.applyTransaction(bad2).transactions.length).toBe(0)
    // 光标进入标记内部后退格删到边界（删除 `+}` 的最后一个 `}` 的一半 → 拒绝）
    const close = base + P1.indexOf('++}')
    const bad3 = st.tr.delete(close + 2, close + 3)
    expect(st.applyTransaction(bad3).transactions.length).toBe(0)
    // 整个 span 一起删（完全包含标记符）→ 放行
    const spanEnd = close + 3
    const ok1 = st.tr.delete(open, spanEnd)
    const r1 = st.applyTransaction(ok1)
    expect(r1.transactions.length).toBe(1)
    expect(r1.state.doc.textContent.startsWith('一种装置，其特征在于')).toBe(true)
    // 标记内文编辑 → 放行，装饰随文本重算
    const ok2 = st.tr.insertText('新', open + 3)
    const r2 = st.applyTransaction(ok2)
    expect(r2.transactions.length).toBe(1)
    expect(decos(r2.state).filter((d) => d.cls.startsWith('ps-critic-ins')).map((d) => textAt(r2.state, d))).toEqual(['新包括壳体，', '新'])
    // 标记外普通输入 → 放行
    const ok3 = st.tr.setSelection(TextSelection.create(st.doc, base)).insertText('权利要求：')
    expect(st.applyTransaction(ok3).transactions.length).toBe(1)
  })

  it('breaksSigil：纯函数边界表', () => {
    const r: [number, number][] = [[10, 13]]
    expect(breaksSigil(r, 10, 13)).toBe(false) // 恰好覆盖
    expect(breaksSigil(r, 5, 20)).toBe(false) // 完全包含
    expect(breaksSigil(r, 11, 12)).toBe(true) // 内部
    expect(breaksSigil(r, 8, 11)).toBe(true) // 跨左边界
    expect(breaksSigil(r, 12, 15)).toBe(true) // 跨右边界
    expect(breaksSigil(r, 11, 11)).toBe(true) // 内部纯插入
    expect(breaksSigil(r, 10, 10)).toBe(false) // 端点插入
    expect(breaksSigil(r, 13, 13)).toBe(false)
    expect(breaksSigil(r, 0, 10)).toBe(false)
  })

  it('onActivate：宿主回调收到点击到的 id（handleClickOn 语义由 view 层触发，这里直接验证元数据路径）', () => {
    const spy = vi.fn()
    let st = mk('all', spy)
    st = st.apply(setCriticActive(st.tr, '3:5'))
    expect(criticKey.getState(st)!.activeId).toBe('3:5')
    st = st.apply(setCriticActive(st.tr, null))
    expect(criticKey.getState(st)!.activeId).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('projectDoc：只读投影（simple / none = accept；original = reject；marks 逐字符保留）', () => {
  const bold = bookSchema.nodes.ps_para!.create({ blockId: 'd/1', kind: 'para' }, parseInline('前{++**粗**体++}后{--x_{2}--}'))
  const d = doc(bold, para('d/2', P2))

  it('all 返回原 doc；其余档位文本等于 acceptCritic / rejectCritic', () => {
    expect(projectDoc(d, 'all')).toBe(d)
    expect(projectDoc(d, 'none').textContent).toBe('前粗体后' + '连接件新固定')
    expect(projectDoc(d, 'simple').textContent).toBe('前粗体后' + '连接件新固定')
    expect(projectDoc(d, 'original').textContent).toBe('前后x_{2}'.replace('x_{2}', 'x2') + '连接件旧固定')
  })

  it('投影保留 strong / subscript marks 与块 attrs；原 doc 不变', () => {
    const p = projectDoc(d, 'none').child(0)
    expect(p.attrs).toEqual({ blockId: 'd/1', kind: 'para' })
    const marks: string[][] = []
    p.forEach((n) => marks.push(n.marks.map((m) => m.type.name)))
    expect(marks).toEqual([[], ['strong'], []])
    const o = projectDoc(d, 'original').child(0)
    const om: [string, string[]][] = []
    o.forEach((n) => om.push([n.text ?? '', n.marks.map((m) => m.type.name)]))
    expect(om).toEqual([['前后x', []], ['2', ['subscript']]])
    expect(d.child(0).textContent).toBe('前**粗**体后x2'.replace('**粗**', '粗').replace('前粗体后x2', '前{++粗体++}后{--x2--}'))
  })

  it('无标记的块原样复用（同一 node 实例）', () => {
    const plain = para('p/1', '无标记')
    const dd = doc(plain, para('p/2', P1))
    expect(projectDoc(dd, 'none').child(0)).toBe(plain)
    expect(projectDoc(dd, 'none').child(1).textContent).toBe('一种装置，包括壳体，其特征在于')
  })
})

describe('格式变更（选中 → 下标 生成 {~~129~>_{129}~~}，进 doc 后两侧文字同为 129 只差 mark）像 Word 一样显示', () => {
  // toBookDoc 走 parseInline：源码 `{~~129~>_{129}~~}` 在 doc 里是 `{~~129~>` + 129(subscript) + `~~}`
  const P = '误差为1.{~~129~>129~~}，劣于{~~方法~>装置~~}'
  const st = (level: MarkupLevel) => EditorState.create({ doc: doc(para('description/p5', P)), plugins: [criticDecorations({ level })] })

  it('all：原文 129 隐藏不画删除线，改格式后的 129 标 ps-critic-fmt；普通替换仍是删除线 + 下划线', () => {
    const s = st('all')
    const ds = decos(s)
    const hidden = ds.filter((d) => d.cls === 'ps-critic-sym').map((d) => textAt(s, d))
    expect(hidden).toContain('129')
    expect(ds.filter((d) => d.cls.includes('ps-critic-fmt')).map((d) => textAt(s, d))).toEqual(['129'])
    expect(ds.filter((d) => d.cls.startsWith('ps-critic-del')).map((d) => textAt(s, d))).toEqual(['方法'])
    expect(ds.filter((d) => d.cls.startsWith('ps-critic-ins')).map((d) => textAt(s, d))).toEqual(['装置'])
  })

  it('none / original：修订样式退为 plain；original 下隐藏的是改格式侧、原文 129 可见', () => {
    const n = st('none')
    expect(decos(n).some((d) => d.cls.includes('ps-critic-fmt') || d.cls.startsWith('ps-critic-del'))).toBe(false)
    const o = st('original')
    const od = decos(o)
    const hiddenO = od.filter((d) => d.cls === 'ps-critic-sym')
    expect(hiddenO.filter((d) => textAt(o, d) === '129')).toHaveLength(1)
    // 隐藏的 129 位于 ~> 之后（改格式侧）
    const arrow = od.find((d) => d.cls === 'ps-critic-sym' && textAt(o, d) === '~>')!
    expect(hiddenO.find((d) => textAt(o, d) === '129')!.from).toBeGreaterThan(arrow.from)
  })
})
