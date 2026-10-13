# 00 · 竞品前端基准（benchmark）— 波次 5 研究课题

> 角色：UX researcher + UI designer（company-os `roles/design/ux-researcher.md`、`roles/design/ui-designer.md`）。
> 基线：`devin/wave4-integrated`；分支：`devin/w5-research-benchmark`。本文只做研究，不改产品代码。
> 采样日期：2026-09-06。Overleaf 源码 commit `28ad3b03b71cb4311decdcb55c36b33ec10d72db`（2026-06-26）；Typora 默认主题 commit `cf4f2cb7e81a73050456367cfdfdb80b5a14a7b2`。

## 0. 如何读本文 · 证据分级

| 标记 | 含义 | 可信度 | 举例 |
|---|---|---|---|
| **[源码]** | 本机克隆的开源仓库里读到的代码，附路径 | 最高 | Overleaf `services/web/frontend/stylesheets/ds/colors.scss` |
| **[实测]** | 本机 Chrome（Playwright over CDP）在 1440×900 / 375×812 亲眼截图 + `getComputedStyle` 读数 | 高（受当日线上版本影响） | 腾讯文档公开文档顶栏 40px |
| **[官方文档]** | 厂商设计规范 / 官方文档 URL | 高（是"规范"，不一定等于线上实现） | Material 3 Buttons specs |
| **[推断]** | 从证据出发的解释性判断 | 中 | "腾讯把工具栏做成浮岛是为了…" |
| **[建议]** | 面向 Patent Studio 的设计决策建议，需技术负责人交叉质疑 | — | "工具栏统一 32px 控件" |
| **[未验证]** | 想查但没查到 / 被登录墙挡住 / 脚本超时 | — | 飞书登录页真实表单 |

硬约束（来自本波次任务书，本文所有建议均在其内）：正文真源 Markdown、后端唯一解析器；UI 原语只允许一套（现 Radix + shadcn 风格）；权限语义不变；AI 不静默改源；桌面 1440 + 移动 375 同一 Web 响应式，不做小程序；a11y（axe 无 serious/critical、键盘可达、对比度 ≥ 4.5:1）。

### 0.1 一页结论（详见 §7 规则）

| # | 结论 | 证据 |
|---|---|---|
| 1 | Overleaf 的设计系统是"**4px 基单位 + 50–950 色阶 + 12–72px 字号阶 + 2/4/8/12/16/24/9999 圆角 + 三档阴影**"，并且全部落成 CSS 变量而不是 Tailwind 类，组件用 `btn-ds` 这样的语义类消费变量 | [源码] §2.1 |
| 2 | Overleaf 编辑器壳 = **40px 顶栏 + 40px 图标 rail（32px tab、20px 图标、3×24 指示条）+ 可折叠侧面板 + 编辑器/PDF 各 50% 的 PanelGroup**；我们现状 `--h-topbar:40px; --w-rail:40px` 已同构 | [源码] §2.3 · [实测] §4 |
| 3 | 6 个对标产品的登录页主按钮高度落在 **36–52px**、圆角 0–20px，中文产品（飞书 6px、腾讯 4px）圆角保守；文档类产品字号基线是 **14px 中文 / 16px 英文** | [实测] §3 |
| 4 | 中文在线文档（飞书/腾讯）文档页共同结构：**顶栏 40–64px + 悬浮/内嵌格式工具栏 40px + 中央纸张 810–820px + 底部状态栏 33px**；移动端顶栏统一 **44px** | [实测] §3.4 §3.5 |
| 5 | 我们现状的问题不在 token 缺失而在**消费不一致**：同一页面按钮出现 24/28/30/32/36/40 六种高度、4px 与 pill 两种圆角并存、状态徽章字号 12/13/14 混用 | [实测] §4.2 |
| 6 | 移动端 375 下所有对标产品都**不承诺完整编辑**：Notion/飞书/腾讯公开页只读 + "APP 内打开"，Overleaf 只做设备判定关掉右键菜单；我们应明确"移动 = 审阅/批注/看板/递交体检 优先，源码编辑保留但不做富工具栏" | [实测] §6 · [源码] §2.4 |
| 7 | 分享对话框的成熟结构是 **权限行 → 邀请行 → 成员列表（按权限排序）→ 链接分享**，四块独立更新；我们协作者中心已有雏形，缺"链接分享/待接受邀请"两态 | [源码] §2.2 share-modal |
| 8 | 评论/审阅面板的行业尺寸：Overleaf 面板 230px、mini 24px、气泡 280px；我们 CriticMarkup 审阅面板应对齐"行内标记 + 右侧线程 + 顶部 review 模式切换"三件套 | [源码] §2.2 review-panel |
| 9 | 官方规范给出的可点目标下限一致：M3 ≥ 48×48dp、Overleaf dropdown 项 ≥ 36px（注释写明为触屏）；我们移动端 40px 控件达标、桌面 24px 工具栏按钮需 ≥ 28px 命中区 | [官方文档][源码] §5.1 |
| 10 | 不建议换组件库：Radix + shadcn 风格已满足 16 个基础组件需求，缺的是 select/switch/tooltip/toast/tag/avatar/table/skeleton 八个文件级原语和 token → 类的映射表 | [实测][推断] §5.1 |

---

## 1. 研究方法与采样环境

### 1.1 采样环境 [实测]

| 项 | 值 |
|---|---|
| OS / 浏览器 | Ubuntu 22.04.5 · Chrome（CDP `localhost:29229`）· Playwright Python |
| 桌面视口 | 1440×900，DPR 1，`locale=zh-CN` |
| 移动视口 | 375×812，DPR 2，`isMobile+hasTouch`，iPhone UA |
| Patent Studio | `make install && make dev`；后端 `127.0.0.1:8000`，前端 `127.0.0.1:5173`；`PATENT_STUDIO_AUTH=on`、`PATENT_PROJECTS_DIR=/home/ubuntu/ps_w5/projects`（隔离 scratch，不碰 `examples/`） |
| 健康检查 | `/api/health` → `ok:true, soffice:true, pdf_backend:cli, unoserver:false` |
| 读数方式 | `getComputedStyle` 抓 body / button / input / tabs / badges / headings / dialog；另一脚本按几何过滤"横向条 ≥ 80% 宽、28–80px 高"识别顶栏/状态栏，"高 ≥ 45% 视口、宽 40–420px"识别侧栏 |

### 1.2 覆盖矩阵

| 产品 | 登录页 | 首页/列表 | 文档页 | 分享面板 | 评论 | 375 | 一手代码 | 官方规范 |
|---|---|---|---|---|---|---|---|---|
| Overleaf | [实测] | [源码] | [源码] | [源码] | [源码] | [实测]登录 + [源码] | ✅ `services/web/frontend` | — |
| Notion | [实测] | [未验证]需登录 | [实测]公开页 | [未验证] | [未验证] | [实测] | — | — |
| Google Docs | [实测]账号登录页 | [未验证] | [未验证] | [未验证] | [未验证] | [实测]登录 | — | ✅ Material 3 |
| Word for Web | [实测]Microsoft 登录页 | [未验证] | [未验证] | [未验证] | [未验证] | [实测]登录 | — | ✅ Fluent 2 |
| 飞书文档 | [实测]错误页 4401 | [未验证] | [实测]公开 docx | [未验证] | [未验证] | [实测] | — | ✅ Universe Design |
| 腾讯文档 | [实测]登录弹窗 | [实测]官网 | [实测]公开文档 | [未验证] | [未验证] | [实测] | — | ✅ TDesign（腾讯开源） |
| Typora | — | [实测]官网 | [源码]github.css | — | — | [实测]官网（无 viewport meta） | ✅ `typora-default-themes` | — |

> 需要账号的页面（Notion 工作区、Google Docs/Word 编辑器、飞书/腾讯已登录态、分享/评论面板）**没有登录**，按任务书用官方设计规范补位并在下文标注"官方页面/未登录公开状态"。

---

## 2. Overleaf（一手源码）

仓库：`/home/ubuntu/repos/overleaf`，以下路径均相对 `services/web/frontend/`。

### 2.1 Design tokens [源码]

#### 2.1.1 色板 `stylesheets/ds/colors.scss`

| 色系 | 阶 | 关键值 | 用途（Overleaf 语义变量） |
|---|---|---|---|
| neutral | 50–950 | 50 `#fafafa` · 950 `#262626` | `--content-primary/secondary`、`--bg-light-primary/secondary`、`--border-divider` |
| green | 50–950 | 50 `#f2f8f5` · 700 `#19754c` · 950 `#112c20` | 品牌/primary、tabs 激活下划线 `--green-50`(旧系) |
| red | 50–950 | 700 `#c3092b` | danger、error notification 边框 `--red-20/60` |
| blue | 50–950 | 700 `#3470a8` | info、链接 |
| yellow / teal | 50–950 | — | warning / 装饰 |

- 规律：每个色系 11 阶，语义层（`--content-*`、`--bg-*`、`--border-*`）再映射到阶；暗色主题只重绑语义层（`notification.scss` 第 7–35 行：亮色边框用 `*-20`，暗色用 `*-60`）。
- **与 Patent Studio 对照**：我们 `--n0..n9` 十阶中性 + 单一 `--primary #098842 / --primary-hover #1e6b41`，没有语义层，也没有 red/blue/yellow 阶（[实测] `frontend/src/index.css`）。

