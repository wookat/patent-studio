import { describe, expect, it } from 'vitest'
import astSchema from '../../../../backend/src/patent_studio/kernel/ast_schema.json'
import astRich from '../../../../backend/tests/fixtures/ast_rich.json'
import sampleMethod from '../../../../backend/tests/fixtures/ast_sample_method.json'
import sampleSystem from '../../../../backend/tests/fixtures/ast_sample_system.json'
import {
  AST_VERSION, CLAIM_KINDS, DESCRIPTION_BLOCK_KINDS, DESCRIPTION_PARTS, PARAGRAPH_ROLES, SEGMENT_KINDS,
  blockAtLine, blockFullLine, type Ast,
} from '../ast'

interface Schema {
  properties: { version: { const: number } }
  $defs: Record<string, { enum?: string[]; required?: string[] }>
}

const schema = astSchema as unknown as Schema
const samples: Record<string, Ast> = {
  method: sampleMethod as unknown as Ast,
  system: sampleSystem as unknown as Ast,
  rich: astRich as unknown as Ast,
}

describe('types/ast ⇄ ast_schema.json', () => {
  it('枚举常量与 schema 一致', () => {
    expect(schema.properties.version.const).toBe(AST_VERSION)
    expect(schema.$defs.DescriptionPart.enum).toEqual([...DESCRIPTION_PARTS])
    expect(schema.$defs.ClaimKind.enum).toEqual([...CLAIM_KINDS])
    expect(schema.$defs.SegmentKind.enum).toEqual([...SEGMENT_KINDS])
    expect(schema.$defs.ParagraphRole.enum).toEqual([...PARAGRAPH_ROLES])
    expect(schema.$defs.DescriptionBlockKind.enum).toEqual([...DESCRIPTION_BLOCK_KINDS])
  })

  it('schema 必填字段 = TS 接口字段（手写同步的护栏）', () => {
    expect(schema.$defs.Claim.required).toEqual([
      'id', 'kind', 'lines', 'num', 'num_written', 'claim_kind', 'category', 'refs', 'charact', 'segments',
    ])
    expect(schema.$defs.Equation.required).toEqual(['id', 'kind', 'lines', 'source', 'label', 'mathml', 'anchor_para_no'])
    expect(schema.$defs.Table.required).toEqual(['id', 'kind', 'lines', 'para_no', 'rows', 'options', 'caption_after', 'note'])
    expect(schema.$defs.Figure.required).toEqual(['id', 'kind', 'book', 'num', 'file', 'width', 'alt', 'caption', 'caption_line'])
    expect(schema.$defs.FiguresBadLine.required).toEqual(['line', 'text'])
  })

  it.each(Object.entries(samples))('%s 样例：id 唯一、行区间合法、kind 在枚举内', (_name, ast) => {
    const blocks = [ast.abstract, ...ast.claims, ...ast.description]
    const ids = [...blocks.map((b) => b.id), ...ast.figures.map((f) => f.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const b of blocks) expect(b.lines.start).toBeLessThanOrEqual(b.lines.end)
    for (const b of ast.description) expect(DESCRIPTION_BLOCK_KINDS).toContain(b.kind)
    for (const c of ast.claims) expect(CLAIM_KINDS).toContain(c.claim_kind)
  })
})

describe('blockAtLine / blockFullLine', () => {
  const ast = samples.rich

  it('全文行 → 块（rich：71 行是 [0013] 段，73 行是式（3））', () => {
    const p = blockAtLine(ast, 71)
    expect(p?.book).toBe('description')
    expect(p?.block.id).toBe('description/发明内容/技术方案/p0013')
    const eq = blockAtLine(ast, 73)
    expect(eq?.block.kind).toBe('equation')
    expect(eq && blockFullLine(ast, eq)).toBe(73)
  })

  it('权项 / 摘要 / 未覆盖行', () => {
    expect(blockAtLine(ast, 11)?.block.id).toBe('claims/1')
    expect(blockAtLine(ast, 15)?.block.id).toBe('claims/1')
    expect(blockAtLine(ast, 5)?.block.id).toBe('abstract')
    expect(blockAtLine(ast, 200)).toBeNull()
  })
})
