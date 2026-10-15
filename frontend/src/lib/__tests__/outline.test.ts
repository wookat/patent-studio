import { describe, expect, it } from 'vitest'
import goldenMethod from '../../../../backend/tests/golden/ast_method.json'
import goldenSystem from '../../../../backend/tests/golden/ast_system.json'
import sampleSystem from '../../../../backend/tests/fixtures/ast_sample_system.json'
import type { Ast } from '@/types/ast'
import {
  EMPTY_OUTLINE, REQUIRED_SECTIONS, ancestorsOf, buildOutline, defaultCollapsed, firstSentence, isCollapsed, locateLine, nodeLine,
  paragraphAtLine, toOutlineNodes, type OutlineModel,
} from '../outline'
import { SYNTH_AST } from './astFixture'

const method = goldenMethod as unknown as Ast
const system = goldenSystem as unknown as Ast
/** prep 手写片段（仅具体实施方式一章），用于缺失章节占位断言 */
const partialSystem = sampleSystem as unknown as Ast

/** Map 不能进 JSON，golden 里转成有序对象 */
const golden = (m: OutlineModel) => JSON.stringify({ ...m, nodeOfBlock: Object.fromEntries(m.nodeOfBlock) }, null, 2)

describe('buildOutline · golden（两案后端 golden parse_ast 输出 + 合成 AST）', () => {
  it('examples/method', async () => {
    await expect(golden(buildOutline(method))).toMatchFileSnapshot('./__golden__/outline.method.json')
  })
  it('examples/system', async () => {
    await expect(golden(buildOutline(system))).toMatchFileSnapshot('./__golden__/outline.system.json')
  })
  it('合成 AST', async () => {
    await expect(golden(buildOutline(SYNTH_AST))).toMatchFileSnapshot('./__golden__/outline.synth.json')
  })
  it('ast 为 null → 空模型（各书 null，不抛）', () => {
    expect(buildOutline(null)).toBe(EMPTY_OUTLINE)
    expect(toOutlineNodes(EMPTY_OUTLINE)).toEqual([])
    expect(locateLine(null, EMPTY_OUTLINE, 10)).toBeNull()
    expect(paragraphAtLine(null, 10)).toBeNull()
  })
})

