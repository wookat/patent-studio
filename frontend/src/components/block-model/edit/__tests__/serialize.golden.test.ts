import { describe, expect, it } from 'vitest'
import { blockSource } from '@/store'
import type { Ast } from '@/types/ast'
import type { EditableBlock } from '../../slots'
import { fromDoc, serialize, toDoc } from '../serialize'
import { schema } from '../schema'
import astMethod from '../../../../../../backend/tests/golden/ast_method.json'
import astSystem from '../../../../../../backend/tests/golden/ast_system.json'
import mdMethod from '../../../../../../examples/method/content.md?raw'
import mdSystem from '../../../../../../examples/system/content.md?raw'

/** 06 §4.3 golden：两案每个可编辑块 serialize(toDoc(block)) === blockSource（与后端 serialize_block 逐字节一致） */
const cases: [string, Ast, string][] = [
  ['method', astMethod as unknown as Ast, mdMethod],
  ['system', astSystem as unknown as Ast, mdSystem],
]

const editableBlocks = (ast: Ast): EditableBlock[] => [...ast.abstract.paragraphs, ...ast.claims, ...ast.description]

describe.each(cases)('golden %s', (_name, ast, md) => {
  const blocks = editableBlocks(ast)

  it('覆盖全部块类型', () => {
    const kinds = new Set(blocks.map((b) => b.kind))
    for (const k of ['paragraph', 'claim', 'section', 'subsection', 'equation', 'table']) expect(kinds).toContain(k)
  })

  it.each(blocks.map((b) => [b.id, b] as const))('%s 往返逐字节一致', (id, block) => {
    const src = blockSource(ast, md, id)
    expect(src).not.toBeNull()
    const doc = toDoc(block)
    doc.check()
    expect(serialize(doc)).toBe(src)
  })

  it('doc 不含内核生成物（段号 / 权项号）', () => {
    for (const b of blocks) {
      const text = toDoc(b).textContent
      if (b.kind === 'paragraph' && b.para_no !== null) expect(text).not.toMatch(/^\[\d{4}\]/)
      if (b.kind === 'table') expect(text).not.toContain(`[${String(b.para_no).padStart(4, '0')}]`)
    }
  })
})

describe('fromDoc 法则', () => {
  const { ps_para, ps_heading, ps_equation, ps_table, ps_row, ps_cell, ps_note, ps_code } = schema.nodes
  const p = (s: string) => ps_para.create(null, s ? schema.text(s) : null)

  it('首尾空行剔除，中间空行保留（权项分段 / 段落拆分交给内核）', () => {
    expect(fromDoc(schema.node('doc', null, [p(''), p('a'), p(''), p('b'), p('')]))).toEqual(['a', '', 'b'])
  })

  it('小节 / 公式 / 代码', () => {
    const doc = schema.node('doc', null, [
      ps_heading.create({ level: 4 }, schema.text('小节')),
      ps_equation.create({ source: 'a+b', label: '' }),
      ps_equation.create({ source: 'a+b', label: '（1）' }),
      ps_code.create(null, schema.text('x = 1\ny = 2')),
    ])
    expect(fromDoc(doc)).toEqual(['#### 小节', '$$a+b$$', '$$a+b$$ （1）', '```', 'x = 1', 'y = 2', '```'])
  })

  it('表格选项注释、^^ 合并标记与表注', () => {
    const row = (...c: string[]) => ps_row.create(null, c.map((t) => ps_cell.create(null, t ? schema.text(t) : null)))
    const doc = schema.node('doc', null, [
      ps_table.create(
        { three_line: true, repeat_header: false, num_left: true, col_widths: [1, 2.5], caption_after: '表1 结果' },
        [row('A', 'B'), row('1', '2'), row('^^', '')],
      ),
      ps_note.create(null, schema.text('注：略')),
    ])
    expect(fromDoc(doc)).toEqual([
      '<!-- 表格: 三线 段号居左 列宽=1,2.5 表题后置=表1 结果 -->',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '| ^^ |  |',
      '',
      '注：略',
    ])
  })
})
