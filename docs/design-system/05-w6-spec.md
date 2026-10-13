# 波次 6 施工规格（唯一真源）— 方向 C · 专业工具式高密度（`c-pro-dense`）

> 状态：**冻结**（2026-09-06，分支 `devin/w6-spec`，基于 `devin/w6-visual`，只有 docs）。老板选 **C · Pro Dense 为主壳**。本文是波次 6 前端施工的唯一规格：token / 原语 / 复合组件 / 逐页版式 / 单元交接全部以本文为准；与 `03-w6-direction-c-pro-dense.md`、`04-w6-direction-review.md` 冲突处以**本文**为准。
> 像素级参照：`docs/archive/design-system/prototype-w6-c-pro-dense/`（`index.html` 可切屏 / 切深浅色 / 切 1440·375）+ 截图 `docs/archive/design-system/w6-c-pro-dense/shots/`。原型与本文冲突处（§0.3 列出的 8 处修正），**以本文为准**。
> 证据等级标注：`[实测]` 本机命令 / 浏览器亲眼所见；`[census]` 来自 `w6-audit/census.json`；`[源码]` 读过的代码 / 竞品源码；`[推断]` 未实测。

## 0. 读法与结论

### 0.1 一句话

Overleaf 的骨架（左 rail + 文件树 / 大纲 + 源码｜PDF 双栏 + 右上唯一绿色"构建"），VS Code / Linear 的密度与四层面深色，Fluent 2 的 32px 控件与 4pt 阴影纪律；状态永远"点 + 文字"，期限永远"热度 + 倒计时"，一屏只有一个绿色实底。

### 0.2 与波次 5 同屏并排必须肉眼可辨的 8 处（验收第一条）

| # | 波次 5 现状 `[census]` | 波次 6 目标 | 看哪张原型图 |
|---|---|---|---|
| 1 | 单一 4px 圆角占 96%，面层无区块感 | 4 层面（app / panel / sunken / elevated）+ 5 档随尺寸圆角 + 3 档阴影 | `shots/cp--1440-light.png` |
| 2 | 无 H1；字号 12–14 三档占 98% | 每个非工作台页面一个 **28/36 H1**，正文 14/22，最小 11 | `s1 s7 s8` |
| 3 | 绿色 13 义（按钮 / 状态 / 图标 / 通知全绿） | 绿只做 primary / 焦点环 / 链接；10 态 = 色点 + 文字；通知按类型 4 色图标 | `cp s1` |
| 4 | 工作台默认 5 区同屏、审阅 / AI / 历史顶掉源码 | 默认 rail + 侧栏 + 源码｜PDF；AI / 审阅 / 历史 / 控制台进右侧 **360 伴随栏**，源码永不消失 | `s3 s6` |
| 5 | 15 种控件高度 | 5 档 24 / 28 / 32 / 36 / 44；顶栏控件统一 32 | `cp` |
| 6 | 深色 = 反色（单层） | 深色 4 层：app 0.175 < sunken 0.160 · panel 0.215 · elevated 0.255；纸面恒白 | `s3--1440-dark` |
| 7 | 移动工作台 chrome 302px，19/23 控件 < 44 | 44 + 56 = 100px；全部控件 ≥ 44 | `s10b s10c` |
| 8 | KPI 4 张空卡顶开台账；10 列看板全展开 | 今日摘要条 32（只显示非零）；看板空列折叠 40 | `s1 s2` |

### 0.3 对原型 C 的 8 处修正（原型未改，施工以本表为准）

| # | 原型 C（`tokens.css` / `proto.css`） | 冻结值 | 依据 |
|---|---|---|---|
| 1 | UI 基准字号 13px（`tokens.css` `--fs-sm: 13px /* UI 基准：表格、树、菜单、按钮 */`，body 13px 探针 `[实测]`） | **14px**（`--fs-md: 14px`，行高 22 为基准；13 退为树 / 大纲 / 命令面板项） | 04 §2.1-4：13px 对非工程用户偏小；B §2.3 飞书 14/22 `[实测]` |
| 2 | `tokens.css` 最小 11，但页面 CSS 硬写 9 / 10px（`components.html` 探针字号集合含 9px 10px `[实测]`；04 §2.1 指出首页 / 工作台 / 客户页 / AI 面板辅助文字 10px） | **最小 11px，禁 9 / 10**；原 10px 处提到 11（等宽案号 / kbd / 状态栏）或 12（说明文字）；`lint-tokens` 的 `text-[Npx]` 禁令已能拦硬写 | 老板硬规则"最小字号 11px（禁 10px）"；04 §3"不借 A 的 10px" |
| 3 | 顶栏控件 28（`proto.css` `.topbar .btn { height: 28px }`，尽管 `tokens.css` 注释写 `--h-md 32 顶栏控件`） | **32**（`--h-md`）；顶栏高 40 不变，控件上下各 4 留白；顶栏搜索框也 32 | benchmark L3；Fluent 2 按钮 medium 32 `[官方]`；04 §2.2-2 |
| 4 | 状态栏右端"构建"绿色实底 + 顶栏"构建"绿色实底 | 顶栏右上 **唯一** primary（split-button）；状态栏只放"点 + 文字"（`● PDF 已就绪 2.3s`），无实底按钮 | 老板"一屏一个 primary"；04 §2.2-6 |
| 5 | 看板列头 / 紧凑行允许只用色点 | **禁止**只点不字：`StatusDot` 必带文字；列头 = 点 + 名 + 计数 | 老板"状态点必须点 + 文字并列，不依赖色觉"；C7 |
| 6 | 圆角 token 5 档已定义（3 / 4 / 6 / 8 / 12），但控件实际只用 3 / 4 / 6 三档，8 / 12 仅对话框 / Sheet | **5 档强制随尺寸**：≤ 24 → 3 · 28 → 4 · 32–36 → 6 · 浮层 / 卡 / Proposal / 块编辑器 → 8 · 对话框 / Sheet / 登录卡 / 空态图标 → 12；pill 仅 chip / 状态 / 头像 | A §2.5（Overleaf `border-radius.scss` 4/8/16/pill `[源码]`；Notion 28/40/48→6/8/12 `[实测]`）；04 §3 |
| 7 | 亮色 hairline 密度高、留白紧（04 §2.1-4 评审所见：对非工程用户偏冷） | 表格 **只留水平线**（列间无竖线）；面板内容区 padding 12 → 非工作台页面 **16 / 页边 32**；台账默认行高 **40**（紧凑模式 36 由用户在"显示"菜单切） | 04 §2.1-4"偏冷"；benchmark C1 C3 C21；Linear 列表行 40 `[实测]` |
| 8 | 控件 6 档 24 / 28 / 32 / 36 / **40** / 44（`components.html` 按钮出现 22 24 28 32 36 40，探针 `w6-spec/probe.json` `[实测]`） | **5 档** 24 / 28 / 32 / 36 / 44；40 档删除（桌面 CTA 用 36，登录 / 移动用 44） | 老板总表"控件高度 ≤ 5 档"；硬规则 ≥ 44 |

### 0.4 期限热度：4 档 → 3 档（老板总表要求 3 档）

| 档 | 条件 | 色 | 文字 |
|---|---|---|---|
| `heat-0` 常规 | `days_left > 30` | `--fg-muted`，无底 | `剩 45 天` |
| `heat-1` 临近 | `7 < days_left ≤ 30` | `--warn-fg` / `--warn-bg` | `剩 12 天` |
| `heat-2` 紧急 | `days_left ≤ 7` 或逾期 | `--danger-fg` / `--danger-bg` | `剩 3 天` / `逾期 2 天`（逾期前缀固定为"逾期"） |

阈值与现有 `frontend/src/store/deadlines.ts` 的 `7d / 30d` 分桶一致 `[源码]`（不改逻辑）；原型 C 的 `heat-3` 合并进 `heat-2`。**阈值是否符合代理实务标 `[推断]`，由 dashboard 单元在 `integration_requests` 请代理师确认，确认前按本表施工。**

---

## 1. 总表（唯一真源）

命名规则：原始层 `--g0..--g11` / `--brand-*` / `--<hue>-fg|bg|dot` 只允许出现在 `frontend/src/index.css`；组件只引用语义层；Tailwind 类通过 `@theme inline` 映射（`bg-panel` `text-fg-muted` …）。**shadcn 语义别名保留**（`--background --foreground --muted --muted-foreground --border --primary --ring --popover --card --destructive` 等）并指向新层，避免全站 className 改动（03-C §9 估算 150–200 行 index.css 改动）。

对比度 = WCAG 2.x 相对亮度公式，OKLCH → 线性 sRGB 实算（脚本 `w6-spec/contrast.py`，`[实测]` 2026-09-06）。文字 ≥ 4.5:1，图形 / 色点 ≥ 3:1（色点同时必有文字，见 §2.2）。

### 1.1 原始灰阶（12 阶，冷灰 hue 255；不借 B 暖灰）

| token | 亮色 OKLCH | 近似 hex | 用途（亮） | 暗色用途 | 现状 `[census]` | 来源 |
|---|---|---|---|---|---|---|
| `--g0` | `oklch(1 0 0)` | `#ffffff` | panel / 纸面 / 输入底 | — | `--n0` 白 | C §2.1 |
| `--g1` | `oklch(0.982 0.002 255)` | `#f8f9fa` | app 壳（rail / 顶栏 / 侧栏 / 状态栏 / 画布） | 暗色 `--fg-strong` 用 0.960 | `--n1` | C；VS Code Light Modern `#F8F8F8` `[源码]` |
| `--g2` | `oklch(0.958 0.004 255)` | `#eff1f4` | sunken（看板列底 / 分组栏 / 代码块底）、hover | 暗色 `--fg` 0.870 | `--n2` | C |
| `--g3` | `oklch(0.925 0.006 255)` | `#e4e6ea` | `--border` hairline、active | — | `--n3` | C；VS Code `#E5E5E5` |
| `--g4` | `oklch(0.870 0.008 255)` | `#d1d5d9` | `--border-strong`（输入 / 分隔线强） | 暗色 `--fg-muted` 用 0.680 | `--n4` | C |
| `--g5` | `oklch(0.760 0.012 255)` | `#acb2b9` | `--fg-disabled`（2.15:1，禁用态豁免） | 暗色 `--fg-subtle` 0.630 | `--n5` | C |
| `--g6` | `oklch(0.565 0.016 255)` | `#70777f` | `--fg-subtle`（占位 / 时间戳）**4.55:1 on g0 · 4.32 on g1 · 4.03 on g2** | — | `--n6` | C；Linear 次级灰 `rgb(138,143,152)` 同级 `[实测]` |
| `--g7` | `oklch(0.520 0.018 255)` | `#626a73` | `--fg-muted`（说明 / 表头 / 标签）**5.50 · 5.22 · 4.87** | — | — | C |
| `--g8` | `oklch(0.420 0.020 255)` | `#464e58` | 图标默认色 **8.45** | 暗色 `--border-strong` 用 0.380 | `--n7` | C |
| `--g9` | `oklch(0.300 0.020 255)` | `#272e38` | `--fg` 正文 **13.62 on g0 · 12.94 on g1** | 暗色 `--border` 0.300 | `--n8` | C |
| `--g10` | `oklch(0.220 0.018 255)` | `#151b23` | `--fg-strong`（标题 / 选中 Tab 下划线）**17.3** | 暗色 elevated 0.255 / panel 0.215 | `--n9` | C |
| `--g11` | `oklch(0.150 0.014 255)` | `#070b11` | tooltip / toast 深底 | 暗色 app 0.175 / sunken 0.160 | — | C；Raycast 壳 `rgb(7,8,10)` `[实测]` |

