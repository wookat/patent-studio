# W6 视觉方向 A · Overleaf 进化版（`a-overleaf-plus`）

> 角色：资深 UI 设计师（company-os `roles/design/ui-designer.md`）· 分支 `devin/w6-visual-a-overleaf-plus`（基于 `devin/wave5-integrated` a4c700b）· 只做设计探索：**未改任何产品代码，未开 PR**。
> 输入：`00-benchmark.md`（C1–C30 / L1–L20，直接沿用不重做）、`02-w6-page-audit.md`（Top-25）、`01-stack-and-tokens.md`、`docs/plan/21-w5-spec.md` §3/§4、`docs/ux/07-overleaf-console-variant.md`。
> 产出：本文 + 静态原型 `prototype-w6-a-overleaf-plus/`（`index.html` 总览，右下角可切深浅色 / 375 取景）+ 35 张 Chrome 真实截图（§6）+ 一手证据 `w6-a-evidence/`。
> 证据分级：**[源码]** Overleaf 开源仓库（commit `28ad3b03b`，路径见 §7）· **[实测]** 我亲自截图 / `getComputedStyle` 读数 · **[官方]** 官方文档链接 · **[推断]** 未直接验证。

---

## 1. 设计主张（一页）

### 1.1 一句话

**"Overleaf 的骨架、飞书的呼吸、Notion 的节律，装进专利代理机构的密度。"**
壳（chrome）退后一步——浅、薄、少；内容（源码 / 纸面 / 表格）站前一步——白纸浮在灰画布上、每屏一个绿色主动作、每个数字都对得齐。

### 1.2 五条支柱（每条对应波次 5 被批评的现实）

| # | 支柱 | 具体做法 | 修正的 audit 问题 |
|---|---|---|---|
| P1 | **四层明度阶梯，替代"一层灰"** | 画布 `#f4f5f6` → 面板 `#fff` → 下沉面 `#e7e9ee` → PDF 画布 `#dfe3e9`；纸面恒白 + 双层阴影浮起。深色同样四层（n9 / n8 / #263140 / #141a22），不再是"反色单层" | #4 #11 |
| P2 | **一个主体、一个 primary** | 工作台默认 = 源码 \| PDF 50/50，可编辑区 ≥ 640px@1440；AI / 审阅 / 历史是**右侧伴随栏 360**，不顶掉源码；构建按钮**只在顶栏一处**（split-button） | #1 #2 #10 #19 |
| P3 | **圆角与字号随尺寸** | 28 控件 4px · 32–36 控件 6px · 卡片 8px · 对话框 / Sheet 12px · 状态徽章 pill；新增 24/28 页级标题，每个非工作台页面有且只有一个 H1 | #4 #5 #6 |
| P4 | **颜色分工** | 绿只做"主动作 + 当前激活"两义；链接用蓝 `#366cbf`；在线/未读用蓝 `--info`；成功用 `green-60`；10 档案件状态各有独立 hue（230/250/300/75/195/270/50/155/25/0） | #7 #23 #24 |
| P5 | **移动是同一套 token 的另一种排布** | 顶栏 44 + 底部 Tab 56 = chrome 100px（12%），内容 ≥ 87%；所有触控 ≥ 44；对话框 < 768 转全屏；Sheet 项高 48 | #3 #8 #22 |

### 1.3 顶栏：浅色化（论证）

**决定：浅色主题下顶栏为白 `#fff` + 1px 边；深色主题下顶栏为 `n9`。**（这是设计决定，不是对生产产品的断言。）

