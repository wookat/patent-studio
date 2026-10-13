# 同类平台调研（2026-09）

老板问题："调研有没有类似平台"。本文只基于公开页面/仓库 README 的一手阅读（链接见各行），**未实际注册试用任何商业产品**，功能描述均为厂商自述；标注「未验证」处需试用后再下结论。

## 1. 结论

1. **没有找到与 Patent Studio 同形态的产品**：即「Markdown 源文 + 确定性生成 CNIPA 版式 DOCX + 真实 LibreOffice PDF 实时预览 + 版式可视化设置 + 零漂移回归」。现有产品分三类：AI 生成初稿的 SaaS（国内外）、Word 插件/桌面 IDE、开发者向脚本/Agent Skill，都不以"排版所见即所得"为核心。
2. **最大的外部变化是 CNIPA 自 2026-01-01 起只收 XML**（官方通知，见 §5）。所有竞品与我们一样最终都停在 DOCX，靠国知局 Windows 版「WORD 转 XML 编辑器」二次转换。谁先把 DOCX/Markdown → 合规 XML 做进工作流，谁就补上了最后一公里。这是 Patent Studio 下一轮最高价值项。
3. 竞品普遍标配、我们缺的：AI 起草/润色、术语一致性与权利要求引用关系校验（ClaimMaster/Rowan 的核心卖点）。这些可在现有 `check_all` 的确定性校验上叠加，不需要重做编辑器。

## 2. 国际 AI 起草平台（USPTO/EPO 为主）

