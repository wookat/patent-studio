import { describe, expect, it } from 'vitest'
import { bookSchema } from '../bookSchema'
import { parseInline, scriptSource, serializeInline } from '../inline'

type Tok = [text: string, marks: string[]]
const toks = (s: string, subExcept?: string[]): Tok[] => {
  const out: Tok[] = []
  parseInline(s, { subExcept }).forEach((n) => out.push([n.text ?? '', n.marks.map((m) => m.type.name).sort()]))
  return out
}
const rt = (s: string) => serializeInline(parseInline(s))

describe('parseInline：INLINE_SPEC 五种标记', () => {
  it('粗体 / 斜体 / 下划线 / 下标 / 上标', () => {
    expect(toks('a **b** c')).toEqual([['a ', []], ['b', ['strong']], [' c', []]])
    expect(toks('a *b* c')).toEqual([['a ', []], ['b', ['em']], [' c', []]])
    expect(toks('a <u>b</u> c')).toEqual([['a ', []], ['b', ['underline']], [' c', []]])
    expect(toks('x_t 与 x_{s∈M_t} 与 x_[k]')).toEqual([
      ['x', []], ['t', ['subscript']], [' 与 x', []], ['s∈M_t', ['subscript']], [' 与 x', []], ['[k]', ['subscript']],
    ])
    expect(toks('x^2 + y^{n+1}')).toEqual([['x', []], ['2', ['superscript']], [' + y', []], ['n+1', ['superscript']]])
  })

  it('`**` 优先于 `*`；`*` 内侧不得是空白；未闭合按字面', () => {
    expect(toks('**a**')).toEqual([['a', ['strong']]])
    expect(toks('**a** 与 *b*')).toEqual([['a', ['strong']], [' 与 ', []], ['b', ['em']]])
    expect(toks('a * b * c')).toEqual([['a * b * c', []]])
    expect(toks('** a **')).toEqual([['** a **', []]])
    expect(toks('a **b')).toEqual([['a **b', []]])
    expect(toks('*a')).toEqual([['*a', []]])
    expect(toks('2 * 3 = 6')).toEqual([['2 * 3 = 6', []]])
  })

  it('嵌套：**a_{2}** / **<u>a</u>** / *a_b*；下标内不再解析；em 内不再解析 `*`', () => {
    expect(toks('**a_{2}**')).toEqual([['a', ['strong']], ['2', ['strong', 'subscript']]])
    expect(toks('**<u>a</u>**')).toEqual([['a', ['strong', 'underline']]])
    expect(toks('*x_b*')).toEqual([['x', ['em']], ['b', ['em', 'subscript']]])
    expect(toks('_{a*b*c}')).toEqual([['a*b*c', ['subscript']]])
    expect(toks('*a **b** c*')).toEqual([['*a ', []], ['b', ['strong']], [' c*', []]])
  })

  it('下标与上标互斥：mark 集合不含两者', () => {
    const f = parseInline('x_{a^2}')
    f.forEach((n) => expect(n.marks.filter((m) => m.type.name === 'subscript' || m.type.name === 'superscript').length).toBeLessThanOrEqual(1))
    const sub = bookSchema.marks.subscript.create()
    const sup = bookSchema.marks.superscript.create()
    expect(sup.addToSet([sub]).map((m) => m.type.name)).toEqual(['superscript'])
  })

  it('_SUB_RE 边界：`_` 后无合法 token 按字面；中文白名单；逗号列表；sub_except', () => {
    expect(toks('a_ b')).toEqual([['a_ b', []]])
    expect(toks('a_（b）')).toEqual([['a_（b）', []]])
    expect(toks('x_检索')).toEqual([['x', []], ['检索', ['subscript']]])
    expect(toks('x_t,c 与')).toEqual([['x', []], ['t,c', ['subscript']], [' 与', []]])
    expect(toks('x_t,')).toEqual([['x', []], ['t', ['subscript']], [',', []]])
    expect(toks('tsf_guard 与 x_t', ['tsf_guard'])).toEqual([['tsf_guard 与 x', []], ['t', ['subscript']]])
    expect(toks('^^')).toEqual([['^^', []]])
  })
})

