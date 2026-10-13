# W15 竞品深调报告（2026-10，v2 深调版）

> 在 `competitive-landscape.md`（2026-09 基线版）之上做深调扩编：一手证据=官网/产品页抓取 + **产品界面截图逐张视觉分析**（Solve 三张、CNIPA.AI、Patlytics 全页）+ **开源仓 README/源码精读**（5 仓）+ 平台枚举（GitHub/awesome 目录/国内厂商官网/融资新闻）。所有「实测」均有一手来源；未注册商用品的功能为厂商自述，已标注。

## 0. 检索面与关键词枚举（可复跑）

| 渠道 | 关键词/清单 |
|---|---|
| Web 搜索 | "AI patent drafting tool", "patent drafting software 2026", "专利AI撰写 平台", "专利 OA 答复 AI", "patent skill claude", "CNIPA XML 生成" |
| GitHub | topic: patent / patent-drafting / cnipa / patent-skill；awesome-legal-skills 目录 |
| 截图取证 | playwright 抓整页 → CDN 直取产品内嵌 UI 图 → 逐图视觉阅读 |
| 评测/融资 | rework 工具对比榜、IP Author 对比榜、Series A/B 新闻 |

## 1. 竞品全景名单（扩编后）

**国际 AI 起草/检索 SaaS**：Solve Intelligence（$40M B 轮，TR 合作）、DeepIP（Word 插件+浏览器）、Patlytics（$40M B 轮，**2026 已上线 Agent+200 Skills 推理层**）、IP Author、Qatent、PatentPal、Patentext、PowerPatent、Edge、davinci。**Word 插件/确定性校验**：ClaimMaster（$30-75）、Rowan Patents（Clarivate）。**全生命周期/检索**：Patlytics、Questel Orbit、IncoPat。

**国内**：智慧芽 Eureka（~20 个 IP agent、20亿+ 垂直数据）、蓝灯鱼 OA精灵/芯智写（OA 答复专精：审查点提炼→特征差异→反驳策略→规范文书→案例库；私有化部署；2 个月文档清除承诺）、唯德 PatMaster（核稿/查重/翻译）、中知慧海、专小犀、佰腾小佰灵、权大师（MCP/API/Skill 输出）、CNIPA.AI、Smart Patent、中细软。

**开源/Agent Skill（同技术路线）**：NathanMaine/memoriant-patent-skills、handsomeZR-netizen/cn-patent-drafter(44★)、fnjialun/cnipa-patent-writer(10★)、patent-dev/claude-for-legal、CNIPA-AI/patent-xml-generator、EtonMu/us-patent-artifact-kit、lawve-ai/awesome-legal-skills。

## 2. 一手视觉分析（截图实证）

**Solve Intelligence — drafting 界面**：左栏=每节独立的「Instruction 卡 + Reasoning 推理流」（"I'll draft the Introduction… Let me first review the invention disclosure"，可折叠的 Read-invention-disclosure 步），右栏=正文实时渲染（[0041] 段号）。顶部按书分签（Claims/Detailed description/Summary/Abstract）。**与我们差异**：我们 ToolStep 是紧凑小票，他们是整栏推理叙事+每步可展开。

**Solve — Review 界面**：正文内联批注卡，术语不一致处划线高亮，卡上带「**Resolve with Solve**」一键按钮——发现即修复，不跳面板。这是我们 terms-lint 面板缺的关键一跳：**每条 finding 内嵌 AI 修复动作**。

**Solve — 定制轴**：三轴风格定制 JURISDICTION（CIPO/EPO/USPTO/UKIPO/INPI）× INDUSTRY（生命/制造/电信）× ATTORNEY（按代理人个人风格）——撰写风格可按申请人/所/代理人画像学习。

**Solve — 附图元素号**：附图上的标号可直接内联改元素名（"#120 Element" 编辑态），标号↔部件名↔说明书引用三方绑定。我们有附图书管理但无标号-名称映射层。

**CNIPA.AI 撰写页**：单页向导式生成五书，卖点是"一键出稿"；导出 Word 固定版式（宋体/仿宋/规定字号），不可自排版式——印证"AI 生成强、版式控制弱"的国内格局。

**Patlytics — Agent 页（2026 新）**："AI reasoning layer powered by 200+ Skills"——竞品正向我们的案卷工程师架构收敛（技能注册表+推理层）。其 Agent 入口在 chat 首屏给三枚快捷提案（summarize activity / search patents / review infringement reports）。我们的 chat 启动面目前是空白的，可吸收**场景化首问快捷卡**。

## 3. 开源仓精读吸收点

