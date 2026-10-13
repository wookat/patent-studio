# W6 · 方向 B · 文档产品式极简（飞书 / Notion 向）— `b-editorial-clean`

- 分支：`devin/w6-visual-b-editorial-clean`（基于 `devin/wave5-integrated`）；**只做设计探索，不改产品代码，不开 PR**
- 角色：资深 UI 设计师（company-os `roles/design/ui-designer.md`）
- 原型：`docs/archive/design-system/prototype-w6-b-editorial-clean/`（纯静态 HTML + `tokens.css` + `proto.css` + `proto.js`；lucide CDN；`index.html` 为入口，右下角原型条切换亮/暗，`viewer.html?screen=…` 以 375×812 视口预览移动屏）
- 截图：`docs/archive/design-system/w6-b-shots/`（Chrome/Playwright 真实截图，1440×900 亮 / 1440×900 暗 / 375×812 亮）；附件 URL 见 §7
- 竞品一手证据：`docs/archive/design-system/w6-b-refs/`（22 张截图 + `computed-samples.json` getComputedStyle 抽样），来源与结论见 §6
- 证据标注：**[实测]** = 我亲自截图 / getComputedStyle / 本地 python 计算；**[源码]** = Overleaf 开源仓库路径（沿用 `00-benchmark.md` 已提取结论）；**[推断]** = 未直接测量的判断

---

## 1. 设计主张（≤ 1 页）

**一句话**：把 Patent Studio 从"控制台"变成"文档"。UI 壳退到纸面之后：白底、几乎没有边框、用留白和字重分层、灰阶细腻到 4 阶文字 + 10 阶面；品牌绿只在**主动作与选中态**出现；Overleaf 只保留两样心智——PDF 工具条和绿色"构建"。

**为什么这条方向能"肉眼可辨地不同"**（对照 audit Top-25）：

| 波次 5 现状（audit） | 方向 B | 视觉后果 |
|---|---|---|
| 圆角 96% 为 4px，面与面明度差 ≤ 0.066，无阴影分层（#4） | 圆角随尺寸 6 / 8 / 12 / 16；面只有 2 阶（白 + `#F7F7F5` 暖灰），但**边线降到 8% 黑**、卡片/菜单/浮条用三档阴影 | 页面"变白变轻"，区块靠留白与阴影而不是框线成立 |
| 字号 71% 在 12–13px，无 H1（#5） | 每页一个 24/32（台账、递交）或 28/36（登录）标题，正文 14/22，说明 13/20；字重只用 400/500/600 | 首屏立刻有"标题—正文—说明"的三级层次 |
| 按钮 14 档高度、主动作 28（#6） | 四档 28/32/36/40 + 移动 44；主动作固定 36（桌面）/44（移动），且一屏一个 | 主动作明显、可数 |
| 品牌绿 13 义（#7） | 绿只做 primary / 选中 / 链接 / 在线点；状态徽章走 10 档语义低饱和色；未读用 `--danger` 小圆点 | 绿色变稀缺，出现即意味着"下一步" |
| 深色 = 反色，`--n9` 单层（#11） | 深色 4 层面（#191919 / #202020 / #252525 / 画布 #111）+ 9% 白线；**纸面恒白**，主色换为 `#3DBB7C` 深字 | 深色下仍能分出侧栏 / 内容 / 弹层 |
| 工作台 5 区并列、可编辑区 480px（#1） | 顶栏 44 → rail 48 + 树 240 + 源码 | PDF 各半；伴随信息一律右侧 320 抽屉；树可折进 rail | 源码区 ≥ 550px（1440） |
| 移动 chrome 302px（#3） | 顶栏 44 + 底部 Tab 56 = 100px；段控件并入顶栏或纸面浮条 | 内容占比 ≥ 87%（812 视口，实测截图） |

**不牺牲的东西**：专业工具的信息密度（台账行 44、树行 30、菜单项 32）、Word 对齐纸面恒白、lucide 唯一图标库、`components/ui` 单一原语目录。**牺牲的东西**（详见 §8）：Overleaf 深色控制台的"沉浸感"、彩色 rail、装饰性渐变/插画——方向 B 明确是"素但有层次"，不是营销站。

---

## 2. Token 决定表

> 所有数值来自 `prototype-w6-b-editorial-clean/tokens.css`；"现状"来自 `frontend/src/index.css`（波次 5，OKLCH）；对比度为本地 python WCAG 2.x 相对亮度计算 **[实测]**。

### 2.1 中性灰阶（原始层 `--g0..g9`）

| Token | 方向 B（亮） | 方向 B（暗） | 现状 `--n*`（亮） | 差异 | 来源 |
|---|---|---|---|---|---|
| `--g0` | `#FFFFFF` | `#191919` | `oklch(1 0 0)` | 暗色底不再是 `--n9` 反色，而是 Notion 式 `#191919` | Notion 深色底 `rgb(25,25,24)`（"Get template" 按钮实测色即 Notion 墨色）**[实测]** |
| `--g1` | `#F7F7F5` | `#202020` | `oklch(.970 .002 248)`（冷） | 冷灰 → **暖灰**（hue 略偏黄），侧栏色 | Craft 首页 body 底 `rgb(252,249,247)` 为暖白 **[实测]**；Notion 侧栏 `#F7F7F5` **[推断]**（未登录，未能实测） |
| `--g2` | `#EFEFED` | `#262626` | `oklch(.934 .007 269)` | 段控件底 / 纸面画布 | 同上 |
| `--g3` | `#E3E2DE` | `#2F2F2F` | `oklch(.872 .012 260)` | 仅骨架/分隔备用 | — |
| `--g4` | `#C9C8C3` | `#454545` | `oklch(.772 .017 263)` | 开关关态底 / Sheet 抓手 | — |
| `--g5` | `#A5A39E` | `#6E6E6B` | `oklch(.671 .025 261)` | `--fg-4` 仅图标/禁用（2.52:1，不用于文字） | WCAG 非文字 3:1 例外 **[实测]** |
| `--g6` | `#73716B` | `#8F8E8A` | `oklch(.549 .030 259)` | `--fg-3` 说明/占位，白底 **4.88:1**、侧栏底 4.55:1 | 飞书正文 `rgba(0,0,0,.85)`、Notion 次级 `rgba(0,0,0,.54)` 均为透明黑叠加 **[实测]**；我们改为实色以便深色映射 |
| `--g7` | `#5F5E5A` | `#A3A29E` | `oklch(.441 .032 262)` | `--fg-2` 次要文字 6.49:1 | — |
| `--g8` | `#37352F` | `#D3D2CE` | `oklch(.346 .035 260)` | 备用（Notion 经典正文色） | Notion 正文 `rgb(55,53,47)` **[推断]**（公开页实测为 `rgba(0,0,0,.95)`，登录态色未测） |
| `--g9` | `#1F1E1B` | `#E8E8E4` | `oklch(.250 .022 257)` | `--fg` 主文字 16.67:1（暗 14.31:1） | 飞书标题 `rgb(31,35,41)` / `rgb(55,60,67)` **[实测]** |

**与现状差异总结**：现状 2 阶文字（`--foreground` / `--muted-foreground`）→ 方向 B **4 阶**（`--fg / --fg-2 / --fg-3 / --fg-4`）；现状冷灰 → 暖灰；深色不再反色而是独立 4 层面。

### 2.2 面 / 边 / 主色 / 语义色