### 1.2 语义面层（4 层）与边 / 前景

| token | 亮 | 暗 | 亮对比（相邻面） | 暗对比 | 现状 | 来源 |
|---|---|---|---|---|---|---|
| `--bg-app` | `--g1` | `oklch(0.175 0.006 260)` `#0f1113` | app↔panel 1.05 | 1.08 | `--background` 白（无层） | C §2.2；VS Code Dark Modern `activityBar #181818 / editor #1F1F1F` `[源码]` |
| `--bg-panel` | `--g0` | `oklch(0.215 0.006 260)` `#181a1c` | — | — | `--surface` | C |
| `--bg-sunken` | `--g2` | `oklch(0.160 0.006 260)` `#0c0d10` | sunken↔panel 1.13 | 1.11 | 无 | C |
| `--bg-elevated` | `--g0` + `--sh-md` | `oklch(0.255 0.007 260)` `#212326` + 1px `--border-strong` | 靠阴影 | 1.11 + 边 | `--popover` | C；Fluent Elevation `[官方]` |
| `--bg-hover` | `--g2` | `oklch(0.255 0.007 260)` | — | — | `--accent` | C |
| `--bg-active` | `--g3` | `oklch(0.300 0.008 260)` | — | — | 无 | C |
| `--bg-selected` | `--brand-100` `oklch(0.955 0.030 155)` | `oklch(0.300 0.045 155)` `#1a3424` | `--fg` on selected **12.08** | `--fg` on selected **9.04** | `--primary-soft` | C |
| `--paper` | `#ffffff` **恒白** | `#ffffff` 恒白 | — | — | `--paper` | 硬规则；C |
| `--paper-canvas` | `--g2` | `--bg-sunken` | — | — | 无 | C（PDF / 版面画布） |
| `--border` | `--g3` | `oklch(0.300 0.008 260)` `#2b2e32` | 1.25（hairline） | 1.28 | `--border` | C |
| `--border-strong` | `--g4` | `oklch(0.380 0.010 260)` `#3f4348` | 1.48 | 1.75 | `--border-2` | C |
| `--border-focus` / `--ring` | `--brand-600` | `--primary`（暗） | — | — | `--ring` | C |
| `--fg-strong` | `--g10` | `oklch(0.960 0.003 255)` | 17.3 | **15.6** on panel | `--foreground` | C |
| `--fg` | `--g9` | `oklch(0.870 0.006 255)` `#d2d4d8` | 13.62 | **11.82** on panel / 12.8 on app / 10.64 on elevated | `--foreground` | C |
| `--fg-muted` | `--g7` | `oklch(0.680 0.012 255)` `#9399a0` | 5.50 / 5.22 on g1 / 4.87 on g2 | **6.08** / 6.59 / 5.48 | `--muted-foreground` | C |
| `--fg-subtle` | `--g6` | `oklch(0.630 0.014 255)` `#848a92` | 4.55 / 4.32 / 4.03（**只允许出现在 g0 / g1 上**，g2 上用 `--fg-muted`） | **5.01** / 5.43 | `--placeholder` | C |
| `--fg-disabled` | `--g5` | `oklch(0.450 0.012 255)` | 2.15（豁免） | 2.36（豁免） | opacity .5 | C |
| `--fg-on-brand` | `--g0` | `oklch(0.140 0.020 155)` `#040c06` | 见 1.3 | 见 1.3 | `--primary-foreground` | C |

### 1.3 品牌绿（只做 3 义：primary / 焦点环 / 链接）

| token | 亮 | 暗 | 对比 | 现状 | 来源 |
|---|---|---|---|---|---|
| `--brand-600` = `--primary` | `oklch(0.520 0.150 152)` `#008039` | `oklch(0.720 0.140 155)` `#4ebe7d` | 白字 on 600 **5.07**；暗：`--fg-on-brand` on 暗主色 **8.49**；暗主色 on panel 7.49 | `--green-600 oklch(0.52 0.15 152)` 等值 | C §2.3；Overleaf `#138a07→` 同族 `[源码]` |
| `--brand-700` = `--primary-hover` | `oklch(0.460 0.130 153)` `#006c32` | `oklch(0.780 0.130 155)` | 白字 **6.62** | `--green-700` | C |
| `--brand-800` = `--primary-active` | `oklch(0.400 0.110 154)` `#00582a` | `oklch(0.840 0.110 155)` | 白字 8.66 | `--green-800` | C |
| `--brand-100` = `--primary-soft` | `oklch(0.955 0.030 155)` | `oklch(0.300 0.045 155)` | — | `--green-50` | C |
| `--link` | `--brand-700` | `oklch(0.800 0.110 152)` `#86d29b` | 6.62 on g0；暗 **9.78** on panel | `--primary-text` | C |
| `--brand-300` | `oklch(0.800 0.110 152)` | 同 | 装饰（选中 PDF 块描边） | 无 | C |

### 1.4 语义色（4 类）与 10 档专利状态色

色相族固定 7 个：`info 258` `ok 152` `warn 70` `danger 27` `violet 300` `teal 190` `orange 45`（原型 C `--st-*` 复用）。每族三值：`-fg`（深字）/ `-bg`（浅底）/ `-dot`（8px 色点）。

| 族 | 亮 fg | 亮 bg | 亮 dot | fg on bg | fg on g0 | dot on g0 | 暗 fg | 暗 bg | 暗 fg on 暗 bg | 暗 dot on panel |
|---|---|---|---|---|---|---|---|---|---|---|
| info | `oklch(0.470 0.150 258)` `#1a57ad` | `oklch(0.955 0.025 258)` | `oklch(0.600 0.170 258)` `#377ee3` | **6.09** | 6.95 | **4.01** | `oklch(0.800 0.100 250)` | `oklch(0.300 0.050 255)` | **7.34** | 4.37 |
| ok | `oklch(0.440 0.120 152)` `#00642f` | `oklch(0.955 0.030 155)` | `oklch(0.580 0.150 152)` `#0a924b` | **6.48** | 7.31 | **4.00** | `oklch(0.820 0.120 152)` | `oklch(0.300 0.050 155)` | **8.01** | 4.38 |
| warn | `oklch(0.480 0.130 70)` `#8a4c00` | `oklch(0.965 0.040 85)` | `oklch(0.600 0.150 70)` `#b76c00` | **6.04** | 6.70 | **4.06** | `oklch(0.850 0.120 80)` | `oklch(0.320 0.060 75)` | **8.02** | 4.32 |
| danger | `oklch(0.480 0.180 27)` `#ac1a1c` | `oklch(0.960 0.025 25)` | `oklch(0.600 0.210 27)` `#e23532` | **6.30** | 7.18 | **4.38** | `oklch(0.800 0.130 25)` | `oklch(0.320 0.070 25)` | **6.46** | 4.00 |
| violet | `oklch(0.460 0.160 300)` `#673ba2` | `oklch(0.960 0.025 300)` | `oklch(0.620 0.180 300)` | **6.80** | — | 3.93 | `oklch(0.820 0.100 300)` | `oklch(0.320 0.060 300)` | **7.20** | 4.46 |
| teal | `oklch(0.450 0.100 190)` `#006662` | `oklch(0.955 0.030 190)` | `oklch(0.580 0.110 190)` `#008e89` | **6.06** | — | 4.00 | `oklch(0.820 0.090 190)` | `oklch(0.300 0.045 190)` | **7.95** | 4.38 |
| orange | `oklch(0.500 0.160 45)` `#a83a00` | `oklch(0.965 0.035 50)` | `oklch(0.580 0.170 45)` `#c84f00` | **5.63** | — | 4.59 | `oklch(0.830 0.120 55)` | `oklch(0.320 0.065 50)` | **7.34** | 3.82 |

语义别名：`--info-* --success-*(=ok) --warning-*(=warn) --destructive-*(=danger)`（现状名保留）。**现状**：`--status-*-{fg,bg,dot}` 十档已存在于 index.css `[源码]`，但 hue / 明度散且 dot 无 3:1 保证；本波次映射到 7 族。

| 状态（`CaseStatus`） | 族 | 文案 | 现状 token |
|---|---|---|---|
| intake 受理 / 立案 | info | 立案 | `--status-intake-*` |
| drafting 撰写中 | violet | 撰写中 | `--status-drafting-*` |
| review 内审 | orange | 内审 | `--status-review-*` |
| client 客户审阅 | teal | 客户审阅 | `--status-client-*` |
| final 定稿 | ok（`-fg` 用 `oklch(0.440 0.120 152)`；dot 用 ok-dot） | 定稿 | `--status-final-*` |
| filed 已递交 | info（dot 明度降 0.520 `oklch(0.520 0.170 258)` 与 intake 区分 = 深蓝） | 已递交 | `--status-filed-*` |
| oa OA 答复 | warn | OA 答复 | `--status-oa-*` |
| granted 授权 | ok（实心 dot + `check` 12 图标叠加于文字前，与 final 区分靠图标 + 文字） | 授权 | `--status-granted-*` |
| rejected 驳回 | danger | 驳回 | `--status-rejected-*` |
| closed 结案 | 中性：fg `--fg-muted` / bg `--bg-sunken` / dot `--g6` | 结案 | `--status-closed-*` |

规则：**任何位置的状态 = `StatusDot`（点 + 文字）**；同族两态（final / granted、intake / filed）靠文字与图标区分，色只是辅助 —— 这是"不依赖色觉"的落地。

### 1.5 期限热度（3 档，见 §0.4）

`--heat-0-fg: var(--fg-muted)` / `--heat-0-bg: transparent`；`--heat-1-fg: var(--warn-fg)` / `--heat-1-bg: var(--warn-bg)`；`--heat-2-fg: var(--danger-fg)` / `--heat-2-bg: var(--danger-bg)`。现状：`DeadlinesPage.tsx` 手写 `text-warning-foreground` `[源码]` → 改用 `Heat`。

### 1.6 字体与字阶

字体栈不变（`--font-ui` 系统 UI 栈 + 中文回退；`--font-mono` 等宽；`--font-paper` 版面 / PDF 宋体族）`[源码 index.css]`。

| token | px / 行高 | 用途 | 现状 `[census]` | 来源 |
|---|---|---|---|---|
| `--fs-2xs` | **11 / 16** | 等宽案号、kbd、状态栏、表头大写标签、Tab 标签（移动） | 现状 `--fs-2xs: 11px`（探针），保持；原型 C 页面的 9 / 10px 不引入 | 老板"最小 11"；04 §3 |
| `--fs-xs` | 12 / 18 | 说明、元信息、chip、徽章、表头 | 12 占 34% | C；B §2.3 |
| `--fs-sm` | 13 / 20 | 树节点、大纲、命令面板项、看板卡标题、状态栏可选 | 13 占 21% | C（Linear 导航 13 `[实测]`） |
| `--fs-md` = `--fs-base` | **14 / 22** | **UI 基准**：正文、按钮、输入、表格单元、菜单项 | 14 占 43%；现基准 14 | 借 B §2.3（飞书 14/22 `[实测]`）；04 §2.1-4 |
| `--fs-lg` | 16 / 24 | 卡片标题、对话框标题、登录输入（16 防 iOS 缩放） | 16 少量 | C；B S8 |
| `--fs-xl` | 20 / 28 | H2（面板大标题、递交步骤标题） | 无 | C |
| `--fs-2xl` | **24 / 32** | H1 紧凑（工作台内页头如"协作者中心"抽屉头 / 移动页 H1） | 无 | 借 B §2.3 |
| `--fs-3xl` | **28 / 36** | **页级 H1**（台账 / 期限中心 / 通知 / 递交 / 登录 / 账户 / 机构） | 无（audit #5） | 借 B §2.3 + S8；A §2.4 |
| 字重 | 400 / 500 / 600 只三档；H1 600、按钮 500、表头 500 | 400/500/600 | B ⑩ |
| 等宽 | 案号 / 行号 / 段号 / 日期 `tabular-nums` | 部分 | C |
| 编辑器 | 源码 14/1.7（`--editor-font-size` 保持用户可调 13–16） | 13/1.7 | C；Overleaf 默认 12→我们 14 `[源码]` |

