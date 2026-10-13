# W6 prep 契约（`devin/w6-prep`，2026-09-06）

prep 独占共享文件（单元不改）：`frontend/src/index.css` · `components/ui/**` · `lib/hash.ts` · `lib/utils.ts` · `store/ui.ts` · `store/layout.ts` · `layout/presets.ts` · `types/case.ts` · `App.tsx` · `components/ds/DesignSystemPage.tsx` · `components/shell/DesktopShell.tsx` · `scripts/lint-tokens.mjs` · `docs/design-system/05-w6-spec.md` 与 `w6-*/**`。
单元需要改这些文件 → 在 unit 输出的 `integration_requests` 里写明（挂点 + 原因），由集成会话统一处理。

对照面：`#/__ds`（`DesignSystemPage.tsx`）= 规格总表 + 全部原语 + 复合组件占位，亮暗切换、`?panel=<id>` 演示伴随栏。

## 1. Token 层（index.css）

| 组 | CSS 变量 | Tailwind 工具类 |
|---|---|---|
| 原始灰阶 | `--g0…--g11`（hue 255） | 不直接用；经语义层 |
| 四层面 | `--bg-app / --bg-panel / --bg-sunken / --bg-elevated / --bg-hover / --bg-active / --bg-selected / --bg-inverse` | `bg-app bg-panel bg-sunken bg-elevated bg-hover bg-active bg-selected bg-inverse`（selected ↔ `--color-selected`） |
| 前景 | `--fg-strong / --fg / --fg-muted / --fg-subtle / --fg-disabled / --fg-icon / --fg-inverse / --fg-on-brand / --link` | `text-fg-strong text-fg text-fg-muted … text-link` |
| 纸面（恒白） | `--paper` = `oklch(1 0 0)` 亮暗同值 · `--paper-fg` · `--paper-canvas` | `bg-paper text-paper-fg bg-paper-canvas`；`[data-slot='paper']` 已带阴影 |
| 边框 / 焦点 | `--border / --border-strong / --ring` | `border-border border-border-strong outline-ring` |
| 品牌 | `--brand-50…--brand-900`、`--primary / --primary-hover / --primary-active / --primary-soft` | `bg-primary hover:bg-primary-hover text-primary-foreground bg-primary-soft` |
| 7 语义族 | `--{info,ok,warn,danger,violet,teal,orange}-{fg,bg,dot}`；danger 实底按钮另有 `--danger-solid / --danger-solid-hover / --danger-solid-fg`（白字 ≥ 6:1，不得用 `--danger-dot` 做 hover） | `text-info-fg bg-info-bg bg-info-dot … bg-danger-solid` |
| 10 状态 | `--st-{intake,drafting,review,client_review,final,filed,oa,granted,rejected,closed}-{fg,bg,dot}`；元素上加 `data-status=<CaseStatus>` 即得 `--status-fg/bg/dot` | 用 `<StatusDot>`，不要手写 |
| 3 热度 | `--heat-{0,1,2}-{fg,bg}`；`data-heat=0|1|2` 得 `--heat-fg/bg` | 用 `<Heat>` / `<Countdown>` |
| 字阶 | `--fs-2xs 11 / xs 12 / sm 13 / md 14 / lg 16 / xl 20 / 2xl 24 / 3xl 28` + 行高 | `text-2xs text-xs text-sm text-base text-lg text-xl text-2xl text-3xl`；禁 `text-[Npx]` |
| 控件 5 档 | `--h-xs 24 / --h-sm 28 / --h-md 32 / --h-lg 36 / --h-touch 44` | `h-xs-control h-sm-control h-md-control h-lg-control h-touch`，`size-touch min-h-touch min-w-touch`；**`h-10` / 40px 禁用** |
| 行高 | `--row-h 40 / --row-h-compact 36 / --row-h-tree 28 / --row-h-menu 32 / --row-h-mobile 48` | `h-row h-row-compact min-h-row-mobile` |
| 壳 | `--h-topbar 40 / --h-statusbar 24 / --w-rail 40 / --w-side 240(200–400) / --w-companion 360(320–480) / --h-pdftb 32 / --h-panel-header 32 / --h-mobile-topbar 44 / --h-mobile-tabs 56` | `h-topbar h-statusbar w-rail w-side w-companion h-pdftb h-panel-header h-mobile-topbar h-mobile-tabs` |
| 圆角 | `--r-xs 3 / sm 4 / md 6 / lg 8 / xl 12 / full` | `rounded-xs rounded-sm rounded-md rounded-lg rounded-xl rounded-full` |
| 阴影 | `--sh-sm / --sh-md / --sh-lg / --sh-paper`（暗色内含 1px 环） | `shadow-sm shadow-md shadow-lg shadow-paper` |
| 动效 | `--dur-fast 120 / --dur-color 150 / --dur-panel 200 / --ease`；reduced-motion → 0ms | `duration-(--dur-color) ease-(--ease)`，或 `lib/utils.ts` 的 `TRANSITION_COLOR / FOCUS_RING` |
| z | `--z-sticky 10 / panel 20 / overlay 40 / popover 50 / toast 60` | `z-sticky z-panel z-overlay z-popover z-toast`；禁数字 z |
| 密度 | `<html data-density>`：≥768 取设置 compact/comfortable，<768 由 App `DensitySync` 强制 `touch`（所有页，不只 MobileShell）；`[data-density='touch']` 把 xs/sm/md/lg 控件统一升 44、行 48 | 单元不用管；用尺寸档类即可；硬写 `h-7`/`h-[40px]` 会绕过升档（lint 拦） |