| Token | 值（亮 / 暗） | 现状 | 差异与理由 | 来源 |
|---|---|---|---|---|
| `--bg` | `#FFF` / `#191919` | `--n0` / `--n9` | 内容底恒白（亮） | 飞书/Notion/Craft 三家公开页 body 均为白或暖白 **[实测]** |
| `--bg-side` | `#F7F7F5` / `#202020` | 无（侧栏与内容同色） | 新增：侧栏与内容形成 1 阶明度差，**唯一**允许的大面积灰 | Notion/飞书文档侧栏浅灰 **[实测截图 d-feishu-docs-product / d-notion-help-block]** |
| `--bg-hover / --bg-active` | `rgba(0,0,0,.04 / .07)` ；暗 `rgba(255,255,255,.055 / .09)` | `--accent` 实色 | 透明黑/白叠加，任何底色上都成立 | Craft docs 侧栏项 hover `oklab(… / 0.05)` **[实测]** |
| `--bg-selected` | `#F0FAF4` / `rgba(61,187,124,.14)` | `--primary-soft` | 选中态唯一允许出现主色底的地方 | 方向简报 |
| `--bg-elevated` | `#FFF` / `#252525` | `--popover = --surface` | 暗色弹层比底亮 1 阶（现状同色） | audit #11 |
| `--paper` | **`#FFFFFF` 亮暗同值** | `--n1`（灰！） | 现状纸面是 `--n1` 灰；方向 B 纸面恒白，画布 `--paper-canvas` `#EFEFED` / `#111` | 任务硬约束"纸面恒白" |
| `--line` | `rgba(0,0,0,.08)` / `rgba(255,255,255,.09)` | `--border = --n2`（实色） | 边线从实色 `--n2` 降到 8% 透明黑，视觉上"几乎没有边框" | Notion 输入框边 `1px rgba(0,0,0,.08)` **[实测 notion-templates]** |
| `--line-2` | `rgba(0,0,0,.14)` / `.16` | `--input = --n3` | 控件描边 | 飞书 secondary 按钮边 `rgb(187,191,196)` **[实测]**，我们更淡 |
| `--primary` | `#0E7C43` / `#3DBB7C` | `--green-600 oklch(.549 .145 151)` | 主绿加深一档，白字 **5.27:1**（现状 green-600 白字 [推断] < 4.5:1）；暗色主绿变浅、配黑字 8.06:1 | WCAG AA；Overleaf 绿"构建"心智 [源码 `stylesheets/ds/components/button.scss`] |
| `--primary-hover` | `#0A6336` / `#4CC38A` | `--green-700` | — | — |
| `--primary-soft / --primary-text` | `#DDF3E6` / `#0A6336`（6.33:1） | `--green-50 / --green-800` | 选中行、成功徽章 | — |
| `--fg-link` | `#0E7C43` / `#5FCB93` | `--primary-text` | 链接与主色同色系但只用于文字 | — |
| `--danger / -soft / -text` | `#B7472A / #FBEDE8 / #9A3A20`（6.13:1） | `oklch(.532 .163 27)` | 去饱和的砖红，避免"警报感" | 飞书 UD 色彩规范"功能色低饱和"**[实测截图 d-feishu-ud-color]** |
| `--warning / -soft / -text` | `#B45309 / #FDF3E3 / #8A3F06`（6.84:1） | `oklch(.688 .155 61)` | 现状 warning 白字对比不足 [推断]；方向 B 改为深字浅底 | — |
| `--info / -soft / -text` | `#2563EB / #EAF0FD / #1D4FBF`（6.29:1） | `oklch(.538 .142 259)` | 仅用于"信息"toast / 徽章 | — |
| `--st-*`（案件状态 10 档） | 低饱和底 + 深字，全部 ≥ 5.24:1（见下） | `--status-*-bg/fg/dot` 30 个 | 保留 hue，去掉 `dot` token（徽章内点用 `currentColor`） | 现状 hue 表 + WCAG 实测 |

案件状态徽章对比度 **[实测]**：intake 6.76 · drafting 6.48 · review 6.02 · client_review 5.24 · final 5.56 · filed 6.73 · oa 5.38 · granted 6.33 · rejected 5.71 · closed 5.64。

### 2.3 字体栈 / 字号阶 / 行高

| Token | 值 | 现状 | 差异 | 来源 |
|---|---|---|---|---|
| `--font-ui` | `-apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, "Segoe UI", sans-serif` | 系统栈（未显式中文优先） | 中文字体前置，避免落到 Segoe UI 的假粗体 | 飞书 `LarkHackSafariFont… -apple-system` **[实测]**；Notion `NotionInter, Inter, -apple-system` **[实测]** |
| `--font-code` | `"JetBrains Mono", "Sarasa Mono SC", ui-monospace, Menlo, Consolas, monospace` | ui-monospace | 源码视图；中文等宽兜底 | [推断] |
| 字号阶 | **8 档** 11/12/13/14/16/20/24/28 | 事实上 12–14 三档占 98%（audit） | 新增 20/24/28 三档标题；正文 14 | 飞书 UD H1 30/38 · H2 24/32 · H3 20/26 **[实测]**；Notion H2 20/30、Linear docs H1 40/44 H2 20/26.6 **[实测]** —— 我们取 24/32 作页级 H1（工具类产品比文档站小一档 [推断]） |
| 行高 | 11→16 · 12→18 · 13→20 · 14→22 · 16→24 · 20→28 · 24→32 · 28→36 | 未成阶 | 固定 px 行高，便于 4pt 对齐 | 飞书 14/22 **[实测]** |
| 字重 | 400 / 500 / 600（禁 700） | 400–700 | 标题 600、强调 500；Notion 700 太重，不采 | 飞书标题 600 / Linear 510–590 **[实测]** |
| 数字 | `tabular-nums` 用于案号/日期/计数 | 部分 | — | C10 |

### 2.4 间距 / 圆角 / 阴影 / 边框 / 动效 / 高度阶

| 类别 | Token | 值 | 现状 | 差异 | 来源 |
|---|---|---|---|---|---|
| 间距 | `--sp-1..12` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 | Tailwind 4pt | 一致；页面内边距 32（≥1024）/ 16（移动） | Tailwind v4 默认 |
| 圆角 | `--r-sm` | **6px**（≤ 32 控件、徽章底、树行、菜单项） | 4px（96%） | +2 | 飞书按钮 6px **[实测]**；C2 |
| 圆角 | `--r-md` | **8px**（36–40 控件、卡片、菜单、浮条、输入框） | 4px | +4 | Notion "Get template" 36 高 8px **[实测]**；Linear 28–36 高 8px **[实测]** |
| 圆角 | `--r-lg` | **12px**（对话框、Sheet、登录卡、看板卡） | 4–8 | — | Notion 48 → 12（benchmark C2） |
| 圆角 | `--r-xl` | 16px（移动 Sheet 顶角） | 无 | 新增 | [推断] iOS Sheet 惯例 |
| 圆角 | `--r-pill` | 9999（状态徽章、期限 chip、开关） | pill 用于主按钮（构建） | **主按钮不再 pill** | C2；飞书营销页 pill 仅用于 CTA **[实测]**，工具态用 6px |
| 阴影 | `--sh-sm` | `0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.04)` | 无 | 浮岛工具条、看板卡 hover | C27 |
| 阴影 | `--sh-md` | `0 4px 16px .08, 0 1px 3px .05, 0 0 0 1px .04` | 无 | 菜单、Popover、选块浮条 | C27 |
| 阴影 | `--sh-lg` | `0 16px 48px .14, 0 4px 12px .06, 0 0 0 1px .04` | 无 | 对话框、Toast、行内块编辑器、Sheet | C27 |
| 阴影 | `--sh-paper` | `0 1px 3px .10, 0 8px 24px .06` | 无 | 纸面浮于画布 | 飞书文档纸面阴影 **[实测截图 d-feishu-docs-product]** |
| 边框 | 宽度 | 1px 唯一；分隔线 `--line` 8%，控件 `--line-2` 14% | 1px `--n2/--n3` 实色 | 透明度化 | §2.2 |
| 动效 | `--dur-fast / --dur / --dur-panel` | 100 / 150 / 200ms，`cubic-bezier(.2,.8,.2,1)` | 150 | 面板只做透明度，不做宽度动画；`prefers-reduced-motion` 全部归零 | C28；Overleaf rail 无 transition [源码 `stylesheets/pages/editor/rail.scss`] |
| 高度 | `--h-topbar` | **44**（桌面 = 移动） | 40 桌面 / 48 移动 | 统一一值 | 飞书文档顶栏 60 营销页 / 工具态 44 [推断]；L2 允许 40，方向 B 取 44 换取 36 控件垂直呼吸 |
| 高度 | `--h-statusbar` | 28 | 24 | +4 容纳 12px 文字 + 徽章 | — |
| 高度 | `--w-rail` | 48 | 40 | 44 触控 + 4 | C6 |
| 高度 | `--h-ctl-sm/…/mobile` | 28 / 32 / 36 / 40 / 44 | 14 档 | 四档 + 移动 | C1 |
| 高度 | `--h-row / --h-row-compact / --h-tree` | 44 / 36 / 30 | 40 / 36 / 28 | 台账行 +4（≥ 44 触控） | C6 / C21 |
| 宽度 | `--w-side / --w-drawer / --max-page / --max-form` | 240 / 320 / 1200 / 560 | 240 / 320 / 1280 / — | 页面最大宽 1200（更窄更"文档"） | L4 / L13；Notion 内容列 720、飞书 820 [推断] |

