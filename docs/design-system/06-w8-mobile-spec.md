# 06 · W8 移动 / 触控密度与间距规格（375）

> 状态：W8-mobile prep 规格（分支 `devin/w8-mobile-prep`）。只修订 05-w6-spec 的「移动 / 触控密度」与「间距」两节；
> tokens 命名、字阶、圆角、颜色、桌面（≥ md）一律沿用 05，不得违反。
> 老板原话（本波次唯一目标）：「移动端有问题……元素的大小以及与元素之间的关系混乱，有些按钮存在偏大，外间距都没有」。

## 0. 根因（探针实测，非推断）

- `frontend/src/index.css` `[data-density='touch']` 把 `--h-xs/sm/md/lg` **全部拉平到 44**，行高 / 面板头 / PDF 工具条统一 44/48。
- W7 探针（`docs/archive/design-system/w7-final/probe/probes.json`）375 亮暗 14 页 `heights` 分布：
  除文本行外可点控件只剩 **44 / 55 两档**（home 44×22、deadlines 44×20、workbench 44×15 …）；桌面同页有 24/28/32/36/44 五档。
- 间距无移动规范：卡片贴边（页边 0–8 不等）、区块之间无 24 留白、chip 行被 `overflow-hidden` 裁切（老板红框图六屏均可见）。
- 结论：**层级消失 = 视觉尺寸被命中区规则绑架**。正确做法是「视觉尺寸分档 + 命中区伪元素扩到 ≥ 44」，而非全部视觉 44。

## 1. 一手依据（SOP-02 调研先行）

| 来源 | 实测/原文 | 对本规格的启示 |
| --- | --- | --- |
| Apple HIG · Accessibility › Buttons and controls¹ | iOS/iPadOS 默认控件 44×44 pt，**最小控件 28×28 pt**；建议无边框控件四周留 ~24 pt、有边框 ~12 pt 间距 | 视觉可以到 28，命中 44；相邻控件要有间距 |
| Apple HIG · Layout / Navigation bars / Tab bars / Segmented controls² | 导航栏 44 pt；Tab bar 49 pt；分段控件默认 32 pt；标准列表行 44 pt；紧凑宽度页边 16 pt | 顶栏 44、Tab bar 56（05 已定，含 label）、Segmented 视觉 32–36、页边 16 |
| Material 3 · Accessibility › Touch targets³ | 目标 ≥ 48×48 dp，**可超出视觉边界**（示例：24 dp 图标 48 dp 目标）；目标间 ≥ 8 dp | 伪元素热区 + gap ≥ 8 |
| Material 3 · Chips / Buttons / FAB specs⁴ | chip 容器 32 dp；button 40 dp（XS 32 / S 40 / M 56）；FAB 56；XS/S 图标按钮须外扩到 48 目标 | chip = sm(32)，普通按钮 36–40，主 CTA 44+ |
| Ant Design Mobile `button.less` / `theme-default.less`⁵ | mini 13px 字 + 3px 上下 padding ≈ 24；small 15px ≈ 28；middle 17px + 7px ≈ 40；large 18px + 11px ≈ 48；Tag 12px 字 2/4 padding ≈ 20 | 四档 24/28/40/48，标签不做命中控件时可 20 |
| Vant `button/index.less` `tabbar` `nav-bar` `var.less`⁶ | mini 24 / small 32 / default 44 / large 50；nav-bar 46；tabbar 50；padding 阶 4/8/12/16/24 | 32 与 44 是移动最常用两档；间距用 4/8/12/16/24 |
| 飞书 / Notion 移动端 | **本波次未完成量尺**（时间盒内无可用真机截图，见 §6 unverified）；引用 HIG 紧凑宽度 16 pt 页边作为替代依据 | 页边 16、区块 24 待下一单元实测校正 |

¹ https://developer.apple.com/design/human-interface-guidelines/accessibility ² https://developer.apple.com/design/human-interface-guidelines/layout 、/navigation-bars 、/tab-bars 、/segmented-controls
³ https://m3.material.io/foundations/accessible-design/accessibility-basics ⁴ https://m3.material.io/components/chips/specs 、/buttons/specs 、/floating-action-button/specs
⁵ https://github.com/ant-design/ant-design-mobile/blob/master/src/components/button/button.less 、src/global/theme-default.less
⁶ https://github.com/youzan/vant/blob/main/packages/vant/src/button/index.less 、tabbar/index.less 、nav-bar/index.less 、style/css-variables.less

## 2. 触控密度：四档视觉高度 + 命中区规则

### 2.1 四档（`[data-density='touch']` 覆盖值）