| 仓 | 可吸收 |
|---|---|
| cn-patent-drafter 44★ | `checklists/cnipa-2026.md` 已全文采集：**10 类 ~45 条确定性规则**（五文档固定序/段号全局单调/从权单向引用禁循环/数值范围给优选区间/摘要≤300+四要素/六小节序/附图黑白宋黑/§25 排除项/AI 诚信四条/避®™与"大约等等"模糊词） |
| memoriant-patent-skills | **agent-per-role 模型路由**（Opus 出稿/Sonnet 审查）+ 7 步检索法 + `/patent-pipeline` 组合命令——对照我们 MODELS{heavy/interactive/fallback} 三档路由：同源思想，可加「按工具角色路由」层 |
| claude-for-legal | CLAUDE.md 实践画像 + 冷启动访谈 + **定时 watcher**（deadline/同行动态监控）+ "draft for attorney review" 护栏文案——watcher 思想可借我们的 deadline 体系做「主动盯梢」 |
| cnipa-patent-writer | 模板 docx 版式逐项继承装配——我们已是 markdown→版式，不需学其装配，但其「docx→pdf→逐页 png 校验」视觉回归思想可借作导出校验 |
| patent-xml-generator | **`cn-application-body` DTD 结构参考**（claim num/type=dependent+dependsOn、p num=段号、Italic 属性、MathML 嵌入）。1★新作仅作 schema 参照，不可直接依赖 |

## 4. 逐项对表（我们 vs 竞态）

| 能力 | 我们现状（代码实证） | 最强竞对 | 差距 |
|---|---|---|---|
| 全文确定性体检 | `lint.py` 14 条：abstract.limit/empty、claims.forward_ref/numbering/independent_first/append、figures.ref*/md/file_missing、spec.sections/unknown_section、preflight.run | cn-patent-drafter ~45 条 + ClaimMaster 全校验清单 | **中**：缺段号连续、从权循环引用图、模糊词表、®™、四要素、§25、附图标记↔说明书双向 |
| 检索 | prior_art 三源（PatSnap/OpenAlex/OPS 待批） | 智慧芽 20亿+垂直库 / Patlytics 无效分析 | 中：无语义检索/无效 claim chart |
| AI 对话 | agentic chat：68 工具、确认卡、持久化、markdown+附件 | Solve 推理叙事栏 / Patlytics 200 Skills | **已同代**，差推理叙事展示与首问快捷卡 |
| 术语/风格画像 | 术语表+terms-lint（统一性） | Solve 三轴（辖区×行业×代理人风格）+ DeepIP 学自家专利 | **中**：无「从既有专利学风格」画像 |
| 附图标号 | 附图书+编号引用检查 | Solve 标号↔元素名内联绑定 / Rowan 自动编号 | 中：无部件号↔名称映射表 |
| OA 答复 | OA 轮次台账+要点拆条+文书生成 | 蓝灯鱼全流程（审查点→特征差异→反驳策略→案例库） | 中：缺对比特征差异表结构 |
| XML 递交 | 无 | 无人做到（全行业缺口） | **P0 机会不变**，patent-xml-generator 给出 DTD 参照 |
| 外部 agent | MCP 68 工具双通道 | 权大师 MCP 输出 | **已领先** |
| 提案-确认契约 | CriticMarkup 提案+双确认闸 | IP Author redline 同源 | 已同代 |

## 5. 吸收清单（按价值×成本排序，进入设计方案）

- **A. check_all 扩 45 条清单**（高价值/低成本/纯确定性）：段号单调连续、从权引用图循环检测、模糊词表（大约/基本上/等等）、®™商标符号、摘要四要素、§25 排除项关键词扫描、附图标记↔说明书双向对应、数值范围建议。落点 `app/domain/lint.py`。
- **B. finding→AI 修复内联**（高价值/中成本）：lint 诊断带 `fix` 提案直出——点在 finding 上出「AI 修复」钮走 propose 链，不跳面板。Solve "Resolve with" 同款。
- **C. agent 推理叙事+首问快捷卡**（中/低）：chat 步骤小票升级为可展开推理行；空对话首屏 3 枚场景化快捷提案（查新/体检/成稿）。
- **D. 风格画像**（中/中）：导入既往专利→抽取版式+措辞偏好→写入机构/案卷模板 hint。Solve 三轴之代理人轴的务实版。
- **E. 附图部件号-名称映射层**（中/中）：figures 台账加 label↔name 列，lint 双向校验，为未来标号编辑打底。
- **F. XML 递交预研**（高/高，P0）：patent-xml-generator 作 schema 参照 + 国知局工具下载实测——独立课题单独立项。
- **G. OA 特征差异表**（中/中）：蓝灯鱼式「审查意见↔权项特征↔对比文件」三列差异表。
- **H. 主动 watcher**（低/低）：期限临近自动跑体检+摘要，入通知流。

## 6. 不建议吸收

- Word 插件路线（DeepIP/ClaimMaster）——丢源文与零漂移，同 v1 结论。
- 一键出稿向导（CNIPA.AI）——与我方「人机打磨」定位冲突，且其版式不可定制正是我们优势面。
- LaTeX 管线——原作者已归档，理由「无法无损转 XML」。
