# W15 设计方案：竞对能力吸收实施计划

> 依据 `competitive-landscape-v2.md` §5 吸收清单。原则：高内聚低耦合——每批独立 PR、落点单一职责模块、写面全走提案契约不破、先核验后动手（obs-pool 规矩）。

## 批次划分（4 批 5 PR，按依赖序）

### 批85-A｜check_all 确定性清单扩编（lint.py 单点扩）
新增规则全落 `app/domain/lint.py`，Diagnostic 契约不变，体检面板零改：

| 新 rule | 逻辑（确定性） |
|---|---|
| `spec.para_seq` | 全文 `[NNNN]` 段号全局单调递增、连续（容差：人工跳号告警非 error） |
| `claims.dep_cycle` | 从权引用建图 DFS 查环 + 引用不存在权号 |
| `style.vague` | 模糊词表正则：`大约|大概|基本上|等等|之类|左右|上下`（warning） |
| `style.trademark` | `®|™|©` 与常见品牌名出现告警（建议改上位概念） |
| `abstract.elements` | 摘要四要素粗检：名称/技术方案/效果要素缺位提示（info） |
| `spec.excluded_matter` | §25 排除项词表扫描（科学发现/智力活动规则/疾病诊疗/动植物品种/原子核变换/平面印刷品） |
| `claims.range_pref` | 数值范围无优选值（「优选|进一步|其中」后跟区间）—info 级 |
| `figures.mark_consistency` | 附图标记（`(\d+)` 引出标号）↔ 说明书部件名双向对照 |

测试：每条规则独立 pytest + 一锅端回归。~1 PR。

### 批85-B｜finding→AI 修复内联（前后端各半）
- 后端：lint Diagnostic 已有 `fix` 槽——给可修复 rule 产结构化 fix（locator+suggestion）；`propose_critic` 新增 from_diagnostic 快捷路径
- 前端：体检面板诊断行加「AI 修复」钮→走既有提案卡确认流（不新造轮子）
- Solve "Resolve with Solve" 同款交互，1 PR

### 批85-C｜agent 观感两件（纯前端）
- 步骤小票升级：每步可展开看推理行（Solve 分栏的紧凑版，不复制其版式）
- 空对话首屏：3 枚场景化快捷卡（「跑查新」「全案体检」「起草一节」），点击即发对应指令
- 1 PR

### 批85-D｜附图部件号映射层（前后端）
- `figures` 台账加 `labels: [{num, name}]`；lint 新增 `figures.mark_consistency` 消费它
- 前端附图书加标号-名称列表编辑位
- 1 PR

### 批86（预研，不动生产）：XML 递交
- 独立 spike：国知局工具下载实测 + patent-xml-generator schema 对照 + content.md→cn-application-body 映射草案
- 产出可行性报告再定实施——不承诺本轮落地

### 缓置（记 obs-pool 不入批）
- D 风格画像（等模板库 hint 字段设计成熟）
- G OA 特征差异表（等 OA 拆条数据稳定）
- H watcher（等期限通知流稳定）

## 工程纪律
- 每批：分支 `devin/$(date +%s)-w15-<slug>` → `fetch_pr_template` → PR → pytest/vitest/tsc/ruff/oxlint 全绿 → CI 绿自动并 → memory 记经验
- 红线：写面只产提案；`no_legal_verdict` 不动；不引入 <7 天新依赖；测试不为你改断言