`pnpm lint:tokens`（`make check` 内）拦：散落 hex / rgb / hsl / oklch（index.css 外）、`text-[Npx]`、`h-[Npx] w-[Npx] p-[Npx]`、`h-10 / w-10 / size-10`、9/10px 字号、内联 `style={{color/background}}`、数字 `z-[n]`。

## 2. 原语（components/ui）

| 原语 | 契约要点 |
|---|---|
| `Button` | `size` xs/sm/md/lg/xl（+ `icon-xs/icon-sm/icon/icon-lg/icon-xl`）；`variant` primary/secondary/soft/ghost/danger/link（旧 default/outline/destructive 仍映射）；`loading` → `aria-busy`；`asChild` |
| `SplitButton` | `{children, menu: <DropdownMenuItem…/>, menuLabel, size sm–xl, variant, menuAlign}`；`data-slot=split-button(-main|-trigger|-menu)` |
| `Input / Textarea` | `size` sm/md/lg/xl（xl = 16px 字，登录 / 移动）；`aria-invalid` 红边 |
| `Select*` | Radix 自定义菜单；`SelectTrigger size sm/md/lg/xl` |
| `Segmented` | `{options, value, onValueChange, size md|xl, 'aria-label'}`；`role=radiogroup`，←/→/Home/End；'sm'/'lg' 兼容输入按 md 渲染 |
| `Tabs*` | `TabsList variant="underline"(默认)|"pill"`，`size md|xl`；面板头用 underline |
| `Badge` | `tone` neutral/brand/info/ok/warn/danger/violet/teal/orange/outline（旧 `variant` 映射）；`data-tone` |
| `Tag` | 案卷标签：`{color?: string(数据色，只做色点), onRemove?}` |
| `Count` | `{value, max=99, size sm|md, tone neutral|brand|danger|inverse, showZero}`；0 隐藏 |
| `StatusDot` | `{status: CaseStatus, variant plain|badge, size sm|md, label?}` → `data-slot=status-dot data-status=…`；**任何状态渲染都用它** |
| `StatusBadge` | @deprecated 过渡 re-export（`data-slot=status-badge`，`dotOnly` 被忽略仍出文字）；单元迁完后删 |
| `Heat` / `heatOf(days)` / `heatLabel` | 3 档：>30 → 0，7<d≤30 → 1，≤7 或逾期 → 2；`{daysLeft | level, size sm|md}` |
| `Countdown` | `{daysLeft, size md|lg}` → `剩 N 天 / 逾期 N 天 / 今天`，tabular-nums，`data-heat` |
| `EmptyState` | `{icon: LucideIcon, title, reason?, action?, size sm|md}`；md = 56 容器 + 32 图标 |
| `PageHeader` | `{title, description?, breadcrumb?, meta?, primary?, actions?, size md|lg, sticky?}`；非工作台页统一页头，`primary` 是本页唯一 primary |
| `Sheet*` / `BottomDrawer` | `SheetContent side=right|left|bottom`；bottom ≤85dvh r12 顶角 + 抓手；`bottom-drawer.tsx` 仅 re-export |
| `CompanionPanel` | `{id, title, icon?, actions?, onClose, width, onWidthChange?, presentation column|sheet-right|sheet-bottom, resizable}`；`clampCompanionWidth`、`COMPANION_WIDTH_*` |
| `Alert` | `variant` default/info/ok/warn/danger（旧 success/warning/destructive 映射）；文字取该族 `-fg`（on `-bg` ≥ 6:1，亮暗皆过 axe） |
| 其余 | `Dialog(400/560/800) Popover Tooltip Kbd Toast Progress Skeleton Avatar Checkbox Switch RadioGroup Field Label Separator Breadcrumb ScrollArea Table DataTable Command Collapsible Toggle*` 同 W5 API，样式走 token |