### 1.7 尺寸档

| 类 | 档 | token | 用途 | 现状 `[census]` | 来源 |
|---|---|---|---|---|---|
| 控件高度（5 档） | **24** | `--h-xs` | 表内行内 ghost、chip 关闭、树节点行内动作 | 15 种高度，常用 28/32/36 | C；Fluent small |
| | **28** | `--h-sm` | 紧凑按钮 / 输入（工作台面板头、工具行、表格筛选） | `--h-control-sm` | C |
| | **32** | `--h-md` | **默认**：顶栏控件、表单、菜单项、命令面板项、Segmented md | `--h-control 32` | 修正 §0.3-3；Linear / Fluent 32 |
| | **36** | `--h-lg` | 页级工具条按钮、登录 / 对话框主按钮（桌面）、PDF 工具条内控件容器 | `--h-control-lg 36` | C |
| | **44** | `--h-touch` | 移动端一切可点；桌面 xl CTA（登录全宽） | `--h-control-mobile 44`；移动 19/23 未达 | 硬规则 ≥ 44；B ⑭ |
| 行高 | 树 / 大纲 28 · 菜单 32 · 表格 40（紧凑 36）· 移动列表 48 · 移动 Sheet 项 48 | `--row-h-tree 28` `--row-h 40` `--row-h-compact 36` `--row-h-mobile 48` | | `--row-h 40` `--row-h-compact 36` 已有；`--tree-row 28` | §0.3-7 |
| 圆角（5 档 + pill） | **3** `--r-xs` | ≤ 24 控件、checkbox、kbd | 96% 用 4 | C |
| | **4** `--r-sm` | 28 控件、输入、Segmented 项、tooltip | | C / Fluent |
| | **6** `--r-md` | 32–36 控件、菜单、卡片（看板卡 / 评论卡）、rail tab | | 借 A §2.5 |
| | **8** `--r-lg` | 浮层（popover / 浮岛 / Proposal 卡 / 块编辑器）、面板容器 | | 借 A（Overleaf 8）|
| | **12** `--r-xl` | 对话框、Sheet 顶角、登录卡、空态图标容器 | | 借 A（Notion 48→12）|
| | pill `--r-full` | chip / 状态 / 头像 / 徽章计数 / 进度 | | C |
| 间距 | 4pt：2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40 | Tailwind `p-0.5..p-10` | 面板内 12；页边 24；非工作台页边 **32**（≥ lg）、16（< md） | 已是 4pt | C；§0.3-7 |
| 阴影（3 档 + 纸） | `--sh-sm` `0 1px 2px oklch(0 0 0/.06)`；`--sh-md` `0 4px 12px oklch(0 0 0/.10), 0 1px 2px /.06`；`--sh-lg` `0 12px 32px /.16, 0 2px 4px /.08`；`--sh-paper` `0 1px 3px /.12, 0 0 0 1px var(--border)` | 暗色：阴影不透明度 ×1.5 且 **加 1px `--border-strong` 环** | 卡 sm · 浮层 md · 对话框 / Sheet lg · 纸 paper | 4 档已有，值散 | C §2.5；Fluent Elevation |
| 边框 | 1px `--border`（hairline）；输入 / 分隔强 `--border-strong`；焦点 2px `--ring` offset 0（`focus-visible`） | | | | C |
| z-index | `--z-sticky 10` `--z-panel 20` `--z-overlay 40` `--z-popover 50` `--z-toast 60` | 已有同值 | | lint-tokens 已禁数字 z | C |
| 动效 | `--dur-fast 120ms`（hover / 颤动）· `--dur-color 150ms`（颜色）· `--dur-panel 200ms`（伴随栏 / Sheet 进出）· `--ease cubic-bezier(0.2,0,0,1)`；`prefers-reduced-motion` → 全部 0ms | 已有 `--dur-*` | | | C；Material easing `[官方]` |

### 1.8 壳尺寸

| token | 值 | 现状 | 来源 |
|---|---|---|---|
| `--h-topbar` | 40 | 40 | C / Overleaf `[源码]` |
| `--h-statusbar` | 24 | 24 | C |
| `--w-rail` | 40（tab 32×32，图标 20） | 40 | A / Overleaf `rail.scss` `[源码]` |
| `--w-side` | **240**（可拖 200–400，句柄 7px） | 208 | C；A §4 |
| `--w-companion` | **360**（右侧伴随栏：AI / 审阅 / 历史 / 控制台 / 术语 / OA；可收起为 0；min 320，max 480） | `--w-agent 320` | 借 A（解 audit #2） |
| `--w-drawer` | 320（协作者中心抽屉 = 伴随栏宽 360 同槽；独立抽屉如设置 320） | 320 | C |
| `--h-pdftb` | 32（PDF 工具条，内控件 24） | 36 | C |
| `--h-panel-header` | 32（dockview 面板头） | 32 | C |
| `--h-m-topbar` / `--h-m-tabbar` | 44 / 56 | 44 / 56 | C；B |
| `--w-dialog-sm/md/lg` | 400 / 560 / 800；< md 全屏 | 已有 | C |
| `--w-board-col` | 280（折叠 40） | 已有 | C |
| `--max-page` | 1280（非工作台页面内容最大宽，居中） | 已有 | A §5 |
| `--w-form` | 400（登录卡 / 表单列） | `--max-form` | B S8 |

### 1.9 断点与响应式规则

| 断点 | 规则 |
|---|---|
| `< 640 (sm)` | 移动壳：顶栏 44 + 底 Tab 56；一切控件 ≥ 44；对话框全屏；伴随栏 / 抽屉 → `Sheet`（底部 ≤ 85vh）；表格 → 卡片列表（行 ≥ 48） |
| `640–767` | 同移动壳（大手机横屏不另做） |
| `768–1023 (md)` | 双栏：rail + 一个主区（源码或 PDF，Segmented 切）；侧栏为 overlay 抽屉；伴随栏 → 右侧 Sheet 360 覆盖 |
| `1024–1279 (lg)` | 三区：rail 40 + 侧栏 240 + 源码｜PDF 双栏；伴随栏打开时**侧栏自动收起**（保证编辑区 ≥ 640） |
| `1280–1679 (xl)` | rail + 侧栏 + 双栏 + 伴随栏可同时开（1280 − 40 − 240 − 360 = 640 编辑区，恰好达标） |
| `≥ 1680` | 三视图（源码 / 版面 / PDF）+ 伴随栏；默认预置 `three-view` 可用，否则三视图需手动 |
| 非工作台页 | 内容 `max-width 1280` 居中，页边 32（lg+）/ 24（md）/ 16（sm−） |

---

## 2. `components/ui` 逐文件规格

通用规则：① 尺寸 prop 名统一 `size: 'xs'|'sm'|'md'|'lg'|'xl'` → 24/28/32/36/44，`md` 默认；② 圆角随尺寸（xs 3 · sm 4 · md/lg 6 · xl 6；浮层 8；对话框 12）；③ 状态五态 `default / hover / active / focus-visible / disabled`，禁用统一 `opacity` 不再用，改 `--fg-disabled` + `--bg-sunken`；④ 图标 lucide，尺寸随控件：24→14 · 28→16 · 32→16 · 36→18 · 44→20；⑤ 全部 `data-slot` 保留供测试；⑥ 移动断点内自动升 `xl`（通过容器 `data-density=touch` 由 `MobileShell` 注入，原语内 `[data-density=touch] &` 选择器），**不**要求各单元手写 `isDesktop ? 'lg' : 'xl'`（ux-07 教训）。

