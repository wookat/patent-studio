import { describe, expect, it } from 'vitest'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import { locateInSource, paraAnchor, paraLine, pdfQueryForBlock } from '../locate'

const md = [
  '# 一种时间序列预测模型部署期可信自适应控制方法及装置',
  '',
  '## 摘要',
  '',
  '本发明公开了一种**可信自适应**控制方法，包括：采集运行期指标 $x_t$，计算漂移分数。',
  '',
  '## 权利要求书',
  '',
  '1.一种控制方法，其特征在于，包括以下步骤：',
  '| 指标 | 阈值 |',
  '| 漂移分数 | 0.3 |',
].join('\n')

describe('locateInSource', () => {
  it('整段命中：忽略 PDF 文字层的空格与源里的 Markdown 标记', () => {
    expect(locateInSource(md, '本发明公开了一种可信自适应控制方法，包括：采集运行期指标 x')).toBe(5)
  })
  it('标题', () => {
    expect(locateInSource(md, '一种时间序列预测模型部署期可信自适应控制方法及装置')).toBe(1)
  })
  it('段号被渲染进 PDF 行首时按滑窗回退', () => {
    expect(locateInSource(md, '[0001] 一种控制方法，其特征在于，包括以下步骤：')).toBe(9)
  })
  it('表格单元格', () => {
    expect(locateInSource(md, '漂移分数 0.3')).toBe(11)
  })
  it('滑窗投票：整行含段号且开头短语在标题里也出现时，仍归到票数最多的正文行', () => {
    const md2 = ['# 一种可信自适应控制方法', '', '[0002] 无', '本发明提供一种可信自适应控制方法，通过漂移分数与置信区间共同判定是否降级。'].join('\n')
    expect(locateInSource(md2, '[0002] 本发明提供一种可信自适应控制方法，通过漂移分数与置信区间共同判定是否降级。')).toBe(4)
  })
  it('过短 / 不存在 → null', () => {
    expect(locateInSource(md, '方法')).toBeNull()
    expect(locateInSource(md, '这段话源文件里根本没有出现过')).toBeNull()
  })
})

describe('段号锚（有 AST 时优先）', () => {
  it('paraLine：段 / 表（含表注段号）→ 块首行；不存在 null', () => {
    expect(paraLine(SYNTH_AST, 1)).toBe(22)
    expect(paraLine(SYNTH_AST, 3)).toBe(32)
    expect(paraLine(SYNTH_AST, 8)).toBe(50)
    expect(paraLine(SYNTH_AST, 9)).toBe(50)
    expect(paraLine(SYNTH_AST, 99)).toBeNull()
  })
  it('PDF 行首 [0003] → 直接命中该段，即使正文在源里被改过（文本匹配会失败）', () => {
    expect(locateInSource(SYNTH_MD, '[0003] 这句话已经被改得面目全非了根本对不上', SYNTH_AST)).toBe(32)
    expect(locateInSource(SYNTH_MD, '[0003] 这句话已经被改得面目全非了根本对不上')).toBeNull()
  })
  it('锚找不到（段号不在 AST）→ 回退文本匹配', () => {
    expect(locateInSource(SYNTH_MD, '[0099] 本发明可在工业现场部署。', SYNTH_AST)).toBe(58)
  })
  it('无段号前缀的行不受 AST 影响', () => {
    expect(locateInSource(SYNTH_MD, '现有技术存在漂移问题', SYNTH_AST)).toBe(26)
  })
})

describe('pdfQueryForBlock（大纲 → PDF 查找词）', () => {
  it('段号锚优先：段 / 表 / 公式(anchor_para_no)', () => {
    expect(paraAnchor(13)).toBe('[0013]')
    expect(pdfQueryForBlock(SYNTH_AST, 'description/技术领域/p0001')).toBe('[0001]')
    expect(pdfQueryForBlock(SYNTH_AST, 'description/具体实施方式/p0008')).toBe('[0008]')
    expect(pdfQueryForBlock(SYNTH_AST, 'description/发明内容/技术方案/eq1')).toBe('[0003]')
  })
  it('非段块用 pdf.js 单项内完整的文字：章节标题 / 权项 `N.` / 页眉 / 附图题注段号', () => {
    expect(pdfQueryForBlock(SYNTH_AST, 'description/发明内容')).toBe('发明内容')
    expect(pdfQueryForBlock(SYNTH_AST, 'description/发明内容/技术方案')).toBe('技术方案')
    expect(pdfQueryForBlock(SYNTH_AST, 'claims/2')).toBe('2.')
    expect(pdfQueryForBlock(SYNTH_AST, 'abstract')).toBe('说 明 书 摘 要')
    expect(pdfQueryForBlock(SYNTH_AST, 'claims')).toBe('权 利 要 求 书')
    expect(pdfQueryForBlock(SYNTH_AST, 'description')).toBe('技术领域')
    expect(pdfQueryForBlock(SYNTH_AST, 'figures/2')).toBe('[0006]')
    expect(pdfQueryForBlock(SYNTH_AST, 'figures/3')).toBeNull()
    expect(pdfQueryForBlock(SYNTH_AST, 'nope')).toBeNull()
  })
})
