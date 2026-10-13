# 03 · 波次 6 视觉方向 C「专业工具式高密度」（key `c-pro-dense`）

> 角色：资深 UI 设计师（company-os `roles/design/ui-designer.md`）。分支 `devin/w6-visual-c-pro-dense`（基于 `devin/wave5-integrated`）。**只做设计探索：未改任何产品代码、不开 PR。**
> 产出物：本文档 · 纯静态原型 `docs/archive/design-system/prototype-w6-c-pro-dense/`（`index.html` 可切屏/切深浅色/切 1440·375 视口）· Chrome 真实截图 48 张 `docs/archive/design-system/w6-c-pro-dense/shots/` · 一手参考截图与 computedStyle 探针 `docs/archive/design-system/w6-c-pro-dense/ref/`。
> 证据标注：`[实测]` 我亲自截图 / computedStyle / 对比度实算；`[源码]` 开源仓库文件路径；`[官方文档]` 官方设计规范页（附截图）；`[W5]` 波次 5 现状（`frontend/src/index.css` 与 `02-w6-page-audit.md`）；`[推断]` 未验证的判断。

---

## 0. 设计主张（≤ 1 页）

**给每天过手几十案的代理师一把"专业工具"，不是一张"网页"。**

老板对波次 5 的评价是"这跟没改差不多"。审计（`02-w6-page-audit.md`）给出了数据原因：面与面明度差 ≤ 0.066、96% 圆角 4px、无阴影分层、字号 71% 集中在 12–13px、页面无 H1、按钮高度 14 档、品牌绿一色 13 义、深色 = 反色单层。**这些不是 token 命名问题，而是"没有层次、没有秩序、没有重点"。** 方向 C 用四条可以肉眼验证的规则回答它：

1. **三面分层 + hairline，而不是一片白。** 壳（顶栏/rail/侧栏/状态栏）用 `--bg-app`（L 0.982），内容面（表格/编辑器/卡片）用 `--bg-panel`（L 1.0），下沉面（输入/看板列/代码）用 `--bg-sunken`（L 0.958），浮层用 `--bg-elevated` + 阴影。面与面之间总有 1px `--border`（L 0.925）。深色沿用 VS Code Dark Modern 的四层结构（`#181818` 壳 / `#1F1F1F` 编辑器 / `#2B2B2B` 线 / `#313131` 控件）`[源码]`，而不是把 `--n9` 铺满。→ 修正 audit #4 #11。
2. **密度来自"小控件、大标题"，而不是"全都 12px"。** UI 基准 13px、控件 28/32 两档为主（Linear 导航 32 高 13px `[实测]`、VS Code 13px `[源码]`），但页面必有一个 20–24px/600 的 H1，卡片数字 24px tabular。字号阶 7 档不变、**用法变**：把"多留白"换成"多信息"，把"多档字号"换成"少档但有落差"。→ 修正 audit #5 #6。
3. **状态用色点，品牌绿只留 3 义。** 案件 10 态 = 8px 色点 + 13px 文字（Linear issue status `[实测]`），期限用 4 档热度条（`--heat-0..3`），徽章只留语义 4 类。品牌绿仅用于**主动作 / 焦点环 / 链接**，在线点用 `--ok-dot`、未读用 `--info-dot`、激活 Tab 用 `--fg-strong` 下划线。→ 修正 audit #7 #23 #24。
4. **工作台 = 源码 ‖ 版面 ‖ PDF 三栏 + 24px 状态栏，伴随面板永远在右侧。** 首屏只有 rail 40 + 文件树 240 + 两个/三个文档栏；协作者/审阅/历史/AI 一律 320/360 右抽屉，**不顶掉源码 Tab**；构建/协同/AI 任务/字数/段号住在状态栏，"构建"只出现一次。移动端切换为**审阅优先**：44px 顶栏 + 56px 底 Tab，chrome 预算 ≤ 140px，选块后的浮条改为底部 44px 大按钮条，Markdown 输入改为快捷键盘。→ 修正 audit #1 #2 #3 #8 #10 #13 #16。

**沿用 Overleaf 的**（`00-benchmark.md` 已有结论，不重做）：rail 40 + 侧栏 240 + 右抽屉 320 的三段壳、PDF 工具条 32、`tabular-nums`、Drawer 伴随而非 Dialog、危险菜单项置底。**不沿用 Overleaf 的**：绿色顶栏（改为中性壳，绿只做主动作）、pill 主按钮（改 4/6px 圆角）、面板名 = 书名的双层 Tab。

**不做的**：3D、渐变堆砌、装饰动效、第二套组件库、非 lucide 图标、彩色大徽章、营销站式大留白。

---

## 1. 一手参考（本波次新增，全部附截图）