冒烟测试：`components/ui/__tests__/w6-primitives.test.tsx`（尺寸档 class / 状态属性 / 键盘 / axe）。

## 3. 伴随栏（CompanionPanel）契约

- **store（`store/ui.ts`，经 `@/store` 导出）**：`companion: CompanionId | null`（不持久化，默认 null）· `companionWidth`（持久化，clamp 320–480，默认 360）· `openCompanion(id) / closeCompanion() / toggleCompanion(id) / setCompanionWidth(px)` · `COMPANION_IDS / isCompanionId`。
  `CompanionId = 'ai' | 'review' | 'history' | 'console' | 'problems' | 'terms' | 'figures' | 'search' | 'deadlines' | 'notify'`。
  1024–1279 打开伴随栏自动收起侧栏（`companionAutoCollapsedSide`），关闭恢复。
- **hash（`lib/hash.ts`）**：`#/p/<pid>?panel=<CompanionId>`（`COMPANION_PARAM='panel'`，`ProjectQuery.panel`）；`projectHash(pid, {panel})`、`goWorkbench(pid, {panel})`、`writeCompanionHash(panel|null)`；`clearProjectQuery()` 保留 `?panel`。`#/__ds?panel=<id>` 演示用。
- **同步**：`shell/CompanionHost.tsx` 的 `useCompanionHashSync` — 进入带 `?panel=` 的工作台即 open；hashchange 去掉参数即 close；store 变化 replace 回写。单元**不要**自己写 hash。
- **挂点**：`lib/slots.ts` `registerCompanionBody(id, Body, Actions?)` / `useCompanionBodies()`。单元在模块顶层注册一次，正文自滚、12px 内边距由壳给、**无 primary 按钮**。未注册 id 显示占位 EmptyState（`data-testid=companion-placeholder-<id>`）。
- **壳**：`DesktopShell` 第 4 栅格列（`data-testid=companion-column`，dockview 外侧）渲染 `<CompanionHost presentation="column"/>`；`MobileShell` 渲染 `<CompanionHost presentation={≥640 ? 'sheet-right' : 'sheet-bottom'}/>`。工作台默认关。
- **触发**：rail / 顶栏图标调用 `toggleCompanion(id)`（rail 项走 `registerRailItem`）。

## 4. 其余既有挂点（W5 保留）