| 文件 | 尺寸变体 | 状态 | token 引用 | 与现状 diff |
|---|---|---|---|---|
| `button.tsx` | xs 24 / sm 28 / **md 32** / lg 36 / xl 44；`icon-*` 同高正方；variant `primary / secondary(边框 --border-strong) / ghost / soft(--brand-100 底 --link 字) / danger / link`；`SplitButton` 子组件（主段 + 24 宽 caret 段，共用 primary） | hover `--brand-700` / 次级 `--bg-hover`；active `--brand-800`；focus 2px ring；loading spinner 16 替代图标 | `--primary --primary-hover --primary-active --fg-on-brand --border-strong --bg-hover --r-sm/md` | 现 sm/md/lg/xl 高度同，但 sm 12px 字 → 改 13；xl 圆角 4 → 6；`text-xs`→`fs-sm`；新增 `xs`、`soft`、`SplitButton`；`rounded-sm` 固定 → 随尺寸 |
| `input.tsx` | sm 28 / md 32 / lg 36 / xl 44（**xl 字号 16**，防 iOS 缩放） | 边 `--border-strong`；hover `--g5`；focus ring；invalid 边 `--danger-dot` + `aria-invalid`；readonly 底 `--bg-sunken` | `--bg-panel --border-strong --fg --fg-subtle(占位) --r-sm(sm)/--r-md` | 现 3 档 → 4 档；占位色 `--placeholder` → `--fg-subtle`；错误态样式新增（audit #12） |
| `textarea.tsx` | 同 input，min-h 3 行（66） | 同 | 同 | 补 invalid |
| `select.tsx` | sm 28 / md 32 / lg 36 / xl 44；菜单项 32（移动 44）；菜单 `--bg-elevated` r8 `--sh-md` | 同 input；选中项 `check` 16 左 | `--bg-elevated --border --sh-md --r-lg` | 替换所有原生 `<select>`（audit #11 #23）；菜单圆角 `rounded-md`→8 |
| `checkbox.tsx` / `radio-group.tsx` | 16（命中区外扩到 32×32；移动 44） | 选中 `--primary` 底白勾；indeterminate 横线；focus ring | `--primary --border-strong --r-xs` | 命中区外扩新增（audit #21） |
| `switch.tsx` | md 20×36 / sm 16×28；`role=switch` | on `--primary`；off `--g4`；暗 off `--border-strong` | `--primary --g4 --r-full` | 补 `role=switch` + sm |
| `toggle.tsx` / `toggle-group.tsx` | 24 / 28 / 32 正方或带字 | pressed `--bg-active` + `--fg-strong`；`aria-pressed` | `--bg-hover --bg-active --r-sm` | 圆角随尺寸 |
| `segmented.tsx` | **md 32**（项 28，容器 p 2）/ **xl 44**（项 40）；删除 `sm 28` 档（工作台面板头切换用 `Tabs` 下划线式，不用 Segmented） | 容器 `--bg-sunken` r6；选中项 `--bg-panel` + `--sh-sm` + `--fg-strong`；未选 `--fg-muted`；`role=radiogroup` 方向键 | `--bg-sunken --bg-panel --sh-sm --r-md/--r-sm` | 现 36 / 28 → **32 / 44**；`--h-segmented 36` 删除；用途：列表｜看板、PDF｜版面（客户页）、登录｜注册、移动 编辑｜预览｜AI |
| `tabs.tsx` | 下划线式：高 32（面板头）/ 36（页级）；项 padding 0 12；选中 2px `--fg-strong` 下划线（**不用绿**）+ `--fg-strong` 字；未选 `--fg-muted` | hover `--fg`；`aria-selected` | `--fg-strong --fg-muted --border` | 现 `rounded-md` 药丸式 → 下划线式（audit #10 双 Tab 消除：面板内只此一种） |
| `badge.tsx` | 拆三件：`Badge`（语义 4 类 info/ok/warn/danger + neutral，高 20，11/500，pill，`-bg` 底 `-fg` 字）；`Tag`（用户标签，高 20，r4，`TAG_COLORS` 数据色，字 `--fg`）；`Count`（计数，16 高 min-w 16，pill，`--bg-sunken`/`--fg-muted`；未读 `--info-dot` 底白字） | — | `--info-* --ok-* --warn-* --danger-*` | 现单一 badge 混用 → 拆；文字 12→11（≥ 11 合规） |
| `status-badge.tsx` | **下线**（保留一轮 re-export 到 `StatusDot` 后删除）；`dotOnly` prop **删除** | — | — | 被 §2.1 `StatusDot` 替代；`components/dashboard/StatusBadge.tsx` 同步下线 |
| `avatar.tsx` | 20 / 24 / 28 / 32 / 40；组 `AvatarGroup` 重叠 −6 + `+N` | 在线点 8 `--ok-dot` 带 1.5px panel 描边（右下）；`AVATAR_COLORS` 数据色不动 | `--ok-dot --bg-panel --r-full` | 去 `red-500` 类硬编码（A §9.2 指出）；在线点由 `StatusDot` 的 dot 子件复用 |
| `tooltip.tsx` | 高 24，12/400，p 4 8，`--g11` 底 `--g0` 字（暗：`--bg-elevated` + 边），r4，`--sh-sm`，延迟 400ms | — | `--g11 --g0 --r-sm` | 现浅底 → 深底（Fluent / Linear） |
| `popover.tsx` | `--bg-elevated` r8 `--sh-md` p 8；min-w 200 | 进出 `--dur-fast` 淡入 + 4px 位移 | `--bg-elevated --border --sh-md --r-lg` | `rounded-md`→8 |
| `dropdown.tsx` | 菜单项 32（移动 44），13px，图标 16 左 gap 8，kbd 右对齐；分组标签 11/500 大写 `--fg-muted` 高 24；分隔 1px | hover `--bg-hover`；danger 项 `--danger-fg` | 同 popover | 项高 / 字号统一；kbd 位 |
| `command.tsx`（cmdk） | 输入 44（16px 字）+ 项 32；面板 w 560 r12 `--sh-lg`；分组标签 11 | — | `--bg-elevated --sh-lg --r-xl` | 项 `text-2xs` 10 → 11；面板圆角 12 |
| `dialog.tsx` | sm 400 / md 560 / lg 800；头 h 52（标题 16/600）p 16 20；体 p 20；脚 p 16 20 右对齐 gap 8；**< md 全屏**（r0，100dvh） | 遮罩 `oklch(0 0 0/.4)`（暗 .6）；进出 `--dur-panel` | `--bg-elevated --sh-lg --r-xl` | 圆角 `rounded-lg`→12；全屏断点由 640 → 768 |
| `sheet.tsx` | 右侧 `w 360`（= 伴随栏，md 断点用）/ 底部 `max-h 85dvh` r12 顶角 + 抓手 36×4 `--g4`；项 48 | 同 dialog | 同 | 抓手新增；宽 320→360 |
| `bottom-drawer.tsx` | **并入 `sheet.tsx` `side=bottom`**，保留一轮 re-export 后删除 | | | 下线 |
| `alert.tsx` | 4 类语义，左 3px 色条 + 图标 16 + 标题 14/500 + 正文 13；p 12；r6 | — | `--*-bg --*-fg --r-md` | 现 `text-xs` → 13 |
| `toast.tsx` | 高 ≥ 44，w 360，`--g11` 底白字（暗 `--bg-elevated` + 边）r8 `--sh-lg`；4 类图标 16 左；操作 link 右；右上 `--z-toast`；移动底部居中 | 进出 `--dur-panel` | | 浅底 → 深底；4 类图标 |
| `progress.tsx` | 高 4 / 8；底 `--bg-sunken`；条 `--primary`（构建）或语义色 | `aria-valuenow` | | — |
| `skeleton.tsx` | `--bg-sunken` r4，shimmer 1.2s（reduced-motion 静止） | | | 圆角随容器 |
| `separator.tsx` | 1px `--border`；`strong` 变体 `--border-strong`；垂直用于工具条 gap 8 | | | 补 strong |
| `scroll-area.tsx` | 滚动条 8（hover 显现）`--g5`；暗 `--border-strong` | | | — |
| `table.tsx` | 表头 36 高 11/500 大写 `--fg-muted` **无底色**只有下边线；行 40（紧凑 36）；单元 p 8 12；**列间无竖线**；行 hover `--bg-hover`；选中 `--bg-selected` + 左 2px `--primary`；分组行 32 `--bg-sunken` 12/600 | `aria-sort` 图标 12 | `--border --bg-hover --bg-selected --bg-sunken` | 表头字 `text-xs`→11；去竖线；行高 token 化 |
| `data-table.tsx`（TanStack） | 容器 r6 边 `--border`；列宽拖拽句柄 5px；虚拟滚动行高 = `--row-h`；空态用 `EmptyState size=sm` | | | 圆角 4→6 |
| `field.tsx` / `label.tsx` | label 12/500 `--fg-muted` 高 20；hint 12 `--fg-subtle`；error 12 `--danger-fg` + `circle-alert` 12，**行内**，`aria-describedby` | | | 错误态新增（audit #12） |
| `kbd.tsx` | 高 20 min-w 20，11/500 mono，`--bg-sunken` 边 `--border` r3 | | | 10→11 |
| `breadcrumb.tsx` | 高 32，13px，分隔 `chevron-right` 12 `--fg-subtle`，当前项 `--fg-strong` | | | 字 12→13 |
| `collapsible.tsx` | 触发行 28（工作台）/ 40（页面）`chevron-right` 12 旋转 90° `--dur-fast` | | | — |
| `empty-state.tsx` | **图标 32**（容器 56×56 r12 `--bg-sunken`）；标题 14/600；原因 13 `--fg-muted` max-w 360；一个 `Button`（页面级 primary 仅当本屏无其他 primary，否则 secondary）；`size=sm`：图标 20 无容器，p 16 | `role=status` | `--bg-sunken --r-xl` | 图标 40→**32** 加容器；原因 12→13 |
| `chart.tsx` / `chart-recharts.tsx` | 系列色 `--chart-1..5` = info / ok / warn / violet / teal 的 `-dot`；网格 `--border`；tooltip 用 §tooltip 样式 | | | 色板对齐 7 族 |
| `misc.tsx` | 保持（工具函数） | | | — |

### 2.1 新原语

| 文件 | 规格 |
|---|---|
| `status-dot.tsx` `StatusDot` | `props: status: CaseStatus \| SemanticTone; size?: 'sm'\|'md'`（sm：点 6 + 12px；md：点 8 + 13px）；结构 `<span data-slot=status-dot data-status>` 内 `<i aria-hidden>`（点，`--<族>-dot`，pill）+ 文字（`--fg`）；**文字必渲染**，无 `dotOnly`；可选 `soft` 变体加 `-bg` 底 pill 高 20 p 0 8（仅台账筛选 chip / 客户页头用）；`role=status` 不加（纯展示）。token：`--st-*` 十档映射 §1.4。 |
| `heat.tsx` `Heat` | `props: daysLeft: number \| null; label?: string; size?: 'sm'\|'md'`；渲染 `heat-0/1/2` 三档：左 3px 热度条（`-fg` 色）+ `tabular-nums` 天数（sm 12 / md 14/600）+ 文案（"剩 N 天" / "逾期 N 天" / "无期限"）；`aria-label` 含全文；`null` → `--fg-subtle` "—"。 |
| `countdown.tsx` `Countdown` | 期限卡（台账右栏 / 递交页 / 客户页头 / 状态栏）：`props: due: string(ISO); kind: string; size?: 'md'\|'lg'`；md：数字 24/600 + "天" 12 + 事项 12 `--fg-muted`，高 44；lg：数字 32/600，高 56；配色随 `Heat` 三档；日期 `tabular-nums` 12 `--fg-subtle` 第二行；节假日顺延由后端 `deadline.date` 给定，前端只显示。 |
| `companion-panel.tsx` `CompanionPanel` | 右侧伴随栏容器：`props: id: 'ai'\|'review'\|'history'\|'console'\|'terms'\|'oa'\|'problems'; title; actions?; onClose`；宽 `--w-companion 360`（min 320 / max 480，左缘 7px 句柄拖拽）；面 `--bg-panel`，左 1px `--border`；头 32：标题 13/600 + 右侧 actions（ghost 24）+ 收起 `panel-right-close` 24；体 `ScrollArea`；脚可选（AI composer）。**与 dockview 共存**：伴随栏在 dockview 容器**外侧**（`DesktopShell` 栅格第 4 列），不是 dockview 面板；同时只开一个 id，切换动画 `--dur-panel`；`< md` 渲染为 `Sheet side=right w=360`；`< sm` 渲染为底部 `Sheet`。状态存 `store/ui.ts companion: { id \| null, width }`。 |
| `split-button.tsx`（或 `button.tsx` 导出） | 见 button 行：`SplitButton primary`：主段"构建" + caret 段（菜单：构建 PDF / 导出 DOCX / 导出 XML / 递交体检）。**全站只有顶栏使用** |
| `page-header.tsx` `PageHeader` | 非工作台页头：H1 28/36/600 + 摘要 13 `--fg-muted` + 右侧动作区（一个 primary）；p 32 0 16（md 24；sm 16）；移动 H1 24/32 |
| `count.tsx` `Count` / `tag.tsx` `Tag` | 从 badge 拆出（见 badge 行） |

### 2.2 下线 / 拆分总表

| 旧 | 处置 | 新 |
|---|---|---|
| `ui/status-badge.tsx` | 下线（一轮 re-export） | `ui/status-dot.tsx` |
| `dashboard/StatusBadge.tsx` | 下线 | `StatusDot` |
| `dashboard/DueBar.tsx`（全宽到期横幅） | 下线 | 台账行内 `Heat` + 今日摘要条（§3.12） |
| `dashboard/TodayCards.tsx`（4 张 KPI 卡） | 重写为 `TodaySummaryBar`（§3.12） | — |
| `ui/bottom-drawer.tsx` | 并入 `sheet.tsx side=bottom` | — |
| `shell/StatusPill.tsx` | 状态栏改文字 + 点 | `StatusDot`（tone 版） |
| `mobile/MobileStatusStrip.tsx` + `MobileEditorViewTabs.tsx` + `MobileLayoutToolbar.tsx` 三条 | 合并进 `MobileTopBar`（44）+ 视图 `Segmented xl`（44，仅编辑 / 预览时显示，chrome ≤ 144） | — |
| 所有原生 `<select>`（成员角色、日期、排序） | 替换 | `Select` / 日期用 `Popover` + 文本输入（自绘选择器留下一轮） |
| `ViewTabs.tsx`（39/36 不一致） | 删除 | `Tabs`（面板头下划线式） |