describe('buildOutline · 层级与标签（合成 AST）', () => {
  const o = buildOutline(SYNTH_AST)

  it('书级行区间 = `## ` 标题行 … offset+length（全文行号）', () => {
    expect(o.title).toEqual({ text: '一种控制方法', line: 1 })
    expect(o.abstract).toEqual({ line: 3, end: 6 })
    expect(o.claims).toMatchObject({ line: 7, end: 17 })
    expect(o.description).toMatchObject({ line: 18, end: 59, paragraphs: 11 })
  })

  it('权项：编号 / 首句截断 / 独从（来自 claim_kind）/ 引用（来自 refs.targets，前向引用进 badRefs）', () => {
    expect(o.claims!.items.map((c) => [c.num, c.text, c.dependent, c.refs, c.badRefs, c.line])).toEqual([
      [1, '一种控制方法，其特征在于，包括以下步骤', false, [], [], 9],
      [2, '根据权利要求1所述的方法，其特征在于，所述漂移分…', true, [1], [], 11],
      [3, '根据权利要求1或2所述的方法，其特征在于，还包括…', true, [1, 2], [], 13],
      [4, '根据权利要求5所述的方法，其特征在于，所述告警为…', true, [5], [5], 15],
    ])
    expect(o.claims!.items[0].id).toBe('claims/1')
    expect(o.claims!.items[0].full.startsWith('一种控制方法')).toBe(true)
  })

  it('说明书：章节 → 小节 → 叶子；段落不成节点', () => {
    const secs = o.description!.sections
    expect(secs.map((s) => [s.name, s.part, s.line, s.end, s.firstPara, s.lastPara])).toEqual([
      ['技术领域', 'technical-field', 20, 23, 1, 1],
      ['背景技术', 'background-art', 24, 27, 2, 2],
      ['发明内容', 'disclosure', 28, 39, 3, 4],
      ['附图说明', 'description-of-drawings', 40, 45, 5, 6],
      ['具体实施方式', 'mode-for-invention', 46, 55, 7, 10],
      ['工业实用性', 'other', 56, 59, 11, 11],
    ])
    const disclosure = secs[2]
    expect(disclosure.subsections.map((x) => [x.name, x.line, x.end])).toEqual([
      ['技术方案', 30, 35],
      ['有益效果', 36, 39],
    ])
    expect(disclosure.subsections[0].leaves).toEqual([
      { id: 'description/发明内容/技术方案/eq1', kind: 'equation', line: 34, label: '公式 (1)', tag: '(1)', paraNo: 3 },
    ])
    expect(disclosure.leaves).toEqual([])
    const drawings = secs[3]
    expect(drawings.leaves.map((l) => [l.id, l.kind, l.line, l.label, l.tag])).toEqual([
      ['figures/3', 'figure', 40, '图3', 'fig3.svg'],
      ['figures/1', 'figure', 42, '图1 本发明实施例的总体流程图', 'fig1.svg'],
      ['figures/2', 'figure', 44, '图2 漂移分数曲线示意图', 'fig2.svg'],
    ])
    const impl = secs[4]
    expect(impl.leaves).toEqual([{ id: 'description/具体实施方式/p0008', kind: 'table', line: 50, label: '表1 阈值表', tag: '[0008]', paraNo: 8 }])
    expect(o.description!.leaves).toEqual([])
  })

  it('块 id → 大纲节点：段落归小节 / 章节，题注段归图，表 / 公式归自身', () => {
    const n = o.nodeOfBlock
    expect(n.get('abstract/p1')).toBe('abstract')
    expect(n.get('claims/3')).toBe('claims/3')
    expect(n.get('description/技术领域/p0001')).toBe('description/技术领域')
    expect(n.get('description/发明内容/技术方案/p0003')).toBe('description/发明内容/技术方案')
    expect(n.get('description/发明内容/技术方案/eq1')).toBe('description/发明内容/技术方案/eq1')
    expect(n.get('description/附图说明/p0005')).toBe('figures/1')
    expect(n.get('description/具体实施方式/p0007')).toBe('description/具体实施方式')
    expect(n.get('description/具体实施方式/p0008')).toBe('description/具体实施方式/p0008')
  })
})

describe('光标 / 行定位', () => {
  const o = buildOutline(SYNTH_AST)
  it('locateLine：书标题行归书；空行归前一个块所属节点；书外 null', () => {
    expect(locateLine(SYNTH_AST, o, 1)).toBeNull()
    expect(locateLine(SYNTH_AST, o, 3)).toBe('abstract')
    expect(locateLine(SYNTH_AST, o, 5)).toBe('abstract')
    expect(locateLine(SYNTH_AST, o, 7)).toBe('claims')
    expect(locateLine(SYNTH_AST, o, 8)).toBe('claims')
    expect(locateLine(SYNTH_AST, o, 9)).toBe('claims/1')
    expect(locateLine(SYNTH_AST, o, 12)).toBe('claims/2')
    expect(locateLine(SYNTH_AST, o, 18)).toBe('description')
    expect(locateLine(SYNTH_AST, o, 22)).toBe('description/技术领域')
    expect(locateLine(SYNTH_AST, o, 32)).toBe('description/发明内容/技术方案')
    expect(locateLine(SYNTH_AST, o, 34)).toBe('description/发明内容/技术方案/eq1')
    expect(locateLine(SYNTH_AST, o, 42)).toBe('figures/1')
    expect(locateLine(SYNTH_AST, o, 51)).toBe('description/具体实施方式/p0008')
    expect(locateLine(SYNTH_AST, o, 58)).toBe('description/工业实用性')
    expect(locateLine(SYNTH_AST, o, 999)).toBeNull()
  })
  it('paragraphAtLine：编号段 / 表（含多行）/ 非编号行 null', () => {
    expect(paragraphAtLine(SYNTH_AST, 22)).toBe(1)
    expect(paragraphAtLine(SYNTH_AST, 32)).toBe(3)
    expect(paragraphAtLine(SYNTH_AST, 51)).toBe(8)
    expect(paragraphAtLine(SYNTH_AST, 52)).toBe(8)
    expect(paragraphAtLine(SYNTH_AST, 34)).toBeNull()
    expect(paragraphAtLine(SYNTH_AST, 28)).toBeNull()
    expect(paragraphAtLine(SYNTH_AST, 9)).toBeNull()
    expect(paragraphAtLine(SYNTH_AST, 33)).toBeNull()
  })
  it('nodeLine / ancestorsOf', () => {
    expect(nodeLine(o, 'claims/2')).toBe(11)
    expect(nodeLine(o, 'description/发明内容/技术方案/eq1')).toBe(34)
    expect(nodeLine(o, 'figures/2')).toBe(44)
    expect(nodeLine(o, 'nope')).toBeNull()
    expect(ancestorsOf(o, 'claims/2')).toEqual(['claims'])
    expect(ancestorsOf(o, 'description/发明内容')).toEqual(['description'])
    expect(ancestorsOf(o, 'description/发明内容/技术方案')).toEqual(['description', 'description/发明内容'])
    expect(ancestorsOf(o, 'description/发明内容/技术方案/eq1')).toEqual(['description', 'description/发明内容', 'description/发明内容/技术方案'])
    expect(ancestorsOf(o, 'figures/1')).toEqual(['description', 'description/附图说明'])
    expect(ancestorsOf(o, 'abstract')).toEqual([])
  })
})

