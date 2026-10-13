import type { Ast, AstClaim, AstParagraph, DescriptionBlock, DescriptionPart } from '@/types/ast'

/**
 * 合成 AST（与 backend/src/patent_studio/kernel/ast_schema.json 契约一致），覆盖大纲要用到的全部形态：
 * 四项权项（独立 / 从属单引 / 从属多引 / 前向引用）、法定五章节 + 非标准章节、小节、公式（anchor_para_no）、
 * 表格（表题在前 + 表注）、三幅附图（两幅有题注行、一幅没有）。全文行号 = books[book].offset + lines.start。
 *
 *  1 # 一种控制方法
 *  3 ## 摘要                       abstract offset 3
 *  5   摘要正文                      abstract/p1
 *  7 ## 权利要求书                 claims offset 7
 *  9   1. …                        claims/1
 * 11   2. …                        claims/2  → 1
 * 13   3. …                        claims/3  → 1,2
 * 15   4. …                        claims/4  → 5（前向）
 * 18 ## 说明书                     description offset 18
 * 20   ### 技术领域   22 [0001]
 * 24   ### 背景技术   26 [0002]
 * 28   ### 发明内容   30 #### 技术方案  32 [0003]  34 公式(1)  36 #### 有益效果  38 [0004]
 * 40   ### 附图说明   42 [0005] 图1题注  44 [0006] 图2题注
 * 46   ### 具体实施方式  48 [0007] 表题  50–52 表 [0008]（表注 [0009]）  54 [0010]
 * 56   ### 工业实用性（非标准）  58 [0011]
 */
const para = (id: string, start: number, para_no: number, text: string, role: AstParagraph['role'] = 'body'): AstParagraph => ({
  id, kind: 'paragraph', lines: { start, end: start }, text, para_no, role,
})
const section = (title: string, start: number, part: DescriptionPart, kind: 'section' | 'subsection' = 'section', parent = 'description'): DescriptionBlock => ({
  id: `${parent}/${title}`, kind, lines: { start, end: start }, title, part,
})
const claim = (num: number, start: number, text: string, refs: number[][]): AstClaim => ({
  id: `claims/${num}`,
  kind: 'claim',
  lines: { start, end: start },
  num,
  num_written: `${num}.`,
  claim_kind: refs.length ? 'dependent' : 'independent',
  category: '方法',
  refs: refs.map((targets) => ({ text: `权利要求${targets.join('或')}`, targets, alternative: targets.length > 1, seg: 0, start: 4, end: 10 })),
  charact: { seg: 0, offset: 20 },
  segments: [{ id: `claims/${num}/seg/0`, kind: 'text', text, line: start, mathml: null }],
})

export const SYNTH_AST: Ast = {
  version: 1,
  title: { text: '一种控制方法', line: 1 },
  books: { abstract: { offset: 3, length: 3 }, claims: { offset: 7, length: 10 }, description: { offset: 18, length: 41 } },
  abstract: {
    id: 'abstract',
    kind: 'abstract',
    lines: { start: 1, end: 3 },
    paragraphs: [para('abstract/p1', 2, 0, '本发明公开了一种控制方法，包括采集指标与计算漂移分数。')],
    figure_num: 1,
  },
  claims: [
    claim(1, 2, '1.一种控制方法，其特征在于，包括以下步骤：采集运行期指标；计算漂移分数。', []),
    claim(2, 4, '2.根据权利要求1所述的方法，其特征在于，所述漂移分数按滑窗计算。', [[1]]),
    claim(3, 6, '3.根据权利要求1或2所述的方法，其特征在于，还包括告警步骤。', [[1, 2]]),
    claim(4, 8, '4.根据权利要求5所述的方法，其特征在于，所述告警为短信。', [[5]]),
  ],
  description: [
    section('技术领域', 2, 'technical-field'),
    para('description/技术领域/p0001', 4, 1, '本发明涉及时间序列预测领域。'),
    section('背景技术', 6, 'background-art'),
    para('description/背景技术/p0002', 8, 2, '现有技术存在漂移问题。'),
    section('发明内容', 10, 'disclosure'),
    section('技术方案', 12, 'disclosure', 'subsection', 'description/发明内容'),
    para('description/发明内容/技术方案/p0003', 14, 3, '漂移分数按式(1)计算：'),
    { id: 'description/发明内容/技术方案/eq1', kind: 'equation', lines: { start: 16, end: 16 }, source: 'd_t = |x_t - \\hat x_t|', label: '(1)', mathml: null, anchor_para_no: 3 },
    section('有益效果', 18, 'disclosure', 'subsection', 'description/发明内容'),
    para('description/发明内容/有益效果/p0004', 20, 4, '本发明可及时发现漂移。'),
    section('附图说明', 22, 'description-of-drawings'),
    para('description/附图说明/p0005', 24, 5, '图1为本发明实施例的总体流程图；'),
    para('description/附图说明/p0006', 26, 6, '图2为漂移分数曲线示意图。'),
    section('具体实施方式', 28, 'mode-for-invention'),
    para('description/具体实施方式/p0007', 30, 7, '表1 阈值表', 'table-caption'),
    {
      id: 'description/具体实施方式/p0008',
      kind: 'table',
      lines: { start: 32, end: 34 },
      para_no: 8,
      rows: [['指标', '阈值'], ['漂移分数', '0.3']],
      options: { three_line: true, repeat_header: false, num_left: false, col_widths: null },
      caption_after: null,
      note: { text: '注：阈值可配置。', para_no: 9 },
    },
    para('description/具体实施方式/p0010', 36, 10, '以上实施例仅用于说明。'),
    section('工业实用性', 38, 'other'),
    para('description/工业实用性/p0011', 40, 11, '本发明可在工业现场部署。'),
  ],
  figures: [
    { id: 'figures/1', kind: 'figure', book: 'figures', num: 1, file: 'fig1.svg', width: 15, alt: '图1 本发明实施例的总体流程图', caption: '本发明实施例的总体流程图', caption_line: 24 },
    { id: 'figures/2', kind: 'figure', book: 'figures', num: 2, file: 'fig2.svg', width: 15, alt: '图2 漂移分数曲线示意图', caption: '漂移分数曲线示意图', caption_line: 26 },
    { id: 'figures/3', kind: 'figure', book: 'figures', num: 3, file: 'fig3.svg', width: 15, alt: '', caption: null, caption_line: null },
  ],
}

/** 与 SYNTH_AST 行号对应的 content.md（仅大纲 / 定位测试需要的行有内容） */
export const SYNTH_MD = (() => {
  const lines = Array.from({ length: 60 }, () => '')
  const put = (n: number, s: string) => (lines[n - 1] = s)
  put(1, '# 一种控制方法')
  put(3, '## 摘要')
  put(5, '本发明公开了一种控制方法，包括采集指标与计算漂移分数。')
  put(7, '## 权利要求书')
  for (const c of SYNTH_AST.claims) put(7 + c.lines.start, c.segments[0].text)
  put(18, '## 说明书')
  for (const b of SYNTH_AST.description) {
    const l = 18 + b.lines.start
    if (b.kind === 'section') put(l, `### ${b.title}`)
    else if (b.kind === 'subsection') put(l, `#### ${b.title}`)
    else if (b.kind === 'paragraph') put(l, b.text)
    else if (b.kind === 'equation') put(l, `$$ ${b.source} $$ ${b.label}`)
    else if (b.kind === 'table') b.rows.forEach((r, i) => put(l + i, `| ${r.join(' | ')} |`))
  }
  put(53, '注：阈值可配置。')
  return lines.join('\n')
})()