---

## 3. 复合组件规格

| # | 复合 | 结构 · 尺寸（像素） | 状态 · 行为 | token / 原语 | 原型 |
|---|---|---|---|---|---|
| 3.1 | **顶栏（工作台）** | h 40 `--bg-app` 下 1px `--border`；左：home 32×32（绿方块 logo r6）→ 菜单 5 项（ghost **32**，13px）；中：案号 mono 11 `--fg-muted` + 案名 14/500 + caret 12 + 保存态 `StatusDot tone=ok "已保存"`（12）；右：在线 `AvatarGroup 24` → 伴随栏入口 4 个 icon 32（审阅 Count · AI · 历史 · 控制台，激活 = `--bg-active`）→ 视图 `Tabs`（源｜PDF / 三视图，仅 ≥ lg）→ **`SplitButton primary md "构建"`（全屏唯一）** → 账户 `Avatar 28` | 标题 hover 显 caret；构建中 primary 内 spinner；`⌘K` 命令面板 | `--bg-app --border --h-md --primary` | `s3-workbench.html` |
| 3.2 | **顶栏（机构页）** | h 40：home → 台账 / 期限（`Count`）/ 通知（`Count` info）ghost 32 → 中：搜索 `Input sm 28` w 320（`⌘K`）→ 右：帮助 / 账户 | 当前页 `--fg-strong` + 底部 2px `--fg-strong` | 同 | `s1` |
| 3.3 | **Rail** | w 40 `--bg-app` 右 1px；tab 32×32 r6 图标 20 `--g8`；激活 `--bg-selected` + 图标 `--link` + 左缘 2×20 `--primary` 条；`Count` 16 右上；顺序：案卷 · 大纲 · 搜索 · 附图 · 术语 ｜底部：体检（`Count` danger 当有 error）· 设置 | tooltip 右侧；键盘 `Alt+1..9` | `--bg-selected --link --primary` | `s3` |
| 3.4 | **文件树** | 侧栏 240 `--bg-app`；头 32：`案卷` 11/500 大写 + 右 ghost 24（新建 / 折叠）；节点 **28**，缩进 12/级，`chevron-right` 12，文件图标 16 `--g8`，文字 13 `--fg`，r4；hover `--bg-hover`；选中 `--bg-selected` `--fg-strong`；行内动作 ghost 24 hover 出现；`role=tree/treeitem aria-expanded`；**隐藏 `studio.json` / `.emf` / `figs/` 内部结构**，附图以缩略行（图标 + 名 + 计数）呈现；分段：正文三书 · 附图 N · 附件 N | 拖放上传高亮 `--bg-selected` 虚线 `--primary` | `--row-h-tree` | `s3` |
| 3.5 | **大纲** | 同侧栏第二段（`Collapsible` 头 28 "大纲"）；节点 28：权 1–N（引用关系括号 11 mono）、说明书段号 `[0002]` mono 11 右对齐；当前段 `--bg-selected`；点击 → `revealView + setFocus` | 跟随光标（`--dur-fast`） | | `s3` |
| 3.6 | **PDF 工具条** | 面板顶 h **32** `--bg-app` 下边线：左 `StatusDot tone=ok sm "PDF 已就绪 · 22 页"`（构建中 tone=info + spinner）→ 中 页码 `Input xs 24 w 40` `/ 22` mono 11 → 缩放 `ghost 24` − 100% + · 适宽 → 右 最大化 24。**浮岛**（选块）：p 4 r8 `--bg-elevated` `--sh-md`，内 `mono 11 "权 1 · L10"` + 分隔 + ghost 24 ×4（定位源码 · 批注 · 编辑 · AI）；定位：纸面内、`clamp(8px, x, 容器宽 − 岛宽 − 8px)`，出现在选区上方 8px，不够则下方；**永不裁切**（ux-05） | | `--bg-elevated --sh-md --r-lg` | `s4` |
| 3.7 | **状态栏** | h 24 `--bg-app` 上 1px；11px `--fg-muted` mono 数字；左：光标 `权 3 · L42` → 摘要字数 `286/300` → 段号连续 ✓；右：体检 `StatusDot tone=danger sm "2 错 3 警"`（点跳控制台）→ 协作 `2 人在线`（ok dot）→ 构建 `StatusDot tone=ok sm "PDF 已就绪 2.3s"`。**无实底按钮、无 primary** | 项 hover `--bg-hover` r3 | | `s3`（右端实底按钮为原型误差，见 §0.3-4） |
| 3.8 | **dockview 面板头** | h 32 `--bg-app` 下边线；`Tabs` 下划线式 13px；右侧 ghost 24（分屏 / 关闭）；激活面板头下划线 `--fg-strong`，非激活 `--fg-muted` | | | `s3 s4` |
| 3.9 | **协作者面板**（伴随栏 `id=collab` 或抽屉 360） | 头 32 "协作者中心" + `Count`；`Tabs`：成员 · 链接 · 访问记录 · 设置；邀请行：`Input md 32` + `Select md` 角色 + `Button secondary md "邀请"`（不是 primary）；成员行 48：`Avatar 32` 在线点 + 名 14 + "正在编辑 权 1" 12 `--fg-muted` + `Select sm 28` 角色右；公开链接卡 r6 边：类型 `Badge` + 到期 `Heat sm` + 复制 / 撤销（danger ghost）；访问记录时间线（§3.16） | 所有者行角色禁用；撤销确认 `Dialog sm` | | `s5-collab-drawer.html` |
| 3.10 | **评论线程** | 卡 r6 `--bg-panel` 边 `--border` p 12；锚点条 mono 11 `--fg-muted`（书 · 权 · 页 · L）；消息：`Avatar 24` + 名 13/500 + 时间 11 `--fg-subtle`；正文 14/22；CriticMarkup 建议卡：`{++ ++}` `--ok-bg` / `{-- --}` `--danger-bg` 删除线；动作 ghost 24：定位 · 回复 · 采纳（仅 CriticMarkup，`soft`）· 已解决；回复 `Textarea sm 28→自增`；当前线程左 2px `--primary`；已解决 `--fg-muted` + 折叠 | | | `s4`（右栏）|
| 3.11 | **Proposal 卡** | r8 `--bg-panel` 边；头 32：`sparkles` 16 `--info-fg` + 场景名 13/500 + 位置 mono 11 + 右 `Badge info "支持 权 3"`；diff 区 mono 13/20 `--bg-sunken` r4：del `--danger-bg` 删除线 / add `--ok-bg`；"为什么" 12 `--fg-muted`；脚 40：左 ghost 24 批注 · 定位 ｜ 右 `Button secondary sm "拒绝"` + `Button soft sm "接受为建议"`（**不是 primary**：接受 = 写 CriticMarkup 建议，面板头常驻一句 12 说明"接受只写入建议，不直接改源码"）；已接受左 2px `--ok-dot`；已拒绝 `--fg-muted` 折叠 | | | `s6-ai-panel.html` |
| 3.12 | **今日摘要条 + KPI**（替代 4 张卡） | h 32 一行 chip（只显示非零）：`Heat sm` 式 pill 高 24：`3 天内 1` (danger) · `7 天内 3` (warn) · `待处理批注 5` (info) · `AI 建议 4` (violet)；点击即筛选；全零 → 一行 13 `--fg-muted` "今日无到期事项"，不占位 | | | `s1` |
| 3.13 | **分组栏（台账左）** | w 240 `--bg-app` 右边线；顶部 `Button primary md "新建案卷"` 全宽（**台账页唯一 primary**）；段：视图（全部 / 我负责 / 收藏 / 待办）→ 按状态（`StatusDot sm` + `Count`，计数 0 折叠进"更多"）→ 客户 → 标签（`Tag`）；项 32 r4 选中 `--bg-selected` | < lg 折叠为顶部 `Select md` | | `s1` |
| 3.14 | **看板卡** | 列 280 `--bg-sunken` r8 p 8；列头 32：`StatusDot md`（点 + 名）+ `Count`；卡 `--bg-panel` r6 `--sh-sm` p 10 12：案号 mono 11 → 标题 13/500 两行截断 → 脚 24：`Heat sm` + `Tag` ×≤2 + `Avatar 20` 右；hover `--sh-md`；空列折叠 40 宽竖条：竖排名 + 0，点击展开 | 拖拽卡 `--sh-lg` 倾斜 0 | | `s2` |
| 3.15 | **期限倒计时** | `Countdown`（§2.1）；台账右栏 / 递交右栏 / 客户页头 / 期限中心列表行 | | | `s1 s7 s9` |
| 3.16 | **时间线（历史 / 访问 / 递交记录）** | 左轴 1px `--border` + 节点 8 `--<tone>-dot`；行 min-h 40：时间 mono 11 `--fg-subtle` w 88 + 事件 13 + 操作者 `Avatar 20`；版本节点可点展开 diff（mono 13/20，add/del 底同 Proposal） | | | `s5` |
| 3.17 | **三视图定位头** | 每视图面板头右侧 mono 11 `--fg-muted`：`权利要求书 · 第 1 页 · 权 1 · L10`；点击 → `revealView('source')`；三视图联动高亮：源码行 `--bg-selected`、版面块 2px `--brand-300` 描边、PDF 块 2px `--brand-300` 描边 + `--brand-100/.4` 填充 | | | `s4` |
| 3.18 | **行内块编辑器** | w 440 r8 `--bg-elevated` `--sh-lg`；头 36 "行内块编辑 · 权 1 · L10" 13/500 + 关闭 24；体 `Textarea mono 14/22 min-h 128`；脚 40：左 12 `--fg-muted` "提交写回 content.md L10 ⌘↵" ｜ 右 `secondary sm 取消` + `soft sm 提交并重建`（不是 primary，顶栏构建才是） | 居中于 PDF 面板 top 96 | | `s4` |
| 3.19 | **移动壳** | 顶栏 **44** `--bg-app` 下边线：返回 / 菜单 44 + 标题 16/600 居中（案名，下 11 案号 mono）+ 右 44（构建 icon 或更多）；底 Tab **56**：5 项 = 案卷 · 编辑 · 预览 · AI · 更多；图标 24 + 11px 标签；选中 `--fg-strong` + 图标 `--link`；安全区 `env(safe-area-inset-bottom)`；编辑 / 预览时顶栏下加视图 `Segmented xl 44`（编辑：三书切换；预览：PDF｜版面）→ chrome 最大 144；**所有可点 ≥ 44** | | | `s10-m-*.html` |
| 3.20 | **Markdown / CriticMarkup 快捷键盘** | 贴输入法上方（`position: sticky bottom` 于键盘弹起容器）h 44 `--bg-app` 上边线，横滑：`#` `**` `{++` `{--` `{~~` `[0001]` `权` `图` `Tab` `↩`；键 44×44 mono 13 r4；长按 `{++` 出说明 tooltip | 输入法收起时隐藏 | | `s10-m-workbench-edit.html` |
| 3.21 | **PDF 长按选块浮条（移动）** | 长按 ≥ 600ms → 顶部 `Sheet` 顶角 r12：定位信息 mono 11 + 3 个 44 项（在源码打开 · 批注 · 编辑）| | | `s10-m-workbench-preview.html` |
| 3.22 | **登录 / 注册卡** | 见 S8 | | | `s8` |
| 3.23 | **客户页头 + 动作条** | 见 S9 | | | `s9` |