| 产品 | 形态 | 与我们相关的点 | 价格（第三方 2026-07 整理，多为报价制） |
| --- | --- | --- | --- |
| [Solve Intelligence](https://www.solveintelligence.com/product/drafting) | 浏览器内起草编辑器 + AI（图、化学结构、序列） | 交互式 AI 起草、风格定制、Review 内联批注 | 约 $199–775/用户/月 |
| [Rowan Patents (Clarivate)](https://clarivate.com/intellectual-property/ip-management-software/rowan-patents/) | 桌面「集成起草环境」：权项/说明书/附图同步，自动部件编号，术语管理 | [导出 Word 帮助页](https://intercom.help/rowanpatents/en/articles/6989259-export-to-word-docx-with-review-content)明说 **导出的 Word 不能直接用于递交**，仅供评审 | 约 $500/用户/月 |
| [DeepIP](https://www.deepip.ai/products/patent-drafting) | Microsoft Word 插件 + AI | 不离开 Word；可上传自己写过的专利学风格 | $350–420/用户/月 |
| [IP Author](https://ipauthor.com/) | Web 全生命周期（交底→检索→起草→OA） | 强调"屏幕上看到的 redline = 导出 Word 里的 redline"（37 CFR 1.121 合规），与我们"零漂移"思路同源 | 报价制 |
| [ClaimMaster](https://www.patentclaimmaster.com/) | Word 插件：校对（先行基础、引用关系、部件号一致）、自动编号、GPT 辅助 | 确定性校验清单是我们 `check_all` 可对标的方向 | $30–75/用户/月（年付 $359.88 起） |
| Patlytics / Qatent / PatentPal / Patentext | AI 起草 + 无效/claim chart 等 | 均无 CNIPA 版式，无实时排版预览 | $99–2000/用户/月 |

来源：[rework 13 工具对比](https://resources.rework.com/tools/ai-tools/best-ai-tools-for-patent-drafting-2026)、[IP Author 5 工具对比](https://ipauthor.com/best-ai-patent-drafting-software/)。共同点：AI-first、USPTO/EPO、Word 为交换格式；**没有一家宣称"编辑即渲染真实 PDF"**。

## 3. 国内平台

| 产品 | 形态 | 自述能力 | 备注 |
| --- | --- | --- | --- |
| [智慧芽 Eureka](https://www.zhihuiya.com/eureka/ip) | IP Agent 套件（查新/FTO/说明书撰写） | 输入权利要求+交底书 → 生成"符合受理局格式标准"的说明书，含核稿（用词一致性） | 报价制，未试用 |
| [CNIPA.AI](https://cnipa.ai/zh/write)（非官方，域名易误导） | Web AI 一键生成五书 | [导出文档](https://www.cnipa.ai/zh/docs/export)：Word（A4、宋体/仿宋、规定字号行距）+ PDF；可选摘要附图、是否带 AI 标识 | 未试用；未说明是否可自定义版式 |
| [Smart Patent](https://thesmartpatent.com/zh-CN/drafting) | Web AI 初稿 + "出厂机检报告" | 检索接地引证、留白标注未核实数值、可导出 PDF/Word 转代理人 | 定位初稿，非编辑器 |
| 中细软专利大模型 | 检索/撰写/翻译三模块 | 第三方半年使用评测（[idctop](https://idctop.com/article/107746.html)）：撰写辅助、OA 答复；偶有引用关系错误 | 二手评价，未验证 |
| [佰腾 小佰灵](https://www.baiten.cn/txmessage/detail.html?id=513) | 检索平台内 AI 助手 | 交底书生成、专利对比、画流程图 | 不做申请文件排版 |
| [权大师](https://www.quandashi.com/data-ai/index.html) | MCP/API/Skill 能力输出 | 说明书框架与权利要求初稿生成 | 面向接入方 |

共同点：都是 **AI 生成内容** 的产品，编辑与版式控制不是卖点；没有一家提到实时真实排版预览或版式参数可视化设置。

## 4. 开源 / Agent Skill（最接近我们技术路线）

| 仓库 | 路线 | 对我们的启发 |
| --- | --- | --- |
| [fnjialun/cnipa-patent-writer](https://github.com/fnjialun/cnipa-patent-writer) | Claude Code Skill：扒一份模板 docx 的版式（四节四页眉、各部分独立页码）→ python-docx 装配 → **docx→pdf→逐页 png 校验** | 与我们 pipeline 最像，但是批处理、非交互；"结构对 ≠ 视觉对"的校验思想值得吸收 |
| [handsomeZR-netizen/cn-patent-drafter](https://github.com/handsomeZR-netizen/cn-patent-drafter) | Claude Code Skill：ctexart+xelatex 出 PDF；10 类 ~50 条 CNIPA 2026 合规清单（段号连续、从权循环引用、摘要 ≤300、第 25 条、AI 承诺） | 清单可直接对照扩充 `check_all`；其 README 承认 LaTeX 无法无损转 XML |
| [CanYellow/LatexPatentTemplate](https://github.com/CanYellow/LatexPatentTemplate) | 五书 LaTeX 模板，**2025-10 已归档**，理由："国知局推动 XML 化，LaTeX 到 XML/Word 无无损转换" | 印证 §5 的 XML 趋势 |
| [HuangXinzhe/cn-patent-drafting](https://github.com/HuangXinzhe/cn-patent-drafting)、[Zaoqu-Liu/cn-patent](https://github.com/Zaoqu-Liu/cn-patent) | Codex/Agent Skill：交底书、成套 docx | 内容生成向 |
| [CNIPA-AI/patent-xml-generator](https://github.com/CNIPA-AI/patent-xml-generator) | TypeScript：结构化输入 → `cn-application-body` DTD XML（段号、权项独立/从属、MathML） | 1 star、2026-04 新建、未验证输出能否被国知局系统接收；但证明 md→XML 路径可行 |
| [EtonMu/us-patent-artifact-kit](https://github.com/EtonMu/us-patent-artifact-kit) | US 版 Markdown/DOCX/SVG/PDF 本地工具 | 与我们同思路，美国格式 |

## 5. 官方工具与 XML 强制要求

- [国知局 2025-11-12 通知](https://www.cnipa.gov.cn/art/2025/11/12/art_75_202551.html)：**2026-01-01 起电子申请只接受 XML**，非 XML 不再受理；数据标准、转换工具、手册在 [专利业务办理系统 → 工具下载](https://cponline.cnipa.gov.cn/GzfwYwblGlwhTMVC/GzfwYwblGlwhT/selectXml)。
- [2023-01 通知](https://www.cnipa.gov.cn/art/2023/1/3/art_75_181211.html)：「WORD 转 XML 编辑器」仅 Windows 7+，需 MS Office 2010+ 或 WPS 2015+。即：现在所有 DOCX 产出（包括我们的）都得再过一次 Windows 工具。
- 未验证：官方 DTD/数据标准具体内容、对公式（OMML→MathML）、表格、附图的要求；转换工具是否能命令行调用。需下载实测。

## 6. 通用"编辑器 + 实时预览"参照

- [Typst.app](https://typst.app/)：毫秒级编译、键入即预览，是我们体验上的标杆；但自有排版语言，不出 DOCX，不适用递交。
- [Collabora Online](https://www.collaboraonline.com/code/) / OnlyOffice：浏览器里直接编辑 DOCX（LibreOffice 内核，Docker 自托管）。可作"导出后微调"的备选，不宜替代 Markdown 源文（会丢结构与零漂移）。
- [SuperDoc](https://github.com/superdoc/docx-editor/)（AGPL，976★）/ docx-editor.dev：前端 DOCX WYSIWYG 组件。同上，参考即可。

## 7. 对 Patent Studio 的启示（按价值排序，如无异议按此进入下一轮）

1. **P0 XML 导出**：先下载国知局数据标准与转换工具做一手实测（DTD 结构、公式/表格/附图映射、能否脚本化）；再决定 DOCX→XML 还是 content.md→XML 直出。这是唯一能让"递交前不再碰 Windows"的功能，竞品无人做到。
2. **P1 校验增强（确定性）**：对照 cn-patent-drafter 清单与 ClaimMaster 能力，给 `check_all` 加：术语一致性、从权引用图（越界/循环）、附图标记与说明一致、段号连续、摘要 ≤300 已有。
3. **P2 AI 辅助**（调现成模型 API，不自训）：选段润色、权项改写建议、术语统一建议——竞品标配，用于提效不用于生成整篇。
4. **不做**：把主编辑器换成 Word 式 WYSIWYG（丢掉源文与零漂移，且 Collabora/SuperDoc 现成可挂为副视图）。

## 8. 未验证清单

- 所有商业产品的实际编辑体验、导出 DOCX 的版式质量（均未注册试用）。
- CNIPA.AI / 智慧芽 生成 Word 是否允许自定义版式、是否有实时预览。
- CNIPA-AI/patent-xml-generator 输出能否通过国知局校验。
- 官方 XML 数据标准细节与转换工具可脚本化程度。