| 来源 | 我看到了什么（`[实测]` computedStyle 见 `ref/probe.json`） | 取什么 / 不取什么 |
|---|---|---|
| Linear 官网 [linear-home](https://app.devin.ai/attachments/77eae2fc-5ef6-4f6e-982e-615ae64d6590/linear-home-1440.png) · [changelog](https://app.devin.ai/attachments/be5be7df-c5a4-485f-a57b-5e11f78d23fd/linear-changelog-1440.png) · [docs/keyboard](https://app.devin.ai/attachments/03d3ff12-1195-466c-83c5-8971a86e57a1/linear-docs-keyboard-1440.png) | body `Inter Variable` 16/24；导航项 **32 高 / 13px / 400**，文字 `rgb(138,143,152)` on `rgb(8,9,10)`；主按钮 32 高 14px/510 `rgb(94,106,210)`；圆角 6 / 9999（chip） | 取：32 高 13px 的导航密度、次级文字用灰 7 阶、状态色点、快捷键 kbd 前置。不取：紫蓝主色（我们是专利机构，主色留绿）、营销大字。 |
| Raycast 官网 [raycast-home](https://app.devin.ai/attachments/41bb8888-b4c9-406b-bb0d-44a71b6e6321/raycast-home-1440.png) | 壳 `rgb(7,8,10)`，Inter 系字体，命令面板 = 大输入 + 32px 项列表 + 右侧 kbd | 取：命令面板项高 32、kbd 右对齐、深色壳极暗但控件面更亮（两层）。 |
| VS Code 主题 `[源码]` `microsoft/vscode: extensions/theme-defaults/themes/dark_modern.json` `light_modern.json`（本地副本 `/home/ubuntu/w6ref/vscode/`；[文档截图](https://app.devin.ai/attachments/51f9b135-1a93-4760-9b28-342ca30a4bc2/vscode-theme-color-1440.png)） | Dark Modern：`activityBar/panel #181818`、`editor #1F1F1F`、`border #2B2B2B`、`input #313131`、`input.border #3C3C3C`、`focusBorder/button #0078D4`；Light Modern：`activityBar #F8F8F8`、`editor #FFFFFF`、`border #E5E5E5`、`input.border #CECECE`、`focusBorder #005FB8` | 取：**四层面结构**与"壳暗于编辑器"的深色逻辑、`#F8F8F8/#FFFFFF/#E5E5E5` 的浅色三阶（我们的 g1/g0/g3 与之同级）。不取：蓝色焦点（改品牌绿）。 |
| Fluent 2（Word for Web）`[官方文档]` [Button](https://app.devin.ai/attachments/46a39c9a-9085-4b1e-8ecd-fc307b210a8e/fluent2-button-1440.png) · [Typography](https://app.devin.ai/attachments/90d63ec8-c8e1-4707-b135-752c691794b5/fluent2-typography-1440.png) · [Elevation](https://app.devin.ai/attachments/08623c7c-87a3-40a0-87f1-d3345618ee2b/fluent2-elevation-1440.png) | 按钮 32 高、14px/600、圆角 4；字阶 12/14/16/20/24/28…；阴影 2/4/8/16/28/64 六档（我们只取 3 档） | 取：按钮 medium 32 + semibold、圆角 4 随尺寸、阴影按"浮层高度"而不是按"好看"。不取：Segoe 专属字体。 |
| Overleaf `[源码]`（`00-benchmark.md` 已提取，沿用） | rail 40、侧栏 230→240、review 320、PDF 工具条 32、file-tree 行 28 | 全部沿用（见 §5 复合组件），理由：它是代理师已经习惯的"编辑器 + 预览"心智。 |

---

## 2. Token 决定表（单一真源 `prototype-w6-c-pro-dense/tokens.css`）

对比度全部为 OKLCH→sRGB→WCAG 实算 `[实测]`（脚本见本文 §9）。"现状"来自 `frontend/src/index.css` `[W5]`。

### 2.1 灰阶（冷灰 12 阶，色相 255）

| token | 值 (OKLCH) | ≈ hex | 用途 | 与现状差异 | 来源 |
|---|---|---|---|---|---|
| `--g0` | `1 0 0` | #ffffff | 内容面、纸面 | = `--n0` | — |
| `--g1` | `0.982 0.002 255` | #f8f9fa | **壳底**（顶栏/rail/侧栏/状态栏） | 新增一阶；现状壳与面同为 n0 白 → 无区块感（audit #4） | VS Code light `#F8F8F8` `[源码]` |
| `--g2` | `0.958 0.004 255` | #eff1f4 | 下沉面 / hover | 现状 n1 0.970 只当 muted 用 | Linear 卡面 `[实测]` |
| `--g3` | `0.925 0.006 255` | #e4e6ea | **hairline 边框** | 现状 `--border: n2 0.934` 但很少画；本方向每两面之间必画 | VS Code light `#E5E5E5` `[源码]` |
| `--g4` | `0.870 0.008 255` | — | 强边框 / 输入框边 | ≈ n3 | VS Code `input.border #CECECE` |
| `--g5` | `0.760 0.012 255` | — | 禁用文字 | ≈ n4 | — |
| `--g6` | `0.565 0.016 255` | — | 占位 / subtle 文字（白底 **4.5:1**） | 现状 placeholder n5 0.671 ≈ 3.4:1 `[推断]` 未达 4.5 | 实算调到 4.5 |
| `--g7` | `0.520 0.018 255` | #686f79 | 次级文字（白底 **5.4:1**） | 现状 muted n6 0.549 | Linear 次级 `rgb(138,143,152)` 在暗底 `[实测]` 同级 |
| `--g8` | `0.420 0.020 255` | — | 标签文字 | ≈ n7 | — |
| `--g9` | `0.300 0.020 255` | #272e38 | 正文（白底 **13.6:1**） | 现状 foreground n9 0.250 更黑；放松一级换层次 | — |
| `--g10` / `--g11` | `0.220` / `0.150` | — | 标题 / 强调 | 现状无 0.15 阶 → 标题和正文一个黑 | Linear 标题 `#F7F8F8` 反相 |

**灰阶文字从 2 阶变 4 阶**（strong / fg / muted / subtle），这是"看得出有主次"的直接来源（audit：现状灰阶文字 2 阶）。

### 2.2 品牌色与语义色

| token | 值 | 对比度 `[实测]` | 与现状差异 | 来源 |
|---|---|---|---|---|
| `--brand-600` 主动作 | `oklch(0.520 0.150 152)` ≈ #008039 | 白字 **5.07:1** | 现状 green-600 `0.549 0.145 151` 白字 ≈ 4.4:1 `[推断]`；压深一级 | Fluent primary 白字 ≥ 4.5 `[官方文档]` |
| `--brand-700/800` | `0.460` / `0.400` | 800 on 白 **8.66:1** | hover / active / 链接 | — |
| `--brand-100` | `0.955 0.030 155` | — | 选中行软底（仅此一处软绿） | 现状 green-50 用于 6 处 |
| **品牌绿用途** | 主动作 · 焦点环 · 链接 | — | **13 义 → 3 义**（audit #7）：在线点→`--ok-dot`、未读→`--info-dot`、激活→`--fg-strong` 下划线、开关 on→`--primary`（保留，属"主动作"）、状态→`--st-*` | Linear 状态色点 `[实测]` |
| `--info/ok/warn/danger` fg on bg | 6.09 / 6.48 / 6.04 / 6.30 | 均 ≥ 4.5 | 现状 `--info-foreground` 等有 3 处用白字压彩底 | 实算 |
| `--*-dot` | L 0.60–0.72 | — | **新增**：仅做 8px 点，不做文字 | Linear |
| `--st-intake…closed` 10 态 | 见 tokens.css | — | 现状 status 用 pill 底色；本方向点 + 文字 | Linear |
| `--heat-0..3` | muted / info / warn / danger | — | **新增** 期限 4 档：>30 天中性、≤30 信息、≤7 警示、≤3 或逾期危险 | 台账需求 `[推断]` 阈值待代理师确认 |

### 2.3 深色（一等公民，非反色）

| token | 值 | 对比度 `[实测]` | 与现状差异 | 来源 |
|---|---|---|---|---|
| `--bg-sunken` | `oklch(0.160 0.006 260)` | — | 输入/看板列 | VS Code `#181818` |
| `--bg-app` 壳 | `0.175` ≈ #0f1113 | — | 现状 `--n9 0.250` 单层 | Linear `#08090A` 与 VS Code `#181818` 之间 |
| `--bg-panel` 内容面 | `0.215` ≈ #181a1c | fg 11.8:1 | **面比壳亮**（现状同为 n9） | VS Code editor `#1F1F1F` 亮于 activityBar |
| `--bg-elevated` 浮层 | `0.255` ≈ #212326 | — | 新增第四层 | VS Code `input #313131` |
| `--border` | `0.300` ≈ #2b2e32 | — | 现状 n7 0.441 过亮刺眼 | VS Code `#2B2B2B` |
| `--fg / strong / muted / subtle` | `0.870 / 0.960 / 0.680 / 0.630` | 11.8 / 15.6 / 6.1 / 5.0 | 现状 fg n1 0.970 满白 → 眩光 | Linear `#F7F8F8` 只用于标题 |
| `--primary`（暗） | `0.720 0.140 155` on-brand `0.140` | **8.49:1** | 现状 `0.700 0.123 157` | 实算 |
| `--paper` | `#ffffff` 恒白 | — | = 现状（硬约束） | 任务书 |
| 阴影 | 退化为 `0 0 0 1px --border` + 面色差 | — | 现状暗色阴影 0.4–0.45 黑 | VS Code 无阴影靠面差 `[源码]` |

### 2.4 字体 / 字阶 / 行高

| 项 | 值 | 与现状差异 | 来源 |
|---|---|---|---|
| `--font-ui` | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif` | 现状把 PingFang 放在 Segoe 前：Windows 上中西文混排西文会落到 YaHei；本方向西文先落系统 UI 字体，中文再落 CJK | Linear/Raycast 用系统栈 `[实测]`；不引入 Inter 网络字体（中文无收益） |
| `--font-mono` | `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC"` | 去掉 `JetBrains Mono Variable` 网络字体依赖 | VS Code 默认 |
| 字阶 7 档 | 11/12/**13**/14/16/20/24 | **档位不变**，用法变：H1 24（登录/空态）或 20（页面），区块 16，UI 基准 13，元信息 12/11；禁止 10 | Fluent 字阶 `[官方文档]`；Linear 导航 13 `[实测]` |
| 行高 | 16/16/18/20/22/26/30 | 现状 lh-lg 24、lh-xl 28、lh-2xl 32 → 收紧 2px 增密度 | Linear 13/19.5 `[实测]` |
| 字重 | 400 / 500 / 600，**不用 700** | = 现状 | Fluent semibold 按钮 |
| 等宽数字 | 案号/日期/计数/段号 `tabular-nums` | 现状仅部分列 | C10 |

### 2.5 间距 / 圆角 / 阴影 / 边框 / 动效

| 项 | 值 | 与现状差异 | 来源 |
|---|---|---|---|
| 间距 | 4pt：2/4/6/8/12/16/20/24/32/40 | = 现状 Tailwind 阶 | — |
| 圆角随尺寸 | `--r-xs 3`（≤28）/ `--r-sm 4`（32、输入）/ `--r-md 6`（36–40、卡片、菜单）/ `--r-lg 8`（对话框、抽屉、看板卡）/ `--r-xl 12`（移动 Sheet）/ pill 仅 chip、状态 | 现状 96% 为 4（audit #4） | Fluent small 2 / medium 4 / large 6 / xlarge 8 `[官方文档]`；C2 |
| 阴影三档 | `--sh-sm: 0 1px 2px .06 + 0 0 0 1px border`（卡/表格/浮条）· `--sh-md: 0 4px 12px -2px .12 + ring`（菜单/popover）· `--sh-lg: 0 16px 40px -8px .22 + ring`（对话框/抽屉/Sheet）· `--sh-paper` 纸 | 现状三档存在但**全站几乎没用**（audit #4 "无阴影分层"）；本方向每个卡片/浮层必用，且阴影里**内含 1px 环**保证深色也有边界 | Fluent elevation 2/8/16 `[官方文档]` |
| 边框 | 1px `--border`；输入框/强边 `--border-strong`；焦点 `0 0 0 2px --ring` 外描边 | 现状边框很少画 | VS Code `focusBorder` `[源码]`；C7 |
| 动效 | 颜色 150ms · 快反馈 120ms · 面板显隐 200ms 透明度；`cubic-bezier(.2,0,0,1)`；`prefers-reduced-motion` → 0ms | 现状 100/150/200/300 四档 → 收为三档 | C28 |
| 控件高 | 24（状态栏内）/ **28** / **32** / 36 / 40 / 44（触控） | 现状 14 档（audit #6）→ 6 档且桌面以 28/32 为主 | Linear 32 `[实测]`；Fluent 32 `[官方文档]`；C1 |
| 壳尺寸 | 顶栏 40 · 状态栏 24 · rail 40 · 侧栏 240（200–400）· 抽屉 320 · AI 360 · PDF 工具条 32 · 移动顶栏 44 · 底 Tab 56 · 移动动作条 56 | = 现状 L2/L4，**沿用** | Overleaf `[源码]` |

---

## 3. 组件规格卡

规格截图：[CP 亮](https://app.devin.ai/attachments/b1eb20ad-5e41-4705-bbf2-6e7bf8a95a97/cp--1440-light.png) · [CP 暗](https://app.devin.ai/attachments/49428486-46bc-40e2-9d2b-a5199532c0e6/cp--1440-dark.png)（亮暗并排，修正 audit #25）。所有卡片按 **尺寸 / 间距 / 状态** 三项给出；CSS 见 `prototype-w6-c-pro-dense/proto.css`。

| 组件 | 尺寸 | 间距 / 排版 | 状态 | 对应规则 |
|---|---|---|---|---|
| **Button** sm/md/lg/xl | 高 **28 / 32 / 36 / 40**；圆角 3 / 4 / 6 / 6；icon 16；图标钮为正方 | 横 padding 8 / 12 / 14 / 16；字 12 / 13 / 14 / 14，500 | `default` 白底 + border-strong；`primary` brand-600 白字；`ghost` 透明 hover `--bg-hover`；`danger` 红字白底；`link` 无底；hover 加深一级、active `translateY(0)` 无位移、`:focus-visible` 2px 环、`disabled` 0.5、`loading` 保宽 + 旋转图标 | C1 C2 C3 C4 C7 C8 |
| **Split / Segmented / Chip** | split 32；seg 高 28（桌面）/ 36（登录）；chip 24 pill | seg 内 padding 2，项高 24 | seg 选中 `--bg-panel` + `--sh-sm`（Linear 式浮起） | C2 |
| **Input** sm/md/lg | 高 28 / 32 / 36（移动 44）；圆角 3/4/6 | 内 padding 8/10/12；前置图标 14/16；后置 kbd | 边 `--border-strong`；focus 边 primary + 2px 环；error 边 `--danger-dot` + 12px 红说明行 + `aria-invalid`；disabled 0.5 | C9 |
| **Select** | = Input 同高同角；右 chevron 14 | 项高 32 / 移动 44 | 自绘触发器，不用原生（audit #11 #23） | C11 |
| **Switch** | 32×18，圆点 14 | 位移 14 | off `--g4`、on `--primary`；焦点环 | — |
| **Checkbox** | 16×16 r3，命中区 28×28 | 表格首列 | checked primary + 白勾 14 | C6（audit #21） |
| **Badge**（语义） | 高 20，pill，12/500 | padding 0 8；可前置 12 图标 | ok/warn/danger/info/neutral 五底 + fg 6:1 | C18（本方向由 22 压到 20，因为主要靠状态点） |
| **Status dot**（案件状态） | 点 8，文字 13 | gap 6 | 10 态色见 `--st-*`；hover 显示状态选择器 | audit #7 |
| **Tag** | 高 20，r4，中性底 `--bg-sunken` + `--g8` 字 12 | padding 0 6 | 不与徽章共色 | C19 |
| **Avatar** | 24 / 32 / 40，圆 | 组重叠 −8，最多 5 + `+N` | 在线点 8 `--ok-dot` 右下；4 个用户各一色 OKLCH L0.55 | C20（去掉 `red-500` 硬编码，audit #23） |
| **Heat**（期限） | 高 20，r3；条 28×3 | padding 0 6 0 4 | 4 档 fg/bg + 条长度 = 剩余比例 | 新增 |
| **Menu / Command** | 项高 **32**（移动 44）；菜单 r6 `--sh-md`；命令面板宽 560 | 项 padding 0 8；kbd 右对齐 | hover `--bg-hover`；danger 项红字 + 前置分隔线置底 | C11 C12 C27 |
| **Dialog** | 宽 400 / 560 / 800；r8 `--sh-lg` | 头 44、体 16、脚 12 右对齐 | ≤640 转全屏 Sheet（audit #22）；Esc / 焦点陷阱 | C13 C14 |
| **Drawer** | 320（AI 360）；从右滑入；无阴影，1px 左线 + `--bg-panel` | 头 40 + Tab 32 + 体 | 伴随不遮文档 | C15 L10 |
| **Sheet（移动）** | 底部，≤85vh，r12 顶角，抓手 36×4 | 项 44 | 遮罩 .4 | L17 |
| **Toast** | 高 ≥ 36，r6 `--sh-md`，宽 ≤ 360 | 图标 16 + 文字 13 + 一个 action 链 | 4 类左侧 3px 色边；`aria-live` | C16 |
| **Tooltip** | 高 24，r4，深底 `--g10` 白字 12 | 延迟 300ms；可含 kbd | 纯文字 | C17 |
| **Table row** | 行 **36**（cozy 40，移动卡 ≥ 48）；表头 28，12/500 muted | 单元 padding 0 12；首列勾选命中 28 | hover `--bg-hover`；selected `--bg-selected` + 左 2px primary；分组行 32 `--bg-app` 可折叠 | C21 L11 L12 |
| **Tree node** | 行 **28**；缩进 14/级；chevron 12；图标 16 | meta 右对齐 11 muted | selected `--bg-active` + `aria-selected`；`role=treeitem` | C29 |
| **Empty** | 图标 40 muted + 标题 14/500 + 一句 12 + 一个 sm primary | 垂直居中 gap 6 | — | C23 |
| **Skeleton** | 高 12 r3，形状 = 最终布局 | 300ms 后出现，1.2s 呼吸 | reduced-motion 停止 | C24 |

---

## 4. 复合组件

| 复合组件 | 规格 | 修正的 audit |
|---|---|---|
| **顶栏**（桌面 40） | 左：logo 24 + 面包屑 `机构 › 案卷 › 书`（13，当前层 strong）；中：无；右：28 高控件组（搜索 ⌘K 200 宽、在线头像组、通知点、**唯一 primary "构建 PDF ⌘B"**、账户 24 头像）。全部 `--bg-app` + 底 1px。 | #10 #16 |
| **Rail**（40） | 20px lucide 图标，命中 32×32，间距 4；激活 = 左 2px `--fg-strong` 条 + `--bg-active`；底部：控制台、设置、深浅色（不再藏在文件菜单，#17） | #17 |
| **文件树 / 大纲**（240） | 头 32（案卷名 + 更多）；**作者视角**只显示五书 + 附图 + 附件；`studio.json`、`.emf` 归入"高级 › 项目文件"折叠组默认关闭 | #18 |
| **PDF 工具条**（32） | 页码输入 40 宽 + `/ 23`、缩放 seg、`选块定位` toggle、构建号 + 时间（不再放"构建"按钮） | #10 |
| **状态栏**（24） | 左：构建状态点 + `#47 · 10:31 · 23 页`、协同 3 在线、AI 任务 1 运行；右：段 `[0003]` · L55 · 字数 · 编码 · 主题；文字 11 muted，命中区 24 高 | #1 #10 |
| **协作者中心**（320 抽屉） | Tab 32：成员 / 公开链接 / 访问记录 / 设置；邀请行 = 输入 32 + 角色 select 32 + primary 32；成员行 48：头像 32 + 名/邮箱 + 角色 select 28 + 在线点；公开链接卡：URL mono + 允许批注 / 需确认 switch + 停用 / 重新生成 | #7 |
| **评论线程** | 头 24：头像 20 + 名 12/500 + 时间 11 + 状态徽章 20；引文 2px 左线 `--warn-dot`；正文 13/20；动作行 xs ghost 按钮 24（命中 28）；激活线程左 2px `--info-dot` | #21 |
| **Proposal 卡**（AI） | r6 `--sh-sm`；头 32：类型点 + 类型 + 定位 mono（权项 5 / [0049]）+ 右侧徽章；diff 行内 `del` 红 / `ins` 绿 13/20；理由 12 muted；脚 40：**一屏一个 primary "写入为修订"**，其余 ghost "忽略 / 批注 / 展开"；不再常驻供应商/模型运维信息（收进 ⋯ 菜单） | #19 |
| **看板卡** | 列 280 `--bg-sunken` r8；卡 `--bg-panel` r6 `--sh-sm`；卡内：案号 mono 11 → 标题 13/500 两行截断 → 脚：热度条 + 标签 + 头像 24 右；空列默认折叠为 40 宽竖条（10 列 → 默认只展开计数 > 0 的） | #20 |
| **期限倒计时** | 左 3px 热度色边，数字 24/600 tabular + "天" 12 + 右侧事项 12；4 档配色随 `--heat-*` | #9 |
| **状态徽章选择器** | 点击状态点弹出 menu：10 态各一行 32（点 + 名 + 计数），当前项 `aria-selected`；移动为 Sheet | #7 |

---

## 5. 页面版式（栅格 / 区块 / 1440 与 375 规则 / 深色）

通用：断点 640/768/1024/1280（L1）；壳尺寸 L2；主内容页最大宽 1280 居中（L13），工作台全宽；每页一个 H1（L19）；深色三面分层（§2.3）；纸面恒白。

| 屏 | 1440×900 栅格与区块 | 375×812 规则 | 深色要点 | 规则 |
|---|---|---|---|---|
| **S1 台账·列表** | 顶栏 40 · 左侧分组栏 240（视图 / 我负责的 / 状态组折叠 / 客户 / 标签，计数 > 0 才显示）· 右主区：今日条 32（3 天内 1 · 7 天内 3 · 待处理批注 5 · AI 建议 4，替代 4 个 KPI 卡）· 表格工具行 32（搜索 ⌘K / 分组 / 排序 / 列配置）· 表格：勾选 28 / 案号 mono / 标题 flex / 状态点 / 期限热度 / 责任人头像 / 客户 / 更新 · 分组行 32 可折叠 · 行 36 · 状态栏 24 | 顶栏 44：筛选 / "案卷 42" / 搜索 / **新建 44**；今日横滑 pill 32；筛选 chip 32；分组头 40 sticky；卡片 ≥ 48：案号 + 热度 · 标题两行 · 头像 20 + 客户 + 标签；底 Tab 56 | 壳 0.175 / 表 0.215；选中行 `--bg-selected` 深绿 | L11 L12 L13；audit #9 #20 #21 #8 |
| **S2 台账·看板** | 同壳；列 280 横滑，空列折叠 40；卡 r6 阴影；列头 36 含计数 + 添加 | 列宽 = 视口 − 32，横向 snap；每屏 1 列 + 下一列露 16px 边 | 列 `--bg-sunken` 0.160，卡 0.215 | L12；#20 |
| **S3 工作台默认** | 顶栏 40 · rail 40 · 树/大纲 240 · **源码 ‖ PDF 两栏 50/50**（1440 下默认两栏，≥1680 三栏）· 面板头 32（书名 + 源/版面/PDF 切换，不再双层 Tab）· PDF 工具条 32 · 状态栏 24；可编辑区 ≥ 560 | 见 S10b/c | 编辑器 0.215，壳 0.175，纸白 | L2 L3 L4 L7；#1 #10 |
| **S4 三视图** | 源码 ‖ 版面 ‖ PDF 三栏（源码 30 / 版面 35 / PDF 35）；PDF 选块 = 2px `#2563eb` 外框 + **浮条 32**（编辑块 / 批注 / 看源码 / AI 改写，右缘距 ≥ 8 防裁切）；双击 → **块编辑器 420 宽 r8 `--sh-lg`**，头 36 显示 `说明书 · 第 8 页 · [0003] · L55`，textarea mono 13/22，脚 32 primary 提交；源码同段行 `--bg-selected` 高亮 + 左 2px | 见 S10c | 块编辑器 `--bg-elevated` 0.255 | L5 L6 L7；#13 #14 |
| **S5 协作者中心** | 工作台 + 右抽屉 320（伴随，不顶 Tab）；Tab 32 四项；邀请行；成员列表行 48；公开链接卡；访问记录列表 | 全屏 Sheet（≤85vh）或整页 | 抽屉 0.215 + 左 1px 0.300 | C15 L10；#2 |
| **S6 AI 面板** | 右抽屉 **360**；Tab 32：对话 / 场景 / **建议 4** / 任务；Proposal 卡见 §4；底部输入 32 + 场景 `/`；供应商/模型放头部 ⋯ 菜单 | S10d：Tab 44 + 卡 + 输入 44 | 卡 0.215 在抽屉 0.175 上 | #2 #19 |
| **S7 递交页** | 顶栏 40（面包屑 + 返回工作台）；内容 1280 居中：H1 24 `递交 · 案名`（不再显示目录 id `method`）+ 4 步 stepper 28；主列 = 4 KPI 卡（23/0 · 2 · 11·130 · 287/300，24px 数字）→ 体检列表行 40（等级点 + 规则 id mono + 定位 / 查看建议 ghost 28）→ 导出三卡（DOCX / PDF / XML，**唯一 primary "生成 XML 包"**）；右栏 320 = 递交清单 / 递交记录 / 期限倒计时 | 单列；stepper 横滑；底部固定动作条 56 `生成 XML 包` 44 | KPI 卡 0.215 + 阴影环 | L13 L19；#6 #16 |
| **S8 登录/注册** | 左 50% 品牌区 `--bg-sunken`：logo + H1 24 + 流程 4 行 + 三视图缩略卡；右 50% 表单卡 400 宽 r8 `--sh-md`：登录/注册 seg 36、输入 36、**内联错误行 12 红 + `role=alert`**（不再用浏览器原生英文气泡）、primary 36 全宽 + ↵ | 单列，品牌区隐藏，输入/按钮 44 | 卡 0.215 浮于壳 0.175 | L14；#12 |
| **S9 客户审阅** | 顶栏 48：机构 logo + 案名 + `案号 · 机构 · 代理师 · 版本 · 截止`；PDF/版面 seg；右栏 320：机构/版本/截止/权限信息 + 批注线程；底部动作条 56：说明 + ghost "要求修改" + **primary "确认定稿 v12"**；纸面批注高亮黄 + 激活蓝 | S10f：顶栏 44 双行；批注浮卡；底动作条 64（两钮 44） | 纸恒白，壳深 | #15 |
| **S10 移动** | — | 顶栏 44 + 底 Tab 56 = **chrome 100px**（编辑 / AI Tab；预览 Tab 加 44 视图条 = 144，略超 L15 的 140，见 §9）（audit #3 为 302px）；编辑 Tab：sticky 段落条 40 + 无行号 14/24 源码 + 底部 Markdown 快捷键盘 44；预览 Tab：PDF/版面 seg + 选块后**底部浮条 4×44**；AI Tab：Tab 44 + Proposal 卡 40 按钮；更多 Sheet：44 项 + 外观 seg；客户审阅：见 S9 | 同深色 token | L15 L16 L17；#3 #8 #13 |

---

## 6. 与 benchmark C1–C30 / L1–L20 的逐条对照

| 规则 | 本方向 | 备注 |
|---|---|---|
| C1 四尺寸 | ✅ 28/32/36/40（+24 状态栏内、44 触控作为 xl 的移动映射） | 原型 `.btn-sm/.btn/.btn-lg/.btn-xl` |
| C2 圆角随尺寸 | ✅ 3/4/6/6，pill 仅 chip/badge | 修正现状 96% 4px |
| C3 一屏一 primary | ✅ 每屏标注：S1 新建、S3/S4 构建、S5 邀请、S6 写入为修订（首卡）、S7 生成 XML 包、S8 登录、S9 确认定稿 | S6 第 2、3 张卡降为 default |
| C4 主动作 ≥ 14 | ⚠️ 桌面 32 主按钮 13px，36/40 为 14 | **有意偏离**：高密度方向下 32 控件配 13（Linear `[实测]` 32/13–14）；若坚持 C4，主按钮统一 36。见 §8 tradeoff |
| C5 icon-only aria-label | ✅ 原型所有图标钮均有 `aria-label` | tooltip 由实现层补 |
| C6 命中区 | ✅ 桌面 ≥ 28（勾选/树/行内动作）、移动 ≥ 44 | audit #8 #21 |
| C7 焦点 2px 外描边 | ✅ `:focus-visible` `0 0 0 2px --ring` | — |
| C8 loading 保宽 | ✅ `.btn.loading` | — |
| C9 输入三档 | ✅ 28/32/36（+44 移动），错误态红边 + 12px 说明 | 本方向把工具栏输入压到 28 |
| C10 tabular-nums | ✅ `.num` 案号/日期/计数/段号 | — |
| C11 菜单项 32/44 | ✅ | — |
| C12 危险项置底 | ✅ `.menu-item.danger` + `.menu-sep` | — |
| C13 Dialog 三档 / ≤640 转 Sheet | ✅ 400/560/800 | CP 屏 |
| C14 焦点陷阱 | 实现层 | 原型不含 JS 陷阱 |
| C15 伴随用 Drawer | ✅ S5 S6 320/360 | — |
| C16 Toast 四类 | ✅ CP 屏 | — |
| C17 Tooltip 文字 | ✅ 24 高 | — |
| C18 徽章唯一规格 | ⚠️ 高 **20**（规则 22） | **有意偏离**：状态改用色点后徽章退为次级信息，20 更贴 36 行；如需与 A/B 方向统一可回 22 |
| C19 Tag/徽章分色 | ✅ | — |
| C20 Avatar 三档 / 组 | ✅ 24/32/40，重叠 8，+N | — |
| C21 表格 padding / 行高 | ✅ 36 默认（规则"紧凑 36"），cozy 40，表头 12/500 | 密度方向默认取紧凑 |
| C22 加载更多 | 实现层 | — |
| C23 空态 | ✅ | — |
| C24 骨架 | ✅ | — |
| C25 lucide 唯一 / 16·20·24 | ✅ 仅 lucide（`vendor/lucide.min.js`），16 行内 / 20 rail·移动 Tab | 移动 Tab 用 20 而非 24（密度方向），可调 |
| C26 语义 token 消费 | ✅ 原型 CSS 只写 `var(--*)`，例外：纸面批注色（`#2563eb` 选框、黄高亮）—— 纸面不随主题 | — |
| C27 阴影三档 | ✅ 且深色退化为环 | — |
| C28 动效 | ✅ 150/200 + reduced-motion | — |
| C29 树节点 | ✅ 28 行 / `role=tree` | — |
| C30 单一 `components/ui` | ✅ 不引入第二组件库；新增原语：`status-dot`、`heat`、`kbd`（已有）、`countdown` | 见 §8 |
| L1 断点 | ✅ | — |
| L2 壳尺寸 | ✅ 沿用 40/24/40/32/44/56 | — |
| L3 顶栏控件同高 | ✅ 顶栏 40 内控件 **28**（规则 32） | **有意偏离**：40 高顶栏放 28 控件上下留 6，比 32 留 4 更"呼吸"；Linear 顶栏 32 控件在 56 高栏 `[实测]` |
| L4 侧栏 240 / 抽屉 320 | ✅ | — |
| L5 A4 真实渲染 | 不涉及（内核） | 原型纸面为示意 |
| L6 源码 100ch | ✅ 原型未画标尺，实现层 | — |
| L7 面板折叠为 rail | ✅ rail 图标即面板开关 | — |
| L8 句柄 7px | ✅ `--w-handle` | — |
| L9 历史 = 模式 | 未画 | 本波次 10 屏不含历史；沿用规则 |
| L10 协作/评论伴随 | ✅ | — |
| L11 台账分组折叠 | ✅ | — |
| L12 表格 <768 转卡片 | ✅ S10a | — |
| L13 1280 居中 | ✅ S7 | — |
| L14 表单单列 ≤640 | ✅ S8 400 | — |
| L15 移动 chrome ≤140 | ✅ **100**（44+56） | audit 302 |
| L16 移动主动作右上 | ✅ 构建 / 新建 | — |
| L17 Sheet ≤85vh | ✅ | — |
| L18 面包屑 | ✅ 机构 › 案卷 › 书；移动只显当前 + 返回 | — |
| L19 单 H1 | ✅ 但 UI 壳 H1 用 **20–24/600**（规则 14–16） | **有意偏离**：audit #5"无 20–24 标题"是"像旧版"的主因之一 |
| L20 1440/375 截图 | ✅ 48 张；axe 未跑 | 见 §9 未验证 |

## 7. 与 audit top_problems 1–25 的逐条对照

| # | 问题 | 本方向如何修正 | 屏 |
|---|---|---|---|
| 1 | 首屏 5 区并列无主体 | 默认 2–3 文档栏，伴随面板收进 rail，编辑区 ≥ 560 | S3 |
| 2 | 面板顶掉源码 Tab | 全部右抽屉伴随 | S5 S6 |
| 3 | 移动 chrome 302px | 44 + 56 = 100；行号列去掉 | S10b |
| 4 | 圆角单一 / 无面差 / 无阴影 | §2.1 三面 ΔL ≥ 0.024 + hairline；圆角 3–12 五档；阴影三档必用 | 全 |
| 5 | 字号挤在 12–13、无 H1 | H1 20–24/600，KPI 数字 24，UI 基准 13 | S1 S7 S8 |
| 6 | 按钮 14 档 | 6 档，桌面 28/32 | 全 |
| 7 | 品牌绿 13 义 | 3 义；状态点 / 热度 / 语义点 | 全 |
| 8 | 移动触控 < 44 | 所有移动可点 ≥ 44（新建 / Tab / 快捷键盘 / 浮条 / Sheet 项） | S10 |
| 9 | 4 KPI 卡 3 个为 0 + 横幅 | 今日条 32 只显示 > 0 项，表格从 y≈112 开始 | S1 |
| 10 | 三处"构建" | 顶栏唯一 primary + 状态栏状态 | S3 S4 |
| 11 | 深色反色单层 / 原生 select | 四层 + 自绘 select | 全暗 |
| 12 | 登录原生英文气泡 / 无品牌区 | 内联 `role=alert` + 品牌区 + 卡阴影 | S8 |
| 13 | 浮条被裁 / 移动无浮条 | 浮条距右缘 ≥ 8；移动底部 4×44 浮条 | S4 S10c |
| 14 | 块编辑器无阴影无定位 | r8 `--sh-lg` + 头部 `书 · 页 · 段 · 行` | S4 |
| 15 | 客户页最素 | 机构 / 联系人 / 版本 / 截止 / 权限信息 + 动作条 | S9 S10f |
| 16 | 递交页 id 标题 / 三档按钮 / 无清单 | H1 案名 + stepper + 清单 + 28/32 两档 | S7 |
| 17 | 主题藏在文件菜单 | rail 底部 + 移动更多 Sheet "外观" | S3 S10e |
| 18 | `studio.json`/`.emf` 进树 | 作者树只显五书/附图/附件 | S3 |
| 19 | AI 面板 3 primary + 运维信息 | 首卡 primary，其余 default；运维进 ⋯ | S6 |
| 20 | 看板 10 列全展 | 空列折叠 40 宽；移动 1 列 snap | S2 |
| 21 | 命中区 16/20/24 | 勾选命中 28，动作按钮 24 高命中 28，移动 44 | S1 S9 |
| 22 | 对话框移动不转 Sheet / 原生日期 | Dialog ≤640 → Sheet；日期用 select+输入（实现层） | CP |
| 23 | 原生 select / `red-500` | 自绘 select；头像 4 色 OKLCH | S5 CP |
| 24 | 通知图标全绿 | 类型点 info/warn/danger/ok（本波次未画通知页，规则进 §2.2） | — |
| 25 | `__ds` 只是 token 表 | CP 屏亮暗并排 + 全组件态 | CP |

---

## 8. Tradeoffs

**这条方向牺牲了什么**

- **初见亲和力**：13px 基准 + 28/32 控件 + 灰阶 hairline，对偶尔使用的客户/新人不如 A/B 方向"友好"；我们用 S9/S10f 客户页放大到 14–15px + 44 触控来对冲，但桌面工作台不让步。
- **与 benchmark 的 4 处有意偏离**（C4 主动作 13、C18 徽章 20、L3 顶栏控件 28、L19 H1 20–24），若三方向要统一，这 4 处是谈判项。
- **深色调色成本**：四层面 + 每个语义色的暗色变体 + 阴影退化为环，比"反色"多一倍 token 维护量；但这正是 audit #11 的解法。
- **三栏并排对宽度敏感**：1440 下三栏各 ≈ 380，源码列 100ch 放不下；默认两栏、≥1680 三栏，用户可手动开第三栏。
- **状态点依赖色觉**：10 态用色点区分，色弱用户靠文字；点 + 文字并列是硬要求，不允许只有点。

**对现有代码改动量估计**

| 范围 | 估计 | 理由 |
|---|---|---|
| `frontend/src/index.css`（578 行） | **中** | 原始层 `--n0..n9` → `--g0..g11`（多 2 阶）、新增 `--bg-app/panel/sunken/elevated` 四面、`--*-dot`、`--st-*`、`--heat-*`、暗色整段重写、阴影加环；字阶/间距/壳尺寸/动效 **基本不动**（波次 5 已对齐）。语义层名字尽量保留（`--primary/--border/--muted-foreground`）以免全站 className 改动。约 150–200 行改动。 |
| `frontend/src/components/ui`（38 文件 / 1935 行） | **中** | 尺寸变体已存在（`h-control-sm/lg`），主要是：button 新增 `xl 40` 与圆角随尺寸；badge 高 22→20 + 新增 `StatusDot`、`Heat`、`Countdown` 三个小原语；select/dropdown/menu 项高对齐 32/44；dialog ≤640 转 sheet 逻辑；toast/tooltip 加环阴影。不换库、不动 Radix 结构。约 12 个文件小改 + 3 个新文件。 |
| Shell（`components/shell`、`mobile`、`dashboard`、`deliver`、`auth`、`client`） | **大** | 这是"肉眼可见"的来源：工作台默认布局（伴随面板改右抽屉、去双层 Tab、状态栏承载构建）、台账首屏（KPI → 今日条、分组栏、热度列）、递交页 IA（H1 + stepper + 清单）、登录页品牌区 + 内联错误、客户页信息区 + 动作条、移动壳（chrome 100、快捷键盘、底部浮条）。约 50k 行 tsx 中的 15–20 个页面/容器组件需要重排；数据层/路由/hash 不动。 |
| 内核（`patent_docx`、LibreOffice、Markdown 真源） | **零** | 硬约束；纸面恒白由 `--paper` 已保证。 |

估算口径：以我自己的吞吐计，token + ui 原语约 1 个会话，shell 重排约 2–3 个会话（可按页面并行拆分）。

---

## 9. 验证记录与未验证项

**已验证 `[实测]`**

- 原型在 Chrome（CDP `localhost:29229`）以 `file://` 直接打开；48 张截图由 `w6-c-pro-dense/shoot-proto.js` 用 `Emulation.setDeviceMetricsOverride` + `Page.captureScreenshot` 生成（1440×900 亮/暗、375×812 亮；S10 移动屏为 375 亮/暗 + 1440 亮）；**console error 0**（脚本捕获 `console.error` 与 `pageerror`）。
- 深浅色切换：`?theme=dark` / 原型条 ◐ 按钮 / `Shift+D`，持久化 `localStorage`；视口切换：`index.html?s=<file>&vp=1440|375`。
- 对比度：§2 表内所有数值为 OKLCH → linear sRGB → WCAG 相对亮度实算（Python，Björn Ottosson 公式）；最低 4.5:1（`--g6` 白底 4.5、暗 `--fg-subtle` 5.0）。
- 移动 chrome：S10a/b/d 顶栏 44 + 底 Tab 56 = 100px；S10c/e 预览 Tab 另有 44 视图条 = 144px（脚本 `getBoundingClientRect` 实量）。
- 移动触控目标：脚本遍历 375 视口下 `button/a/[role=button]/[role=tab]/input/select`，S10 六屏 **0 个 < 44px**（例外：`<input>` 内元素 42，其可点击 `<label>` 容器为 44；纸面内行内批注标记 `span.cm` 高 36 —— 行内文字高亮无法做到 44，靠右栏线程列表提供 44 命中区）。

**未验证 `[未验证]`**

- axe 扫描（原型为静态 HTML，未跑）；真机触控；`prefers-reduced-motion` 在真机的实际行为（CSS 已写）；屏幕阅读器读序。
- 期限热度阈值（30/7/3 天）为 `[推断]`，需代理师确认。
- 三栏并排在 1440 的实际可用性（原型 S4 为静态布局，未做拖拽）。
- 字体栈在 Windows 上的实际渲染（截图环境为 Linux Chrome，中文落 Noto Sans CJK）。

**截图（Chrome 真实截图，附件 URL）**

| 屏 | 仓库路径 | 1 | 2 | 3 |
|---|---|---|---|---|
| S1 台账·列表 | `shots/s1--*.png` | [1440-light](https://app.devin.ai/attachments/970348ac-df7e-42ee-ab00-fdd59e57db11/s1--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/33e01bc2-c79f-4066-93dc-afc7c58d2084/s1--1440-dark.png) | [375-light](https://app.devin.ai/attachments/e4315ac9-a1a4-4616-86ad-7f11df687637/s1--375-light.png) |
| S2 台账·看板 | `shots/s2--*.png` | [1440-light](https://app.devin.ai/attachments/575c73b9-bcb4-4bb8-90af-8b3675b4a15d/s2--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/52e34f88-993b-4f4f-8266-d7a8b350e0aa/s2--1440-dark.png) | [375-light](https://app.devin.ai/attachments/85395536-e060-4f9d-a662-d4f595a91261/s2--375-light.png) |
| S3 工作台默认 | `shots/s3--*.png` | [1440-light](https://app.devin.ai/attachments/d5020390-a561-4d59-965d-837ed8d83f24/s3--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/257ba511-e808-4edd-ab74-3933347b76b8/s3--1440-dark.png) | [375-light](https://app.devin.ai/attachments/b478bde0-dc43-4de4-8dca-b4aceea47ff4/s3--375-light.png) |
| S4 三视图·版面编辑+选块+块编辑器+源码联动 | `shots/s4--*.png` | [1440-light](https://app.devin.ai/attachments/264f4b0e-1e14-41f0-9502-0160208fd6fc/s4--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/f2e9d856-fc67-4cec-8790-83e8d5c46fed/s4--1440-dark.png) | [375-light](https://app.devin.ai/attachments/fe9dc84f-2faa-48b5-91ef-3ad28e176c52/s4--375-light.png) |
| S5 协作者中心抽屉 | `shots/s5--*.png` | [1440-light](https://app.devin.ai/attachments/4710b0e7-41a5-4bee-8f25-dcfed43e1095/s5--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/55cf5a29-b4d7-45f9-882e-ff70b766eff0/s5--1440-dark.png) | [375-light](https://app.devin.ai/attachments/0bfec1cb-6ffe-4d6d-9339-bcf2e82a9c3d/s5--375-light.png) |
| S6 AI 智能体面板 | `shots/s6--*.png` | [1440-light](https://app.devin.ai/attachments/75c21255-c3bb-46c2-8ac8-0cc404329c80/s6--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/d9ac104d-2fa1-49d1-ac1b-d2d324f6d029/s6--1440-dark.png) | [375-light](https://app.devin.ai/attachments/04871056-250e-4b7a-bb76-6b2c557c1837/s6--375-light.png) |
| S7 递交页 | `shots/s7--*.png` | [1440-light](https://app.devin.ai/attachments/43fbb1ea-77be-4dad-8910-1115c297fee0/s7--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/3c7ea003-c9e7-4654-bb58-62cc842fe0e7/s7--1440-dark.png) | [375-light](https://app.devin.ai/attachments/b0fa7c2d-3558-448e-97bd-b8a3e24d1d66/s7--375-light.png) |
| S8 登录/注册 | `shots/s8--*.png` | [1440-light](https://app.devin.ai/attachments/e4d44bf7-a83a-4400-99c2-90d463ebc86d/s8--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/94cd41cb-09a3-41a4-8cbf-0bf84c38aae7/s8--1440-dark.png) | [375-light](https://app.devin.ai/attachments/b63516fd-99f1-42ce-8d44-381b02a73354/s8--375-light.png) |
| S9 客户免登录审阅 | `shots/s9--*.png` | [1440-light](https://app.devin.ai/attachments/1f0b75c5-7276-40c0-bbdd-8021c8819b77/s9--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/ea64757d-5404-40cc-aff5-0de9eff3135d/s9--1440-dark.png) | [375-light](https://app.devin.ai/attachments/b26d41ff-e54c-412d-ac06-06b049aa6b1f/s9--375-light.png) |
| S10a 移动·台账 | `shots/s10a--*.png` | [375-light](https://app.devin.ai/attachments/240e85ea-da3e-4291-b626-9a9b9ad3fcd9/s10a--375-light.png) | [375-dark](https://app.devin.ai/attachments/04c35b31-6701-4c3b-920d-a2e63dfbe919/s10a--375-dark.png) | [1440-light](https://app.devin.ai/attachments/c7f88d3c-2cd1-46d9-8cff-01dc9c225413/s10a--1440-light.png) |
| S10b 移动·工作台 编辑 Tab | `shots/s10b--*.png` | [375-light](https://app.devin.ai/attachments/101188e4-b6ec-485e-896a-eb714f51bbe0/s10b--375-light.png) | [375-dark](https://app.devin.ai/attachments/d70c6352-e11c-4452-abad-7986bed42221/s10b--375-dark.png) | [1440-light](https://app.devin.ai/attachments/3c50ca37-fbd4-49b6-af36-e22490fbf209/s10b--1440-light.png) |
| S10c 移动·工作台 预览 Tab | `shots/s10c--*.png` | [375-light](https://app.devin.ai/attachments/8209866c-9661-433f-9464-55997b3ca170/s10c--375-light.png) | [375-dark](https://app.devin.ai/attachments/4759ef5f-e085-4111-b1ca-bc8a75236492/s10c--375-dark.png) | [1440-light](https://app.devin.ai/attachments/5a41f3f9-936b-4cd7-b93e-e68b77c05f30/s10c--1440-light.png) |
| S10d 移动·工作台 AI Tab | `shots/s10d--*.png` | [375-light](https://app.devin.ai/attachments/cdf67e2c-7a92-49f3-a047-2c91e6e96a6b/s10d--375-light.png) | [375-dark](https://app.devin.ai/attachments/3ad0daff-8a42-4c20-a49a-a6b47f741d37/s10d--375-dark.png) | [1440-light](https://app.devin.ai/attachments/5b56d752-3698-4345-8429-7b51ea30613d/s10d--1440-light.png) |
| S10e 移动·更多 Sheet | `shots/s10e--*.png` | [375-light](https://app.devin.ai/attachments/b6645e64-b65f-454b-8b7c-605294d54088/s10e--375-light.png) | [375-dark](https://app.devin.ai/attachments/851f8cc7-7d1a-4def-8947-d1ca5d891901/s10e--375-dark.png) | [1440-light](https://app.devin.ai/attachments/9242f14e-5b82-4cdf-8fc8-d0787d48d926/s10e--1440-light.png) |
| S10f 移动·客户审阅 | `shots/s10f--*.png` | [375-light](https://app.devin.ai/attachments/31019f5b-917f-44c9-82be-518e1171c49f/s10f--375-light.png) | [375-dark](https://app.devin.ai/attachments/8bd395e4-7a6d-4d5e-9f6b-9fa1a7ff5539/s10f--375-dark.png) | [1440-light](https://app.devin.ai/attachments/7c202a20-42e3-47fd-8e36-bcda02960cb6/s10f--1440-light.png) |
| CP 组件规格卡（亮暗并排） | `shots/cp--*.png` | [1440-light](https://app.devin.ai/attachments/b1eb20ad-5e41-4705-bbf2-6e7bf8a95a97/cp--1440-light.png) | [1440-dark](https://app.devin.ai/attachments/49428486-46bc-40e2-9d2b-a5199532c0e6/cp--1440-dark.png) | [375-light](https://app.devin.ai/attachments/89f4d901-05f3-47ec-9643-03771afc64da/cp--375-light.png) |

参考截图：`docs/archive/design-system/w6-c-pro-dense/ref/`（Linear ×3、Raycast ×1、Fluent 2 ×3、VS Code ×1、`probe.json` computedStyle 探针）。