---

## 4. 逐页版式 S1–S10

每屏：1440 栅格 / 1280 / 375 / 深色 / 空态·加载·错误态 / 原型与截图 / 解决的审计项。截图目录 `docs/archive/design-system/w6-c-pro-dense/shots/`。

### S1 台账 · 列表（`s1-dashboard-list.html` · `s1--1440-light.png` `s1--1440-dark.png` `s1--375-light.png`）
- 1440：`40 顶栏 | [240 分组栏 | 1fr 主区（max 1280 居中，页边 32）] | 24 状态栏(无，机构页无状态栏)`。主区：`PageHeader` H1 28 "案件台账" + 摘要 13 + 右 `Segmented md 列表|看板` + 显示菜单 ghost 32 → 今日摘要条 32 → 表格工具行 32（搜索 `Input sm` 240 · 分组 · 排序 · 列配置，全 ghost 28）→ `DataTable`：勾选 32 | 案号 mono 120 | 标题 1fr | 状态 `StatusDot` 120 | 期限 `Heat sm` 140 | 责任人 `Avatar 24` 56 | 客户 140 | 更新 100；行 40；分组行 32 可折叠；末行 "+ 新建案卷" 36 ghost。
- 1280：同，页边 24。
- 375：顶栏 44（菜单 / "案卷 42" / 搜索）；`Segmented xl` 列表｜看板；今日摘要横滑 pill 32；筛选 chip 32；分组头 40 sticky；卡片行 ≥ 56：案号 mono 11 + `Heat sm` 右 · 标题 14 两行 · `StatusDot sm` + `Avatar 20`；底 Tab 56；"新建" = 顶栏右 44 icon（无 FAB）。
- 深色：壳 `--bg-app 0.175` / 表 `--bg-panel 0.215`；选中行 `--bg-selected`。
- 空态：`EmptyState` 图标 `folder-open` 32 "还没有案卷" + 原因 + `Button primary "新建案卷"`（此时分组栏 primary 隐藏，保持唯一）；加载：表格 8 行 `Skeleton`；错误：`Alert danger` 行内 + 重试 ghost。
- 解决：#5 #6 #7 #9 #20 #21 #23 #24。

### S2 台账 · 看板（`s2-dashboard-board.html` · `s2--*.png`）
- 1440：同壳；列 280 横向滚动；默认只展开计数 > 0 的列，其余折叠 40；列头 `StatusDot md` + `Count`。
- 375：一列一屏 + 右侧露 24 下一列；列头 sticky；卡按钮区 44。
- 空态：全部为空 → 整块 `EmptyState`。解决：#20。

### S3 工作台默认（`s3-workbench.html` · `s3--*.png`）
- 1440：`40 顶栏 | 40 rail | 240 侧栏 | 1fr 源码 | 7 句柄 | 1fr PDF | [360 伴随栏，默认关] | 24 状态栏`。默认只有 **4 区**（rail · 侧栏 · 源码 · PDF）。源码面板头 32（书 `Tabs` + 定位头）+ CodeMirror 14/1.7 行号 w 40 mono 11 `--fg-subtle`；PDF 面板头 32 + 工具条 32 + 画布 `--paper-canvas` + 纸 `--paper` `--sh-paper` max-w 680。
- 1280：同；伴随栏打开时编辑区 640。1024：伴随栏打开 → 侧栏自动收起。
- 375：见 S10。
- 深色：rail / 顶栏 / 侧栏 / 状态栏 app 0.175；面板 0.215；纸恒白，画布 sunken 0.160。
- 加载：源码 `Skeleton` 8 行；PDF 构建中 工具条 `StatusDot info "构建中…"` + 纸面 `Progress 4`；错误：PDF 面板内 `Alert danger` + "查看控制台" ghost（打开伴随栏 console）。
- 解决：#1 #2 #4 #6 #10 #11 #17 #18。

### S4 三视图 + 选块 + 行内块编辑（`s4-workbench-3view.html` · `s4--*.png`）
- ≥ 1680：`源码 1fr | 版面 1.05fr | PDF 1fr`；1280–1679：三视图为 dockview 分组 Tab 切换（源｜版面｜PDF 中任选两栏），定位头保证跨视图联动；每视图定位头 §3.17；PDF 浮岛 §3.6；块编辑器 §3.18；版面纸恒白 + 左侧段标签 mono 11 `--fg-subtle`。
- 375：三视图不出现；编辑（源码）/ 预览（PDF｜版面 Segmented）。
- 解决：#13 #14。

### S5 协作者中心（`s5-collab-drawer.html` · `s5--*.png`）
- 1440：伴随栏槽 360（`CompanionPanel id=collab`），源码 / PDF 不动；内容 §3.9。1024：侧栏自动收起。375：更多 › 协作者 → 全屏 `Sheet`。
- 空态：成员只有自己 → 邀请行上方 `EmptyState sm`；访问记录空 → 一行 13 `--fg-muted`。
- 解决：#2 #11 #22 #23。

### S6 AI 智能体面板（`s6-ai-panel.html` · `s6--*.png`）
- 1440：`CompanionPanel id=ai` 360；头 32 "AI 助手" + 运行态 `StatusDot tone`（mock / 真模型同形态，只在文字后缀 "· mock" 11）；`Tabs`：建议 `Count` · 对话 · 任务 · 场景；筛选 chip 24；Proposal 卡 §3.11；底 composer：`Textarea sm` 自增 + `Button soft sm` 发送（**面板内无 primary**）；运维信息（模型 / token / 耗时）折叠进 "详情" 11 `--fg-subtle`。
- 375：AI Tab 全屏（减 100 chrome），**只用面板内 `Tabs` 一套**（ux-09：移动壳不再叠 Segmented）；Proposal 卡按钮 44。
- 深色：diff add/del 用暗 `-bg`。
- 空态：无建议 → `EmptyState sm` "选一个场景开始"；运行中：任务卡 `Progress 4` + 取消 ghost；错误：`Alert danger` + 重试；机构禁用 AI：整面板 `EmptyState` + 说明（qa-05）。
- 解决：#2 #19。

### S7 递交（`s7-deliver.html` · `s7--*.png`）
- 1440：顶栏 40（返回工作台 · 案号 + 案名 · `StatusDot`）；主区 max 1120 居中 p 32：`PageHeader` H1 28 "递交" + 版本 `Badge` + 右 **`Button primary lg "生成递交包"`**（唯一）→ 步骤条 32（体检 ✓ · 导出 ● · 清单 · 记录）→ 左 1fr：体检卡（`StatusDot danger "2 错 3 警"` + 列表行 40 可点跳）· 导出卡（DOCX / PDF / XML 三行 48，各 `secondary sm 下载`）· 递交清单卡（checkbox 行 40）；右 360：`Countdown lg` 期限 · 递交记录时间线 · 申请人信息。
- 375：单列卡；导出行 56；底部粘性 64：`primary xl` 全宽（缺项 disabled + 12 说明）。
- 空态：无版本 → `EmptyState` "先构建一次"；加载 `Skeleton` 卡；错误 `Alert`。
- 解决：#5 #16 #6。

### S8 登录 / 注册（`s8-login.html` · `s8--*.png`）
- 1440：`1fr 1fr`：左品牌区 `--bg-app`（logo 32 + 产品名 20/600 + 三条价值点 14/22 `--fg-muted` + 底部 12 版权 + 白纸样张 `--sh-paper`）；右表单区 `--bg-panel` 居中卡 400 p 32 r12 `--sh-md`（≥ md 有卡；< md 无卡）：`Segmented md 登录|注册` → H1 **28/36** "登录" → `Field` 邮箱 / 密码 `Input xl 44 字 16` → 行内错误 12 `--danger-fg` + 图标 → `Button primary xl 44` 全宽 → 13 link "忘记密码"；注册加姓名 + 说明 12 "首个注册账号成为机构超级管理员"。
- 375：品牌区压为 120 高（logo + 一句）；表单全宽 p 24 20；控件 44。
- 深色：品牌区 app / 表单 panel。
- 错误：服务端错误 `Alert danger` 卡顶；加载：按钮 spinner。解决：#12。

### S9 客户免登录审阅页（`s9-client-review.html` · `s9--*.png`）
- 1440：行 `56 头 | 1fr | 64 动作条`，列 `1fr | 360 评论`。头 56 `--bg-panel` 下边线：机构标 24 + 机构名 14/600 + 案名 14 + 元信息 12 `--fg-muted`（`审阅稿 v14 · 代理师 李哲 · lizhe@…`）+ **`Countdown md "请于 09-12 前确认 · 剩 6 天"`** + 右 `Segmented md PDF|版面` + 下载 ghost 32；主区 PDF 工具条 32 + 纸恒白 max 680（水印 11 `--fg-subtle/.5` 对角）；右 360 评论线程 §3.10（正文 **14/22**）；**动作条 64**：左 13 "2 条批注未解决" + 右 `secondary lg "有修改意见"` + `primary lg "确认定稿"`（唯一）。
- 375：评论栏 → 顶栏右 44 icon（`Count`）打开底部 Sheet；动作条 64 保留（按钮 44）。
- 空态：无批注 → 右栏 `EmptyState sm`；链接失效 → 全页 `EmptyState` "链接已失效或过期"；只读链接 → 动作条只留 "下载"。
- 解决：#15 #21。

### S10 移动端（`s10-m-dashboard / -workbench-edit / -preview / -ai / -more / -client.html` · `s10a..f--375-*.png`）
- 统一 §3.19 壳。`dashboard`：见 S1-375。`edit`：顶栏 44 + `Segmented xl` 三书 + CodeMirror 15/24 行号 w 32 mono 11 + 快捷键盘 44（chrome 144，键盘弹起时快捷键盘贴输入法）。`preview`：`Segmented xl PDF|版面` + PDF 工具条 44（页码 / 缩放 44 项）+ 纸 + 长按浮条 §3.21。`ai`：见 S6-375。`more`：底部 `Sheet` ≤ 85dvh r12 抓手，项 48 分组：文件（案卷 · 附图 · 附件）/ 面板（审阅 `Count` · 历史 · 协作者 · 控制台）/ 案卷（体检 · 递交 · 排版）/ 外观（主题 `Segmented xl 亮|暗|系统` · 密度）—— **主题 / 密度只在这里与账户页**（#17）。`client`：见 S9-375。
- 深色：`s10*--375-dark.png`。
- 解决：#3 #8 #13 #17 #22。

### 4.1 审计 Top-25 → 单元 / 页面 / 组件