**tokens_summary（15 条关键决定）**：① 暖灰 10 阶替代冷灰；② 文字 4 阶；③ 边线 8% 透明黑；④ 主绿 `#0E7C43`（白字 5.27:1），暗色 `#3DBB7C` 黑字；⑤ 绿只做 primary/选中/链接/在线点；⑥ 状态 10 档低饱和底深字 ≥ 5.2:1；⑦ 纸面 `#FFF` 恒白，画布灰；⑧ 字号 8 档，新增 20/24/28；⑨ 行高固定 px 阶；⑩ 字重 400/500/600；⑪ 圆角 6/8/12/16 随尺寸，主按钮不 pill；⑫ 阴影三档 + 纸面阴影；⑬ 顶栏 44 桌面=移动，状态栏 28，rail 48；⑭ 控件四档 28/32/36/40 + 移动 44；⑮ 动效 100/150/200，reduced-motion 归零。

---

## 3. 组件规格卡

> 状态图统一用文字列出：**默认 → hover → active/pressed → focus-visible → disabled →（loading / error / selected）**。所有 focus-visible = `2px solid var(--line-focus)` 外描边 + `outline-offset:2px`（C7）。图标一律 lucide，16 行内 / 20 rail·工具条 / 24 移动 Tab（C25）。

### 3.1 Button（四尺寸 × 五变体）

| 尺寸 | 高 | 水平 padding | 字号 | 圆角 | 用途 |
|---|---|---|---|---|---|
| sm | 28 | 10 | 12 | 6 | 表格行内、树行内、状态栏 |
| md（默认） | 32 | 12 | 13 | 6 | 顶栏、工具条、抽屉 |
| lg | 36 | 14 | 14 | 8 | 页面主动作、表单提交、递交页 |
| xl | 40 | 16 | 14 | 8 | 登录卡 CTA |
| mobile | 44 | 14 | 14 | 8 | < 768 全部 btn 自动升为 44（`@media` 覆盖） |

变体：`primary`（绿底白字）/ `secondary`（白底 `--line-2` 描边 + 1px 微阴影）/ `ghost`（无底，hover 4% 黑）/ `danger`（`--danger-soft` 底 `--danger-text` 字，仅菜单末与确认框）/ `link`（无高，`--fg-link`）。icon-only：宽 = 高，必带 `aria-label` + tooltip（C5）。

状态：hover 变深一档（primary → `--primary-hover`；其他 → `--bg-hover`）→ active `--bg-active` → focus-visible 2px 绿描边 → disabled `opacity:.45` 不可点 → loading 宽度锁定 + 文字替换为"构建中…"（C8）。

映射：C1 C2 C3 C4 C5 C6 C7 C8；修正 audit #6 #10 #19。

### 3.2 Input

| 档 | 高 | 圆角 | 字号 | 用途 |
|---|---|---|---|---|
| sm | 32 | 6 | 13 | 工具栏搜索、抽屉内 |
| md（默认） | 36 | 8 | 14 | 表单 |
| xl | 40 | 8 | 14 | 登录卡 |
| mobile | 44 | 8 | 14 | < 768 |

结构：`.input`（容器，`--line-2` 描边，`--bg-elevated` 底）> 前置 lucide 16 灰图标 + `<input>` + 后置动作（如密码可见 28 ghost）。状态：hover 无变化 → focus-within 描边 `--line-focus` + `0 0 0 3px --primary-soft` 光环 → error 描边 `--danger` + 下方 12/18 `--danger-text` 说明（图标 `circle-alert` 14）→ disabled 底 `--g1`。占位色 `--fg-3`（4.88:1）。

映射：C9 C7；修正 audit #12（登录错误态自绘，不用浏览器气泡）#22（日期用自绘选择器占位）。

### 3.3 Select

高 32（桌面）/ 40（移动）；描边同 Input；右侧 `chevron-down` 16；`quiet` 变体无描边（表格行内、成员角色）。菜单项 32 / 移动 44（C11），选中项前置 `check` 16。状态：hover `--bg-hover` → open 描边 `--line-focus` → disabled。修正 audit #11（深色原生白底 select）#23（机构成员头衔原生 select）。

### 3.4 Switch

36×20 pill，滑块 16 白 + 2px 阴影，位移 16；关 `--g4`、开 `--primary`（**唯一允许开关用绿的地方**，因为开=选中态语义）。移动端命中区外扩到 44×44（透明 padding）。状态：hover 无 → focus-visible 描边 → disabled `.45`。C7 C6。

### 3.5 Badge（状态徽章）

高 22，padding 0 8，pill，12/500，`gap 5` 前置 6px `currentColor` 点（opacity .85）。变体：`st`（10 档案件状态，底 `--st-*-bg` 字 `--st-*-fg`）/ `neutral` / `danger` / `warning` / `info` / `success`；`count` 变体 18 高 11px（侧栏计数、未读）。无 hover（非交互）；作为选择器时见 §4.11。C18；修正 audit #7 #23。

### 3.6 Tag（标签）

高 22，padding 0 7，圆角 6，1px `--line` 描边，`--bg-elevated` 底，12px `--fg-2`，可带 12px 图标；与徽章**不共用色系**（C19）。hover `--bg-hover`；可删除变体尾随 `x` 12（命中 22×22，仅桌面；移动用长按菜单 [推断]）。

### 3.7 Avatar

24 / 32 / 40 三档（C20），圆形，字母/姓首字 11/13/15 600 白字，底 `hsl(var(--hue) 40% 45%)`（hue 由用户 id 哈希，禁止 `red-500` 硬编码 → 修正 audit #23）。`online` 变体右下 8px 绿点 + 2px `--bg` 描边（绿的"在线"语义是简报允许的例外）。组 `.avs` 重叠 6px，最多 5 + `+N` 计数。

### 3.8 Menu（Dropdown / Context）

min-width 220，padding 4，圆角 8，`--bg-elevated` + `--sh-md`；项高 32（移动 44）圆角 6，13px，前图标 16 `--fg-3`，右侧快捷键 12 `--fg-3`；分组标签 11/600 大写 `--fg-3`；危险项红、置底、前分隔线（C12）。状态：hover `--bg-hover`，focus 同 hover + 描边，disabled `.45`。

### 3.9 Dialog

宽三档 400 / 560 / 800（C13），圆角 12，`--sh-lg`，标题 16/600，正文 14/22，底部动作右对齐（secondary + 一个 primary lg）；≤ 640 视口转全屏 Sheet（圆角 0）。焦点陷阱 + Esc（C14）。修正 audit #22。

### 3.10 Drawer（右侧伴随抽屉）

宽 320（768–1023 收窄 280），左边 1px `--line`，头 44（标题 14/600 + 关闭 32 ghost），下方 Tabs 36（下划线式，选中 `--fg` 2px 底线），内容滚动，脚 56 固定动作区。仅做透明度 200ms 显隐，不做宽度动画（C28）。C15 L10；修正 audit #2（审阅/历史/AI 不再顶掉源码 Tab）。移动端转为全屏子页（顶栏返回）。

### 3.11 Toast