| 档 | token | 桌面 | **触控视觉** | 字号 | 图标 | 用途（哪些控件属此档） |
| --- | --- | --- | --- | --- | --- | --- |
| xs | `--h-xs` | 24 | **28** | 11 (`text-2xs`) | 14 | 表内 / 卡片内行内 ghost 图标按钮、Tag 关闭 ×、树节点行内动作 |
| sm | `--h-sm` | 28 | **32** | 12 (`text-xs`) | 14 | 筛选 chip、Toggle、快捷动作、次要文字按钮、可点 Tag |
| md | `--h-md` | 32 | **36** | 13 (`text-base`) | 16 | Segmented、Tabs pill、卡片主按钮、Dropdown 触发器、工具条按钮 |
| lg | `--h-lg` | 36 | **44** | 13 | 16 | Select / Input / Textarea 单行、表单主按钮、Sheet 内主按钮 |
| touch | `--h-touch` | 44 | 44 | 14 (`text-lg`) | 18 | 主 CTA（xl）、顶栏 44、Tab bar 56、列表主行 48 |

- 行高：`--row-h` 48、`--row-h-compact` 44、`--row-h-menu` 44、`--row-h-tree` 44；`--h-panel-header` 44；`--h-pdftb` 44（不变）。
- **44 只给**：主 CTA、顶栏、Tab bar、列表主行、Select/Input（lg）。其余控件按档位缩小，靠命中区补足。
- 桌面（`:root` 无 touch 属性）值一律不变；密度 compact 规则不变。

### 2.2 命中区规则（硬指标：375 全部可点控件命中区 ≥ 44）

1. 任何视觉 < 44 的可点原语在 touch 容器内加统一工具类 `touch-hit`（`@utility`，index.css）：
   `position: relative` + `::after { content:''; position:absolute; inset 居中; width/height: max(100%, var(--h-touch)) }`。
   探针按 W6/W7 口径取 `el ∪ ::after` 并集量命中区，与 CriticMarkup ✓/✗、Checkbox、Switch 现有做法同源。
2. `touch-hit` 只在 `[data-density='touch']` 后代生效（`:where([data-density='touch']) &::after`），桌面零影响。
3. 相邻可点控件 **gap ≥ 8**（chip 行 gap 8、按钮组 gap 8、卡片内动作 gap 8），保证热区不重叠误触；
   同一行内热区允许在 gap 内相互接近但不得越过邻元素的视觉中线。
4. Checkbox（16）/ Switch（20）保留 `after:-inset-*` 写法（已验证 46 / 44）；Radio 同 Checkbox。
5. `overflow-hidden` 的容器不得直接包裹带 `touch-hit` 的控件（会裁掉热区）——横向行用 `ScrollRow`（`overflow-x:auto` + 上下 padding 6）。
6. 字号 / 图标随档：见 §2.1；最小字号 11px 不变（lint-tokens `fs-min` 守）。

### 2.3 原语 → 档位对照（W8 单元实施时按表选 size，不再手写 isDesktop ? 'lg' : 'xl'）

| 原语 | touch 档 | 说明 |
| --- | --- | --- |
| Button xs / sm / md / lg / xl | 28 / 32 / 36 / 44 / 44 | xl 只给页级主 CTA 与底部动作条 |
| Toggle / ToggleGroup item | sm 32（默认 md 36） | 工具条开关 |
| Tabs trigger（underline） | 44（面板头） | 顶部 Tab 条走 ScrollRow |
| Tabs trigger（pill）| md 36 | |
| Segmented item | md 36；xl 44 | 视图切换（源码 / 版面 / PDF） |
| Select trigger / Input / Textarea | lg 44 | 表单类保留 44（HIG 列表行 44） |
| Tag（可点 / 可删）| sm 32 视觉（`h-6` 24 + `touch-hit`） | 纯展示 Tag 20 不加热区 |
| Checkbox / Switch | 16 / 20 视觉 + 伪元素 46 / 44 | 不变 |
| Dropdown / Select item | 44 行 | `--row-h-menu` |
| 图标按钮（ghost）| xs 28 / sm 32 | 顶栏内 sm，卡片内 xs |

## 3. 移动 8pt 间距规范（375）

### 3.1 token（index.css 新增，`@theme inline` 映射为 `p-*/gap-*/px-*` 工具类）

| token | 值 | 工具类 | 用途 |
| --- | --- | --- | --- |
| `--pad-page-m` | 16 | `p-page-m` `px-page-m` | 页边（HIG 紧凑宽度 16） |
| `--gap-section-m` | 24 | `gap-section-m` `space-y-section-m` | 区块之间（标题 + 内容为一区块） |
| `--pad-card-m` | 16 | `p-card-m` | 卡片内边距 |
| `--gap-card-m` | 12 | `gap-card-m` | 卡片与卡片之间 |
| `--gap-group-m` | 8 | `gap-group-m` | 同组元素（chip 与 chip、按钮与按钮、标签与值） |
| `--gap-inline-m` | 4 | `gap-inline-m` | 文本行内（图标与文字、数字与单位） |
| `--pad-sheet-m` | 16 | `p-sheet-m` `px-sheet-m` | 底部 Sheet 内容区左右 / 底 |
| `--pad-sheet-top-m` | 8 | `pt-sheet-top-m` | Sheet 把手到内容 |