| # | 问题（02 §Top-25） | 单元 | 页 | 组件 / 规则 |
|---|---|---|---|---|
| 1 | 默认 5 区无焦点 | shell-workbench | S3 | 默认 4 区；伴随栏默认关 |
| 2 | 审阅 / 历史 / AI 顶掉源码 | shell-workbench（容器）+ ai-panel / collab-review-history（内容） | S3 S5 S6 | `CompanionPanel` 360 |
| 3 | 移动 chrome 302 | mobile-shell | S10 | 44 + 56（+44 视图条）≤ 144 |
| 4 | 单一 4px / 无面层 | prep（tokens）+ 全单元 | 全 | 4 层面 + 5 档圆角 + 3 档阴影 |
| 5 | 无 H1 | dashboard / deliver-admin-account / auth-client-public | S1 S7 S8 S9 | `PageHeader` 28/36 |
| 6 | 15 种控件高 | prep（ui）+ 全单元 | 全 | 5 档；lint 现有 `h-[Npx]` 禁令 |
| 7 | 绿 13 义 | prep + 全单元 | 全 | 绿 3 义；`StatusDot` 7 族 |
| 8 | 移动控件 < 44 | mobile-shell（审计全单元） | S10 | `data-density=touch` 自动 xl |
| 9 | KPI 空卡顶开 | dashboard | S1 | 今日摘要条 32 |
| 10 | 3 个构建 + 双 Tab | shell-workbench + editor-threeview | S3 | 顶栏唯一 `SplitButton`；面板头 `Tabs` 一种 |
| 11 | 深色反色 + 原生 select | prep（tokens）+ 各单元替换 select | 全 | 4 层暗色；`Select` |
| 12 | 登录原生校验 | auth-client-public | S8 | `Field` 行内错误 |
| 13 | PDF 浮条裁切 / 移动无 | editor-threeview + mobile-shell | S4 S10 | 浮岛 clamp；长按 Sheet |
| 14 | 块编辑器无阴影 / 定位 | editor-threeview | S4 | §3.18 |
| 15 | 客户页缺机构 / 联系人 / 期限 | auth-client-public | S9 | 头 56 + `Countdown` |
| 16 | 递交标题用目录 id / 无清单 | deliver-admin-account | S7 | H1 "递交" + 案名；清单卡 |
| 17 | 主题 / 密度错位 | mobile-shell + deliver-admin-account（账户页） | S10 more / 账户 | 只在两处 |
| 18 | 作者树暴露内部文件 | shell-workbench | S3 | §3.4 隐藏规则 |
| 19 | AI 多 primary + 运维细节 | ai-panel | S6 | 面板内无 primary；详情折叠 |
| 20 | 10 列全展开 | dashboard | S2 | 空列折叠 40 |
| 21 | 命中区小 | prep（checkbox / 行内动作外扩）+ 全单元 | 全 | 命中 ≥ 32 桌面 / 44 移动 |
| 22 | 对话框 / 日期不适配移动 | prep（`Dialog < md 全屏`）+ collab-review-history（日期） | S5 | §2 dialog；`Popover` 日期 |
| 23 | 原生 select + 硬编码红 | 全单元（各自目录）| 全 | `Select`；`--danger-*` |
| 24 | 通知图标全绿 | dashboard（inbox / notify） | 通知页 | 4 类 `-dot` 图标色 |
| 25 | `#/__ds` 只有 token | prep | `#/__ds` | 组件全态 + 亮暗并排 + 10 态 + 3 热度 |

---

## 5. 单元交接（8 个）

通用禁忌（全单元）：① 不新增 `index.css` 变量、不改 `components/ui`（需要 → `integration_requests`）；② 不写 hex / rgb / oklch / `text-[Npx]` / `w-[Npx]` / 数字 z（`pnpm lint:tokens` 拦）；③ 一屏一个 primary（本单元页面上的 primary 在下表点名，其余按钮 secondary / soft / ghost）；④ 状态只用 `StatusDot`，期限只用 `Heat` / `Countdown`；⑤ 移动断点不手写尺寸，用 `data-density=touch`；⑥ 图标 lucide；⑦ 不改 Markdown 真源 / 内核 / 权限 / AI 路由；⑧ 验收 = `make check` 绿 + 本表截图清单（1440 亮 / 1440 暗 / 375 亮，与对应原型截图并排）。

| 单元 | 页面 → 原型屏 | 必用原语 / token | 本单元 primary | 专属禁忌 | 验收截图清单 |
|---|---|---|---|---|---|
| **shell-workbench** | 工作台壳 S3（`s3`）· 伴随栏容器 S5/S6 槽位 · dockview 面板头 S3/S4 · 状态栏 · 文件树 / 大纲 · 控制台 / 问题面板（伴随栏 `id=console/problems`）· 卡片 / 结构面板头样式 | `CompanionPanel` `SplitButton` `StatusDot(tone)` `Tabs` `Count` `Avatar(Group)` `Tooltip` `Kbd`；`--h-topbar --h-statusbar --w-rail --w-side --w-companion --h-panel-header --bg-app --bg-panel --bg-selected --row-h-tree` | 顶栏 `SplitButton "构建"`（全工作台唯一） | 状态栏无实底按钮；rail 激活不用绿底；面板头不用 Segmented；伴随栏不是 dockview 面板；不动 `store/layout.ts` 预置语义（只改样式） | 1. S3 默认 1440 亮 / 暗 2. 伴随栏开（console）1280 亮 3. 1024 伴随栏开侧栏自动收起 4. 状态栏体检 2 错 特写 5. 文件树隐藏内部文件 6. `#/__ds` 无回归 |
| **dashboard** | S1（`s1`）· S2（`s2`）· 期限中心（`#/deadlines`，版式 = S1 表格变体：列 案号 / 事项 / 期限 `Heat` / 状态 / 责任人）· 通知（`#/inbox`：列表行 48，4 类图标色，未读 `--info-dot`）· 新建案卷对话框（`Dialog md`）· 移动首页 S10a（`s10-m-dashboard`）· 时间线组件 §3.16 | `PageHeader` `Segmented(md/xl)` `DataTable` `StatusDot` `Heat` `Countdown` `Count` `Tag` `EmptyState` `Skeleton`；`--row-h --row-h-compact --w-board-col --bg-sunken` | 台账：分组栏 "新建案卷"；期限中心 / 通知：无 primary | 删除 `TodayCards` / `DueBar` / `StatusBadge`；看板空列必折叠；KPI 全零不占位；通知图标不全绿；`store/deadlines.ts` 分桶不改（热度阈值 = 7 / 30） | 1. S1 1440 亮 / 暗 2. S2 1440 亮（含折叠列） 3. S1 375 4. 期限中心 1440 + 375 5. 通知 1440 6. 空态 S1 7. 今日摘要条全零 / 非零两态 |
| **editor-threeview** | S4（`s4`）· S3 源码 / PDF 面板内容 · PDF 工具条 §3.6 · 浮岛 · 块编辑器 §3.18 · 版面纸面外壳 · 附图册 / 附图 / 附件面板（伴随栏或侧栏段） | `Tabs` `StatusDot(tone)` `Input xs` `Button ghost xs/sm` `Popover` `Textarea` `Progress`；`--h-pdftb --paper --paper-canvas --sh-paper --brand-300 --brand-100 --editor-font-size` | 无（构建在顶栏） | 纸面 / PDF 画布恒白（暗色亦白）；浮岛 `clamp` 不裁切（ux-05）；块编辑器提交按钮 `soft` 非 primary；不改 `pdfIndex/focusSync` 逻辑；源码字号用户可调不锁 | 1. S4 1680 三视图亮 / 暗 2. 1440 双栏 + 浮岛出现（右缘处） 3. 块编辑器打开 4. 定位头特写 5. PDF 构建中 / 错误态 |
| **collab-review-history** | S5（`s5`）· 审阅面板（伴随栏 `id=review`，线程 §3.10）· 版本历史（`id=history`，时间线 + diff）· 分享 / 公开链接卡 · 术语面板（`id=terms`，列表行 32） | `CompanionPanel` `Tabs` `Avatar(Group)` `Select` `Input` `Badge` `Heat` `Count` `Dialog` `Textarea` `Sheet`；`--ok-bg --danger-bg（CriticMarkup）` | 无（邀请 / 采纳 = secondary / soft） | 角色 / 日期不用原生 select；采纳按钮按 `project.role` 禁用（domain-04 若本轮不做，写 `integration_requests`）；已解决线程折叠 | 1. S5 1440 亮 / 暗 2. 审阅面板 + 当前线程 3. 历史 diff 展开 4. 375 协作者 Sheet 5. 公开链接卡 |
| **ai-panel** | S6（`s6`）· 转换 / OA 导入 / 集成设置面板（伴随栏 `id=oa` 与设置 tab，表单 §2） | `CompanionPanel` `Tabs` `Badge` `StatusDot(tone)` `Progress` `Textarea` `Button soft/secondary/ghost` `EmptyState`；`--info-fg --bg-sunken` | 无 | 面板内无 primary；接受 = 写建议不改源码（头部常驻说明）；运维信息折叠；mock / 真模型同形态；375 只留面板内 `Tabs` 一套（ux-09）；机构禁用 → `EmptyState` | 1. S6 1440 亮 / 暗 2. Proposal 三态（待 / 已接受 / 已拒绝） 3. 运行中任务 4. 375 AI 5. 空态 |
| **deliver-admin-account** | S7（`s7`）· 体检结果卡 · 排版设置 / 模板 / 导入（设置页：左 `--w-settings-nav 200` + 右表单 max 640）· 账户页（H1 28 "账户"；主题 / 密度 `Segmented md` 在此）· 机构管理各 tab（成员 / 审计（`DataTable`，375 转卡片 ux-02）/ 策略）· 通用页面容器 `components/pages` | `PageHeader` `Tabs` `DataTable` `Countdown` `StatusDot` `Badge` `Checkbox` `Select` `Switch` `Alert` `Progress`；`--max-page --w-form` | 递交页 "生成递交包"；账户 / 机构 / 设置页 "保存"（每 tab 一个） | 递交标题不用目录 id；导出三行不做 primary；审计表 375 不横向溢出；日期 / 角色不用原生 select | 1. S7 1440 亮 / 暗 2. S7 375 底部粘性 3. 账户页 1440 4. 机构审计 375 卡片 5. 设置页 1440 |
| **auth-client-public** | S8（`s8`）· S9（`s9`）· S10f 客户 375（`s10-m-client`）· 分享页（`#/share/…` = S9 无评论栏变体） | `Segmented md` `Field` `Input xl(16px)` `Button primary xl/lg` `Countdown md` `StatusDot` `Sheet` `EmptyState` `Alert`；`--bg-app（品牌区） --bg-panel --sh-md --r-xl --w-form` | 登录 "登录 / 注册"；客户页 "确认定稿" | 登录不用浏览器原生气泡；客户页正文 14–15 不小于 14；水印用 `--fg-subtle/.5` 不硬编码；只读链接无动作 primary；375 品牌区压缩不隐藏 logo | 1. S8 1440 亮 / 暗 2. S8 375 + 行内错误 3. S9 1440 亮 / 暗 4. S9 375 + 评论 Sheet 5. 链接失效空态 |
| **mobile-shell** | S10b–e（`s10-m-workbench-edit/preview/ai/more`）· 壳 §3.19 · 快捷键盘 §3.20 · 长按浮条 §3.21 · 全单元 375 审计（产出 `integration_requests`） | `Segmented xl` `Sheet` `Tabs` `Button xl` `Count` `Kbd`；`--h-m-topbar --h-m-tabbar --h-touch`；注入 `data-density=touch` | 顶栏右 44 "构建" icon（编辑 / 预览时） | chrome ≤ 144；全部控件 ≥ 44（用 `probes.json` 探针实测）；删除三条旧工具条（§2.2）；主题 / 密度只在 more Sheet；不叠第二套 Tab | 1. S10b 375 亮 / 暗 + 键盘弹起快捷键盘 2. S10c 预览 + 长按 Sheet 3. S10d AI 4. S10e more Sheet 5. `probes.json` 44 全绿输出 6. 其他单元 375 审计表 |