宽 360，padding 12，圆角 8，`--bg-elevated` + `--sh-lg`，前置 lucide 20 语义色图标（success 绿 / info 蓝 / warning 琥珀 / error 红），标题 14/500 + 描述 13/20 `--fg-2`，可带一个 action（link 变体）+ 关闭 28 ghost；`aria-live` polite，error assertive（C16）。移动端底部居中，宽 `calc(100vw - 32px)`。

### 3.12 Tooltip

高 24，padding 0 8，圆角 6，`--bg-inverse` 底 `--fg-inverse` 字 12px，延迟 300ms，仅文字（C17）。快捷键用 `<kbd>` 11px 半透明底。

### 3.13 Table row（台账）

行高 **44**（compact 36），单元 padding 8×12，表头 12/500 `--fg-3` 高 36 **无底色**（只有下边线）；行 hover `--bg-hover`；选中行 `--bg-selected` + 左 2px 绿条；勾选框 16 但命中区 32×44；标题列 14/500 `--fg`，案号列 13 `tabular-nums` `--fg-2`；分组行（`tr.grp`）36 高 12/600 大写 `--fg-3` + 计数；末行"+ 新建案卷"36 高 `--fg-3` hover 变 `--fg`（Notion 数据库"+ New"）。C21 C10 C6；修正 audit #9 #21。

### 3.14 Tree node

行高 30，缩进 12/级，`chevron-right` 12 旋转表开合，文件图标 16 `--fg-3`，文字 13，圆角 6；hover `--bg-hover`；选中 `--bg-selected` 字 `--fg`；行内动作 28 ghost 仅 hover 出现；`role=treeitem` + `aria-expanded`（C29）。**作者树隐藏 `studio.json` / `.emf`**，附图以缩略行呈现（修正 audit #18）。移动端 40 高。

### 3.15 Empty state

垂直居中，padding 40 24，lucide 32 `--fg-4` stroke 1.25，标题 14/500 `--fg`，一句原因 13/20 `--fg-3` ≤ 320 宽，一个动作（secondary md，除非页面无其他 primary）。（C23，图标取 32 而非 40：方向 B 更克制 [推断]）。看板空列用虚线框 `--line-2` + "拖到此列进入撰写"文字（S2）。

### 3.16 Skeleton

形状 = 最终布局：纸面骨架 = 白纸 + 灰条；表格 = 44 行 × 列宽；圆角 4；`--g2 → --g1 → --g2` 1.4s 横向流光；> 300ms 才显示；`prefers-reduced-motion` 下静止（C24）。

### 3.17 Segmented control（补充原语）

高 32（移动 40），padding 2，底 `--g2` 圆角 6，项 padding 0 10 圆角 4，选中项 `--bg-elevated` + 1px 阴影 + `--fg`，未选 `--fg-2`。用于 列表/看板、源码/版面/PDF、PDF/版面（客户页）。iOS/Notion 数据库视图切换惯例 **[实测截图 d-notion-templates 顶部筛选条]**。

---

## 4. 复合组件

| 复合组件 | 规格 | 状态 | 映射 |
|---|---|---|---|
| **4.1 顶栏**（工作台 / 递交） | 高 44，白底，下 1px `--line`；左：返回 32 ghost + 面包屑（机构 › 案卷 › 书，13px，当前层 `--fg` 500，其余 `--fg-3`，分隔 `chevron-right` 12）；中：视图段控件 32；右：在线头像组 24 + 分享 32 secondary + 协作 / AI / 更多 32 ghost + **唯一 primary "构建" 32**（绿，`play` 16，尾随 `⌘S` kbd）。所有控件同高 32 垂直居中，左右 padding 12（L3 取 12 而非 8 [推断]：44 高需更多呼吸）。移动 44：返回 + 标题（单层）+ 构建 44 icon primary + 更多 | 构建：默认 → 构建中（宽度锁定 + 文字"构建中…"）→ 成功（状态栏出现"构建成功 · 12:03"）→ 失败（状态栏红文 + "查看问题"link） | L2 L3 L16 L18 C3 C8；修正 audit #10（三处构建 → 一处）#1 |
| **4.2 Rail** | 宽 48，`--bg-side`，上下 padding 8；每项 40×40 圆角 8，lucide 20 `--fg-3`，hover `--bg-hover` + 右侧 tooltip 标签（300ms）；选中 `--bg-active` + 图标 `--fg`（**不用绿**）；项：文件、大纲、附图、术语、审阅、历史、AI、控制台；底部：设置。移动端不显示，功能进"更多"Sheet | 4 态 | C5 C6 C25 L7；修正 audit #17（主题/密度入口进 rail 设置） |
| **4.3 文件树 / 大纲** | 宽 240（可拖 200–400，句柄 7px hover 1px 高亮 L8），`--bg-side`；头 36：案号 12 `tabular-nums` `--fg-3` + 折叠 28 ghost；树节点见 §3.14；大纲模式：H1/H2 缩进 12，当前段落 `--bg-selected`；三书（权利要求书 / 说明书 / 摘要）为一级节点 | — | C29 L4 L7；修正 audit #18 |
| **4.4 PDF 工具条**（Overleaf 保留项 ①） | 高 36，`--bg-side`（纸面画布之上），下 1px `--line`；左：上一页/下一页 28 ghost + 页码输入 28×40 + "/ 8"；中：缩小 / 适宽 / 放大 28；右：下载 28 ghost；构建状态文字 12 `--fg-3`。**保留理由**：Overleaf 用户对"编译→PDF 工具条→页码/缩放/下载"的动线已成肌肉记忆 [源码 `js/features/ide-react/components/toolbar/toolbar.tsx`、`stylesheets/pages/editor/toolbar-redesign.scss`]；方向 B 只改视觉（无底色块、28 控件、6 圆角） | 构建中：工具条右侧 12px "构建中…" + 纸面骨架 | L2 C25；修正 audit #10 #13 |
| **4.5 状态栏** | 高 28，白底，上 1px `--line`，12px `--fg-3`；左：光标位置 `L16:C1`、当前书 / 段号 `[0041]`；中：问题计数徽章（warning 18 count）；右：构建时间 / 版本 v14 / 字数 | 问题 > 0 时计数徽章变 warning | L2 C10 |
| **4.6 协作者面板**（S5） | 320 抽屉；Tabs 成员 / 链接 / 访问记录 / 设置；在线组：头像 32 `online` + 名 14/500 + 12 说明"正在编辑 · 说明书 [0057]"；成员行 48：头像 24 + 名 / 邮箱（ellipsis）+ 角色 `select.quiet` 32（撰写 / 审阅 / 所有者）；待接受邀请行灰字 + "重发"link；链接卡：类型徽章 + URL 13 等宽 + 复制 28 icon + 开关；脚 56：邮箱 input sm + 角色 select + **secondary md "邀请"**（抽屉打开时 primary 仍归顶栏"构建"，抽屉内不放 primary，守 C3） | 成员：在线 / 离线 / 待接受 / 已禁用 | C15 C20 C11 L10；修正 audit #2 #7 |
| **4.7 评论线程**（S9 / 审阅） | 卡 padding 12，圆角 8，1px `--line`，未解决左侧 2px `--warning`，已解决整卡 `--fg-3` + `check` 徽章；头：引文锚点 12 `--fg-3`（"权项 1 · 步骤三"）+ 定位 28 ghost；消息：头像 24 + 名 13/500 + 时间 12 `--fg-3` + 正文 14/22；脚：回复 input sm + "解决" 28 sm secondary | 未解决 / 已解决 / 我的 / 他人 | C15 C6；修正 audit #21（定位/回复/解决从文字链变 28 按钮） |
| **4.8 Proposal 卡**（S6） | 卡 padding 12 圆角 8 `--line`；头：作用域徽章 neutral（"权项 3"）+ 定位 12 `--fg-3`（`L16`）+ 置信/来源 12（"引用 [0041] [0057]"）；正文：CriticMarkup 渲染——删除 `--danger-soft` 底 `--danger-text` 删除线，插入 `--success-soft` 底 `--primary-text`；脚 36：接受 28 sm **secondary（`--primary-text` 绿字，不是 primary）**、拒绝 28 sm secondary、批注 28 ghost、定位 28 icon；"推断"卡带 warning 徽章"需代理师确认" | 待处理 / 已接受（折叠为一行摘要）/ 已拒绝（灰）/ 编辑中 | C3 C6；修正 audit #19（面板去掉 5 行开关说明 + 供应商信息，一屏 0 primary） |
| **4.9 看板卡**（S2） | 宽 272 列内，padding 12 圆角 8 `--bg-elevated` + `--line` + 1px 微阴影，hover `--sh-sm`；标题 14/500 两行 ellipsis；元信息行 12 `--fg-3`：期限 chip（见 4.10）+ 类型 tag + 权项数 tag；底行：案号 `tabular-nums` + 评论/Proposal 计数 + 责任人 24 头像；列头 32：状态徽章 + 计数 + "+" 28 icon；**空列折叠**到右侧"+3"（列表/看板切换旁"隐藏空列"开关） | 拖拽中 `--sh-md` + 2° 旋转（reduced-motion 下不旋转） | L12 C18；修正 audit #20 |
| **4.10 期限倒计时 chip** | 22 高 pill，`calendar` 12 + "6 天 · 客户审阅"；≥ 14 天 `due-ok`（`--g2` 底 `--fg-2`）；3–13 天 `due-soon`（warning soft）；≤ 2 天 / 逾期 `due-urgent`（danger soft，"明天" / "逾期 2 天"）；侧栏"期限中心"右侧 count 徽章 danger | 三档 | C18 C10；修正 audit #9（不用全宽横幅，期限内嵌行内） |
| **4.11 状态徽章选择器** | 徽章本体可点（hover 出现 `chevron-down` 12），点开 Menu 220：10 档徽章各占 32 行 + 右侧 `check`；键盘 ↑↓ Enter；移动 Sheet 44 行 | closed / open / 选中项 | C11 C18 C23；修正 audit #21 #23 |

