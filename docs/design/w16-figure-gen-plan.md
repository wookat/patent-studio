# W16 专利附图生成与绘制——调研与设计方案

> 目标：智能体生成 + 手动调整 + 智能体修改的三位一体附图能力，覆盖平台发明专利典型图型（流程图/结构框图/系统架构图）。

## 一、CNIPA 形式规范（设计硬约束）

依《专利法实施细则》第 20/21 条及审查指南，附图要求：

| 约束 | 对设计的含义 |
|---|---|
| 黑色线条、均匀清晰，不得用照片/蓝图 | 输出黑白线稿 SVG/PNG，主题锁黑白，禁彩色填充 |
| 阿拉伯数字编号「图1、图2」标正下方 | 题注已有；生成图内不重复编号 |
| 同一部件跨图标号一致；**说明书文字提及的标号必须在图中出现，图中标号必须被文字提及** | 与我们 `numerals.*` preflight 规则同向——生成器把标号写进节点文本，一致性由现有门禁兜底 |
| 结构框图/逻辑框图/流程图框内必须有文字 | 节点必须带标签，禁裸框 |
| 图中除必需词语外不得有注释，词语用中文 | 节点文本中文优先 |
| 缩小至 2/3 仍清晰 | 矢量输出 + 最小字号约束 |

## 二、竞品调研

| 产品 | 做法 | 可吸收点 |
|---|---|---|
| **PatentPal** | 权项→方法流程图/系统框图自动生成，导出 Word+Visio/PPT 供继续编辑 | 「claims→figure」一步成图 + 导出可编辑格式（Visio 是代理人所习惯） |
| **PatentFig AI** | 描述/草图→黑白线稿；自然语言改图（"make the arrow thicker"）；标号可加/移/重编；按局（USPTO/EPO/CNIPA…）版式导出；版本时间线 | 自然语言改图指令面、标号编辑、局版式模板、图版本历史 |
| IPnite / ClaimMaster / Specifio | 框图/流程图辅助 + 标号一致性检查 | 标号一致性检查我们已有（numerals.*），属于优势项 |

竞品共性结论：**生成的都是"结构型图"（流程图/框图），不是渲染线稿产品图**；可编辑交付物（Visio/源码）是刚需；标号与正文一致性是检查卖点。

## 三、开源方案调研

| 方案 | 代表 | 优劣 |
|---|---|---|
| **Mermaid** | mobrien133/patentdrawingproject（claims→USPTO mermaid）、oh-my-patent | 前端纯 JS 渲染出 SVG、文本源码天然双向（LLM 生成+人手改+LLM 再改都同一份源）、flowchart 语法 LLM 熟悉度最高；布局自动不可精调 |
| **Graphviz DOT** | RobThePCGuy/Claude-Patent-Creator 的 patent-diagram-generator skill（136★） | 布局引擎成熟（dot/neato/circo）、后端渲染稳；需引入 Python graphviz + 系统 dot，前端预览要后端转 SVG |
| **drawio (mxGraph)** | wb-diagram-converter 生态 | 最强手动编辑（嵌入编辑器），但集成重（~几 MB）、源码 XML 对 LLM 不友好 |
| PlantUML/Excalidraw/D2 | diagramkit/diagram-sync | 备选族，收益不优于 mermaid |

**选型：Mermaid 为主引擎**。理由：唯一「LLM 生成 ⇄ 人编辑 ⇄ LLM 修改」三方都操作同一可读文本源、且零后端依赖（前端渲染 SVG→导 PNG 进 figs/ 复用现有管线）；DOT 做备选后端引擎（复杂布局场景后置）。

## 四、架构设计

```
figs-src/<name>.mmd        ← 图源（git 版本化，审计同其他文件）
        │  frontend mermaid → SVG 预览
        ▼  导出（前端 SVG→PNG 300dpi or 后端渲染）
figs/<name>.png            ← 现有 figures.md 管线不变（编排/题注/marks/进 DOCX/XML）
```

- **图源存 `figs-src/*.mmd`**：与 figs/ 平级新目录，纳入 git 版本与审计，文件树可见（图标区分）
- **编辑面**：FigureCard/图纸区新增「绘制」入口——CodeMirror 源码编辑器（已有）+ 实时 SVG 预览 + 「导出为附图」钮（渲染 PNG 300dpi 写 figs/，走现有上传语义）
- **手动调整** = 改 mmd 源码重渲（符合「文本即图」哲学，零画布开发）；后续需要拖拽级编辑再上 drawio/自研
- **智能体生成/修改**：chat 工具两件——
  - `propose_figure_source {name, mmd, rationale}`：模型产图源+说明，确认卡预览 SVG，点执行落 figs-src/ 并可一键导出 figs/
  - `propose_figure_edit {name, mmd}`：读现有图源改后提案（diff 进提案说明）
  - 均提案制，契约有写不破；生成 prompt 注入 CNIPA 约束（黑白/中文标签/标号）
- **标号联动**：生成时从案卷 marks/权项抽取部件名建议标号；`numerals.*` 现有规则自然校验图文一致性
- **渲染黑白主题**：mermaid themeVariables 锁白底黑线（stroke:#000），字号 ≥14px（缩 2/3 可读）

## 五、分批计划

| 批 | 内容 | 依赖 |
|---|---|---|
| B1 绘制管线 | figs-src 目录+读写 API+mmd 编辑器+SVG 预览+导出 PNG 进 figs/ | mermaid dep |
| B2 智能体 | propose_figure_source / propose_figure_edit 两件 + CNIPA prompt 约束 + 确认卡 SVG 预览 | B1 |
| B3 联动 | 标号建议（marks+权项抽取）+附图说明段联动提案+导出 Visio 兼容（SVG→drawio 转换可选） | B1 |

边界：外观/产品视角线稿（PatentFig 那种 AI 线稿）不在本批——生成式出图风格不可控、CNIPA 对结构图需求覆盖了发明+实用新型的大部分图面工作，真需要时走外部工具导入 PNG。

## 六、待拍板

1. mermaid 选型确认（备选 graphviz 后置）
2. 「手动调整」= 源码编辑+预览是否够，还是必须画布拖拽（成本差一个量级）
3. 分批节奏 B1→B2→B3 可吗