#### 2.1.2 间距 `stylesheets/ds/spacing.scss` + `foundations/spacing.scss`

| 变量 | 值 | 变量 | 值 |
|---|---|---|---|
| `--ds-base-unit` | 4px | `--spacing-05` | 12px |
| `--spacing-01` | 2px | `--spacing-06` | 16px |
| `--spacing-02` | 4px | `--spacing-07` | 20px |
| `--spacing-03` | 6px | `--spacing-08` | 24px |
| `--spacing-04` | 8px | `--spacing-09` | 32px |
| ds 层 | 50–2400 → 2/4/6/8/10/12/14/16/20/24/28/32/40/48/64/80/96px | | |

#### 2.1.3 字体 `stylesheets/ds/typography.scss` + `foundations/typography.scss`

| 项 | 值 |
|---|---|
| UI 字体 | Inter（编辑器壳、`btn-ds`）；营销/登录页 body 实测 `"Noto Sans", sans-serif` 16px/24px、`rgb(73,83,101)` |
| 字号阶（foundations） | `--font-size-01..09` = 12/14/16/18/20/24/30/36/48px |
| 字号阶（ds） | 12/14/16/18/20/24/28/32/40/56/72px |
| 行高阶 | `--line-height-01..09` = 16/20/24/28/32/40/48/64/68px |
| 字重 | 400/500/600/700 |
| body-sm mixin | 14px/20px（history change-list 使用） |

#### 2.1.4 边框/圆角/阴影/动效

| 类别 | 值 | 路径 |
|---|---|---|
| 边框宽 | 1px（base）、2px | `ds/border.scss` |
| 圆角 | 2 / 4 / 8 / 12 / 16 / 24 / 9999px；`--border-radius-base` 用于 modal、dropdown item、command palette 项 | `ds/border.scss`、`foundations/border-radius.scss` |
| shadow-sm | `0 2px 4px 0 rgb(30 37 48 / 16%)` | `foundations/elevation.scss` |
| shadow-md | `0 4px 12px 0 rgb(30 37 48 / 12%), 0 2px 4px rgb(30 37 48 / 8%)` | 同上 |
| shadow-lg | `0 8px 16px 0 rgb(30 37 48 / 12%), 0 4px 6px 0 rgb(30 37 48 / 12%)` | 同上 |
| 动效 | 按钮 transition 0.15s（登录页实测 `0.15s ×4`）；rail 面板切换**无 transition**（`rail.tsx` 注释）；PanelGroup 拖拽无动画 | [实测] + `rail.tsx` |
| 断点 | 未覆盖 `$grid-breakpoints`，沿用 Bootstrap 5 默认 sm 576 / md 768 / lg 992 / xl 1200 / xxl 1400 | grep 无覆盖 + [官方文档] Bootstrap 5 Breakpoints |

### 2.2 组件结构：props / state / ARIA / 路径 [源码]

| 组件 | 路径 | props（摘） | state / 行为 | ARIA / a11y | 尺寸 |
|---|---|---|---|---|---|
| Button | `js/shared/components/button/button.tsx` + `stylesheets/ds/components/button.scss` | `variant: primary/secondary/tertiary/danger`, `size: sm/md/lg`, `isLoading`, `loadingLabel`, `leadingIcon/trailingIcon` | loading 时渲染 spinner + 隐藏文字保持宽度 | `:focus-visible` outline；loading label 可读 | md 16px/24px、padding 4×16、radius 8；sm 14px/20px、padding 8；icon-text gap 8 |
| MaterialIcon | `js/shared/components/material-icon.tsx` | `type`, `accessibilityLabel`, `unfilled` | — | 有 label 时输出 visually-hidden 文本，否则 `aria-hidden` | 20px（rail） |
| Notification（toast/alert） | `js/shared/components/notification.tsx` + `stylesheets/components/notifications.scss` | `type: info/success/warning/error/offer`, `title`, `action`, `isDismissible`, `ariaLive: polite/off/assertive` | 图标随 type：info/check_circle/warning/error/campaign | `aria-live` 可配 | 边框色 `*-20`（亮）/`*-60`（暗） |
| Dropdown menu | `js/shared/components/dropdown/*` + `stylesheets/components/dropdown-menu.scss` | Bootstrap Dropdown 封装 | — | Bootstrap 语义 | item min-height **36px**（源码注释：touch 可达）、min-width 240 / 160；header item 44px；item radius base |
| Badge / Tag | `js/shared/components/badge/*`, `tag.tsx`, `stylesheets/components/badge.scss` | `bg`, `prepend`, `closeBtnProps` | tag 可关闭 | close 按钮有 label | line-height 16px、padding 0/4px |
| Tooltip | `js/shared/components/tooltip.tsx`（OLTooltip） | `id`, `description`, `overlayProps.placement` | hover/focus 显示 | Bootstrap tooltip role | max-width 解除限制 |
| Modal | `js/features/ui/components/ol/ol-modal.tsx` + `stylesheets/components/modal.scss` | Bootstrap Modal 封装 | — | Bootstrap focus trap；另有 `focus-trap.tsx` | radius base；padding 16/12/20 三档 |
| Pagination | `js/shared/components/pagination.jsx` + `pagination.scss` | 页码 | — | — | padding 8×16，1px `--neutral-30`，字重 600 |
| Table | `js/shared/components/table.tsx` + `table.scss` | 容器 `.table-container(-bordered)` | — | — | cell padding 8px；表头 font-weight normal |
| Spinner / Loading | `loading-spinner.tsx`, `loading-branded.tsx` | — | — | — | sm 1.25rem |
| Select | `js/shared/components/select.tsx` | 自定义 select | — | — | — |
| Tabs | `stylesheets/components/tabs.scss` | Bootstrap Nav | — | — | 激活态 **3px 底线** `--green-50`，padding 8，line-height 24 |
| Rail | `js/features/ide-react/components/rail/rail.tsx` | tabs 配置数组（file-tree/search/integrations/review/chat/modules） | `useRailContext()`：selected/open/isOpen；重复点击当前 tab → 折叠面板；`mountOnEnter`、`unmountOnExit=false` | `aria-label={t('sidebar')}`，tablist 语义 | rail 40px；tab 32×32；icon 20；指示条 3×24；gap 4 |
| RailTab | `rail/rail-tab.tsx` | `icon`, `eventKey`, `open`, `indicator`, `title` | active 图标 filled / inactive unfilled | `OLTooltip` + visually-hidden label | 同上 |
| Toolbar | `ide-react/components/toolbar/toolbar.tsx` + `stylesheets/pages/editor/toolbar-redesign.scss` | — | — | — | 高 40；home 32×32；padding 4；gap 12 |
| OnlineUsers | `toolbar/online-users.tsx` + `stylesheets/pages/editor/online-users.scss` | — | 最多 5 个头像，多余折叠为 overflow 按钮 | — | 圆 24px、边 1px、重叠 8px、容器 max 400px |
| MainLayout | `ide-react/components/layout/main-layout.tsx` | — | `PanelGroup/Panel`（react-resizable-panels）：editor 与 PDF `defaultSize=50`、`minSize=5`；拖拽/双击切换/折叠恢复 | Panel `tagName="section"` + `aria-label` | — |
| FileTree | `js/features/file-tree/components/file-tree-folder.tsx`, `file-tree-doc.tsx` + `stylesheets/pages/editor/file-tree.scss` | — | 折叠/选中/重命名/拖拽 | folder `role=treeitem aria-expanded aria-label`；doc `role=treeitem aria-label` | 行高 2.05em；工具行 28px；header 36px；item font 14/20；hover bg 变量 |
| CommandPalette | `js/features/command-palette/components/command-palette-body.tsx` + `command-palette.scss` | — | 搜索过滤 + 键盘上下 | input `aria-label="Command palette search"`；项 `role=menuitem` | input 18px、padding 12；列表 max-height 50vh；项 padding 6×8，radius base；主文 16px，副文 14px |
| ShareModal | `js/features/share-project-modal/components/share-modal-body.tsx`, `project-access.tsx` 等 | owner 权限、feature flags、members、invites | 成员按 read/write → pending editor → review → pending reviewer 排序；privilege 与 link access 分开更新 | Modal focus trap | 子组件：access / invite / members / link share / recaptcha-error |
| ReviewPanel | `js/features/review-panel-new/*` + `stylesheets/pages/editor/review-panel.scss` | — | comment / thread / change / resolve / mention / review-mode / overview / tabs / empty state | — | header 36；panel **230px**；mini **24px**；comment popover **280px** |
| History | `js/features/history/components/change-list/*`, `diff-view/*` + `history.scss` | labels、version details、users、restore | 版本列表 + diff 视图 + 标签 + 恢复 modal | — | change-list **320px**、toolbar 40px、用户 badge、body-sm 14/20 |
| Chat | `js/features/chat/components/*` | message group、input、infinite scroll | — | — | — |
| ProjectList（dashboard） | `js/features/project-list/components/project-list-ds-nav.tsx` | `DefaultNavbar`, `SidebarDsNav`, `ProjectListTable`, `SearchForm`, `NewProjectButton`, `ProjectTools`, `CurrentPlanWidget`, `UserNotifications`, `LoadMore` | 分页用 LoadMore（不是页码） | — | 列宽随 sm/md/lg/xl/xxl；移动端 `d-md-none / d-md-flex`，搜索与新建变 inline flex |