---

## 5. 页面版式（S1–S10）

> 通用：≥ 1024 三区（侧栏 240 | 内容 | 抽屉 320）；768–1023 双栏（树隐藏进 rail，抽屉 280）；< 768 单栏 + 底部 Tab 56（L1）。页面主内容 max 1200 居中（台账 / 递交 / 账户），工作台全宽（L13）。每页一个 H1（L19）。深色：壳换 `.dark` 4 层面，**纸面与 PDF 仍 `#FFF`**，画布 `#111`。

### S1 台账 · 列表（`s1-ledger-list.html`）
- 栅格：`240px | 1fr`；侧栏 `--bg-side`：机构切换 36 → 台账 / 期限中心（danger count）/ 通知（count）→ "视图"组（全部 / 按状态看板 / 我负责的 / 本周到期）→ "机构"组 → 底部用户 40。
- 内容：page-head padding 32 0 8：H1 24/32/600 "案件台账" + 13 `--fg-3` 摘要（"全部案件 · 2 件在办 · 最近更新 3 分钟前"）；其下一行**无边框 KPI 数字**（24/600 + 12 说明：在办 / 内审 / 客户审阅 / 权项，只显示有值项，替代现状 4 张卡片）；工具条 44：段控件 列表|看板 + 筛选 ghost + 搜索 input sm 240 + 右端 **primary md "新建案卷"**（一屏唯一）。
- 表格：分组行（内审 1 / 客户审阅 0 折叠 / OA 答复 1）；列：勾选 32 | 标题 1fr | 案号 120 | 状态 120 | 期限 140 | 责任人 56 | 更新 100；行 44。
- 375：侧栏隐藏 → 顶栏 44（汉堡 + "台账" + 搜索）；表格转卡片列表 `.mlist`（标题两行 + 案号等宽 + 状态徽章 + 期限 chip + 头像）；工具条换行：段控件 40 + 筛选 40 + 右端 **primary 44 "新建案卷"**（不全宽，L16 主动作居右）；底部 Tab 56：台账 / 期限 / 通知 / 我。
- 深色：侧栏 `#202020` 内容 `#191919`，表格行分隔 9% 白线。
- 映射：L1 L4 L11 L12 L13 L19 · C1 C3 C10 C18 C19 C20 C21 C23 · 修正 audit #5 #8 #9 #21 #24

### S2 台账 · 看板（`s2-ledger-board.html`）
- 同 S1 壳；看板 `display:flex; gap 16; overflow-x:auto`，列 272；只显示有案件的列 + 右侧 "+3 空列" 折叠按钮；列头 32；卡见 §4.9；列底 "+ 新建" 36 `--fg-3`。
- 375：列宽 `calc(100vw - 56px)` 横向 snap 滚动，可见 1 列 + 下一列边缘 40px 提示；卡内触控 44。
- 映射：L12 · C2 C6 C18 C27 · 修正 audit #20

### S3 工作台默认（`s3-workbench.html`）
- 栅格：行 `44 | 1fr | 28`；列 `48 rail | 240 tree | 1fr center | (320 drawer 可选)`；center `1fr 1fr` 源码 | PDF，拖拽句柄 7px。
- 源码面板：面板头 36（"权利要求书 · content.md" 13/500 + 行列位置），行号列 40px `--fg-4` 12px 等宽，正文 13/22 等宽，当前行 `--bg-subtle`；软标尺 100ch（L6）。
- PDF 面板：工具条 36（§4.4）+ 画布 `--paper-canvas` padding 24 + 纸面 A4 比例白纸 `--sh-paper`（视口不足整体缩放 L5）。
- 状态栏 28（§4.5）。1440：源码区宽 = (1440 − 48 − 240) / 2 ≈ 576px（现状 480，audit #1）。
- 375：顶栏 44（返回 + 标题 + 构建 44 primary icon + 更多）+ 内容 + 底部 Tab 56（编辑 / 预览 / AI / 更多）；chrome = 100px（12%）。
- 深色：rail/树 `#202020`，源码底 `#191919`，PDF 画布 `#111`，**纸白**。
- 映射：L2 L3 L4 L5 L6 L7 L8 L15 L16 L18 · C1 C3 C5 C25 C28 C29 · 修正 audit #1 #3 #10 #11 #18

### S4 三视图 + 选块 + 行内块编辑（`s4-threeview.html`）
- 树折进 rail（`data-state=threeview`），center `1fr 1fr 1fr`：源码 | 版面（contenteditable，纸白）| PDF。
- PDF 选块：块底 `--bg-selected` + 左 2px 绿；**浮条**（`--sh-md`，圆角 8，高 36）出现在块下方 8px，**限制在 PDF 面板内**（`left:24px`，不再被右缘裁切）：定位文字 "权项 3 · P1 · L16" + 编辑 / 批注 / 定位源码 28 ghost。
- 行内块编辑器：卡片 `--sh-lg` 圆角 8，头 36（"权利要求书 · 权项 3 · content.md L16" 12 `--fg-3` + 关闭），编辑区 13/22 显示 CriticMarkup 删除/插入，脚 44：CriticMarkup 开关 + 取消 secondary + **primary md "提交并重建"**（一屏唯一 primary；顶栏"构建"此态降为 secondary，原型 S4 已如此）。
- 源码联动：L16 整行 `--bg-selected`，右缘徽章 "联动 · 权项 3 · L16"。
- 375：预览 Tab 下选块浮条置于纸面顶部 52px 处（不遮挡选块），块编辑器为底部 Sheet ≤ 85vh。
- 映射：L5 L7 L9 · C3 C6 C27 · 修正 audit #13 #14

### S5 协作者中心抽屉（`s5-collab.html`）
- S3 壳 + 右侧 320 抽屉（§4.6）；顶栏头像组高亮当前在线（李哲、王岚）；抽屉 Tabs 成员 / 链接 / 访问记录 / 设置。
- 375：抽屉转全屏子页（顶栏返回 + "协作者"），成员行 48，角色 select 40，脚固定 56。
- 映射：C11 C15 C20 L10 · 修正 audit #2 #7 #23