### 5.1 shared_files（prep 独占，单元不得改；需要 → `integration_requests`）

```
frontend/src/index.css
frontend/src/components/ui/**            （含新原语 status-dot / heat / countdown / companion-panel / page-header / tag / count）
frontend/src/lib/hash.ts
frontend/src/lib/utils.ts
frontend/src/store/ui.ts                 （companion 状态 / density）
frontend/src/store/layout.ts · frontend/src/layout/presets.ts
frontend/src/types/case.ts               （CaseStatus / STATUS_LABEL / TAG_COLORS）
frontend/src/App.tsx
frontend/src/components/ds/DesignSystemPage.tsx
frontend/src/components/shell/DesktopShell.tsx  （栅格：rail | side | dockview | companion；shell 单元只改其内子组件样式，栅格列由 prep 定）
frontend/scripts/lint-tokens.mjs
frontend/src/test/** 共享测试工具
docs/design-system/05-w6-spec.md
docs/archive/design-system/w6-audit/** · w6-review/** · w6-spec/**
```

### 5.2 prep 交付物（单元开工前）

1. `index.css`：§1 全部 token（亮 / 暗），旧名别名一轮；`@theme inline` 映射；`[data-density=touch]` 升档规则。
2. `components/ui`：§2 全部 diff + 新原语；`status-badge` / `bottom-drawer` re-export 过渡。
3. `#/__ds`：token 面 + 全原语全态 + 10 态 `StatusDot` + 3 档 `Heat` + `Countdown` + `CompanionPanel` demo，**亮暗并排**（解 #25）；作为各单元的视觉基准页。
4. `DesktopShell` 栅格四列 + `store/ui.ts companion`；`MobileShell` 注入 `data-density=touch`。
5. `make check` 绿；`pnpm lint:tokens` 0。

---

## 6. 借入清单（≤ 12 条，C 为主壳）

| # | 来自 X：什么 → 放到哪 | 证据 |
|---|---|---|
| 1 | 来自 A（Overleaf 血缘）：左 rail 40 + 文件树 / 大纲 240 + 源码｜PDF 双栏 + 右上唯一绿色"构建" split-button → 工作台壳 S3（§3.1 §3.3 §3.4） | A §4 顶栏 / Rail（Overleaf `rail.scss` `[源码]`）；老板"主要参考 Overleaf"；04 §1 A 血缘评分最高 |
| 2 | 来自 A：右侧 360 伴随栏承载 AI / 审阅 / 历史 / 控制台，不顶掉源码 → `CompanionPanel`（§2.1）+ S5 / S6 | A S6 `rail 40 │ 240 │ 1fr │ 1fr │ 伴随 360`；audit #2；04 §2.2 |
| 3 | 来自 A：5 档随尺寸圆角 4 / 6 / 8 / 12 / pill（C 原 3 档）→ §1.7 圆角（我们含 3 共 5 档 + pill） | A §2.5（Overleaf `border-radius.scss` `[源码]`；Notion 28/40/48→6/8/12 `[实测]`）；04 §3 |
| 4 | 来自 A：PDF 浮岛 `right ≥ 8` 不裁切 + 行内块编辑器 440 r8 sh-lg 带定位头 → §3.6 §3.18 | A §4 PDF 工具条 / 行内块编辑器；audit #13 #14 |
| 5 | 来自 B：字阶 H1 28/36（页级）与 24/32（紧凑）、正文 14/22、说明 13/20 → §1.6 | B §2.3（飞书 UD 14/22 `[实测]`）；04 §2.1-4 |
| 6 | 来自 B：登录页两栏品牌区 + 行内错误 + 16px 输入（xl 44）→ S8 / `Field` / `Input xl` | B S8；audit #12 |
| 7 | 来自 B：客户审阅页机构 / 联系人 / 期限头 56 + 底部动作条 64 + 正文 14/22 → S9 | B S9；audit #15 |
| 8 | 来自 B：期限倒计时 3 档（常规 / 临近 / 紧急）→ `Heat`（阈值改 30 / 7 对齐 `store/deadlines.ts`）| B §4.10；老板总表"3 档" |
| 9 | 来自 B：表格表头无底色只留下边线、列间无竖线、末行"+ 新建"→ `Table` / S1 | B §3.13；04 §2.1-4"hairline 偏冷" |
| 10 | 来自 Fluent 2 / Linear（经 C 引证）：控件默认 32、按钮 500 字重、菜单项 32、命令面板项 32 → §1.7 / §2 | C §1 证据表（Fluent Button `[官方]`、Linear 导航 32 `[实测]`）；benchmark L3 |
| 11 | 来自 VS Code Dark Modern（经 C）：四层深色"壳暗于编辑器"+ 暗色浮层加 1px 环 → §1.2 暗列 | C §1（`dark_modern.json` `[源码]`） |
| 12 | 来自 Notion / iOS（经 B）：底部 Sheet ≤ 85vh r12 抓手 36×4 项 48 → `Sheet side=bottom` / S10 more | B S10；C S10 |

**不借**：B 的暖灰基色（hue 偏黄）— 保持 C 冷灰 255；A 的 10px 行号 / 角标档 — 最小 11；任何方向的双 primary（A 顶栏 + 状态栏、C 原型状态栏"构建"）— 一屏一个。

---

## 7. 验证（实事求是）

### 7.1 已验证 `[实测]`
- 对比度：§1 全部数值由 `docs/design-system/w6-spec/contrast.py` 计算（OKLCH → 线性 sRGB → WCAG 相对亮度）；所有文字对 ≥ 4.5（最低 `--fg-subtle` on g2 4.03，因此该组合被禁用）；色点 on 白 ≥ 3.93、on 暗 panel ≥ 3.82（色点恒伴文字）。
- 真实 `#/__ds`（`pnpm dev` :5173，Playwright + Chromium 1440×900，亮 / 暗）与原型 `components.html` 并排截图：`docs/design-system/w6-spec/ds-vs-proto--light.png`、`ds-vs-proto--dark.png`；探针 `probe.json` 读出原型根 token（`--g0..g11`、四层面、`--w-side 240`、`--w-agent 360`、`--h-md 32`、`--r-xl 12`）与本文 §1 同值；真实页 `--w-side 208` / `--w-agent 320` / `--h-segmented 36` / `--n0..n9` 单层暗色 = 现状差距。差异表见 `w6-spec/README.md`。
- 原型 `components.html` 页内确实存在 9px / 10px 字号与 40px 按钮（探针），证实 §0.3-2 / §0.3-8 的修正必要。

### 7.2 未验证 `[推断]`
- 热度阈值 30 / 7 是否符合代理实务；`granted` 与 `final` 同族靠图标区分在色弱用户上的可读性（有文字兜底）；1024 断点"伴随栏开 → 侧栏自动收起"的交互手感；暗色 PDF.js 画布观感；`CompanionPanel` 与 dockview 拖拽区域是否互相抢手势。
- 本分支只有 docs，未运行 `make check` / `make zero-drift` / `make roundtrip`（不改代码，无需门禁；prep 分支必跑）。
- 各单元 375 控件 ≥ 44 需用 `w6-review/probes.json` 探针在实现后实测，本文未测。

### 7.3 `#/__ds` 现状 vs 原型（并排所见）

`w6-spec/README.md` 差异表：现状页只有 token 色块 + 字阶 + 尺寸条 + Button 变体，无输入 / 开关 / 勾选态、无亮暗并排、`StatusBadge` 仍有只点无字变体；原型 `components.html` 亮暗并排、10 态点 + 文字、输入错误态、开关 / 勾选齐全。prep 按 §5.2-3 补齐后 `#/__ds` 成为各单元视觉基准页。

## 7.4 实现落点（`devin/wave6-integrated`，2026-09-06）

本节把 §1–§6 的规格逐条对到集成分支上的真实文件；`[实测]` = 本分支已跑门禁 / 探针，`[推断]` 见 `docs/handoff-context.md` §7c 已知问题。

| 规格 | 落点 | 状态 |
|---|---|---|
| §1 token 真源（g0..g11、四层面、`--h-sm/md/lg/touch`、`--r-*`、`--st-*` 十档、`--w-side/--w-agent`） | `frontend/src/index.css` §1（`:root` 亮 / `.dark` 暗各一套）+ `@theme` 只做变量→工具类映射 | `[实测]` `pnpm lint:tokens` 0 违规 / 458 文件；`check-contrast.test.ts` 亮暗全部配对 ≥ 4.5 |
| §1 旧名删除 | `--n0..n9`、`--green-*`、`--h-control*`、`--h-segmented`、`--touch-target`、`--status-*`（含 `--color-status-*`）及 `h-control*` / `bg-n*` 工具类已全部删除并迁移到新名 | `[实测]` `rg` 零引用；shadcn 语义名（`--background/--foreground/--muted/--accent/--destructive/--popover/--card/--input` …）仍被 ~300 处引用，作为语义层保留并指向四层面（见 index.css 注释） |
| §2 原语 | `frontend/src/components/ui/*` 43 件（button / input / textarea / select / checkbox / switch / radio-group / segmented / toggle(-group) / tabs / dialog / sheet / bottom-drawer / popover / dropdown / command / tooltip / toast / badge / tag / status-badge / status-dot / count / countdown / heat / progress / skeleton / empty-state / alert / avatar / breadcrumb / page-header / field / label / kbd / separator / scroll-area / collapsible / table / data-table / chart(-recharts) / companion-panel / misc） | `[实测]` 全带 `data-slot`；`Switch` / `Checkbox` 视觉尺寸不变、`in-data-[density=touch]` 伪元素扩到 ≥ 44；`Segmented xl` = `h-touch` |
| §3 主壳 / 伴随栏 | `components/shell/*` + `CompanionHost`；`registerCompanionBody(id, body)`；`#/p/<pid>?panel=<CompanionId>`；AI 只存在于伴随栏（dockview `PANEL_KINDS` / `RAIL_KINDS` 无 `ai`，`ai-assist` 预设 id 保留仅右组 terms / OA / review） | `[实测]` `layout.test.ts` / `dockviewHost.test.tsx` / `routing-topbar.test.tsx` |
| §4 页面（台账 / 工作台 / 三视图 / AI / 协作 / 递交 / 客户 / 移动） | `components/dashboard/*`、`components/editor/*`、`components/ai/AiPanel.tsx`、`components/collab/*`、`components/deliver/*`、`components/client/*`、`components/mobile/*`（`MobileTabs` + action-sheet，`MobileAiTab` 只包一层 `AiPanel`） | `[实测]` 七屏 W5 vs W6 并排：`w6-final/strip-1440-light.png` / `strip-1440-dark.png` / `strip-375.png` |
| §0.3 375 控件 ≥ 44 | 移动台账 / 移动编辑 `<44px` 控件 22 / 19 → 2 / 0（`w6-final/census.json` `probes`） | `[实测]` 残余 2 个为 PDF 透明文本层非控件，见 `compare.md` |
| 普查 | `docs/archive/design-system/w6-final/census.json` + `compare.md`（W5 基线 `w6-audit/census.json`） | `[实测]` 按钮高度档 15→14（桌）/ 14→9（移）；圆角 5→7；最小字号 11 保持；`<h1>` 全页有 |

## 8. 变更记录
- 2026-09-06 v1 冻结（`devin/w6-spec`）。
- 2026-09-06 v1.1 增 §7.4 实现落点（`devin/wave6-integrated`）。