`lib/slots.ts`：`registerEditorExtension` · `registerLayoutDecoration` · `registerPdfOverlay` · `registerTopBarItem` · `registerRailItem` · `registerHomeMobileSlot`；`layout/registry.ts registerPanel`（dockview 面板种类）；`store/layout.ts` 预设 `LAYOUT_PRESETS`（三视图 ≥1680 由 editor-threeview 用 `layout-pdf` 预设 + `useMediaQuery('(min-width:1680px)')`）。

## 5. 八单元速查

| 单元 | 可用原语 / 挂点 | 契约要点 |
|---|---|---|
| shell-workbench | `CompanionHost` 已在两壳；`registerCompanionBody('console'|'problems'|'terms'|'figures'|'search')`；`toggleCompanion`；`SplitButton`（顶栏「构建」唯一 primary）；`Tabs underline`（面板头）；`StatusDot`（状态栏点 + 文字，无实底） | 不改 DesktopShell 栅格；rail 40 / 侧栏 240 / 顶栏 40 / 状态栏 24 已是 token |
| dashboard | `PageHeader`（`primary`=新建案件）、`StatusDot`（列头 = 点 + 名 + `Count`）、`Heat`/`Countdown`（期限列）、`Tag`、`DataTable`（行 `h-row` 40 / 紧凑 36）、`EmptyState`；`registerCompanionBody('deadlines'|'notify')`；`registerHomeMobileSlot` | 今日摘要条 32 用 `Count`+文字；看板空列折叠 40（`h-row`）；<640 表格→卡片 |
| editor-threeview | `Tabs underline`（<1680 版面进 Tab）、`Segmented md`（视图切换）、`Kbd`、`Countdown`（定位头无）、`registerEditorExtension / registerLayoutDecoration / registerPdfOverlay`；`--h-pdftb 32`（`h-pdftb`）；纸面 `bg-paper text-paper-fg` 恒白，画布 `bg-paper-canvas` | 三栏仅 ≥1680（`useMediaQuery`）；编辑器默认 14px/1.7（`--editor-font-size` clamp 11–20） |
| collab-review-history | `registerCompanionBody('review')`、`registerCompanionBody('history')`；`Avatar`、`Badge tone`、`Tag`、`Sheet`（移动评论） | CriticMarkup 颜色只用 `--ok/--danger/--info/--violet` 族 |
| ai-panel | `registerCompanionBody('ai', AgentBody, AgentActions)`；`Button soft/ghost`（无 primary）、`Skeleton`、`Progress`、`Badge`、`Count` | Proposal 卡 r8 sh-sm；面板头 actions 只放 ghost icon |
| deliver-admin-account | `PageHeader`（primary=「递交」/「保存」）、`DataTable`、`Dialog`（400/560/800）、`Alert`、`Select`（tokenized）、`Field`、`Switch`、`Tabs underline` | 页边 32（`px-page-x`，`max-w-page` = 1280）；一屏一个 primary |
| auth-client-public | `Input size="xl"`（16px）、`Button size="xl" variant="primary"`、`Alert`（行内错误）、`Field`；登录卡 `max-w-100 rounded-xl shadow-md`；客户审阅页 `PageHeader size="md"` + 固定底部动作条（`h-16`，primary「确认定稿」） | 375 单栏，品牌区压缩不隐藏 logo；`bg-app` 品牌区 / `bg-panel` 表单卡 |
| mobile-shell | `MobileShell` 根已 `data-density="touch"`（控件自动 44）；`Sheet side=bottom`（`BottomDrawer` 兼容）、`Segmented size="xl"`、`Button size="xl"`、`CompanionHost` Sheet 形态已接 | 顶栏 44 / 底 Tab 56 token；快捷键盘 `min-h-touch`；PDF 长按 Sheet 用 `Sheet side=bottom` |

## 6. 验收命令

`make check`（ruff + oxlint + lint-tokens + tsc + pytest + vitest + vite build）· `make zero-drift` · `make roundtrip`；浏览器：`#/__ds` 亮 / 暗 / 375、首页、工作台无控制台错误；375 可点控件 ≥ 44；纸面暗色仍白。