describe('serializeInline：逐字节往返与规范化', () => {
  it.each([
    'plain 文本',
    '**粗体** 与 *斜体* 与 <u>下划线</u>',
    '**a_{2}**',
    'x_t,c 与 x_{s∈M_t} 与 x_[k] 与 x_检索',
    'x^2 + y^{n+1}',
    'a * b * c ** d',
    '_{λ∈Λ}',
    '**<u>a</u>** 与 *x_b*',
    'a_ b 与 2 * 3 = 6',
  ])('往返 %s', (s) => {
    expect(rt(s)).toBe(s)
  })

  it('用户新打的下 / 上标（无 src）：单字母数字 `_x`，其余 `_{…}`', () => {
    const sub = (t: string) => bookSchema.text(t, [bookSchema.marks.subscript.create()])
    const sup = (t: string) => bookSchema.text(t, [bookSchema.marks.superscript.create()])
    expect(serializeInline([bookSchema.text('x'), sub('t')])).toBe('x_t')
    expect(serializeInline([bookSchema.text('x'), sub('t,c')])).toBe('x_{t,c}')
    expect(serializeInline([bookSchema.text('x'), sub('ab')])).toBe('x_{ab}')
    expect(serializeInline([bookSchema.text('x'), sup('2'), bookSchema.text('+'), sup('n+1')])).toBe('x^2+^{n+1}')
    expect(scriptSource('_', 'tt', 't')).toBe('_{tt}')
    expect(scriptSource('_', 't,c', 't,c')).toBe('_t,c')
    expect(scriptSource('_', '[k]', '[k]')).toBe('_[k]')
  })

  it('W9 domain-01：裸 token 后紧跟字母数字会被内核多吃 → 写 `_{…}`（H2O 只选 2 → H_{2}O，而非 H_2O）', () => {
    const sub = (t: string, src: string | null = null) => bookSchema.text(t, [bookSchema.marks.subscript.create({ src })])
    const sup = (t: string, src: string | null = null) => bookSchema.text(t, [bookSchema.marks.superscript.create({ src })])
    expect(serializeInline([bookSchema.text('水H'), sub('2'), bookSchema.text('O')])).toBe('水H_{2}O')
    expect(serializeInline([bookSchema.text('m/s'), sup('2'), sub('2')])).toBe('m/s^2_2')
    expect(serializeInline([bookSchema.text('x'), sub('2'), bookSchema.text(',3 与')])).toBe('x_{2},3 与')
    expect(serializeInline([bookSchema.text('x'), sub('t'), bookSchema.text(', 与')])).toBe('x_t, 与')
    // 有 src 的既有下标后面新打字母 → 同样改花括号；后面是中文 / 空白 → 原样
    expect(serializeInline([bookSchema.text('CO'), sub('2', '2'), bookSchema.text('e')])).toBe('CO_{2}e')
    expect(serializeInline([bookSchema.text('x'), sub('t', 't'), bookSchema.text('时刻')])).toBe('x_t时刻')
    // 花括号 / 方括号 src 无歧义
    expect(serializeInline([bookSchema.text('x'), sub('[k]', '[k]'), bookSchema.text('1')])).toBe('x_[k]1')
    // 往返：序列化结果再解析只把 2 作下标
    expect(toks('水H_{2}O')).toEqual([['水H', []], ['2', ['subscript']], ['O', []]])
    expect(scriptSource('_', '2', null, 'O')).toBe('_{2}')
    expect(scriptSource('_', '2', null, '')).toBe('_2')
  })

  it('规范嵌套：strong > em > underline；非规范写法序列化为等价规范形', () => {
    expect(rt('<u>**a**</u>')).toBe('**<u>a</u>**')
    expect(toks(rt('<u>**a**</u>'))).toEqual(toks('<u>**a**</u>'))
    const doc = bookSchema.nodes.ps_para.create(null, parseInline('**a** *b* <u>c</u> d_1 e^2'))
    expect(serializeInline(doc.content)).toBe('**a** *b* <u>c</u> d_1 e^2')
  })

  it('W9 ux-01：粗斜体在粗体跨度边缘写 `***x***`（内核 bi 分支），不产生内核切错的 `**a*b***`', () => {
    const b = (t: string) => bookSchema.text(t, [bookSchema.marks.strong.create()])
    const i = (t: string) => bookSchema.text(t, [bookSchema.marks.em.create()])
    const bi = (t: string) => bookSchema.text(t, [bookSchema.marks.strong.create(), bookSchema.marks.em.create()])
    const biu = (t: string) => bookSchema.text(t, [bookSchema.marks.strong.create(), bookSchema.marks.em.create(), bookSchema.marks.underline.create()])
    // B → 输入「粗体测试」→ 选「测试」→ Ctrl+I（→ Ctrl+U）
    expect(serializeInline([b('粗体'), bi('测试')])).toBe('**粗体*****测试***')
    expect(serializeInline([b('粗体'), biu('测试')])).toBe('**粗体*****<u>测试</u>***')
    expect(serializeInline([bi('测试'), b('粗体')])).toBe('***测试*****粗体**')
    expect(serializeInline([bi('测试')])).toBe('***测试***')
    expect(serializeInline([i('a'), bi('b'), i('c')])).toBe('*a****b****c*')
    expect(serializeInline([b('a'), bi('b'), b('c')])).toBe('**a*b*c**')
    // 解析与内核 inline_tokens 逐字一致（见 backend/tests/test_inline.py 同名用例）
    expect(toks('**粗体*****测试***')).toEqual([['粗体', ['strong']], ['测试', ['em', 'strong']]])
    expect(toks('**粗体*****<u>测试</u>***')).toEqual([['粗体', ['strong']], ['测试', ['em', 'strong', 'underline']]])
    expect(toks('***测试*****粗体**')).toEqual([['测试', ['em', 'strong']], ['粗体', ['strong']]])
    expect(toks('***测试****粗体*')).toEqual([['测试', ['em', 'strong']], ['粗体', ['em']]])
    expect(toks('*a****b****c*')).toEqual([['a', ['em']], ['b', ['em', 'strong']], ['c', ['em']]])
    expect(toks('**a***b*')).toEqual([['a', ['strong']], ['b', ['em']]])
    for (const s of ['**粗体*****测试***', '***测试*****粗体**', '***测试****粗体*', '*a****b****c*', '**a*b*c**', '**a***b*', '***a***'])
      expect(rt(s)).toBe(s)
  })
})