证据：
1. **[源码]** Overleaf 新版编辑器（ide-redesign）本身就是"跟随主题"：`toolbar-redesign.scss` `:root { --redesign-toolbar-background: var(--bg-dark-primary) }` 且 `@include theme('light') { --redesign-toolbar-background: var(--bg-light-primary) }`；`toolbar.scss` 同理 `--editor-toolbar-bg: var(--white)`（light）。即 Overleaf 自己在浅色主题下顶栏就是浅的——"深色顶栏"只是其默认深色主题给人的印象。
2. **[实测]** Overleaf 官方文档《Redesigned Overleaf editor》配图（`w6-a-evidence/ext-overleaf-docs-editor-img0.png`，[附件](https://app.devin.ai/attachments/42fcc076-d2d7-4f87-86ff-485e9af145b4/ext-overleaf-docs-editor-img0.png)）与 2025-11-19 博客《Introducing Overleaf's new look》首图（[附件](https://app.devin.ai/attachments/b83ea0a9-c4e7-4679-8db0-42c249873dc2/ext-overleaf-new-look-blog-1440.png)）展示的都是**白色顶栏 + 浅 rail**。
3. **[实测]** 飞书开放平台官方页 body `rgba(0,0,0,.85)` on `#fff`、主按钮 32 高 6px 圆角（`w6-a-evidence/ext-feishu-universe-button.json`）：内容优先、轻 chrome。
4. **[推断]** 专利代理师一天 6–8 小时看白纸黑字；深顶栏 + 白纸的明度跳变（n9→白 ≈ 16:1）会让视线反复重新适应；浅顶栏把最强对比留给"纸面 vs 画布"，符合 P1。
5. 品牌识别不靠深色条：保留 Overleaf 式 **32×32 绿色 home 方块**（`toolbar-redesign.scss` `$home-button-size: 32px`）作为唯一恒定品牌锚点。

牺牲：浅顶栏在多窗口并排时少了"应用边界感"——用 1px `--border` + 顶栏内 28px 菜单按钮的悬停面补偿；深色主题用户不受影响。

### 1.4 与波次 5 肉眼可辨的差异（截图对照见 §6）

| 观察点 | W5（audit 截图） | 方向 A |
|---|---|---|
| 台账首屏 | 4 KPI（3 个 0）+ 全宽横幅，表格 y=190 | 24px H1「全部案卷」+ 只显示非零的「我的今天」3 格，表格 y≈150；右侧期限 / 动态栏 |
| 工作台默认 | 5 区并列，可编辑 480px | 3 区（rail 40 + 案卷/大纲 240 + 源码\|PDF），源码 ≥ 640px；纸面浮起 |
| AI 面板 | 顶掉源码 Tab；3 个 primary；供应商信息常驻 | 右侧伴随 360；每张 Proposal 一个绿「接受」；供应商信息 1 行灰字置底 |
| 圆角 | 96% 4px | 4 / 6 / 8 / 12 / pill 五档按尺寸 |
| 深色 | 单层 n9 | 顶栏 n9 · 侧栏 n9 · 面板 n8 · 下沉 #263140 · 纸面白 |
| 登录 | 原生英文气泡、无品牌区 | 左品牌区（深色 + 白纸样张）+ 右 400px 表单卡、中文行内错误、44px 主按钮 |
| 客户审阅 | 无机构 / 联系人 / 截止 | 顶栏机构 + 案名 + 版本；右栏代理师 / 截止倒计时 / 进度；底部「确认定稿」动作条 |

---

## 2. Token 决定表

格式：**值 · 与 W5 现状差异 · 来源**。W5 现状取自 `frontend/src/index.css`（OKLCH），差异按等值 hex 比较。原型权威文件：`prototype-w6-a-overleaf-plus/tokens.css`。

### 2.1 灰阶（10 阶，蓝灰调）

| token | 值 | W5 | 差异 | 来源 |
|---|---|---|---|---|
| `--n0` | `#ffffff` | `oklch(1 0 0)` | 同 | — |
| `--n1` | `#f4f5f6` | ≈`#f6f6f7` | 同阶，改用 OL 精确值 | [源码] `foundations/colors.scss` `$neutral-10` |
| `--n2` | `#e7e9ee` | ≈`#e8e9ee` | 同 | [源码] `$neutral-20` |
| `--n3` | `#d0d5dd` | ≈`#d0d4dc` | 同 | [源码] `$neutral-30` |
| `--n4` | `#afb5c0` | ≈`#afb4bf` | 同 | [源码] `$neutral-40` |
| `--n5` | `#8d96a5` | ≈`#8d95a4` | 同 | [源码] `$neutral-50` |
| `--n6` | **`#616c7d`** | ≈`#677283` | **深一档**：OL 原值在 n1 画布上 4.46:1 不达标；新值 白 5.32 / n1 4.87 / n2 4.38（n2 上不放正文） | 计算（§8） |
| `--n7` | `#495365` | ≈`#495365` | 同 | [源码] `$neutral-70` |
| `--n8` | `#2f3a4c` | ≈`#2f3a4c` | 同 | [源码] `$neutral-80` |
| `--n9` | `#1b222c` | ≈`#1b222c` | 同 | [源码] `$neutral-90` |

> 灰阶数值本身与 W5 几乎等值——**W5 的问题不在灰阶，而在"只用了两层"**（audit #4：面与面明度差 ≤ 0.066）。方向 A 的差异在 §2.3 面层分配。

### 2.2 品牌绿与功能色

| token | 值 | W5 | 差异 | 来源 |
|---|---|---|---|---|
| `--green-10/20/30/40/50/60/70` | `#eaf6ef #b8dbc8 #86caa5 #53b57f #098842 #1e6b41 #195936` | 只有 50/600/700/800 四档 | 补齐 7 阶，深色主题主色改用 `green-40` | [源码] `$green-*` |
| `--primary`（浅） | `#098842`，白字 4.55:1 | 同 | 同值，但**语义收窄**：只用于主按钮 + 激活指示（rail 3px 条、Tab 下划线） | [源码] `$green-50`；audit #7 |
| `--primary`（深） | `#53b57f`，`n9` 字 6.31:1 | `green-600` 白字 | 改：深色主色提亮一阶、字改深 | 计算 |
| `--link` | `#366cbf`（5.18:1） | 绿 | **链接从绿里拆出** | [源码] `$link-ui: $blue-50` |
| `--info` | `#366cbf` | 绿点 | 在线点 / 未读计数 / 评论级链接用蓝 | audit #7 #24 |
| `--success` | `#1e6b41` | `green-600` | 与 primary 区分（体检通过、已解决） | [源码] `$green-60` |
| `--warning` / `--warning-text` | `#de8014` / `#8f5514`（on `#fcf1e3` 5.42:1） | `amber` | 警告文字专用深档 | [源码] `$yellow-40/50` |
| `--danger` | `#b83a33`（5.69:1） | `red-500` 硬编码头像 | 头像不再用 danger 色 | [源码] `$red-50`；audit #23 |
| 案件状态 10 档 | hue 230/250/300/75/195/270/50/155/25/0，fg/bg 对比 5.4–6.8:1 | 同 hue 体系 | 保留 W5 的 hue 分配（是对的），去掉"绿多义" | W5 spec §3.2；计算 |

### 2.3 面层（解决"没有区块感"）

| token | 浅 | 深 | W5 | 来源 |
|---|---|---|---|---|
| `--canvas` | `#f4f5f6` | `#1b222c` | 浅 `--background: n0`（页面与面板同白） | [源码] `ide-redesign.scss` `--ide-redesign-background: var(--bg-light-primary)` |
| `--surface` | `#ffffff` | `#2f3a4c` | 深 = n9 与画布同 | [源码] `--bg-dark-secondary` |
| `--surface-sunken` | `#e7e9ee` | `#263140` | 无 | Notion 段控件轨道 [实测 §7] |
| `--pdf-canvas` | `#dfe3e9` | `#141a22` | `--paper: n1` 与画布几乎同明度 | [推断] 让白纸从画布浮起 |
| `--paper` / `--paper-fg` | `#fff` / `#000` **两主题不变** | 同 | W5 已恒白 | 硬约束 |
| `--topbar` | `#fff` | `#1b222c` | 深 n9 常驻 | §1.3 |
| `--rail` | `#f4f5f6` | `#1b222c` | — | [源码] `rail.scss` |
| `--popover` | `#fff` | `#364357` | 深与面板同色 | [源码] `--bg-dark-tertiary` |

### 2.4 字体与字阶

| token | 值 | W5 | 差异 | 来源 |
|---|---|---|---|---|
| `--font-ui` | `-apple-system, "PingFang SC", "Noto Sans SC", … system-ui` | 同 | 同（Overleaf 用 Lato/Noto Sans，中文场景以系统栈为优） | [实测] OL 页 `"Noto Sans", system-ui`（`ext-overleaf-docs-redesigned-editor.json`） |
| `--font-code` | `"JetBrains Mono", "Sarasa Mono SC", ui-monospace` | 同 | 同 | W5 |
| `--font-paper` | `"Times New Roman", SimSun, "Songti SC", serif` | 版面由 patent_docx 决定 | 原型示意用，**不约束内核** | 硬约束 |
| 字阶 | 11/12/13/14/16/20/24/**28** | 11–24 七档 | +28 页级标题；**要求每个非工作台页有 24px H1**（W5 定义了 20/24 但无页面使用） | audit #5；Notion 标题 [实测] |
| 行高 | 16/16/20/22/24/28/32/36 | 13→18、14→20 | 13→**20**、14→**22**（中文行高 ≥ 1.5） | 飞书正文 14/22 [官方] |
| 编辑器 | 13px / 1.7 | 13 / 1.6 | 行高 +0.1（中文源码） | [推断] |
| 数字 | `tabular-nums` 用于案号 / 日期 / 计数 / 页码 | 部分 | 全量 | C10 |

### 2.5 间距 · 圆角 · 边框 · 阴影

| 类别 | 值 | W5 | 差异 | 来源 |
|---|---|---|---|---|
| 间距 | 4 基数：4/8/12/16/20/24/32/40/48/64 | Tailwind 默认 | 同；页面内边距 1440 → 32，375 → 12–16 | [源码] `--spacing-01…11` |
| 圆角 | **4 / 6 / 8 / 12 / pill**：≤28 控件 4 · 32–40 控件 6 · 卡片/菜单/浮岛/Proposal 8 · 对话框/Sheet/空态图标 12 · 状态徽章 pill | 4/6/8 定义了但 96% 用 4 | 补 12；**强制随尺寸** | C2；[源码] `border-radius.scss`（4/8/16/pill）；Notion 28/40/48→6/8/12 [实测] |
| 边框 | `--border #e7e9ee` · `--border-strong #d0d5dd`（输入框 / secondary 按钮） · 深 `#3d4859 / #4d5a6e` | 一档 | 两档 | [源码] `--border-divider` / `--border-primary` |
| 阴影 | `sh-1: 0 2px 4px rgba(30,37,48,.16)` 浮岛 · `sh-2: 0 4px 12px .12 + 0 2px 4px .08` 菜单/卡片悬停 · `sh-3: 0 8px 16px .12 + 0 4px 6px .12` 对话框/抽屉/块编辑器 · `sh-paper` 双层 | 定义了但几乎不用 | **实际用上**：浮岛 sh-1、卡片 hover sh-2、抽屉/Dialog/块编辑器 sh-3 | [源码] `elevation.scss`；`editor-floating-menu.scss` `0 2px 4px 0 #1e253029` |
| 焦点 | 1px `--ring` + 3px `--focus-halo`（绿 28%） | ring 2px | 改为柔和光晕 | C7 |

### 2.6 尺寸阶与动效

| token | 值 | W5 | 来源 |
|---|---|---|---|
| 顶栏 / rail / rail tab / rail 图标 / 激活条 | 40 / 40 / 32×32 / 20 / 3×24 | 40 / 40 / — | [源码] `toolbar-redesign.scss` `$toolbar-height: 40px`；`rail.scss` |
| 侧栏 / 伴随栏 / 抽屉 / 台账分组栏 | 240 / **360** / 360 / 220 | 208 / 320 / 320 / 220 | L4；伴随栏 320→360：Proposal 卡 4 个动作 + diff 在 320 内换行（实测原型） |
| 控件高 | xs 24 · sm 28 · md 32 · lg 36 · xl 40 · 触控 44 | 15 档实测 | C1 |
| 行高 | 表格 40 / 紧凑 36 / 移动 52 · 树 28 · 菜单 32 · Sheet 项 48 | 40/36/44 | C11 C21 C29 |
| PDF 工具条 / 状态栏 | 36 / 24 | 32 / 24 | [推断] 36 容纳 28 按钮 + 4 内边 |
| 移动 | 顶栏 44 · Tab 56 · 主按钮 44 | 同 | L2 L15 |
| 动效 | 色 150ms · 面板显隐 200ms（透明度 + 8px 位移，不做宽度动画）· `prefers-reduced-motion` → 0ms + 骨架停止 | 同 | C28；[源码] rail 无 transition |

---

## 3. 组件规格卡

所有卡片的实现见 `proto.css`（类名同下）；"态"= 原型中已呈现的状态。尺寸单位 px。

| 组件 | 尺寸 / 间距 | 圆角 / 字 | 态 | 规则 |
|---|---|---|---|---|
| **按钮 sm** `.btn-sm` | h 28 · px 10 · gap 6 · 图标 16 | 4 · 12/500 | default / hover / active / disabled(.5) | C1 C2 |
| **按钮 md** `.btn` | h 32 · px 12 | 6 · 13/500 | 同上 + focus-visible 光晕 | C1 C2 C7 |
| **按钮 lg** `.btn-lg` | h 36 · px 14 | 6 · 14/500 | 页级主动作（递交 / 确认定稿） | C1 C4 |
| **按钮 xl** `.btn-xl` | h 40（移动 44 由容器撑）· px 16 | 8 · 14/500 | 登录 / 移动底部动作 | C6 |
| 变体 | primary 绿白 · secondary 白 + strong 边 · ghost 透明 · danger 红 · link 蓝 · icon 方形 · **split**（构建 ▾） | — | 一屏一个 primary | C3 |
| **输入框** `.input` | h 32（表单 36 `.input-lg`，登录 40 `.input-xl`）· px 10 · 前置图标 16 灰 | 6 / 8 · 13–14 | focus 光晕 · invalid 红边 + 12px 红字 + 图标 | C9 |
| **选择** `.select` | 与输入同高 · 右 caret 14 | 6 | 打开态复用菜单 | C11 |
| **开关** `.switch` | 36×20 · 拇指 16 · 位移 16 | pill | on 绿 / off n4 · `role=switch aria-checked` | — |
| **复选** `.check` | 命中 28（移动 44）· 框 18 | 4 | on 绿 | C6；audit #21 |
| **徽章** `.badge` | h 20 · px 7 · 计数 18 | pill · 11/600 | 中性 / 计数蓝 / 点 8 | C18 C19 |
| **状态徽章** `.status` | h 22 · px 7/8 · 前置 7px 点 | pill · 12/500 | 10 档语义色 · `.is-select` 带 caret 可点（命中 ≥ 28） | C18 |
| **标签** `.tag` | h 22 · px 8 · 图标 12 | 4 · 12 | 中性阶 | C19 |
| **期限** `.due` | h 22 · px 8 · 图标 12 · `tabular-nums` | 4 · 12/500 | ok 灰 / soon 琥珀底 / urgent 红底 / done 删除线 | C10 |
| **头像** `.avatar` | 24 / 32 / 40 · 在线点 9 + 2 白边 · 组重叠 6 | 圆 · 11/13/15 600 | 4 色（蓝/紫/棕/绿，均非 danger） | C20；audit #23 |
| **菜单** `.menu` | min-w 200 · p 4 · 项 h 32 px 10 · 分隔 1 · 标签 11/600 | 8 / 项 4 · 13 | hover 下沉面 · kbd 右对齐 · 危险项红置底 | C11 C12 |
| **Tooltip** `.tooltip` | h 24 · px 8 | 4 · 12 | 深底白字，仅文字 | C17 |
| **对话框** `.dialog` | w 400/560/800 · 头 20 24 0 · 体 16 24 24 · 脚右对齐 gap 8 | 12 · 标题 16/600 | < 768 转全屏（`border-radius: 0; 100vw×100vh`） | C13 C14 |
| **抽屉** `.drawer` | w 360 · 头 h 52 px 20 | 0 · 标题 16/600 | 右侧伴随，sh-3 | C15 L10 |
| **Toast** `.toast` | min-h 44 · px 14/12 · 图标 16 | 8 · 13 | 深底白字 + 一个 link 动作；success/info/warning/error 图标色 | C16 |
| **表格行** `.tbl` | h 40 · 单元 px 12 · 表头 12/500 灰 · sticky 表头 | 0 | hover 画布色 · 选中行绿 soft | C21 |
| **树节点** `.tree-node` | h 28 · px 6 · 图标 14 · 计数右对齐 11 | 4 · 13 | hover / active 绿 soft + 500 | C29 |
| **空态** `.empty` | 图标容器 44（圆角 12）· 标题 14/600 · 一句原因 · 一个 primary | 12 | — | C23 |
| **骨架** `.skel` | 与最终形状同 · 1.2s 横向渐变 · reduced-motion 停止 | 4 | — | C24 |
| **段控件** `.seg` | 轨道 h 32 p 2 · 项 h 26（lg 36/30） | 6 / 4 · 13 | on 白底 sh-1 | audit #6 |

---

## 4. 复合组件

| 复合 | 结构与尺寸 | 状态 / 行为 | 规则 · audit |
|---|---|---|---|
| **顶栏**（工作台） | h 40：home 32×32 绿方块 → 菜单 5 项（28 高 ghost）→ 居中标题「案号(等宽灰) 案名 ▾ 已保存」→ 在线头像组 → 协作者 ▸ 历史 ▸ 视图段控件（源\|PDF / 三视图）▸ **构建 split-button**（唯一 primary）▸ 账户 32 | 浅色白 / 深色 n9；标题 hover 显示 caret；保存态 pill | L2 L3 L18 · #10 #6 |
| **顶栏**（机构页） | h 40：home → 台账 / 期限(计数) / 通知 → 居中搜索 320（`⌘K`）→ 帮助 / 账户 | 搜索为命令面板入口 | L18 |
| **Rail** | w 40 · tab 32×32 圆角 6 · 图标 20 · 激活 = 绿 soft 底 + 底部 3×24 绿条 · 计数徽章 16 右上 · 底部固定 体检 / 设置 | 顺序：案卷与大纲 · 搜索 · 审阅(10) · AI(8) · 附图 · 收件 · 术语 | [源码] `rail.scss`（32×32 / 20 / 3×24）· #1 |
| **文件树 / 大纲** | 侧栏 240：`案卷` 段（正文三书 · 附图 6 · 附件 0，**隐藏 studio.json / .emf / figs 内部结构**）+ `大纲` 段（跟随光标；权 1–11 带引用关系、说明书段号 [0002]…） | 节点 28 · 计数右对齐 · 当前节点绿 soft | C29 L4 · #18 |
| **PDF 工具条** | 面板顶 h 36：状态点「PDF 已就绪」→ 页码输入 34×24 / 总页 → 缩放 → 最大化；**浮岛** 位于纸面内、`right ≥ 20`，p 4 · 圆角 8 · sh-2：`权 1·L10 │ 定位源码 批注 编辑 AI` | 浮岛随选块出现，永不超出面板右缘（`max-width: calc(100% - 40px)`） | C27 · #13 |
| **行内块编辑器** | w 440 · 圆角 8 · sh-3：头 36「行内块编辑 · 权利要求书 · 第 1 页 · 权 1 · L10」→ 等宽 textarea ≥ 128 → 脚「提交 = 写回 content.md L10 ⌘↵ │ 取消 · 提交并重建(primary sm)」 | 提交即写回源码同一行，不产生第二真源 | #14 |
| **状态栏** | h 24 · 11px：光标位置（书·权·行）· 摘要字数 286/300 · 段号连续 · ⋯ · 体检 0 错 2 警 · 协作 2 人在线 · 编辑→预览 2.3s | 体检项可点跳控制台 | L2 |
| **协作者面板**（抽屉 420） | Tab：成员 3 · 链接 2 · 访问记录 · 设置 → 邀请行（输入 36 + 角色选择 + 邀请 primary）→ 成员列表（头像 32 + 在线 + 「正在编辑 权 1」+ 角色选择 32）→ 公开链接卡（评论级 / 只读，复制 + 撤销）→ 最近访问时间线 | 所有者不可改角色；撤销为 danger-soft | C15 C20 L10 |
| **评论线程** `.thread` | 卡 8：锚点条（等宽 11：书·权·页）→ 消息（头像 24 + 名/时间 + 13px 正文）→ 动作 28（定位 / 回复 / 已解决）→ 回复输入 32 | 当前线程绿边 + 2px soft 光晕；已解决 .75 透明 | C6 · #21 |
| **Proposal 卡** `.proposal` | 卡 8：头（AI 图标蓝 + 位置等宽 + 右侧「支持 权 3」tag）→ diff（del 红底删除线 / add 绿底）→ 「为什么」12px → 脚（画布底：批注 · 定位 │ 拒绝 · **接受(primary sm)**） | 接受 = 写入 CriticMarkup 建议，**不直接改源码**（面板头常驻一句说明）；已接受绿边；已拒绝 .7 | #19 #2 |
| **看板卡** `.kcard` | w 240 列 · 卡 8 · p 10/12 · sh-1：案名 13/500 两行 → 案号等宽 11 → 脚（期限 due + 评论数 + 头像右对齐） | hover sh-2；空列折叠为 44px 竖条（列名竖排 + 0） | L12 · #20 |
| **期限倒计时** | `剩 14 天`（灰）→ ≤ 7 天琥珀底 → ≤ 1 天红底 → 逾期 红 + 「逾期 2 天」；日期 `tabular-nums` | 台账列、看板卡脚、状态栏、客户审阅页共用 | C10 |
| **状态徽章选择器** | `.status.is-select`：pill 22 + caret 12，点击弹菜单（项 32：点 + 名 + 计数）；命中区外扩到 28 | 键盘可用 | C11 C18 · #21 |

---

## 5. 页面版式

断点：< 768 移动单栏 + 底部 Tab；768–1023 双栏（本轮未出图，[推断]）；≥ 1024 三区；工作台全宽，其余页 `max-width 1280` 居中（L1 L13）。

| 屏 | 1440 栅格（px） | 375 | 深色 | 规则 · audit |
|---|---|---|---|---|
| **S1 台账·列表** | 顶栏 40 │ 分组栏 220（新建 primary · 全部/我负责/收藏/待办 · 按状态 · 标签）│ 主区 p 32：H1 24 + 段控件(列表/看板/显示空档) → 「我的今天」3 格（仅非零）→ 表格 40 行（□28 · 案名 · 状态 pill · 期限 due · 责任人 32 · 评论 · 更新）│ 右栏 280（本周到期 · 动态） | 顶栏 44（菜单 / 搜索 / 头像 44）→ 段控件 36 → 到期横幅（只 1 条）→ 卡片列表（52 行：案名两行 + 案号 + pill + due）→ Tab 56；`+` 为 56 圆形 FAB | 画布 n9 · 分组栏 n9 · 表格面 n8 | L11 L12 L13 · #9 #21 #8 |
| **S2 台账·看板** | 同壳；列 240 × 2 展开（内审 1 · 已递交 1）+ 8 空列折叠 44；卡 `.kcard` | 横向滚动 1 列 + 右侧露 24px 下一列；列头 sticky | 同 | #20 |
| **S3 工作台默认** | 顶栏 40 │ rail 40 │ 侧栏 240 │ 源码 1fr（书 Tab 28 + CodeMirror 13/1.7 + 行号 40）│ 句柄 7 │ PDF 1fr（工具条 36 + 画布 #dfe3e9 + 纸 560 max）│ 状态栏 24。可编辑区 ≥ 640 | 见 S10 | 纸恒白；rail/顶栏 n9、侧栏 n9、面板 n8 | L2 L4 L7 L8 · #1 #10 #11 |
| **S4 三视图** | 源码 1fr │ 版面 1.05fr（Word 对齐纸 + 左侧段标签 L9/L10/L11 + 编辑中块绿框）│ PDF 1fr（选块绿框 + 浮岛 + 块编辑器 440 居中 top 300）；源码 L10 绿底高亮联动 | 三视图不在 375 出现；移动用 编辑/预览 Tab | 纸恒白，块编辑器 n8 | L5 L7 · #13 #14 |
| **S5 协作者抽屉** | 抽屉 420 从右覆盖 PDF 区（不遮源码）· 遮罩无 | 转全屏 Sheet（更多 › 协作者） | 抽屉 n8 · sh-3 加深 | C15 L10 |
| **S6 AI 面板** | `rail 40 │ 240 │ 1fr（源码）│ 1fr（PDF）│ 伴随 360`：源码 / PDF 均保留；面板 Tab（建议 8 / 对话 / 任务 3）→ 筛选 chip → Proposal 卡 → 任务 → 底部输入 + 1 行运维灰字 | AI Tab 全屏（375 减去 100 chrome） | Proposal diff 在 n8 上 add/del 用深色 soft | #2 #19 |
| **S7 递交** | 顶栏 40（返回工作台 · 案号 案名 pill）│ 主区 1120 居中：H1「递交」+ 版本 + **生成递交包(primary lg)** → 步骤条（体检 ✓ · 导出 ● · 清单 · 记录）→ 左 1fr（体检卡 · 导出卡 · 递交清单卡）右 360（期限 · 递交记录时间线 · 申请人） | 单列卡；导出行 56 + 44 圆形下载；底部粘性 44 主按钮（缺项时 disabled + 说明） | 卡 n8 on n9 | L13 L14 · #16 #6 |
| **S8 登录** | 左 1fr 品牌区（n9：logo · 28px 标语 · 4 个能力 chip · 白纸样张 -4°）│ 右 1fr 表单区居中卡 400（段控件 登录/注册 · H1 24 · 输入 40 · 行内中文错误 · 主按钮 44） | 品牌区压为 176 高只留 logo + 标语；表单全宽 | 表单区 n9 / 卡 n8 | C9 · #12 |
| **S9 客户审阅** | 顶栏 56（机构 · 案名 + 案号/版本 · 链接类型 pill · PDF\|版面 · 下载）│ 主区 PDF（工具条 36 + 纸 620）│ 右栏 360（代理师卡 + 截止 due + 身份 + 进度 → 批注/修改记录 Tab → 线程 → **动作条：要求修改 · 确认定稿(primary lg)**） | 顶栏 44 → 段控件 → 到期横幅 → 纸 → 底部粘性：当前线程 1 条 + 双按钮 44 | 纸恒白 | #15 |
| **S10 移动** | — | 台账 / 工作台 编辑（书 Tab + 源码 + 浮动 构建）/ 预览（PDF + 页码浮条）/ AI（Proposal 卡 44 按钮）/ 更多 Sheet（项 48：案卷·审阅(10)·历史·协作者·体检·递交·外观·排版）· 客户审阅；chrome 44+56=100 | — | Sheet n8 圆角 12 | L15 L16 L17 · #3 #8 #22 |

---

## 6. 截图（Chrome 真实截图，Playwright CDP 连接 `localhost:29229`，`shot.js`）

35 张：S1–S9 各 1440 亮 / 1440 暗 / 375 亮 = 27；S10 1440 亮 / 暗（多机取景总览）+ 375 亮 × 6（台账 · 工作台 编辑/预览/AI/更多 · 客户审阅）= 8。仓库内副本 `prototype-w6-a-overleaf-plus/shots/`。

| 屏 | 1440 亮 | 1440 暗 | 375 亮 |
|---|---|---|---|
| S1 台账列表 | [s1-1440-light](https://app.devin.ai/attachments/234dc560-1a38-4f7b-a4f1-ae1a44fab21f/s1--1440-light.png) | [s1-1440-dark](https://app.devin.ai/attachments/74f79517-0c89-475b-8c10-d934b23dfb69/s1--1440-dark.png) | [s1-375](https://app.devin.ai/attachments/f8b5ef14-544d-4af7-873d-ad968b0f040c/s1--375-light.png) |
| S2 台账看板 | [s2-1440-light](https://app.devin.ai/attachments/ec7881ca-f659-4b9c-8227-2dc995e672c7/s2--1440-light.png) | [s2-1440-dark](https://app.devin.ai/attachments/14cc72c0-63dc-4f59-be3e-c1db8639edb1/s2--1440-dark.png) | [s2-375](https://app.devin.ai/attachments/50abf719-9b16-4f6f-ac2a-7767b97e70c4/s2--375-light.png) |
| S3 工作台默认 | [s3-1440-light](https://app.devin.ai/attachments/558a0617-8c7d-4bf8-9419-f0777da81bc1/s3--1440-light.png) | [s3-1440-dark](https://app.devin.ai/attachments/3456a24a-457c-49c1-a819-de9e4c349f66/s3--1440-dark.png) | [s3-375](https://app.devin.ai/attachments/abf841bc-f529-474f-8fac-6f72885369ee/s3--375-light.png) |
| S4 三视图 + 块编辑器 | [s4-1440-light](https://app.devin.ai/attachments/3c46afb0-7ee9-4dc3-b031-ec07fa674528/s4--1440-light.png) | [s4-1440-dark](https://app.devin.ai/attachments/2ba236c6-5bc3-4bd7-abca-b69ef5493f7d/s4--1440-dark.png) | [s4-375](https://app.devin.ai/attachments/d90df900-b473-4664-8058-63e8c436d655/s4--375-light.png) |
| S5 协作者抽屉 | [s5-1440-light](https://app.devin.ai/attachments/4f7a7277-ad61-4ee1-8525-bcec4172d45f/s5--1440-light.png) | [s5-1440-dark](https://app.devin.ai/attachments/5902496d-2db1-443e-8594-a55adfbae141/s5--1440-dark.png) | [s5-375](https://app.devin.ai/attachments/24a9c809-42c6-495f-b59a-0af3afc92499/s5--375-light.png) |
| S6 AI 面板 | [s6-1440-light](https://app.devin.ai/attachments/499c3dbc-712b-4f3c-a3fc-8218f7cabd65/s6--1440-light.png) | [s6-1440-dark](https://app.devin.ai/attachments/40c536ef-5947-4353-b227-4935d589b338/s6--1440-dark.png) | [s6-375](https://app.devin.ai/attachments/cae48332-e987-40c5-917c-6c47d7f1d00b/s6--375-light.png) |
| S7 递交 | [s7-1440-light](https://app.devin.ai/attachments/24bd60c4-6c6e-40bf-9e3c-b4ed4877fb21/s7--1440-light.png) | [s7-1440-dark](https://app.devin.ai/attachments/a9050ae5-855f-4058-a32e-e688cd7cc520/s7--1440-dark.png) | [s7-375](https://app.devin.ai/attachments/995a3f1d-4ecb-4b42-a043-f34fd2f9a998/s7--375-light.png) |
| S8 登录 | [s8-1440-light](https://app.devin.ai/attachments/31ec72b8-361b-4ee2-a9d0-e6f298edc09e/s8--1440-light.png) | [s8-1440-dark](https://app.devin.ai/attachments/f21c7438-3bcf-4136-9025-ab83a4751843/s8--1440-dark.png) | [s8-375](https://app.devin.ai/attachments/7bbf45a7-15b4-4002-a105-434130d5b0b3/s8--375-light.png) |
| S9 客户审阅 | [s9-1440-light](https://app.devin.ai/attachments/65aea3f9-b949-47e5-94a6-de0ba8a97be5/s9--1440-light.png) | [s9-1440-dark](https://app.devin.ai/attachments/77e0c355-2356-4108-9070-cfd063ab8a56/s9--1440-dark.png) | [s9-375](https://app.devin.ai/attachments/0636c28b-97bc-4a45-87c4-f525e7e4b42b/s9--375-light.png) |
| S10 移动总览 | [s10-1440-light](https://app.devin.ai/attachments/cb9d9dfa-9ee4-4ef6-97fc-7c1b6d5cc3b9/s10--1440-light.png) | [s10-1440-dark](https://app.devin.ai/attachments/ed9be906-007d-4cb7-afca-04f5bb9675bd/s10--1440-dark.png) | 台账 [m-dashboard](https://app.devin.ai/attachments/c7687cf6-5adb-4007-b63e-051f7e66c015/s10-m-dashboard--375-light.png) · 工作台 [编辑](https://app.devin.ai/attachments/17ffe71e-1fde-4ed2-a678-a515e9a587cb/s10-m-workbench-edit--375-light.png) / [预览](https://app.devin.ai/attachments/30ecabb8-5a4e-4d6c-b82b-de15030a9a55/s10-m-workbench-preview--375-light.png) / [AI](https://app.devin.ai/attachments/e98c8ee3-7c12-4e1a-a31e-7b52119fec70/s10-m-workbench-ai--375-light.png) / [更多 Sheet](https://app.devin.ai/attachments/b2e1f489-df96-44d2-8a1a-e05c9c4cb536/s10-m-workbench-more--375-light.png) · 客户审阅 [m-client](https://app.devin.ai/attachments/b3195851-9ee7-43e0-a7b2-a5fbf14133b1/s10-m-client--375-light.png) |

说明：S3/S4/S6 的 375 截图 = 移动工作台对应 Tab（三视图与伴随栏在 375 不存在，按 L15/L16 折叠进 Tab/Sheet）；S5 的 375 = 更多 Sheet（协作者入口）。截图脚本对每张检查 `scrollWidth > innerWidth`，35 张均无横向溢出。

---

## 7. 一手证据索引

### 7.1 Overleaf 源码 [源码]（`/home/ubuntu/repos/overleaf`，commit `28ad3b03b71cb4311decdcb55c36b33ec10d72db`，`services/web/frontend/stylesheets/`）

| 事实 | 路径 |
|---|---|
| 顶栏 40 · home 32 · 浅色主题顶栏 `--bg-light-primary`、深色 `--bg-dark-primary` | `pages/editor/toolbar-redesign.scss` L1–L40 |
| 旧顶栏浅色 `--editor-toolbar-bg: var(--white)` | `pages/editor/toolbar.scss` L75–L84 |
| 编辑器背景随主题 `--ide-redesign-background` | `pages/editor/ide-redesign.scss` L2–L19 |
| rail 40 · tab 32×32 · 图标 20 · 激活条 3×24 | `pages/editor/rail.scss` |
| 浮岛阴影 `0 2px 4px 0 #1e253029` | `pages/editor/editor-floating-menu.scss` |
| 中性 10 阶 / 绿 7 阶 / 蓝红黄 | `foundations/colors.scss` |
| 圆角 4 / 8 / 16 / pill | `foundations/border-radius.scss` |
| 阴影 elevation 三档 | `foundations/elevation.scss` |
| 编译按钮 split | `pages/editor/compile-button.scss` |

### 7.2 官方文档与实测截图 [官方] [实测]

| 来源 | 链接 | 截图 / 读数 |
|---|---|---|
| Overleaf 博客《Introducing Overleaf's new look》2025-11-19 | https://www.overleaf.com/blog/introducing-overleafs-new-look | [1440 截图](https://app.devin.ai/attachments/b83ea0a9-c4e7-4679-8db0-42c249873dc2/ext-overleaf-new-look-blog-1440.png)；body `"Noto Sans"` 16px `#495365`、H1 48、pill 36 导航按钮、绿 `#098842` 主按钮 |
| Overleaf Docs《Redesigned Overleaf editor》 | https://docs.overleaf.com/getting-started/how-do-i-use-overleaf/redesigned-overleaf-editor | [页面](https://app.devin.ai/attachments/9c547ca4-da6e-4014-8aca-79a0480f4b1d/ext-overleaf-docs-redesigned-editor-1440.png) · [编辑器配图](https://app.devin.ai/attachments/42fcc076-d2d7-4f87-86ff-485e9af145b4/ext-overleaf-docs-editor-img0.png)：白顶栏 + 浅 rail + 绿 Recompile + 右 PDF |
| 飞书 Universe Design · 色彩 | https://open.feishu.cn/document/design-specification/design-language/color?lang=zh-CN | [截图](https://app.devin.ai/attachments/4fcfa4ae-2dbd-4324-8227-f914f1a2a801/ext-feishu-universe-color-1440.png)；body 14px `rgba(0,0,0,.85)` on `#fff` |
| 飞书 Universe Design · 按钮 | https://open.feishu.cn/document/design-specification/component---data-entry/button/button_text?lang=zh-CN | [截图](https://app.devin.ai/attachments/472ab616-120d-4f60-93d6-c95d9f9d1b23/ext-feishu-universe-button-1440.png)；主按钮 h 32 · 6px · `#1456f0` |
| Notion Help · What is a block | https://www.notion.com/help/what-is-a-block | [截图](https://app.devin.ai/attachments/80d0e425-e568-4f4e-8e38-6fd0f0271f04/ext-notion-help-block-1440.png)；body 16px `rgba(0,0,0,.95)` Inter，导航按钮 h 30 圆角 4 |
| 采样脚本 / JSON 读数 | `w6-a-evidence/ext.js`、`ext2.js`、`*.json` | `getComputedStyle` 抽样 |

未拿到（如实）：Overleaf / 飞书 / Notion **登录后**的编辑器、项目面板、分享面板实景（无账号；Overleaf 编辑器实景以官方文档配图 + 源码替代；飞书文档登录返回 4401 同 benchmark §3.4）。这些标为 [官方]/[源码] 而非 [实测]。

---

## 8. 可访问性与纪律核对

| 项 | 结果 | 方式 |
|---|---|---|
| 对比度 ≥ 4.5:1 | 正文 n9/白 16.0 · fg-2 7.75 · fg-3 5.32（白）/ 4.87（n1）· 白/primary 4.55 · link 5.18 · danger 5.69 · warning-text 5.42 · 状态 pill 5.4–6.8 · 深色 fg-2/n8 7.04 · fg-3/n8 5.57 · n9/green-40 6.31 · blue-30/n8 5.54 | WCAG 公式计算（Python，§2.1 注） |
| 占位符 n5/白 2.98 | 低于 4.5，**接受**（占位符非必读内容，label 在上） | 计算 |
| 触控 ≥ 44 | 移动顶栏按钮 44×44 · Tab 56 · 列表行 52 · Sheet 项 48 · 主按钮 44 · 复选 44 · FAB 56 · 下载 44 | 原型 CSS + 375 截图 |
| `prefers-reduced-motion` | `tokens.css` 与 `proto.css` 均有 `@media (prefers-reduced-motion: reduce)`：时长 0、骨架停止 | 代码 |
| 一屏一个 primary | S1 新建 · S3/S4 构建 · S5 邀请 · S6 每卡「接受」（卡内唯一）· S7 生成递交包 · S8 登录 · S9 确认定稿 | 截图逐屏核对 |
| 纸面恒白 | 深色截图 s3/s4/s6/s9-dark 纸面 `#fff` | 截图 |
| 图标只用 lucide | `vendor/lucide.min.js`（0.475.0 UMD，本地）| 代码 |
| 无第二组件库 / 无 3D 渐变 | 手写 CSS 545 行 + tokens 210 行；唯一渐变是骨架屏 | 代码 |
| 未验证 | axe 扫描、真机触控、屏幕阅读器；768–1023 双栏 [推断] | — |

---

## 9. Tradeoffs 与改动量估计

### 9.1 这条方向牺牲了什么

1. **浅顶栏减弱"应用边界感"**——多窗口并排时不如深条醒目；用 home 绿方块 + 1px 边补偿；深色用户不受影响。
2. **伴随栏 360 + 侧栏 240 在 1280 视口下源码区约 600px**——1280 以下建议伴随栏自动折叠为 rail 图标（L7），本轮未出 1280 图 [推断]。
3. **10 档状态色 + 蓝链接 + 绿主色** 比 W5 的"一绿到底"多了 3 个 hue 需要记忆——但代理师的台账本来就按状态扫视，语义色是收益不是成本。
4. **不做营销化**：登录页品牌区是唯一"叙事"位置，其余页面保持工具密度；如果老板想要更多"产品感"，方向 B/C 可能更合适。
5. **版面视图（Word 对齐）在 375 不呈现**——按 L15 移动只保留 编辑 / 预览；这与 W5 一致，不是退步。
6. **纸面样式在原型中是 HTML 示意**（`--font-paper`），真实版面由 `patent_docx` 决定；原型只约束 UI 壳。

### 9.2 对现有代码的改动量（不在本轮执行）

| 区域 | 估计 | 理由 |
|---|---|---|
| `frontend/src/index.css`（token） | **小–中** | 灰阶 / 绿 / 状态 hue 与 W5 基本等值，主要是：新增 `--canvas/--surface-sunken/--pdf-canvas/--popover` 四层面、`--link/--info` 蓝拆分、深色主色改 `green-40`、`--n6` 微调、`--fs-28`、行高 13→20 / 14→22、`--w-companion 360`、圆角 12 档。全部在 `:root/.dark` 与 `@theme inline` 映射内，约 60–80 行。 |
| `frontend/src/components/ui`（原语） | **中** | 尺寸 / 变体基本已有（button 四档、input 三档）。需改：button `xl 40 / 圆角 8`、split-button 变体、badge 拆 `status/tag/count` 三件、avatar 去 red-500、dialog `< 768` 全屏、drawer 360、toast 深底 + 四类图标、switch `role=switch`、tooltip 深底、select 替换原生（成员头衔 / 日期）。新增：`due`（期限倒计时）、`status-select`。约 10 个文件各 20–60 行。 |
| Shell（工作台 / 台账 / 移动） | **中–大** | 这是"肉眼可见"的主要来源：① 工作台默认布局从 5 区改 3 区，AI / 审阅 / 历史改为**伴随栏**而非替换 Tab（dockview 面板编排 + 视图 store）；② 浮岛与块编辑器加定位头 + 约束在面板内；③ 台账首页 H1 + 「我的今天」非零过滤 + 右栏；④ 看板空列折叠；⑤ 递交页四步结构 + 案名标题；⑥ 客户审阅页右栏 + 动作条；⑦ 登录页双栏；⑧ 移动 Sheet 全屏化 + 更多 Sheet 项 48。约 12–15 个页面/容器组件，不触及 CodeMirror / ProseMirror / react-pdf 内核与任何后端。 |
| 不改 | — | Markdown 真源、`patent_docx`、DOCX/PDF 生成、CNIPA XML、后端 API、`studio.json` 语义。 |

按 CEO 吞吐估算：token + ui 原语 1 个会话；Shell 8 项拆 4 个并行子会话 + 1 个集成会话；合计约 2–3 个会话，主要等待在 LibreOffice 构建走查。

---

## 10. 与 benchmark / audit 的对照总表

| 规则 | 落点（原型） | 规则 | 落点 |
|---|---|---|---|
| C1 四档按钮 | §3 btn sm/md/lg/xl | C16 Toast | index.html 组件态 |
| C2 圆角随尺寸 | §2.5 | C17 Tooltip | index.html |
| C3 一屏一 primary | §8 逐屏 | C18 状态徽章 22 pill | `.status` |
| C4 主动作 ≥ 14 | btn-lg/xl 14px | C19 Tag/徽章分色 | `.tag` 中性 / `.status` 语义 |
| C5 icon 按钮 aria-label | 原型全部 icon 按钮带 `aria-label` | C20 头像三档 | `.avatar` 24/32/40 + 组 |
| C6 命中区 | 28 / 44 | C21 表格 40/36 | `.tbl` |
| C7 焦点 | ring + halo | C22 加载更多 | [未出图]（两案数据不足一页） |
| C8 loading 保宽 | [未出图] | C23 空态 | index.html |
| C9 输入三档 + 错误态 | S8 | C24 骨架 | index.html |
| C10 tabular-nums | 案号 / 日期 / 页码 | C25 lucide 16/20/24 | 全部 |
| C11 菜单项 32/44 | `.menu-item` / Sheet 48 | C26 语义 token | proto.css 零硬编码色（纸面除外） |
| C12 危险项 | S5 撤销链接 danger-soft | C27 阴影三档 | §2.5 |
| C13 Dialog 三档 + 全屏 | `.dialog` | C28 动效 | §2.6 |
| C14 焦点陷阱 | [实现期] | C29 树 28 | `.tree-node` |
| C15 抽屉 | S5 | C30 单一 ui 目录 | §9.2 |
| L1 断点 | §5 | L11 分组只显非零 | S1 分组栏「其余 8 个状态（空）」折叠 |
| L2 高度 | 40/24/40/36 · 44/56 | L12 表格转卡 | S1 375 |
| L3 顶栏控件同高 | 28 菜单 / 32 动作 | L13 1280 居中 | S7 1120 |
| L4 侧栏 240 | S3 | L14 表单单列 | S8 |
| L5 A4 纸 | S4 版面（示意） | L15 chrome ≤ 140 | 100 |
| L7 面板可折叠 | rail | L16 移动主动作右上 | 编辑 Tab 浮动「构建」 |
| L8 句柄 7 | `--w-split-handle` | L17 Sheet ≤ 85vh | `.sheet` |
| L9 历史模式 | [未出图] | L18 面包屑 | 顶栏 案号 › 案名 |
| L10 伴随 | S5 S6 | L19 一个 H1 | S1 S7 S8 |
| audit #1–#25 | 见 §1.2 表与 §5 各行「audit」列；未覆盖：#17（主题入口——已放进移动更多 Sheet「外观」与工作台「文件」菜单 `⌘⇧L`；机构顶栏与账户页入口未出图）、#25（`#/__ds` 展示页——由 `index.html` 组件态区替代示意） |