describe('折叠', () => {
  const o = buildOutline(SYNTH_AST)
  it('默认：发明内容 / 具体实施方式展开，有子项的其他章节与带叶子的小节折叠；无子项者不进集合', () => {
    expect([...defaultCollapsed(o)].sort()).toEqual(['description/发明内容/技术方案', 'description/附图说明'])
  })
  it('isCollapsed = 默认 XOR 用户切换过（outlineCollapsedIds 记录的是切换过的节点）', () => {
    const d = defaultCollapsed(o)
    expect(isCollapsed(d, [], 'description/附图说明')).toBe(true)
    expect(isCollapsed(d, ['description/附图说明'], 'description/附图说明')).toBe(false)
    expect(isCollapsed(d, [], 'claims')).toBe(false)
    expect(isCollapsed(d, ['claims'], 'claims')).toBe(true)
  })
})

describe('toOutlineNodes（doc.outline：状态栏路径）', () => {
  it('标题 → 摘要 → 权利要求书/权项(ref) → 说明书/五章节(缺失标 missing)+小节', () => {
    const nodes = toOutlineNodes(buildOutline(SYNTH_AST))
    expect(nodes.map((n) => n.kind)).toEqual(['title', 'abstract', 'claims', 'description'])
    const claims = nodes[2].children!
    expect(claims.map((c) => [c.id, c.label, c.ref])).toEqual([
      ['claims/1', '1', null], ['claims/2', '2', 1], ['claims/3', '3', 1], ['claims/4', '4', 5],
    ])
    const desc = nodes[3].children!
    expect(desc.map((s) => s.label)).toEqual([...REQUIRED_SECTIONS, '工业实用性'])
    expect(desc.every((s) => !s.missing)).toBe(true)
    expect(desc[2].children!.map((x) => x.id)).toEqual(['description/发明内容/技术方案', 'description/发明内容/有益效果'])
  })
  it('后端样例只含部分章节 → 缺失章节 missing 占位、行号落在说明书标题', () => {
    const desc = toOutlineNodes(buildOutline(partialSystem)).find((n) => n.id === 'description')!
    expect(desc.children!.map((s) => [s.label, s.missing ?? false])).toEqual([
      ['发明内容', true], ['附图说明', true], ['具体实施方式', true], ['技术领域', false], ['背景技术', false],
    ])
    expect(desc.children![0].line).toBe(partialSystem.books.description.offset)
  })
})

describe('firstSentence', () => {
  it('到首个 。；： 截断；超过 24 字加 …', () => {
    expect(firstSentence('一种方法。其特征')).toBe('一种方法')
    expect(firstSentence('一种方法；其特征')).toBe('一种方法')
    expect(firstSentence('x'.repeat(30))).toBe(`${'x'.repeat(24)}…`)
    expect(firstSentence('  短  ')).toBe('短')
  })
})
