import { describe, expect, it } from 'vitest'
import { diagLocationLabel, lineChipLabel } from '@/lib/diagLocation'
import { selectionLabel } from '@/components/ai/aiModel'
import { SYNTH_AST, SYNTH_MD } from './astFixture'

describe('selectionLabel — AI 选区芯片 / 快捷动作位置字样', () => {
  it('单块 → 块标签；跨块 → A – B；无 AST 退到书名，不出现 L\\d+', () => {
    expect(selectionLabel({ lineStart: 15, lineEnd: 15 }, SYNTH_AST)).toBe('权利要求 4')
    expect(selectionLabel({ lineStart: 15, lineEnd: 44 }, SYNTH_AST)).toBe('权利要求 4 – 说明书 · 段落 [0006]')
    expect(selectionLabel({ lineStart: 15, lineEnd: 16 }, null, SYNTH_MD)).toBe('权利要求书')
    expect(selectionLabel({ lineStart: 15, lineEnd: 44 }, null, SYNTH_MD)).not.toMatch(/L\d+|content\.md/)
  })
})

describe('diagLocationLabel — 用户可读位置，不露 content.md / 行号 / 块 id', () => {
  it('按全文行折算：权项 → 「权利要求 N」，说明书段落 → 「说明书 · 段落 [NNNN]」，摘要 → 「摘要」', () => {
    expect(diagLocationLabel({ line: 15 }, SYNTH_AST)).toBe('权利要求 4')
    expect(diagLocationLabel({ line: 44 }, SYNTH_AST)).toBe('说明书 · 段落 [0006]')
    expect(diagLocationLabel({ line: 5 }, SYNTH_AST)).toBe('摘要')
    expect(diagLocationLabel({ line: 20 }, SYNTH_AST)).toBe('说明书 · 技术领域')
  })

  it('块 id 优先于行号；figures/N → 「图 N」', () => {
    expect(diagLocationLabel({ line: 15, blockId: 'claims/2' }, SYNTH_AST)).toBe('权利要求 2')
    expect(diagLocationLabel({ line: null, blockId: 'description/附图说明/p0006' }, SYNTH_AST)).toBe('说明书 · 段落 [0006]')
    expect(diagLocationLabel({ line: null, blockId: 'abstract' }, SYNTH_AST)).toBe('摘要')
    const fig = SYNTH_AST.figures[0]
    expect(diagLocationLabel({ line: null, blockId: fig.id }, SYNTH_AST)).toBe(`图 ${fig.num}`)
  })

  it('无 AST 时退到后端章节字样（/ → ·），再退到全文；任何情况下不出现实现细节', () => {
    expect(diagLocationLabel({ line: 15, section: '说明书/背景技术' }, null)).toBe('说明书 · 背景技术')
    expect(diagLocationLabel({ line: 15, section: '权利要求书' }, null)).toBe('权利要求书')
    expect(diagLocationLabel({ line: 15 }, null)).toBe('全文')
    expect(diagLocationLabel({ line: null }, SYNTH_AST)).toBe('全文')
    for (const label of [diagLocationLabel({ line: 15 }, SYNTH_AST), diagLocationLabel({ line: 9999 }, SYNTH_AST), diagLocationLabel({ line: 15 }, null)]) {
      expect(label).not.toMatch(/content\.md|第 \d+ 行|\bL\d+|\//)
    }
  })

  it('行落在块外（标题行 / `## 书名` 行）→ 「标题」/ 书名；lineChipLabel 任何情况不出现「第 N 行」', () => {
    expect(diagLocationLabel({ line: SYNTH_AST.title.line }, SYNTH_AST)).toBe('标题')
    expect(diagLocationLabel({ line: SYNTH_AST.books.claims.offset }, SYNTH_AST)).toBe('权利要求书')
    expect(diagLocationLabel({ line: SYNTH_AST.books.description.offset }, SYNTH_AST)).toBe('说明书')
    expect(lineChipLabel(44, SYNTH_AST)).toBe('[0006]')
    expect(lineChipLabel(20, SYNTH_AST)).toBe('技术领域')
    for (const label of [lineChipLabel(SYNTH_AST.title.line, SYNTH_AST), lineChipLabel(15, null), lineChipLabel(9999, SYNTH_AST)]) {
      expect(label).not.toMatch(/第 \d+ 行|\bL\d+/)
    }
  })
})