### S6 AI 智能体面板（`s6-ai.html`）
- 右侧 320 抽屉；Tabs 对话 / 任务 / 建议 / 历史；对话气泡无底色（用户消息右对齐 `--g1` 底，AI 消息左对齐无底 + 引用段号 `[0041] [0057]` 为 link）；Proposal 卡 §4.8；任务列表 3 行 36（进行中 spinner / 完成 check / 排队）；composer：textarea 自动高 36–120 + 上下文 chip（"当前：权利要求书 · 权项 3"）+ 发送 32 icon **secondary**（面板内 0 primary，primary 仍是顶栏构建）。
- 375：AI Tab 全屏，composer 固定底部（输入聚焦时隐藏底部 Tab L17）。
- 映射：C3 C6 L10 L17 · 修正 audit #2 #7 #19

### S7 递交页（`s7-deliver.html`）
- 顶栏 44（面包屑 台账 › WK2026-0012 › 一种时间序列… › 递交 + 状态徽章"内审"）；内容 max 1200 padding 32；H1 24/32 "递交 · 一种时间序列预测模型部署期可信自适应控制方法及装置" + 13 元信息（案号 · 发明专利 · 方法+装置 · 申请人待确认 · 目标 2026-09-19）。
- 两栏 `1fr 360px`：左"递交体检"（清单 6 项，每项 44：图标 20 语义色 + 标题 14 + 说明 13 `--fg-3` + 右侧 28 sm 动作）+ "导出"三卡（DOCX / PDF / CNIPA XML，每卡 secondary md）+ "递交记录"时间线；右侧粘性卡"递交清单 4 / 6 项就绪" + **primary lg "生成递交包"（disabled，原因两行）**。
- 375：单栏，粘性卡置顶变为固定底部动作条 64（primary 44）。
- 映射：L13 L14 L19 · C1 C3 C4 C23 · 修正 audit #6 #16

### S8 登录 / 注册（`s8-login.html`）
- 栅格 `1fr 1fr`：左品牌区 `--bg-side`（标志 24 + 产品名 + 三条价值点 14/22 + 底部 12 版权），右表单区居中卡 400（padding 32，圆角 12，`--sh-md`）；H1 28/36 "登录"；邮箱 / 密码 input xl 40；错误态自绘（12/18 红字 + 图标）；**primary xl 40 全宽 "登录"**；下方 13 "还没有账号？注册" link。`data-demo=register` 切换为注册（加姓名字段，说明"首个注册账号成为机构超级管理员"）。
- 375：品牌区隐藏，卡无阴影 padding 24 20，input/按钮 44。
- 映射：L14 · C1 C4 C7 C9 · 修正 audit #12

### S9 客户免登录审阅页（`s9-client.html`）
- 栅格 行 `56 | 1fr | 64`，列 `1fr | 360 评论`；头 56：机构标 24 + "wookat 专利事务所" 600 + 标题 13/500 + 元信息 12（审阅稿 v14 · 代理师 李哲 · 邮箱 · 请于 **2026-09-12** 前确认）+ 段控件 PDF | 版面；PDF 工具条 36 + 白纸；选文字后浮条（引文位置 + 批注 + 标记）；右侧评论线程 §4.7；**固定动作条 64：左 "2 条批注未解决" 13 + 右 secondary lg "有修改意见" + primary lg "确认定稿"**。
- 375：评论栏隐藏（顶栏右侧 44 icon 带 count 徽章打开评论 Sheet），动作条 64 保留（primary 44）。
- 映射：L2 L13 · C3 C15 C16 · 修正 audit #15

### S10 移动端（`s10-mobile.html`，六屏；`viewer.html?screen=…` 375×812）
- 统一：顶栏 44 + 底部 Tab 56 = 100px chrome；所有 btn / input 44；Tab 图标 24 + 11px 标签，选中 `--fg` + 图标绿（在线/选中语义）。
- `ledger`：见 S1-375。`edit`：源码 15/24，行号 28px（占宽 7.5%，audit #3 8.5% → 7.5%），CriticMarkup 高亮。`preview`：PDF 工具条 44 + 纸白 + 选块浮条置顶。`ai`：Proposal 卡 + composer 固定。`more`：Sheet ≤ 85vh，圆角 16 顶角，抓手 36×4，分组 文件 / 面板 / 案卷 / 外观（主题亮暗、密度）项 48。`client`：见 S9-375。
- 映射：L1 L2 L15 L16 L17 · C1 C6 C13 C25 · 修正 audit #3 #8 #17 #22

---

## 6. 竞品一手证据与 Overleaf 保留项

### 6.1 亲自截图 + getComputedStyle（`w6-b-refs/`，脚本 `refs.js` 逻辑：Playwright + 已装 Chrome，1440×900 与 375×812）

| 站点 / 页面 | URL | 截图（附件） | 实测要点 | 采用 |
|---|---|---|---|---|
| 飞书 Universe Design · 色彩 | https://open.feishu.cn/document/design-specification/design-language/color?lang=zh-CN | [d-feishu-ud-color](https://app.devin.ai/attachments/c0f62382-bd39-45a1-a486-b1c87b5ed2ff/d-feishu-ud-color.png) | body 14/23.3 `rgba(0,0,0,.85)` 白底；H1 30/38/600 `rgb(55,60,67)`；H2 24/32/500；H3 20/26/500；primary 按钮 32 高 6px 圆角 `rgb(20,86,240)` 无阴影；secondary 白底 1px `rgb(187,191,196)` | 圆角 6、控件 32、标题阶 24/20、功能色低饱和 |
| 飞书 UD · 按钮 | https://open.feishu.cn/document/design-specification/component---data-entry/button/button?lang=zh-CN | [d-feishu-ud-button](https://app.devin.ai/attachments/ddfb0aca-b631-4aaa-ac7a-d79fb46648fb/d-feishu-ud-button.png) | 同上（页面壳相同）；按钮规范图示 | 四尺寸 + 五变体划分 |
| 飞书 UD · 字体 | https://open.feishu.cn/document/design-specification/design-language/typography?lang=zh-CN | [d-feishu-ud-typography](https://app.devin.ai/attachments/34680626-83f0-4af6-8102-580a70acd46f/d-feishu-ud-typography.png) | 字体栈 `LarkHackSafariFont, LarkEmojiFont, LarkChineseQuote, -apple-system…`；14/22 正文 | 中文前置字体栈、14/22 |
| 飞书文档产品页 | https://www.feishu.cn/product/docs | [d](https://app.devin.ai/attachments/4cbd11cc-c6b4-488a-9150-2331a18cfc83/d-feishu-docs-product.png) / [m](https://app.devin.ai/attachments/276c867f-fa21-4c20-9ca0-44a170e85c7c/m-feishu-docs-product.png) | 顶栏 60 白底透明；编辑器实景图：白纸 + 浅灰画布 + 左侧目录 + 右上协作头像 + 蓝主按钮（**营销页内嵌截图，非登录态实测**） | 纸面浮于浅灰画布、协作头像在顶栏右 |
| Notion Help · block | https://www.notion.com/help/what-is-a-block | [d-notion-help-block](https://app.devin.ai/attachments/a0d59555-5ffb-4c4a-bfda-6e8d30a7ebc9/d-notion-help-block.png) | body 16/24 `rgba(0,0,0,.95)`；顶栏 64 白；导航按钮 30 高 4px 圆角透明；H2 20/30 | 文字用透明黑分级（我们转实色） |
| Notion 模板页 | https://www.notion.com/templates/meeting-notes | [d](https://app.devin.ai/attachments/c4b8bfac-f0da-4995-a986-7b78c58e0736/d-notion-templates.png) / [m](https://app.devin.ai/attachments/abb01eca-3b91-4938-812d-99a17e082fbc/m-notion-templates.png) | primary "Get template" 36 高 **8px 圆角** 墨色 `rgb(25,25,24)` 白字；搜索 input 44 高 6px 圆角 **1px rgba(0,0,0,.08)** 边 | `--r-md 8`、`--line 8%`、深色底 `#191919` |
| Notion 设计博客 | https://www.notion.com/blog/topic/design | [d-notion-blog-design](https://app.devin.ai/attachments/656b05bb-f1fa-4062-ac4e-2c292dbb6923/d-notion-blog-design.png) | 卡片无边框、靠 24–32 间距分隔；H3 22/28/700 | "无边框靠间距"版式 |
| Craft 官网 | https://www.craft.do/ | [d](https://app.devin.ai/attachments/380666f4-af2d-428a-ae28-11849ff6bc44/d-craft-home.png) / [m](https://app.devin.ai/attachments/72dfc42f-e97b-47b8-b33b-e963e096a328/m-craft-home.png) | body 底 **`rgb(252,249,247)` 暖白**；导航 52 高，下边 `rgba(3,3,2,.09)` | 暖灰阶、分隔线 8–9% |
| Craft 帮助中心 | https://support.craft.do/ | [d-craft-docs](https://app.devin.ai/attachments/72441618-b5e8-426e-96d6-f2e24dd6a2d7/d-craft-docs.png) | 侧栏项 32 高 8px 圆角，hover `oklab(… / 0.05)` 半透明；搜索 36 高 8px；H2 16/600 H3 14/600 | 侧栏项 hover 用透明叠加、rail/树 hover 4–5% |
| Linear 官网 | https://linear.app/ | [d](https://app.devin.ai/attachments/c18c37bb-a371-4580-9264-272171085266/d-linear-home.png) / [m](https://app.devin.ai/attachments/c1742ed5-9306-4822-99b7-72ae2172ad37/m-linear-home.png) | 深色底 `rgb(8,9,10)` 文字 `rgb(247,248,248)`；字重 510/590（可变字体）；导航 pill 32 | 深色文字不纯白（我们 `#E8E8E4`）；字重 500/600 而非 700 |
| Linear Docs | https://linear.app/docs | [d-linear-docs](https://app.devin.ai/attachments/e4f17f4b-a8f7-4dff-93f1-4ccc8ed60298/d-linear-docs.png) | 侧栏项 36 高 8px 圆角 14/510；H1 40/44 H2 20/26.6 H3 15/24 | 侧栏项高、标题阶参考 |

