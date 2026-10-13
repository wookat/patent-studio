import { describe, expect, it } from 'vitest'
import type { CriticMark } from '@/lib/types'
import type { Ast } from '@/types/ast'
import { clusterMarks, clusterSummary, groupMarks, markContext, stripCritic } from '../reviewUtils'
import { applyMarks } from '@/store/review'

/** 与后端 critic.parse 同口径：from/to 含标记符，final/original 为接受 / 拒绝后的替换文本 */
function parse(line: string, lineNo = 1): CriticMark[] {
  const re = /\{\+\+(.*?)\+\+\}|\{--(.*?)--\}|\{~~(.*?)~>(.*?)~~\}|\{>>(.*?)<<\}|\{==(.*?)==\}/g
  const out: CriticMark[] = []
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const from = m.index
    const to = from + m[0].length
    const id = `${lineNo}:${from}`
    if (m[1] !== undefined) out.push({ id, kind: 'ins', line: lineNo, from, to, a: '', b: m[1], final: m[1], original: '' })
    else if (m[2] !== undefined) out.push({ id, kind: 'del', line: lineNo, from, to, a: m[2], b: '', final: '', original: m[2] })
    else if (m[3] !== undefined) out.push({ id, kind: 'sub', line: lineNo, from, to, a: m[3], b: m[4]!, final: m[4]!, original: m[3] })
    else if (m[5] !== undefined) out.push({ id, kind: 'comment', line: lineNo, from, to, a: m[5], b: '', final: '', original: '' })
    else out.push({ id, kind: 'mark', line: lineNo, from, to, a: m[6]!, b: '', final: m[6]!, original: m[6]! })
  }
  return out
}

describe('clusterMarks：同一逻辑修订的相邻标记合成一张卡', () => {
  it('`{--旧--}{++新++}` → 一张 sub 卡，a=旧 b=新', () => {
    const cs = clusterMarks(parse('模型采用 {--CNN--}{++Transformer++} 结构'))
    expect(cs).toHaveLength(1)
    expect(cs[0]!.kind).toBe('sub')
    expect(cs[0]!.a).toBe('CNN')
    expect(cs[0]!.b).toBe('Transformer')
    expect(cs[0]!.marks).toHaveLength(2)
    expect(clusterSummary(cs[0]!)).toBe('CNN → Transformer')
  })

  it('版面里一次下标格式化产生的碎片 `{++_{++}2{++}++}` → 一张 ins 卡，b=_{2}', () => {
    const line = 'H{++_{++}2{++}++}O'
    expect(clusterMarks(parse(line))).toHaveLength(2)
    const cs = clusterMarks(parse(line), () => line)
    expect(cs).toHaveLength(1)
    expect(cs[0]!.kind).toBe('ins')
    expect(cs[0]!.b).toBe('_{2}')
    expect(cs[0]!.a).toBe('2')
    expect(clusterSummary(cs[0]!)).toBe('下标：2')
    // 版面「选中 → 下标」实际生成的是替换标记，同样识别为格式
    const sub = clusterMarks(parse('C{~~129~>_{129}~~}H'))
    expect(sub).toHaveLength(1)
    expect(clusterSummary(sub[0]!)).toBe('下标：129')
    expect(clusterSummary(clusterMarks(parse('{~~**粗**~>粗~~}'))[0]!)).toBe('去掉加粗：粗')
    // 接受整簇 = 与逐条接受相同的文字结果
    expect(applyMarks(line, cs[0]!.marks, 'final')).toBe('H_{2}O')
    expect(applyMarks(line, cs[0]!.marks, 'original')).toBe('H2O')
  })

  it('不相邻 / 不同行 / comment·mark 不合并；非格式包裹的间隔不合并', () => {
    const l1 = '{++a++} x {++b++}'
    const l2 = '{--c--}{>>批<<}{==高==}'
    const cs = clusterMarks([...parse(l1, 1), ...parse(l2, 2)], (n) => (n === 1 ? l1 : l2))
    expect(cs.map((c) => [c.line, c.kind])).toEqual([
      [1, 'ins'],
      [1, 'ins'],
      [2, 'del'],
      [2, 'comment'],
      [2, 'mark'],
    ])
  })

  it('全 del 相邻 → del；全 ins 相邻 → ins；作者 / 时间取簇内首个有记录者', () => {
    const marks = parse('{--a--}{--b--}')
    marks[0]!.author = null
    marks[0]!.at = null
    marks[1]!.author = '张代理'
    marks[1]!.at = 1_700_000_000
    const [c] = clusterMarks(marks)
    expect(c!.kind).toBe('del')
    expect(c!.a).toBe('ab')
    expect(c!.author).toBe('张代理')
    expect(c!.at).toBe(1_700_000_000)
    expect(clusterSummary(c!)).toBe('− ab')
  })

  it('乱序输入按行 / 列排序后再合并', () => {
    const ms = parse('{--x--}{++y++}')
    const [c] = clusterMarks([ms[1]!, ms[0]!])
    expect(c!.kind).toBe('sub')
    expect(c!.from).toBe(0)
  })
})

describe('markContext / stripCritic：卡片上下文是可读正文，不是标记', () => {
  it('去掉 CriticMarkup 只留接受后的字', () => {
    expect(stripCritic('a {++b++} c {--d--} e {~~f~>g~~} h {>>i<<} j {==k==}')).toBe('a b c  e g h  j k')
  })

  it('前后各取一小段，去行首 Markdown 记号，超长省略', () => {
    const line = '1. 一种时间序列预测模型，其特征在于{--CNN--}{++Transformer++}编码器与解码器堆叠而成'
    const [c] = clusterMarks(parse(line))
    const ctx = markContext(line, c!, 6)
    expect(ctx.before).toBe('…，其特征在于')
    expect(ctx.after).toBe('编码器与解码…')
    expect(ctx.before).not.toContain('{')
    expect(ctx.after).not.toContain('}')
    expect(markContext(undefined, c!)).toEqual({ before: '', after: '' })
  })

  it('上下文里的其他标记也被折成正文', () => {
    const line = '{++甲++}乙{--丙--}丁'
    const cs = clusterMarks(parse(line))
    expect(cs).toHaveLength(2)
    expect(markContext(line, cs[1]!).before).toBe('甲乙')
  })
})

describe('groupMarks：按所属块（权利要求 N / 段落 [nnnn]）分组', () => {
  const ast = {
    books: { abstract: { offset: 0 }, claims: { offset: 0 }, description: { offset: 0 } },
    abstract: { id: 'abs', kind: 'paragraph', lines: { start: 1, end: 1 } },
    claims: [
      { id: 'c1', num: 1, lines: { start: 3, end: 3 } },
      { id: 'c3', num: 3, lines: { start: 5, end: 5 } },
    ],
    description: [{ id: 'd1', kind: 'paragraph', para_no: 12, lines: { start: 7, end: 7 } }],
  } as unknown as Ast

  it('同块多簇进同一组，组按首行排序', () => {
    const cs = clusterMarks([...parse('{++x++} q {++y++}', 5), ...parse('{--z--}', 1)])
    const gs = groupMarks(ast, cs)
    expect(gs.map((g) => [g.blockId, g.items.length])).toEqual([
      ['abs', 1],
      ['c3', 2],
    ])
  })

  it('无 AST 时归入未定位组', () => {
    const gs = groupMarks(null, clusterMarks(parse('{++x++}', 9)))
    expect(gs).toHaveLength(1)
    expect(gs[0]!.blockId).toBe('')
  })
})