- 只允许 4 / 8 / 12 / 16 / 24 / 32（8pt 栅格 + 4 半格）；探针抽样 `getComputedStyle` 的 padding / gap 必须落在此集合。
- 区块标题（`text-sm font-medium`）与内容间 8；标题与上一区块 24。

### 3.2 版式规则

1. **页面** = `MobilePage`：`px-page-m`，纵向 `gap-section-m`，顶部 `pt-4`（16），底部 `pb-[calc(var(--h-mobile-tabs)+var(--pad-page-m)+env(safe-area-inset-bottom))]` 让位 Tab bar。
2. **卡片**：`p-card-m rounded-lg border bg-panel`；卡片列表 `gap-card-m`；卡片内元素 `gap-group-m`；卡片内主按钮 md 36 靠右或整行。
3. **横向行**（Tab 条 / 步骤条 / chip 行 / 状态筛选）= `ScrollRow`：`overflow-x:auto` 不裁切，首末 16 内边距（`px-page-m`，配合 `-mx-page-m` 出血到页边），`gap-group-m` 8，隐藏滚动条（`scrollbar-none`），`scroll-snap` 关闭，键盘可达（`tabIndex=0` + 左右键）。
4. **底部动作条**：`h-action-bar` 64，固定在 Tab bar 之上（`bottom: var(--h-mobile-tabs)`）；Sheet 打开时动作条随 Sheet 内容滚动到底部，不叠两层。
   两者都加 `padding-bottom: env(safe-area-inset-bottom)`；Tab bar 高 56 + safe-area。
5. **底部 Sheet**（AI · 审阅 · 问题 · 协作）：把手 8 上边距，标题行 44，内容 `px-sheet-m`，内容分组 `gap-section-m`；关闭 × 为 sm 32 + touch-hit。
6. **列表主行** 48：左 16 右 16，主文 13 / 次文 12，右侧 chevron 或计数；行内动作最多 1 个（xs 28）。
7. 文本行内 4：图标 14–16 与文字间 4；数字与单位间 4；不可用 `space-x-1.5`（6）等半格外值。

## 4. 六屏 375 目标版式（高保真原型 `prototype-w8-mobile/*.html`，对照图 `w8-mobile/*.png`）

| # | 屏 | 基线问题（红框） | 目标版式要点 |
| --- | --- | --- | --- |
| 1 | 首页台账 `home.html` | 统计卡挤满、筛选 chip 44 高被裁、案卡间无间距 | 顶栏 44 → 今日条（ScrollRow，chip sm 32）→ 区块 24 → 案件卡 `gap-card-m` 12，卡内 16，状态 Badge 20，主按钮 md 36 |
| 2 | 期限中心 `deadlines.html` | 日历格与列表贴边、日期 44 方格过大 | 月份 Segmented md 36 → 周条 ScrollRow → 期限卡 12 间距，倒计时 Count 24，行 48 |
| 3 | 工作台 + 底部 Sheet `workbench.html` | Sheet 内 Tab 与按钮统一 44 无层级 | 顶栏 44（返回 sm 32 + 标题 + 更多 sm 32）→ 视图 Segmented md 36 → 纸面 → Sheet：把手 8 / 标题 44 / Tabs 44（ScrollRow）/ 建议卡 16 / 卡内按钮 md 36 |
| 4 | 递交体检 `deliver.html` | 步骤条被裁、检查项按钮偏大 | 步骤条 ScrollRow → 检查项行 48（图标 16 + 文案 + 状态）→ 底部动作条 64：次按钮 lg 44 + 主 CTA xl 44 |
| 5 | 账户 · 机构 `account.html` | 设置行 55 高、Switch 行无分组 | 分组标题 12/16 → 行 48（Switch 20 视觉）→ 组间 24 → 危险区独立卡 |
| 6 | 客户审阅页 `client.html` | 顶部 ClientHeader 56 后按钮全 44 | ClientHeader 56 → 说明卡 16 → 段落评论行 48 → 批注 ✓/✗ xs 28（已有伪元素）→ 底部 CTA xl 44 |