### 2.3 页面布局 [源码]

| 层 | Overleaf 做法 | 为什么（[推断]） | 我们对照（[实测] §4） |
|---|---|---|---|
| 编辑器壳 | 40px 顶栏 → 下方左 40px rail + 可折叠侧面板 + PanelGroup（编辑器/PDF 50/50，min 5%） | 顶栏承载项目名/在线/分享/编译，rail 承载工具，主区留给内容；min 5% 保证任何面板都能"几乎折叠"而不丢句柄 | 已同构：`--h-topbar:40px --w-rail:40px --w-side:209px --w-split-handle:7px --h-statusbar:24px` |
| 侧面板 | rail 选中态驱动；再次点击折叠；无动画 | 面板高频切换，动画会拖慢；不卸载保状态 | 我们 `--duration-panel:200ms`（有动画） |
| PDF 工具条 | 独立一行在 PDF 面板顶部 | 与源码工具栏对称 | 已同构：`--h-pdftb:32px` |
| 评论/历史 | 评论走 rail 面板（230px）；历史用独立 320px change-list + 全宽 diff | 历史是"模式"（替换编辑区），评论是"伴随"（贴边） | 我们历史在左侧栏下半区（[实测] 版本历史）；建议同 Overleaf 分开"模式 vs 伴随" |
| Dashboard | 左侧 nav（标签/文件夹）+ 表格 + 右上搜索/新建；`LoadMore` 而非页码 | 项目数量长尾；标签是主要组织方式 | 我们同构（案卷表 + 左侧筛选），但左侧状态筛选 11 项占满 |
| 移动端 | 编辑器无独立移动布局；`isMobileDevice()` 只用于关闭 CodeMirror 自定义右键菜单（`source-editor/extensions/context-menu.ts`）；dashboard 用 Bootstrap `d-md-*` 折叠 | Overleaf 不把手机当编辑场景 | 我们有独立 `components/mobile`（底部 Tab、bottom sheet） |

### 2.4 图标与主题化策略 [源码]

| 项 | 做法 | 路径 |
|---|---|---|
| 图标库 | Google Material Symbols（`<MaterialIcon type="..." unfilled>`），激活/非激活用 filled/unfilled 表达 | `js/shared/components/material-icon.tsx` |
| Bootstrap 5 主题化 | SCSS 变量层（`$spacing-*`, `$font-size-*`）→ 输出 CSS 变量 `--spacing-*`；组件覆盖 `--bs-*`（如 `--bs-dropdown-item-border-radius`, `--bs-border-divider`） | `stylesheets/foundations/*.scss`, `components/*.scss` |
| 暗色主题 | 同一组语义变量在 `[data-theme]` 下重绑 | `components/notifications.scss` 7–35 行 |
| 新旧并存 | `btn-ds`（新 DS）与 `btn`（旧 Bootstrap）并存，靠 class 区分 | `ds/components/button.scss` |

---

## 3. 外部产品组件卡

每张卡：**状态**（登录/未登录）→ 计算样式读数 → 截图 → 官方规范补位 → 对我们的启示。

### 3.1 Notion [实测：登录页 + 公开模板页；未登录]