**未拿到的一手证据（如实）**：飞书文档 / Notion **登录后**的编辑器、首页、分享面板实景需要账号，本次未登录，因此 Notion 侧栏 `#F7F7F5`、正文 `#37352F`、飞书内容列 820 等均标 **[推断]**（来自公开资料与经验，未 getComputedStyle）。我用飞书产品页内嵌的编辑器实景截图作为替代证据。

### 6.2 Overleaf 保留项与理由（沿用 `00-benchmark.md` 已提取的源码路径 [源码]）

| 保留 | Overleaf 路径 | 保留理由 | 方向 B 改动 |
|---|---|---|---|
| PDF 工具条（页码 / 缩放 / 下载 + 编译状态） | `services/web/frontend/js/features/ide-react/components/toolbar/toolbar.tsx`、`stylesheets/pages/editor/toolbar-redesign.scss` | 用户对"编译 → 看 PDF → 翻页缩放下载"的动线有肌肉记忆；这是专利代理师核对纸面的核心动作 | 去底色块，28 控件，6 圆角，构建状态文字化 |
| 绿色"构建"主按钮 | `stylesheets/ds/components/button.scss`（`btn-primary` 绿）、`js/shared/components/button/button.tsx`（`loadingLabel`） | 绿 = "去生成 PDF" 的品牌心智；C8 loading 文本 | 不再 pill；全站唯一 primary；移动 44 icon |
| 右侧伴随面板（review panel 320） | `stylesheets/pages/editor/review-panel.scss` | C15/L10 结论：伴随不遮文档 | 抽屉白底无重底色，Tabs 下划线 |
| 在线头像组 | `stylesheets/pages/editor/online-users.scss`、`toolbar/online-users.tsx` | 协作可见性 | 24 头像 + 8px 绿点，最多 5 |
| 文件树 a11y | `js/features/file-tree/components/file-tree-folder.tsx`、`stylesheets/pages/editor/file-tree.scss` | `treeitem` / `aria-expanded` | 行高 30、隐藏 `studio.json` |

**不保留**：Overleaf 深绿顶栏 / 深色 rail（与"白底文档"冲突）、pill 主按钮、面板名 = Tab 名的双层 Tab（audit #10）。

---

## 7. 原型截图（Chrome 真实截图，1440×900 亮 / 暗，375×812 亮）