原型只用 index.css 的 CSS 变量名（`--bg-app --bg-panel --fg --fg-muted --border --primary --h-* --pad-*-m --gap-*-m` 等，`proto.css` 顶部是 index.css 语义层的静态副本），不引第二套色值。
对照图由 `w8-mobile/capture/compare.js` 生成：左 W7 基线 `w7-final/probe/shots/<屏>--375-light.png`，右原型 375×812 截图（`w8-mobile/proto/`），合成 `w8-mobile/<屏>--compare.png`。

## 5. 单元验收口径（每个 W8 页面单元、以及本 prep 分支）

| 指标 | 口径 | 工具 |
| --- | --- | --- |
| 视觉分档 | 375 每页探针 `heights`（可点控件）出现 **≥ 3 档**（28/32/36/44/48 中的三个及以上） | `docs/archive/design-system/w8-mobile/capture/probe.js` → `tiers` |
| 命中区 | 375 `el ∪ ::after` 最小边 < 44 的可点控件 = **0**（纸面 / PDF 文本层除外） | 同上 `controlsUnder44` |
| 8pt 栅格 | 每页抽样可见 `padding-*` / `gap` / `column-gap` / `row-gap` 非零值，**≥ 90 %** 落在 {4,8,12,16,24,32}，并列出离格值 | 同上 `spacing` |
| axe | serious / critical = 0（亮暗） | 同上（axe-core） |
| 字号 | UI 最小字号 ≥ 11 | 同上 `minFontUi` |
| 桌面不变 | 1440 亮暗截图与 W7 基线像素差 = 0（或仅时间戳 / 光标） | `pixelmatch` 或目测 |
| 本地门 | `make check` · `make zero-drift` · `make roundtrip` · `pnpm lint:tokens` 全绿 | 本地（不启用 GitHub Actions） |
| jsdom | 每个原语在 `data-density=touch` 容器内：class 含 `touch-hit`（或 `after:-inset-*`）且高度 class = 档位 | `components/ui/__tests__/w8-touch-tiers.test.tsx` |
| 真量 | 375 打开 `#/__ds` touch 示例节，每个可点原语 `getBoundingClientRect` 视觉高 ∈ 档位、`el ∪ ::after` 命中 ≥ 44 | `w8-mobile/capture/measure-touch.js`（exit 1 即失败） |

### 5.1 本分支 375 基线数字（prep 地基后、页面单元前；亮暗一致，取 light）

| 页 | 可点 | <44 | 档数 tierList | 8pt 抽样 on8 / on4 | 离格值 |
| --- | --- | --- | --- | --- | --- |
| home | 24 | 0 | 4：44×17 56×3 16×2 48×2 | 39 % / 78 %（36） | gap 6、padding 2 |
| deadlines | 7 | 0 | 2：44×4 56×3 | 100 % / 100 %（8） | — |
| inbox | 7 | 0 | 3：56×3 44×2 48×2 | 56 % / 75 %（16） | padding 2 |
| workbench | 14 | 0 | 2：44×9 56×5 | 0 % / 0 %（2） | padding 2 |
| ai（Sheet） | 45 | 0 | 6：44×18 32×12 16×6 56×5 20×2 28×2 | 37 % / 73 %（73） | gap 6 ×10 |
| review / problems / collab | 17 / 37 / 22 | 0 | 2 / 3 / 2 | 33 / 56 / 62 % | gap 6、padding 2、padding 10 |
| deliver | 16 | 0 | 2：44×14 36×2 | 61 % / 92 %（66） | gap 6、padding 10 |
| account / admin | 10 / 11 | 0 | 2：44 + 36 | 30 % / 62 % | gap 6 ×5、padding 2 |
| client | 4 | 0 | 1：44×4 | 0 % / 100 %（2） | — |

- 全部 26 组合（13 屏 × 亮暗）：`controlsUnder44 = 0`、axe serious/critical = 0、pageerror = 0、console error = 0、`minFontUi ≥ 11`。
- 档数 < 3 与 on8 < 90 % 是**页面单元的待办**（页面仍写 `isDesktop ? 'lg' : 'xl'`、`gap-1.5`），不是原语问题；地基已让 xs/sm/md 在 touch 下恢复 28/32/36（ai Sheet 里 chip 28 / 32 已出现）。

## 6. 本 prep 分支的已验证 / 未验证（实事求是）

- 已验证：见结构化输出 `verified`（命令实测 / 浏览器实测 + 截图）。
- 未验证：飞书 / Notion 移动端页边距实测量尺；六屏原型的真实页面落地（本分支只交付原型 + 地基，页面单元由后续单元按 §4 表逐屏实施）。
- 兼容说明：`[data-density='touch']` 分档后，未接入 `touch-hit` 的页面级 `h-sm/md-control` 元素命中区会 < 44；
  W8 页面单元必须改用原语或加 `touch-hit`，探针 `controlsUnder44` 为其硬门。