截图：[登录 1440](https://app.devin.ai/attachments/f89fbfdc-942f-471b-a2ca-fa433200190e/ext-notion-login-1440.png) · [公开页 1440](https://app.devin.ai/attachments/ddf4386a-4d2f-46ad-a630-51d18aaaf06c/ext-notion-public-1440.png) · [公开页 375](https://app.devin.ai/attachments/ec5cc8f3-97f2-4a2a-9bda-790ca8ab6666/ext-notion-public-375.png)

| 元素 | 读数 | 备注 |
|---|---|---|
| 字体 | `inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica…` | 全站 Inter |
| 登录主按钮 | 360×40px，radius 8px，bg `rgb(35,131,226)`，白字 | 桌面 |
| 第三方登录按钮（375） | 335×48px，radius **12px**，1px `rgb(230,229,227)` 边，16px/600 | 移动端放大到 48 |
| 输入框 | 328×26px（内容盒），15px | 外层容器另加 padding |
| 公开页 H1 | 40px/48px | 页面标题 |
| 正文 | 16px/24px；内容列宽 **720px** | 单列、居中 |
| 顶部页面导航 | 104px（含面包屑 + 分享/CTA 行） | 公开页 |
| 模板 CTA | 128×28px，radius 6px | 小按钮 |
| 375 | 顶栏：标题 + 分享图标 + CTA + 汉堡；cover 横跨；正文左右 padding ≈ 50px；"Share to Web" 以 callout 呈现 | 只读 |

启示 [推断]：Notion 用**单一内容列 + 极少 chrome** 把注意力留给文字，按钮圆角随尺寸增大（28→6、40→8、48→12）——"圆角与高度成比例"是可借用的规则。

### 3.2 Google Docs（账号登录页）+ Material 3 [实测登录页；编辑器未登录]

截图：[登录 1440](https://app.devin.ai/attachments/ef932b4c-c1bc-407e-8670-6384a1522883/ext-google-login-1440.png) · [登录 375](https://app.devin.ai/attachments/03264c90-ca64-4db9-b3d5-a1cdf6269f89/ext-google-login-375.png) · [M3 Buttons](https://app.devin.ai/attachments/903d699d-258b-468e-9a51-32349bc61adb/ext-m3-button-1440.png)

| 元素 | 读数 [实测] |
|---|---|
| 字体 | `"Google Sans", roboto, …` 14px/20px，正文 `rgb(31,31,31)` |
| 输入框 | 456×52px，16px/24px，radius 4px（outlined text field） |
| 主按钮"下一步" | 90×40px，radius **20px**（pill），bg `rgb(11,87,208)`，padding 0 24px，transition **0.28s**；375 下同尺寸 |
| 文本按钮"忘记了邮箱？" | 86×20px，14px/500，蓝字无底 |
| H1"登录" | 36px/44px，字重 400 |

Material 3 官方规范 [官方文档]（https://m3.material.io/components/buttons/specs · https://m3.material.io/components/navigation-bar/specs · https://m3.material.io/foundations/layout/applying-layout/window-size-classes）：

| 规则 | 值 |
|---|---|
| 按钮五类 | elevated / filled / tonal / outlined / text；默认 round |
| 尺寸阶 XS/S/M/L/XL square radius | 12/12/16/28/28dp；pressed 8/8/12/16/16dp |
| 触控目标 | XS/S icon button ≥ **48×48dp** |
| 状态 | enabled / disabled / hovered / focused / pressed，全部 token 化 |
| Navigation bar | compact 窗口垂直项、medium 可水平；flexible nav bar 优先于 baseline |
| Window size classes | compact < 600dp、medium 600–839、expanded 840–1199、large 1200–1599、extra-large ≥ 1600 |

### 3.3 Word for Web（Microsoft 登录页）+ Fluent 2 [实测登录页；编辑器未登录]

截图：[登录 1440](https://app.devin.ai/attachments/18b04f3f-9269-4c54-a57c-7d7793f8f6cf/ext-ms-login-1440.png) · [Fluent 2 Button](https://app.devin.ai/attachments/ff24ead0-45e7-402d-aeb9-9a4ab3453060/ext-fluent2-button-1440.png)

| 元素 | 读数 [实测] |
|---|---|
| 字体 | `"Segoe UI", -apple-system, "Helvetica Neue", …` 15px/20px，`rgb(27,27,27)` |
| 输入框 | 348×36px，15px/20px，无圆角 |
| 主按钮 | 108×32px，bg `rgb(0,103,184)`，radius **0**，padding 4 12；375 下同尺寸 |
| 登录选项行 | 440×48px（桌面）/ 373×48px（375），padding 8 24 |
| 背景 | 全屏插画 + 居中白卡 |

Fluent 2 官方规范 [官方文档]（https://fluent2.microsoft.design/components/web/react/core/button/usage）：

| 规则 | 内容 |
|---|---|
| 按钮种类 | standard / split / menu / compound / toggle；toolbar 内用 toggle |
| 主按钮唯一 | 一个布局仅一个 primary；次要用 outline / subtle / transparent |
| 位置 | primary 在其他动作的上方或左侧 |
| 文案 | 简洁主动语态；多步流程用 Next / Previous |
| 保存 | 自动保存时不放 Save；不能自动保存必须显示 Save + 成败反馈 |
| 对比度 | 文本 ≥ 4.5:1，图标 ≥ 3:1；disabled 不要求对比度但需 tooltip 解释 |

### 3.4 飞书文档 [实测：公开 docx 页；登录页返回错误 4401，未登录]

截图：[文档 1440](https://app.devin.ai/attachments/5ea22bc8-78ca-4df6-a9d4-cf9101efe9ae/ext-feishu-docx-1440.png) · [文档 375](https://app.devin.ai/attachments/9d6b8300-5f0f-498b-ba94-f13ecb3acd7a/ext-feishu-docx-375.png) · [登录页错误态 1440](https://app.devin.ai/attachments/5dfb1c83-bbfa-4cbc-88aa-1967c4f91b04/ext-feishu-login-1440.png)

| 元素 | 桌面 1440 | 移动 375 |
|---|---|---|
| 字体 | `LarkHackSafariFont, LarkEmojiFont, LarkChineseQuote, …` | 同 |
| 正文 | **14px/21px**，`rgb(31,35,41)` | — |
| H1 | 34px/55.25px，字重 500 | **28px/40px** |
| 顶栏 | **64px** | **44px**：Logo + 登录/注册 + 协作者图标 + 汉堡 |
| 左侧目录 | 248px | 收起 |
| 正文编辑区 | **820px** | 单列，左右 padding ≈ 24px |
| 登录/注册按钮 | 84×32px，14px，radius **6px**，bg `rgb(20,86,240)` | — |
| 浮动帮助按钮 | 36×36 圆形，轻阴影 | — |

飞书 Universe Design 官方 [官方文档]（https://open.feishu.cn/document/design-specification/design-language/color?lang=zh-CN · …/component---data-entry/button/button_text）：品牌蓝 `#1456F0`；中性文字 `#1f2329`；Background 1/2/3 ≈ `#EFF0F1 / #F5F6F7 / #F8F9FA`；按钮文案规范强调"动词开头、≤ 4 字"。

### 3.5 腾讯文档 [实测：官网 + 公开只读文档 + 登录弹窗；未登录]

截图：[文档 1440](https://app.devin.ai/attachments/281b2db6-9c0b-4e63-9688-5a5bedc62f05/ext-tencent-doc-1440.png) · [文档 375](https://app.devin.ai/attachments/a8a5d181-6ad0-423f-9c17-f123bde11ca1/ext-tencent-doc-375.png) · [登录弹窗 1440](https://app.devin.ai/attachments/929a4780-666c-41d6-bd79-bbae7909f285/ext-tencent-login-1440.png) · [官网 1440](https://app.devin.ai/attachments/f55d8817-934b-4aad-b790-96dd338c92b2/ext-tencent-home-1440.png) · [TDesign 色彩](https://app.devin.ai/attachments/21b67f81-dbf8-4c9a-af4d-5be8f142e40d/ext-tdesign-color-1440.png)

| 元素 | 桌面 1440 | 移动 375 |
|---|---|---|
| 字体 | `"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", …`；body **13px**，`rgba(0,0,0,0.88)` | 同 |
| 页面背景 | `rgb(243,245,247)`（灰底衬白纸） | — |
| 顶部标题栏 | **40px** | **44px**：主页图标 + 协作者头像 + "APP 内打开" + 登录 |
| 二级 header | 52px | — |
| 格式工具栏 | **40px**，白底、radius 8px、1px rgba 边、轻阴影（浮岛） | 底部浮动工具条 ≈ 68px |
| 纸张宽 | **810px** | 单列大字号 |
| 底部状态栏 | **33px** | — |
| 工具栏按钮 | 多为 **24×24**，无圆角 | — |
| "只能查看" | 72×24px，radius 4px | — |
| "登录腾讯文档" | 108×28px，radius 4px，蓝 | — |
| 官网 header 按钮 | 96×36px，radius 4px，`rgb(30,111,255)`；plain 版白底蓝边（`dui-button`） | — |
| 登录弹窗 | 遮罩弱化页面；标题"请选择登录方式"；微信/QQ 切换；蓝色"立即登录"；下方手机号/企业微信/SSO/创建组织；底部协议勾选 | — |

启示 [推断]：腾讯把格式工具栏做成"浮岛"（白底+圆角+阴影）而不是贴边条，是为了在灰底画布上把**工具与纸张都当作对象**分层；24px 按钮 + 40px 条是中文办公软件的高密度传统，但 24px 在触屏上不达标，故移动端换成底部 68px 工具条。

### 3.6 Typora [源码 github.css + 官网实测]

截图：[官网 1440](https://app.devin.ai/attachments/39ab55d0-c40c-4027-a490-17e3123a9bc9/ext-typora-home-1440.png)

| 项 | 值 [源码 `themes/github.css`] |
|---|---|
| 正文 | 16px，`rgb(51,51,51)`，line-height 1.6，Open Sans |
| `#write` 内容列 | max-width **860px**；≥1400 视口 1024px；≥1800 视口 1200px；padding 30px，底部 100px |
| 标题 | H1 2.25em/1.2 · H2 1.75em/1.225 · H3 1.5em/1.43 |
| 链接 | `#4183C4` |
| 侧栏 | `--side-bar-bg-color: #fafafa`；`--control-text-color: #777` |
| 官网 375 | **无 viewport meta**，按 980px 渲染（`vw:982`）——官网不响应式 [实测] |

启示 [推断]：Typora 的"所见即所得单栏 + 随视口三档内容宽"是**版面视图**的直接参照：正文列宽跟视口走三档而不是无限拉伸。

### 3.7 Overleaf 登录页（线上）[实测]

截图：[1440](https://app.devin.ai/attachments/6bd78844-5169-4b08-8898-df428d8cf8ed/ext-overleaf-login-1440.png) · [375](https://app.devin.ai/attachments/4cbcae06-28aa-4924-bc1c-67cfb551ab93/ext-overleaf-login-375.png)

| 元素 | 1440 | 375 |
|---|---|---|
| 主按钮 `btn btn-ds btn-lg btn-primary w-100` | 360×44px，radius 8，16px/600，bg `rgb(38,38,38)`，transition 0.15s | 319×44px |
| 输入框 | 360×52px，radius 8，16px | 52px 高 |
| body | Noto Sans 16/24，`rgb(73,83,101)` | 同 |
| cookie bar | 绿 pill "Accept all cookies" 145×24 | 固定底部，占高较大 |

### 3.8 横向对照：登录页主按钮 / 输入框 / 字体基线 [实测]

| 产品 | 主按钮 高×圆角 | 输入框高 | 基线字号 | 品牌色 |
|---|---|---|---|---|
| Overleaf | 44 / 8 | 52 | 16 | `#262626`（登录页黑） |
| Notion | 40 / 8（375：48 / 12） | 26（内容盒） | 15–16 | `rgb(35,131,226)` |
| Google | 40 / 20 | 52 | 14 | `rgb(11,87,208)` |
| Microsoft | 32 / 0 | 36 | 15 | `rgb(0,103,184)` |
| 飞书 | 32 / 6 | — | 14 | `#1456F0` |
| 腾讯 | 28–36 / 4 | — | 13 | `rgb(30,111,255)` |
| **Patent Studio** | 36 / 4（登录）；32 / 4（新建案卷）；24 / pill（导出） | 36（登录）/ 32（搜索） | 14 | `#098842` |

---

## 4. Patent Studio 现状实测（1440 / 375）

### 4.1 截图索引 [实测]

| 页面 | 1440 | 375 |
|---|---|---|
| 登录 | [ps-1440-login](https://app.devin.ai/attachments/64490a42-1d1e-4400-a88a-04ed8dab65c7/ps-1440-login.png) | — |
| 案卷台账（表格） | [ps-1440-dashboard](https://app.devin.ai/attachments/5811e3dc-386e-4cdc-8112-db15285ccea0/ps-1440-dashboard.png) | [ps-375-dashboard](https://app.devin.ai/attachments/b2740869-714d-447f-ae39-f2929e44ba81/ps-375-dashboard.png) |
| 案卷台账（看板） | [ps-1440-dashboard-board](https://app.devin.ai/attachments/4885e464-8490-4039-a218-3a0edfc6fd77/ps-1440-dashboard-board.png) | — |
| 管理标签对话框 | [ps-1440-dashboard-rowmenu](https://app.devin.ai/attachments/212ac6c5-9588-4137-bcad-07af0393cbfa/ps-1440-dashboard-rowmenu.png)（脚本原意点行菜单，实际命中"管理标签"） | — |
| 工作台·源码 | [ps-1440-workspace-source](https://app.devin.ai/attachments/9eca0cb1-cdbd-49d9-bd9b-950047c9efb0/ps-1440-workspace-source.png) | [ps-375-workspace-edit](https://app.devin.ai/attachments/50251833-6a47-4b92-820d-aa7eb40c1f24/ps-375-workspace-edit.png) |
| 工作台·版面 | [ps-1440-workspace-layout](https://app.devin.ai/attachments/e1c4a4ac-88ba-42d3-80eb-f7f5d8ce3c69/ps-1440-workspace-layout.png) | [ps-375-workspace-预览](https://app.devin.ai/attachments/a3e140b3-c302-4b5d-8fbf-9b233939ee44/ps-375-workspace-%E9%A2%84%E8%A7%88.png) |
| 文件菜单 | [ps-1440-workspace-filemenu](https://app.devin.ai/attachments/a16250c8-ba22-4fff-b8c0-bb852f4d2ffa/ps-1440-workspace-filemenu.png) | [ps-375-workspace-nav](https://app.devin.ai/attachments/27c724cb-0613-4a97-a3cc-2875ce98fc05/ps-375-workspace-nav.png) |
| 协作者（分享） | [ps-1440-workspace-share](https://app.devin.ai/attachments/cc5f05f1-0fee-4892-ba1c-f148bc07cafb/ps-1440-workspace-share.png) | — |
| 审阅 | [ps-1440-workspace-review](https://app.devin.ai/attachments/af8da8bb-7ec3-4eb4-8a1d-932294fb2af8/ps-1440-workspace-review.png) | — |
| 版本历史 | [ps-1440-workspace-history](https://app.devin.ai/attachments/f17c08ae-2258-48dc-a499-349a3a772821/ps-1440-workspace-history.png) | — |
| AI 助手 | [ps-1440-workspace-ai](https://app.devin.ai/attachments/2bd30a98-a1ae-4979-976e-72ae80cf9c84/ps-1440-workspace-ai.png) | — |
| 问题面板 | [ps-1440-workspace-problems](https://app.devin.ai/attachments/2040f480-c91b-4916-aa9e-3e7eeccf7f6e/ps-1440-workspace-problems.png) | — |
| 设置 | [ps-1440-workspace-settings](https://app.devin.ai/attachments/dbf52085-b648-471a-86f6-fc45633c0b72/ps-1440-workspace-settings.png) | [ps-375-workspace-more](https://app.devin.ai/attachments/e6550bb4-05e3-4419-86ae-98e2c81d9916/ps-375-workspace-more.png)（更多操作 bottom sheet） |
| 递交 | [ps-1440-deliver](https://app.devin.ai/attachments/d72b820e-11b5-4f44-afdc-287a0f372bbc/ps-1440-deliver.png) | [ps-375-deliver](https://app.devin.ai/attachments/27dc1e66-d428-4525-9ebe-0639d7aa8b9d/ps-375-deliver.png) |
| 账户 | [ps-1440-account](https://app.devin.ai/attachments/ea8413b4-9490-4626-afd0-afeb7e559377/ps-1440-account.png) | [ps-375-account](https://app.devin.ai/attachments/4e50f968-cd6a-41c4-9be7-1298aaf5679a/ps-375-account.png) |
| 机构管理 | [ps-1440-admin](https://app.devin.ai/attachments/279ffd4c-2dc3-4372-9e08-8a029add031c/ps-1440-admin.png) | — |
| 控制台 Tab | — | [ps-375-workspace-控制台](https://app.devin.ai/attachments/8c132aac-6857-48c5-838f-7ecfb4288c15/ps-375-workspace-%E6%8E%A7%E5%88%B6%E5%8F%B0.png)（截图仍显示预览面板，控制台切换未验证） |

### 4.2 计算样式读数 [实测 `getComputedStyle`]

| 元素 | 1440 | 375 | 观察 |
|---|---|---|---|
| body | 14px，`rgb(27,34,44)`，白底；UI 字体 `-apple-system, PingFang SC, Noto Sans SC, Microsoft YaHei, Segoe UI, system-ui` | 同 | 中文 14px 与飞书一致 |
| 登录输入框 / 主按钮 | 36px / 4px radius；主按钮 36px 绿 | — | 与 Microsoft 36 同档，低于 Overleaf/Google 52 |
| Dashboard 搜索框 | 32px，13px 字，4px，1px `rgb(208,213,221)`，padding 4 12 4 32 | 同 | — |
| "新建案卷" | 94×32，**12px**/500，4px，绿 | 40×32（只剩图标） | 主按钮字号 12 偏小 |
| 视图切换（表格/看板） | 32×32 组按钮，圆角 4/0/0/4 | 同 | — |
| 左侧筛选项 | 203×36，13px，选中 `rgb(234,246,239)` 底 + `rgb(25,89,54)` 字，4px | 89×32 **pill** 横滚 chips | 桌面 4px、移动 pill，两种圆角 |
| 表头排序按钮 | 48×24，12px/500 | — | — |
| 状态徽章（撰写） | 56×24，14px，pill | 50×20，12px | 字号不统一 |
| 顶栏"案卷"返回 | 62×32，13px | 40×40 图标 | — |
| 顶栏"分享 · 1 在线" | 113×24，12px/600，4px，灰底 | — | 24px 高 |
| 顶栏"导出" | 90×24，**14px/600，pill**，绿 | "构建" 54×40 pill | 顶栏同一行 24 与 32 混排 |
| rail 图标按钮 | 32×32，选中 `rgb(234,246,239)`，4px | — | 与 Overleaf 32×32 同 |
| 侧栏标题"案卷文件" | 102×28，14px/600 | — | — |
| 树内小按钮 | 16×16、20×20、24×20 | — | 命中区 < 24px |
| 版面视图标题 | H2 18.67px/24.27（SimHei）、H3 16px/20.8 | — | 文档字体正确切换为黑体 |
| 状态栏 | 24px，`bg-muted`，12px | 状态 pill 22px | — |
| 移动顶栏 | — | 48px（`--h-mobile-topbar`），控件 40px | 高于飞书/腾讯 44 |
| 移动书切换（全文/摘要…） | — | 87×39 段控件 | — |
| 移动视图切换（源码/版面） | — | 72×36 pill 段控件 | 与 39 高的书切换不等高 |
| 移动底部 Tab | — | 125×55，12px，选中浅绿底 | `--h-mobile-tabs:56px` |
| 更多操作 bottom sheet | — | 项 351×44，13px | 44 达标 |
| 协作者面板 | dialog `shadow-md`，标题"协作者 · <案名>" | — | — |

### 4.3 现状问题清单（只列实测可见的）[实测 + 推断]

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P1 | 同页按钮高度 24/28/30/32/36/40 六档 | §4.2 顶栏、侧栏、树 | 视觉节律断裂；24px 不满足触屏 |
| P2 | 圆角 4px 与 pill 混用且不按尺寸规律（24 高 pill、32 高 4px、36 高 4px、40 高 pill） | §4.2 | 无法形成"圆角随尺寸"的可预期规则 |
| P3 | 主动作字号 12px（新建案卷）低于正文 14px | §4.2 | 主动作视觉权重反而最低 |
| P4 | 状态徽章 12/13/14 三种字号 | §4.2 | 同一语义组件不一致 |
| P5 | 树内 16×16 / 20×20 操作按钮 | §4.2 | 桌面命中区偏小；键盘焦点环难见 |
| P6 | 移动顶栏 48 + 书切换 39 + 视图切换 36 + 提示条 ≈ 170px chrome | 375 预览截图 | 375×812 下内容首屏 < 60% |
| P7 | 移动"排版设置"点击超时、"控制台"Tab 切换后截图仍为预览 | 脚本日志 | **未验证**是否 bug，列入 §8 |
| P8 | 版本历史挤在左侧栏下半区（≈ 200px 宽） | history 截图 | diff 无法展开；Overleaf 用 320px 列 + 全宽 diff |
| P9 | 无 red/blue/yellow 语义阶，错误/警告色靶向 Tailwind 默认 | `index.css` | 问题面板/审阅色彩无 token 约束 |

---

## 5. 四级总结："它们怎么做 / 为什么 / 我们该怎么做"

### 5.1 第一级 · 基础组件（16 项）

> 现状：`frontend/src/components/ui` 只有 button / dialog / dropdown / input / misc / sheet / tabs 七个文件 [实测 `ls`]。

| 组件 | 参考怎么做（证据） | 为什么 [推断] | 我们怎么做 [建议]（专利场景理由） |
|---|---|---|---|
| Button | Overleaf 4 variant × 3 size、radius 8、focus-visible、loading label [源码]；M3 5 类 + 5 状态 token 化 [官方文档]；Fluent 一个布局一个 primary [官方文档] | 变体数少、状态齐、尺寸阶固定，才能在几十个页面复用 | 尺寸阶 **sm 28 / md 32 / lg 36 / mobile 40**；圆角规则：≤32→4px，36–40→6px，pill 只用于状态/筛选 chip；一个视区一个 primary（顶栏是"构建/导出"，dashboard 是"新建案卷"）；loading 必带文字 |
| Input | Overleaf/Google 登录 52px、Notion 内容盒 26 + 外框、我们 32/36 [实测]；Fluent 输入不能自动保存必须给 Save 反馈 | 表单页高、工具栏内低 | 表单 36、工具栏/筛选 32、移动 40；错误态用 red 阶 + 下方 12px 说明；案号/申请号等格式化字段统一等宽数字 `tabular-nums` |
| Select | Overleaf `select.tsx` 自定义 + dropdown item ≥ 36px [源码] | 触屏可达 | Radix Select；项高 32 桌面 / 44 移动；状态选择器（撰写/复核…）复用同一 Select |
| Switch | Overleaf history `toggle-switch.tsx`（"仅显示带标签版本"）[源码] | 二值即时生效 | Radix Switch；只用于即时生效设置（如"连续页不分页"），需保存的用 checkbox |
| Menu | Overleaf dropdown min-width 240/160、item 36、header 44、radius base [源码] | 触屏 + 可读 | Radix DropdownMenu；桌面项 32、移动改 Sheet；危险项红色置底并加分隔 |
| Dialog | Overleaf modal radius base、padding 三档、focus trap [源码]；腾讯登录弹窗遮罩 + 居中 [实测] | 焦点管理 | Radix Dialog；宽 sm 400 / md 560（Overleaf `ide-redesign.scss` max-width 560）/ lg 800；标题 16/600；移动端 ≤ 640 自动转全屏 Sheet |
| Drawer | Overleaf rail 面板（230）与 history 列（320）[源码]；我们 bottom sheet 已有 [实测] | 伴随信息不遮主区 | 桌面右侧 Drawer 320（协作者/历史）；移动 bottom sheet 高 ≤ 85vh，项 44 |
| Toast | Overleaf Notification 5 类 + `aria-live` + action + dismiss [源码] | 可访问 + 可操作 | 单一 Toast 原语（success/info/warning/error）；构建成功 toast 带"打开 PDF"action；`aria-live=polite`，错误 `assertive` |
| Tooltip | Overleaf OLTooltip 全 rail/toolbar 图标必带 [源码]；Fluent disabled 需 tooltip [官方文档] | 图标不自解释 | Radix Tooltip；所有 icon-only 按钮强制 `aria-label` + tooltip；延迟 300ms |
| Tag | Overleaf `tag.tsx` 可关闭、prepend [源码] | 标签是组织维度 | 机构级标签 Tag 22px 高、12px 字、4px 圆角；颜色取 neutral 阶，不与状态徽章撞色 |
| Badge | Overleaf badge line-height 16、padding 0/4 [源码]；我们状态徽章 pill 12–14px [实测] | 状态需一眼可辨 | 状态徽章唯一规格：高 22、12px/500、pill、色 = 状态语义阶（撰写 green、复核 blue、驳回 red、待客户 yellow）；计数 Badge 16 高圆点 |
| Avatar | Overleaf 在线头像 24 圆、1px 边、重叠 8、最多 5 [源码] | 空间有限 | Avatar 24（顶栏）/ 32（列表）/ 40（账户）；首字母 + 稳定哈希色；协作者角色（editor/reviewer/viewer）用 2px 环色表达 |
| Table | Overleaf cell padding 8、表头 normal 字重、列宽随断点 [源码]；腾讯 body 13px 高密度 [实测] | 台账信息密 | 行高 40 桌面（我们现 ≈ 54，可选紧凑 36）；表头 12px/500 灰；≤ 768 转卡片列表（现状已做） |
| Pagination | Overleaf 用 LoadMore，不用页码 [源码]；`pagination.jsx` 仅营销页 | 项目长尾无需定位页 | 台账用"加载更多 + 计数"；仅审计/版本列表需页码时用 32px 页钮 |
| Empty state | Overleaf review panel empty state、我们"暂无标签"[实测] | 引导下一步 | 图标 40 + 标题 14/600 + 说明 13 + 一个主动作；空态文案说明"为什么空 + 怎么做" |
| Skeleton | Overleaf loading-branded / spinner [源码]；飞书/腾讯公开页首屏均有占位 [实测截图] | 感知性能 | PDF/版面构建 >300ms 显示与最终布局同形的骨架（纸张轮廓），不是 spinner；表格骨架 5 行 |

### 5.2 第二级 · 复合组件（9 项）

| 复合组件 | 参考怎么做 | 为什么 [推断] | 我们怎么做 [建议] |
|---|---|---|---|
| Toolbar | Overleaf 顶栏 40 / home 32 / gap 12 [源码]；腾讯格式条 40 浮岛 + 24 按钮 [实测]；飞书 64 顶栏 [实测] | 40 是"信息条"高度共识；按钮 24–32 | 顶栏 40 固定；**所有顶栏控件统一 32 高**（分享/导出/在线数），不再 24；PDF 工具条 32 保持；源码/版面编辑工具条 36 浮岛（≤ 12 个按钮，超出进"更多"） |
| File tree | Overleaf treeitem + aria-expanded、行高 2.05em、工具行 28、header 36 [源码] | 屏幕阅读器可遍历 | 行高 28、缩进 16；`role=tree/treeitem`；行内操作按钮 24 命中区 28；专利案卷固定结构（docs/figs/attachments）用**分组标题**而非普通文件夹 |
| Comment thread | Overleaf 面板 230、mini 24、气泡 280、review-mode 切换、resolve/mention [源码] | 行内标记 + 侧栏线程 | CriticMarkup 建议 = 行内高亮 + 右侧 280 卡；卡结构：头像 24 + 名 + 时间 → 引文 → 正文 → 接受/拒绝/回复；reviewer 只能生成建议（权限不变） |
| Share dialog | Overleaf access → invite → members（按权限排序）→ link share；privilege/link 独立更新 [源码]；腾讯"只能查看"pill [实测] | 分块降低认知 | 协作者中心保留；新增"链接分享（仅邀请 / 机构内）"与"待接受"分组；成员行：Avatar 32 + 名/邮箱 + 角色 Select 32 + 移除 |
| Online avatar group | Overleaf 24 圆、重叠 8、max 5 + overflow [源码] | 顶栏空间 | 顶栏"分享 · 1 在线" 改为 头像组 + 分享按钮两个对象；点头像跳到该人光标（依赖 yjs awareness，现状未验证） |
| Command palette | Overleaf input `aria-label`、项 `menuitem`、max-height 50vh、主 16 副 14 [源码]；我们版面 `/` 菜单已有 [handoff] | 键盘用户 | `Ctrl/⌘+K` 全站面板：跳转案卷 / 切换书 / 运行构建 / 插入模板；结构同 Overleaf |
| Status-badge selector | 我们 dashboard 状态列即点即改 [实测] | 台账高频操作 | Badge 触发 + Select 列表；变更写审计（现状未验证）；移动端用 Sheet |
| Kanban card | 我们看板已有 [实测截图 board] | 状态推进可视 | 卡：标题 14/600 两行截断 + 案号 12 等宽 + 负责人 Avatar 24 + 截止日 Tag；列头 = 状态徽章 + 计数；拖拽即改状态 |
| Version comparison | Overleaf 320 列表 + 全宽 diff + 标签 + 恢复 modal [源码]；我们左侧栏下半区 [实测] | 历史是"模式" | 进入历史 = 替换编辑区为 diff，右侧 320 版本列；恢复走确认 modal（写源需 editor） |

### 5.3 第三级 · 页面排版与响应式

| 主题 | 参考 | 我们怎么做 [建议] |
|---|---|---|
| 断点 | Bootstrap 5 默认 576/768/992/1200/1400 [官方文档，Overleaf 未覆盖]；M3 600/840/1200/1600 [官方文档] | 采用 **sm 640 / md 768 / lg 1024 / xl 1280**（Tailwind v4 默认，与现状 `min-[1280px]:` 一致）；行为规则：< 768 单栏 + 底部 Tab；768–1023 双栏（rail 折叠 + 单编辑区）；≥ 1024 三区（rail+侧栏+双面板）；≥ 1280 显示状态栏完整信息 |
| 侧栏宽 | Overleaf rail 40 / review 230 / history 320；飞书目录 248；我们 `--w-side:209` | 侧栏 **240**（可拖 200–400），历史/协作者 Drawer 320 |
| 内容列 | Typora 860/1024/1200 三档 [源码]；飞书 820、腾讯 810、Notion 720 [实测] | 版面视图纸张 **A4 比例、宽 794px@100%**（真实纸张，不随视口拉伸，超出则缩放）；Markdown 源码列不限宽但行宽软限 100ch |
| 密度 | 腾讯 13px/24px 按钮高密度；Overleaf 14/20 中密度 | 默认中密度（14/20，行 40）；台账提供"紧凑"开关（36 行）——代理师一屏看 20+ 案 |
| 顶栏/状态栏 | 40 / 33（腾讯）/ 24（我们） | 顶栏 40、状态栏 24 保持；移动顶栏 **44**（对齐飞书/腾讯，现 48） |
| 分栏 | Overleaf PanelGroup 50/50 min 5% [源码]；dockview 已在我们栈内 | 三视图默认：源码 50 / 版面或 PDF 50；任何面板可折叠到 rail 图标；拖拽句柄 7px 保持 |
| 动效 | Overleaf 面板无动画，按钮 150ms；Google 280ms | 颜色 150ms、面板 200ms 保持，但**面板折叠不做宽度动画**（内容重排卡顿），只做透明度 |
| 阴影 | Overleaf 三档 [源码] | 直接采用 sm/md/lg 三档；浮岛工具栏 sm、菜单 md、对话框 lg |

### 5.4 第四级 · 全站信息架构

| 页面 | 现状路由/形态 [实测] | 参考 | 建议 [建议] |
|---|---|---|---|
| 登录/注册 | 居中卡片 + 登录/注册段控件 | Overleaf/Google/MS 都是"单任务居中卡"；腾讯用弹窗 | 保持；卡宽 400；主按钮 36→40；错误行内提示 |
| 机构首页/案卷台账 | 左筛选（视图/状态/标签）+ 表格/看板 + 搜索/新建 | Overleaf dashboard 同构 | 左栏分组折叠（状态 11 项默认折叠只显示有计数的）；顶栏放"我的待办"入口 |
| 案卷工作台 | 40 顶栏 + 40 rail + 侧栏 + 双面板 + 24 状态栏 | Overleaf 编辑器 | 保持；rail 顺序：文件 / 搜索 / 审阅 / AI / 结构 / 问题 / 设置（高频在上） |
| 协作者中心 | dialog | Overleaf share modal | 转为右侧 Drawer 320（不遮文档） |
| 版本历史 | 左侧栏下半区 | Overleaf 历史模式 | 改为"历史模式" |
| 递交页 | 独立页 | — | 保持独立页；体检结果用 Table + 状态徽章 |
| 账户 / 机构管理 | 独立页 | Overleaf settings | 左侧二级导航 200 + 表单列 640 |
| 导航模型 | hash 路由 + 顶栏返回 | Overleaf：顶栏 home + 项目名 | 面包屑：机构 › 案卷 › 书；移动端顶栏只留返回 + 标题 + 主动作 + 更多 |

---

## 6. 移动端专章（375）

### 6.1 各产品在 375 下的做法 [实测截图]

| 产品 | 导航 | 底部 Tab / 工具条 | 编辑限制 | 评论/审阅 |
|---|---|---|---|---|
| Notion 公开页 | 顶栏：标题 + 分享 + CTA + 汉堡 | 无 | 只读；"Share to Web" callout | 未验证（需登录） |
| 飞书公开 docx | 44px：Logo + 登录/注册 + 协作者 + 汉堡；首屏 hero 插画 | 无 | 只读；H1 28/40，padding 24 | 未验证 |
| 腾讯公开文档 | 44px：主页 + 协作者头像 + "APP 内打开" + 登录 | 底部浮动工具条 ≈ 68px | 只读 + 引导 APP | 未验证 |
| Overleaf 登录页 | Logo 居中 | cookie bar 固定底部 | 编辑器无移动布局；仅 `isMobileDevice()` 关右键菜单 [源码] | — |
| Google 登录 | 单列表单 | — | 按钮尺寸与桌面相同（40） | — |
| Microsoft 登录 | 单列表单 | — | 按钮 32 不变；选项行 48 | — |
| Typora 官网 | 无 viewport meta，980 渲染 | — | — | — |
| **Patent Studio** | 48px：返回 + 汉堡 + 标题 + 构建 + 头像 + 更多 | 底部 Tab 56（编辑/预览/控制台）+ "在源码中编辑" 悬浮按钮 | 源码可编辑（CodeMirror）；版面只读 | 审阅面板未在 375 采样 [未验证] |

### 6.2 我们应支持的移动场景 [建议，理由标注]

| 场景 | 角色 | 形态 | 理由 |
|---|---|---|---|
| 查看案卷台账 / 推进状态 | 代理师、合伙人 | 卡片列表 + 状态 Badge Sheet | 通勤/客户现场看进度（handoff §6x 案件台账是首页） |
| 审阅与批注 | 复核人/合伙人 | 版面视图 + 长按选区 → 评论 Sheet；CriticMarkup 建议接受/拒绝 | 复核是移动端最合理的"轻写"；对标产品移动端都以只读+评论为主 [实测] |
| 看 PDF / 定位回源 | 所有 | PDF Tab + 点选文字 → 高亮对应源段 | 老板原话 1："最少应该可以实现选择文字对应就指向哪里" |
| 递交体检 | 代理师 | 只读结果 Table + 徽章 | 提交前最后确认 |
| 轻量源码修改 | 代理师 | CodeMirror 单栏，工具条只留 `##`/列表/保存 | 现状已有 40px 按钮；不做富工具栏 |
| AI 助手对话 | 代理师 | 全屏 Sheet 聊天，建议以 CriticMarkup 落到源 | AI 不静默改源 |

### 6.3 移动表单与控件建议 [建议]

| 项 | 规格 | 依据 |
|---|---|---|
| 顶栏 | 44px；左返回、中标题（单行截断）、右 1 主动作 + 更多 | 飞书/腾讯 44 [实测] |
| 底部 Tab | 56px；3–4 项；图标 24 + 12px 文字；选中浅绿底（现状） | M3 navigation bar compact [官方文档] |
| 控件高 | 40（现状），列表项 44 | Overleaf dropdown 36 触屏注释 [源码]；M3 48 目标 [官方文档] |
| 段控件 | 统一 36 高（现书切换 39、视图切换 36 不一致） | §4.2 |
| chrome 预算 | 顶栏 44 + 段控件 36 + 底 Tab 56 = 136px，内容 ≥ 83% | §4.3 P6 |
| Sheet | 高 ≤ 85vh，项 44，标题 13/600 灰（现状） | §4.2 |
| 键盘 | 输入聚焦时隐藏底部 Tab | 375×812 下软键盘占 ≈ 300px [推断] |

---

## 7. 规则

### 7.1 component_rules（≤ 30）

| # | 规则 | 依据 |
|---|---|---|
| C1 | 按钮只有四种尺寸：sm 28 / md 32 / lg 36 / mobile 40，禁止其他高度 | §4.3 P1；Overleaf sm/md/lg |
| C2 | 圆角随尺寸：≤ 32 → 4px，36–40 → 6px，pill 仅用于状态/筛选 chip | Notion 28/40/48 → 6/8/12；§4.3 P2 |
| C3 | 一个视区只有一个 primary 按钮，其余用 secondary/ghost | Fluent 2 |
| C4 | 主动作字号不低于正文 14px | §4.3 P3 |
| C5 | 所有 icon-only 按钮必须同时有 `aria-label` 与 tooltip | Overleaf RailTab/MaterialIcon |
| C6 | 桌面可点目标命中区 ≥ 28px，移动 ≥ 40px，列表项 ≥ 44px | Overleaf dropdown 36 注释；M3 48 |
| C7 | 焦点态用 2px 外描边（`:focus-visible`），不靠颜色变化 | Overleaf btn-ds |
| C8 | loading 按钮保持宽度并输出可读 loading 文本 | Overleaf Button `loadingLabel` |
| C9 | 输入框三档高：工具栏 32 / 表单 36 / 移动 40；错误态红阶边框 + 12px 说明文字 | §3.8 |
| C10 | 案号/申请号/日期/计数使用 `tabular-nums` 等宽数字 | 台账列对齐 [推断] |
| C11 | Select 与 Menu 的项高统一：桌面 32、移动 44 | Overleaf 36 触屏注释 |
| C12 | 危险菜单项红色、置底、前加分隔线 | Overleaf danger variant |
| C13 | Dialog 三档宽 400 / 560 / 800，≤ 640 视口自动转全屏 Sheet | Overleaf modal 560 max |
| C14 | Dialog 必有焦点陷阱和 Esc 关闭 | Overleaf focus-trap |
| C15 | 伴随信息（协作者、历史列表、评论线程）用右侧 320 Drawer，不用居中 Dialog | Overleaf 230/320 |
| C16 | Toast 四类（success/info/warning/error）、`aria-live` polite，错误 assertive，可带一个 action | Overleaf Notification |
| C17 | Tooltip 延迟 300ms，仅文字，不放交互控件 | Overleaf OLTooltip |
| C18 | 状态徽章唯一规格：高 22、12px/500、pill、色按状态语义阶 | §4.3 P4 |
| C19 | 标签 Tag 与状态徽章不共用色系：Tag 用 neutral 阶，徽章用语义阶 | Overleaf tag/badge 分离 |
| C20 | Avatar 三档 24 / 32 / 40；在线头像组最多 5 个 + 溢出计数，重叠 8px | Overleaf online-users |
| C21 | 表格单元 padding 8×12，行高 40，紧凑 36；表头 12px/500 灰 | Overleaf table 8px |
| C22 | 列表分页用"加载更多 + 已显示/总数"，页码仅审计/版本 | Overleaf LoadMore |
| C23 | 空态 = 图标 40 + 标题 + 一句原因 + 一个主动作 | Overleaf empty state |
| C24 | 骨架屏形状 = 最终布局形状（纸张/表格行），>300ms 才显示 | 飞书/腾讯首屏占位 |
| C25 | 图标库唯一：lucide-react；尺寸 16（行内）/ 20（rail、工具栏）/ 24（移动 Tab） | Overleaf 20px rail 图标 |
| C26 | 颜色只通过语义 token（`--content-*`/`--bg-*`/`--border-*`/`--status-*`）消费，组件不直接写色值 | Overleaf 语义层 |
| C27 | 阴影三档 sm/md/lg：浮岛工具栏 sm、菜单 md、对话框 lg | Overleaf elevation |
| C28 | 颜色过渡 150ms，面板显隐只做透明度 200ms，不做宽度动画 | Overleaf 无 transition rail |
| C29 | 树节点 `role=treeitem` + `aria-expanded`，行高 28，行内操作命中 28 | Overleaf file-tree |
| C30 | 所有 UI 原语来自 `components/ui` 单一目录（Radix + shadcn 风格），新增 select/switch/tooltip/toast/tag/avatar/table/skeleton 八文件，不引第二套 | 任务书硬约束 + §5.1 |

### 7.2 page_rules（≤ 20）

| # | 规则 | 依据 |
|---|---|---|
| L1 | 断点 sm 640 / md 768 / lg 1024 / xl 1280；< 768 单栏 + 底部 Tab，768–1023 双栏，≥ 1024 三区 | Tailwind v4 默认 + 现状 `min-[1280px]` |
| L2 | 桌面顶栏 40、状态栏 24、rail 40、PDF 工具条 32 固定；移动顶栏 44、底部 Tab 56 | Overleaf / 飞书 / 腾讯 |
| L3 | 顶栏内所有控件同高 32，垂直居中，左右 padding 8 | §4.3 P1 |
| L4 | 侧栏默认 240，可拖 200–400；Drawer 320 | Overleaf 230/320，飞书 248 |
| L5 | 版面视图纸张按真实 A4（794px@100%）渲染，视口不足时整体缩放而非重排 | 硬约束"不用 HTML 近似替代"+ Typora 三档列宽反例 |
| L6 | 源码视图行宽软限 100ch，超出灰色标尺提示 | [推断] 便于对照版面 |
| L7 | 三视图任何面板可折叠为 rail 图标，双击句柄恢复 50/50 | Overleaf PanelGroup |
| L8 | 拖拽句柄 7px，hover 显示 1px 高亮线 | 现状 `--w-split-handle` |
| L9 | 版本历史是"模式"：进入即替换编辑区为 diff + 右侧 320 版本列 | Overleaf history |
| L10 | 协作者/评论是"伴随"：右侧 Drawer，不遮文档 | Overleaf review panel |
| L11 | 台账页左栏分组可折叠，状态组默认只展示计数 > 0 的项 | §5.4 |
| L12 | 表格 < 768 转卡片；卡片 = 标题两行 + 案号等宽 + 徽章 + 负责人头像 | 现状 + §5.2 kanban |
| L13 | 页面主内容最大宽 1280 居中（台账、账户、递交），工作台全宽 | Notion 720 / 飞书 820 内容列 [推断为表单页] |
| L14 | 表单页单列，标签在上，字段宽 ≤ 640 | 账户/机构管理 |
| L15 | 移动端 chrome 预算 ≤ 140px（顶栏 44 + 段控件 36 + Tab 56），首屏内容 ≥ 80% | §4.3 P6 |
| L16 | 移动端主动作固定右上（构建/导出），次动作进"更多"Sheet | 飞书/腾讯顶栏 |
| L17 | 输入聚焦时隐藏底部 Tab，Sheet 高 ≤ 85vh | §6.3 |
| L18 | 面包屑：机构 › 案卷 › 书；移动端只显示当前层 + 返回 | Overleaf 顶栏 home + 项目名 |
| L19 | 每页只有一个 H1（14–16px/600 在 UI 壳内；文档正文标题由 `patent_docx` 样式决定，不受 UI 字号阶约束） | 版面视图 H2 18.67 SimHei 实测 |
| L20 | 所有页面 1440 与 375 均需截图走查，axe 无 serious/critical | 任务书 |

---

## 8. 未验证项与已知误差

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| U1 | Notion 工作区首页、编辑页、分享、评论 | 未登录 | 只采到登录页与公开模板页 |
| U2 | Google Docs 编辑器、分享、评论 | 未登录 | 只采到账号登录页；用 Material 3 官方规范补位 |
| U3 | Word for Web 编辑器 | 未登录 | 只采到 Microsoft 登录页；用 Fluent 2 补位 |
| U4 | 飞书登录页真实表单 | 返回"无效的请求参数 4401" | 两条入口（passport / 官网）均未见表单 |
| U5 | 飞书 / 腾讯 已登录态首页、分享、评论 | 未登录 | 腾讯只采到登录弹窗 |
| U6 | 腾讯文档工具栏 hover 态 | 选择器未命中 | 基础尺寸已测，hover 未测 |
| U7 | Patent Studio 移动"排版设置"可操作性 | 点击超时 | 只确认在 Sheet 中可见 |
| U8 | Patent Studio 移动"控制台"Tab | 截图仍显示预览 | 未确认切换是否成功 |
| U9 | Patent Studio 审阅面板 375 | 未采样 | — |
| U10 | Patent Studio yjs awareness 光标跟随、状态变更审计 | 未验证 | §5.2 建议依赖此能力 |
| U11 | Overleaf 线上编辑器（登录态）真实渲染 | 未登录 | 全部编辑器结论来自源码而非线上截图 |
| U12 | Overleaf `btn`（旧）与 `btn-ds`（新）线上哪个为主 | 源码并存 | 登录页实测 `btn-ds` |
| U13 | Google 375 输入框/文本按钮完整读数 | 截图有、JSON 只取前 6 项 | 主按钮读数已入表 |
| U14 | 各产品动效时长（除按钮 transition） | 未测 | 面板/菜单动画未逐帧采样 |
| U15 | 对比度数值 | 未用工具计算 | 只有色值，未算比值 |

误差说明：外部页面为 2026-09-06 线上版本，含 A/B 与地区差异；`getComputedStyle` 读数受字体回退影响（本机无 PingFang/Segoe，实际渲染 Noto Sans CJK）。

---

## 9. 证据索引

### 9.1 源码路径

| 编号 | 路径 |
|---|---|
| E1 | `overleaf/services/web/frontend/stylesheets/ds/colors.scss` |
| E2 | `overleaf/services/web/frontend/stylesheets/ds/spacing.scss`、`foundations/spacing.scss` |
| E3 | `overleaf/services/web/frontend/stylesheets/ds/typography.scss`、`foundations/typography.scss` |
| E4 | `overleaf/services/web/frontend/stylesheets/ds/border.scss`、`foundations/border-radius.scss`、`foundations/elevation.scss` |
| E5 | `overleaf/services/web/frontend/js/shared/components/button/button.tsx`、`stylesheets/ds/components/button.scss` |
| E6 | `overleaf/services/web/frontend/js/shared/components/{material-icon,notification,tooltip,tag,table,select,pagination}.tsx` |
| E7 | `overleaf/services/web/frontend/stylesheets/components/{dropdown-menu,modal,badge,tabs,table,pagination,notifications,loading-spinner}.scss` |
| E8 | `overleaf/services/web/frontend/js/features/ide-react/components/layout/main-layout.tsx` |
| E9 | `overleaf/services/web/frontend/js/features/ide-react/components/rail/{rail,rail-tab}.tsx`、`stylesheets/pages/editor/rail.scss` |
| E10 | `overleaf/services/web/frontend/js/features/ide-react/components/toolbar/{toolbar,online-users}.tsx`、`stylesheets/pages/editor/{toolbar-redesign,online-users}.scss` |
| E11 | `overleaf/services/web/frontend/js/features/file-tree/components/{file-tree-folder,file-tree-doc}.tsx`、`stylesheets/pages/editor/file-tree.scss` |
| E12 | `overleaf/services/web/frontend/js/features/command-palette/components/command-palette-body.tsx`、`stylesheets/pages/editor/command-palette.scss` |
| E13 | `overleaf/services/web/frontend/js/features/share-project-modal/components/{share-modal-body,project-access}.tsx` |
| E14 | `overleaf/services/web/frontend/stylesheets/pages/editor/review-panel.scss`、`js/features/review-panel-new/` |
| E15 | `overleaf/services/web/frontend/js/features/history/components/{change-list,diff-view}/`、`stylesheets/pages/editor/history.scss` |
| E16 | `overleaf/services/web/frontend/js/features/project-list/components/project-list-ds-nav.tsx`、`stylesheets/pages/project-list.scss` |
| E17 | `overleaf/services/web/frontend/js/features/source-editor/utils/isMobileDevice.ts`、`extensions/context-menu.ts` |
| E18 | `typora-default-themes/themes/github.css` |
| E19 | `patent-studio/frontend/src/index.css`、`frontend/src/components/ui/`、`docs/handoff-context.md` |

### 9.2 官方文档

| 编号 | URL |
|---|---|
| E20 | https://m3.material.io/components/buttons/specs |
| E21 | https://m3.material.io/components/navigation-bar/specs |
| E22 | https://m3.material.io/foundations/layout/applying-layout/window-size-classes |
| E23 | https://fluent2.microsoft.design/components/web/react/core/button/usage |
| E24 | https://open.feishu.cn/document/design-specification/design-language/color?lang=zh-CN |
| E25 | https://open.feishu.cn/document/design-specification/component---data-entry/button/button_text?lang=zh-CN |
| E26 | https://getbootstrap.com/docs/5.3/layout/breakpoints/ （Overleaf 未覆盖 `$grid-breakpoints`） |
| E27 | https://developer.android.com/guide/topics/large-screens/support-different-screen-sizes |

### 9.3 实测截图

见 §3 各卡与 §4.1 表内链接（43 张，全部为 `app.devin.ai/attachments` URL，无 base64）。