| 屏 | 1440 亮 | 1440 暗 | 375 亮 |
|---|---|---|---|
| S1 台账列表 | [s1--d-light](https://app.devin.ai/attachments/83f22ca0-db72-4078-9608-3b92bfb66879/s1--d-light.png) | [s1--d-dark](https://app.devin.ai/attachments/e5833bfa-f38c-49f6-ba37-3b871ae4d0e1/s1--d-dark.png) | [s1--m-light](https://app.devin.ai/attachments/8eeff8b3-c24f-45db-b996-722cfd9c4ded/s1--m-light.png) |
| S2 台账看板 | [s2--d-light](https://app.devin.ai/attachments/3ad45c00-f791-4c48-b84d-9941a80c44a5/s2--d-light.png) | [s2--d-dark](https://app.devin.ai/attachments/64cba832-6b37-42b4-b045-a802ce4b5983/s2--d-dark.png) | [s2--m-light](https://app.devin.ai/attachments/7bd9523f-91b1-40d9-a37b-c016c88100c3/s2--m-light.png) |
| S3 工作台默认 | [s3--d-light](https://app.devin.ai/attachments/a7ca0908-8411-499d-a142-c80fc3d1939d/s3--d-light.png) | [s3--d-dark](https://app.devin.ai/attachments/1e30169f-fcfd-4381-9b53-3f516220d130/s3--d-dark.png) | [s3--m-light](https://app.devin.ai/attachments/4e65435b-0679-474c-ae84-14d320cf1eb3/s3--m-light.png) |
| S4 三视图 + 选块 + 块编辑 | [s4--d-light](https://app.devin.ai/attachments/d96c4f24-8e27-4363-9027-81a81a31ad03/s4--d-light.png) | [s4--d-dark](https://app.devin.ai/attachments/12b0986a-fa0b-46e6-9071-2a915ac9d748/s4--d-dark.png) | [s4--m-light](https://app.devin.ai/attachments/3af6207d-0c03-47ea-8699-d5d4c77703bf/s4--m-light.png) |
| S5 协作者抽屉 | [s5--d-light](https://app.devin.ai/attachments/6db32388-e58b-4157-a80a-1a64094f3158/s5--d-light.png) | [s5--d-dark](https://app.devin.ai/attachments/d665f6b8-c6b0-438b-9c73-64a9c3d38e4d/s5--d-dark.png) | [s5--m-light](https://app.devin.ai/attachments/a03bc1b3-2e35-4000-89fd-a15d222a32da/s5--m-light.png) |
| S6 AI 面板 | [s6--d-light](https://app.devin.ai/attachments/9e95e9d3-977c-4492-866f-c9f60738ccd3/s6--d-light.png) | [s6--d-dark](https://app.devin.ai/attachments/bf107776-f2bf-43c9-9ae6-b5cf4c998c34/s6--d-dark.png) | [s6--m-light](https://app.devin.ai/attachments/9de67584-afee-495c-a6ae-b21d523344e1/s6--m-light.png) |
| S7 递交页 | [s7--d-light](https://app.devin.ai/attachments/45c253db-00c1-4dfb-8b6c-4f0d8b4deab4/s7--d-light.png) | [s7--d-dark](https://app.devin.ai/attachments/f0db0e93-f09c-41e8-8bd6-61296f8f32f4/s7--d-dark.png) | [s7--m-light](https://app.devin.ai/attachments/1333ebf7-a5ad-4eaf-9ad2-c2404fb50724/s7--m-light.png) |
| S8 登录 / 注册 | [s8--d-light](https://app.devin.ai/attachments/dfbe7869-ca29-4bb8-a51b-52a217dacb02/s8--d-light.png) | [s8--d-dark](https://app.devin.ai/attachments/67ce21a7-c706-4ba3-94f8-334807e144b4/s8--d-dark.png) | [s8--m-light](https://app.devin.ai/attachments/9d0ecf31-31d1-4cd8-a8ff-de4631325896/s8--m-light.png) |
| S9 客户审阅页 | [s9--d-light](https://app.devin.ai/attachments/a384d26b-d08e-43a9-8609-9ce21fbca0b8/s9--d-light.png) | [s9--d-dark](https://app.devin.ai/attachments/d4697320-8602-474d-9026-791b80532c12/s9--d-dark.png) | [s9--m-light](https://app.devin.ai/attachments/cdd9b198-7a67-4ec0-9a32-7f64689e7b93/s9--m-light.png) |
| S10 移动六屏（1440 = 六屏并排画廊） | [s10--d-light](https://app.devin.ai/attachments/1779eca7-cb8c-4cdc-923e-5928d48d80a1/s10--d-light.png) | [s10--d-dark](https://app.devin.ai/attachments/70cb29ed-aacf-4fac-8461-852b38b522cb/s10--d-dark.png) | [s10--m-light（画廊在 375）](https://app.devin.ai/attachments/07cddb72-7068-47e8-ae84-825e1254f415/s10--m-light.png) |
| S10 · 台账 375 | — | — | [s10-ledger](https://app.devin.ai/attachments/0683df3b-9f94-44d1-80c2-d80f8c207594/s10-ledger--m-light.png) |
| S10 · 编辑 Tab 375 | — | — | [s10-edit](https://app.devin.ai/attachments/7a0e411f-9136-4253-85ce-57dd81e5d730/s10-edit--m-light.png) |
| S10 · 预览 Tab 375 | — | — | [s10-preview](https://app.devin.ai/attachments/082b862e-f5f3-4011-bf76-2923ea1db4bd/s10-preview--m-light.png) |
| S10 · AI Tab 375 | — | — | [s10-ai](https://app.devin.ai/attachments/6559a69f-954d-4df9-8e7a-fccc30c298d3/s10-ai--m-light.png) |
| S10 · 更多 Sheet 375 | — | — | [s10-more](https://app.devin.ai/attachments/487590e3-a1a7-47b9-bcc4-9185a2092879/s10-more--m-light.png) |
| S10 · 客户审阅 375 | — | — | [s10-client](https://app.devin.ai/attachments/e1900d7a-37ca-4deb-9348-76ab247c65f8/s10-client--m-light.png) |

原型使用的真实数据：`examples/method`（WK2026-0012《一种时间序列预测模型部署期可信自适应控制方法及装置》，11 项权利要求，段号 [0001]–[0089]，权项 1 步骤一/二/三原文）与 `examples/system`（WK2026-0007《一种时间序列预测模型可信部署监控与自动降级系统》，OA 答复期限 2026-06-18）。人物（李哲 / 王岚 / 周工）与时间为演示数据。

---

## 8. Tradeoffs 与改动量估计

### 8.1 方向 B 牺牲了什么

1. **沉浸式暗色控制台感**：Overleaf 深绿顶栏 + 深 rail 在方向 B 消失，白壳在长时间盯 PDF 时对比更刺眼 [推断]——靠深色模式补偿，但深色模式下白纸与 `#111` 画布的亮度差比现状更大。
2. **区块边界靠"读"而不是"看"**：8% 边线 + 留白分层，对低对比显示器 / 投影仪不友好 [推断]；需要保留 `--line-2` 14% 作为"高对比"偏好开关（未在原型实现）。
3. **信息密度略降**：台账行 40 → 44、树行 28 → 30、顶栏 40 → 44、状态栏 24 → 28，1440×900 台账首屏可见行约少 2 行 [推断]。
4. **绿的稀缺性要靠纪律维持**：C3"一屏一 primary"在抽屉打开时需要顶栏"构建"降级或抽屉内不放 primary，原型选择后者；实现时要在 shell 层做 primary 归属判断，工程成本见下。
5. **暖灰与现状 OKLCH 冷灰不兼容**：无法"等值搬家"，必须整体替换 `--n*`；图表色（recharts）也要跟随重新校色。
6. **未验证项**：axe 扫描、真机触控、`prefers-reduced-motion` 真机行为、深色模式对比度在真实 PDF.js 渲染下的表现——原型只在 Chrome 静态页验证。

### 8.2 改动量估计

| 范围 | 估计 | 理由 |
|---|---|---|
| `frontend/src/index.css`（tokens） | **中** | 原始层 `--n0..n9` 全部换值 + 新增 `--g*` 暖灰、`--fg-2/3/4`、`--line/--line-2`、`--sh-*` 三档、`--r-*` 四档、`--h-*` 高度阶、10 档 `--st-*` 合并 30 个 `--status-*`；深色块从"反色"改为独立 4 层。改的是**值和命名**，不是结构（仍 原始层 → 语义层），Tailwind v4 `@theme` 映射同步改。约 200 行。 |
| `frontend/src/components/ui/*` | **中偏大** | 每个原语都要改尺寸档与圆角（button 四档 + mobile 覆盖、input 三档、select/menu 32/44、badge 22 pill、tag 与 badge 分色、avatar 三档 + hue 哈希、dialog 三档 + ≤640 转 Sheet、drawer 320 透明度动画、toast 四类、tooltip 24/300ms、empty 32 图标、skeleton 形状）；**新增** segmented control、status-badge-select、due-chip 三个原语；删除现状 pill 主按钮变体。约 25 个文件，多为样式类替换，逻辑改动集中在 dialog→sheet 与 select 自绘。 |
| Shell（顶栏 / rail / 树 / 状态栏 / 抽屉承载 / 移动 Tab） | **大** | 结构性改动：① 审阅 / 历史 / AI / 协作者从 dockview Tab 迁到右侧 320 抽屉（audit #2），dockview 只保留源码 / 版面 / PDF 三面板；② 三处"构建"合并为顶栏一处；③ rail 图标 + tooltip 承载面板开关；④ 移动端 chrome 302 → 100，段控件并入纸面浮条；⑤ primary 归属判断（抽屉 / 块编辑器打开时顶栏构建降级）；⑥ 树隐藏 `studio.json/.emf`。涉及 `App` 布局、hash 路由参数（抽屉状态）、dockview 配置。 |
| 台账 / 递交 / 登录 / 客户页（页面层） | **中** | 台账：KPI 卡 → 摘要行、期限横幅 → 行内 chip、看板空列折叠；递交：H1 + 清单 + 粘性动作卡；登录：分栏 + 自绘错误；客户页：机构头 + 动作条。逻辑不变，版式重排。 |
| 版面 / PDF 内核、Markdown 真源、DOCX/PDF 生成 | **零** | 设计只管 UI 壳；纸面恒白是对现状 `--paper: --n1` 的**回退到白**，不动内核。 |

**总体**：中偏大。可分三个短周期落地：① tokens + `components/ui`（一周期，可视差异立刻出现：圆角 / 阴影 / 字号 / 暖灰）→ ② 台账 / 登录 / 递交 / 客户页版式 → ③ 工作台 shell（抽屉化 + 移动 chrome）。

---

## 9. 验证声明（实事求是）

- **已验证 [实测]**：36 张原型截图为 Chrome（Playwright，本机已装 Chrome）真实渲染；所有 fg/bg、状态徽章、深色配对的对比度用 python 计算（§2）；竞品数值来自 getComputedStyle（`w6-b-refs/computed-samples.json`）；`git status` 仅新增 `docs/design-system/` 下文件，`frontend/`、后端、`examples/` 无改动。
- **未验证**：axe-core 扫描（原型无表单语义完整性）、真机触控（仅按 CSS 高度 ≥ 44 判定）、`prefers-reduced-motion` 真机、深色模式在真实 PDF.js 画布上的观感、飞书 / Notion 登录态实景（未登录）。
- **推断项**已在正文逐条标 **[推断]**（Notion 侧栏 / 正文色、飞书内容列宽、顶栏 44 vs 40 的取舍、空态图标 32、Sheet 顶角 16、暖白对投影仪的影响、移动 Tag 删除交互）。
