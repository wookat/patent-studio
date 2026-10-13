---
name: patent-drafting
description: 撰写、修订、审计中国发明专利材料。当任务涉及把论文/代码/设计文档/实验记录/交底书整理为专利三书（权利要求书/说明书/摘要）、发明点挖掘、查新、权项支持性/术语一致性检查、或既有草稿增量修订时使用。适配 Patent Studio 三书/提案/体检工作流；方法学改写自 HuangXinzhe/cn-patent-drafting（MIT License）。
---

# Patent Drafting（CN · Patent Studio）

## 红线（动笔前先读）

- **只提取不脑补**：深度挖掘 ≠ 创造性扩展。源文未提及的参数/实验/附图/效果宁可不写、列入待确认；绝不编造专利号、文献、URL。
- **三要素闭环**：每个发明点先定 区别点→技术问题→技术效果，缺一向发明人确认或标待确认，再落笔。
- **措辞纪律**：对疑点只用「建议 / 疑似 / 请核对」，不得下法律结论（不支持 / 不清楚 / 不具新颖性 / 不具创造性 / 应予驳回 / 无效）。
- **不直改源文**：改动一律以提案/补丁给出（CriticMarkup / patch 提案，人点「应用」才落地）；修订稿另存版本不覆盖既有交付。

## Route（按任务选读对应 references）

- **新材料 → 三书初稿**：`references/intake.md` → `references/claims.md`；平台内走 S1 场景或 convert 导入管线
- **查新 / 新颖性 / 授权风险**：`references/prior-art.md`——无检索源时只产出「待检索」查新笔记，禁伪造结论
- **既有稿修订 / 增量合并 / 纠错**：`references/iteration.md`（含修订分类与留档摘要格式）+ `references/claims.md`

## Patent Studio 对接

- 源材料放案卷 `attachments/`（docx/pdf/md/txt 经 convert.extract 抽取，附图入 figs/）
- 成稿路径：S1 场景 agent（交底书→三书，patch 提案等应用）或 convert 管线（target=new 建新案）
- 打磨链对应场景：s2 权项批评 / s3 支持性补写 / s4 术语统一 / s5 附图标记对齐 / s6 摘要 / s7 OA 争辩 / s9 双语 / s10 客户简报
- 自检双轨：确定性 `lint` + `preflight`（块结构/段号/术语/附图标记规则）+ `references/claims.md` 的人工审计清单（支持性/先行词/公式参数/图示对应）

## References

- `references/intake.md`：最少打扰问项、证据扫描优先级、发明点提取表
- `references/claims.md`：权项布局（独权/从权/装置介质链）、支持映射、公式参数、图示一致性、终审清单
- `references/prior-art.md`：查新时机、检索式构造、查新表字段、「待检索」诚实降级
- `references/iteration.md`：修订分类（合并/纠错/加强/重写）、保序增量、留档摘要、密度校准
- `references/benchmarks.md`：1001 篇授权件统计——各节密度基准（p25/中位/p75）、域×密度矩阵、自称分布、权项句式与尾链惯例、实施方式扩写优先级
- `references/phrases.md`：逐句矿采句式库——实施方式/附图说明/发明内容/背景各段首句式、从权句式、效果动词、企业件 boilerplate

## 致谢

方法学与参考文献改写自 https://github.com/HuangXinzhe/cn-patent-drafting（MIT License），裁剪并适配至 Patent Studio 的三书、提案与体检契约。
