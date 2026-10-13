# 设计系统 01 · 技术栈选型与 Tokens 草案（波次 5 研究课题「stack」）

- 分支：`devin/w5-research-stack`（基于 `devin/wave4-integrated` = `20e29ca`）
- 作者角色：frontend-engineer（资深前端架构）+ ui-designer
- 日期：2026-09-06
- 性质：**研究与选型文档，不改产品代码**。所有候选库的安装 / tsc / build 实测在临时 worktree `spike/w5-stack` 上完成，不 push。
- 读法：每条结论后有「证据」列，等级如下

| 等级 | 含义 | 举例 |
|---|---|---|
| **E1 实测** | 本机 `pnpm` 安装 + `tsc` + `vite build` 得到的数字；浏览器亲眼看到的截图；`culori`/axe 跑出来的值 | §3、§4、§6 |
| **E2 一手文档** | 官方文档 / 官方 changelog / GitHub 仓库元数据（`gh api`）/ npm registry 发布时间 | 链接均在 §11 |
| **E3 推断** | 基于 E1/E2 的工程判断，明确标「推断」 | 迁移工期、触发条件 |

---

## 0. 决策一览（decisions）

| # | 主题 | 决定 | 一句理由 | 证据 |
|---|---|---|---|---|
| D1 | UI 组件基座 | **保留 Radix Primitives + shadcn 风格（自有源码）**；补组件走 shadcn `radix` 变体；**不迁** Base UI / Ark / Radix Themes | 单一原语硬规则 + 216 个组件文件已建在 Radix 上；shadcn 官方 2026-07 明言「Radix 不弃用、无需迁移、每个新组件双库同发」；Base UI 多 +21.7 kB gzip 且零收益 | E1 §4.1、E2 [S3][S4] |
| D2 | Radix 包形态 | 9 个 `@radix-ui/react-*` **一次性合并为 `radix-ui@1.6.7` 单包**（shadcn 现行写法） | 体积实测相同（93.2 vs 93.3 kB gzip），避免新旧两种 import 风格并存 | E1 §4.1 |
| D3 | 图标 | **lucide-react 唯一图标库**（现已 157 个在用）；PDF/DOCX/XML 三个文件类型标记用 `Badge` 文字而非品牌图标 | 34 个专利场景概念覆盖 31/34；缺的 3 个（PDF/Word/微信）都是品牌/文件类型类，lucide 设计原则不收品牌图 | E1 §4.2 |
| D4 | 图表 | **Recharts 3.10.1 + shadcn `chart` 封装（ChartContainer/ChartTooltip）** | 台账统计只需柱/饼/折线/进度；SVG 可用 CSS 变量着色、可被 axe 读到；ECharts tree-shake 后仍 +181 kB gzip，是 Recharts 的 1.7 倍 | E1 §4.3、E2 [S6] |
| D5 | 动效 | **CSS 过渡 + `tw-animate-css`（已有）为唯一动效层**；`motion` 不进 wave 5；Auto-Animate 不引入 | 现有 38 处 `transition-*`/`animate-in` 覆盖全部需求；motion 全量 +39.8 kB、mini +25.1 kB 无对应场景；全局 `prefers-reduced-motion` 已在 index.css | E1 §4.4 |
| D6 | 字体 | **界面用系统栈（不自托管中文）；等宽源码自托管 JetBrains Mono Variable（0.2 MB）**；正文 PDF 字体只走后端 `make fonts` | Noto Sans SC 变量字体 4.6 MB，私有部署内网首屏不可接受；系统栈 PingFang/微软雅黑/Noto CJK 全平台有中文；只有等宽字体在各系统差异大 | E1 §4.5 |
| D7 | 颜色空间 | **tokens 全部改写为 OKLCH**，数值用 `culori` 从现 hex 等值转换（视觉零变化），新色（十档状态）在 OKLCH 直接生成 | Tailwind v4 / shadcn 默认 OKLCH；等亮度阶梯可算；对比度用 `culori.wcagContrast` 自动校验 | E1 §6.1、E2 [S1][S9] |
| D8 | 深色模式 | 保留现 `.dark` class + `@custom-variant dark`，token 双值；十档状态色深色版一并生成并校验 | 现机制已工作（截图 dashboard-dark / workbench-dark），只补 token | E1 §2、§6.2 |
| D9 | 对比度校验 | 加 `culori@4.0.2`（devDependency）+ 一个 vitest 用例解析 `index.css` 断言语义配对 ≥4.5:1 | 现 32 个语义色仅靠注释里的手算值；实测已有 1 处失守（`--n5` placeholder 白底 2.98） | E1 §6.1 表 C |
| D10 | 表单 | **不引入 react-hook-form + zod**；用受控原生表单 + 新增 `Field`/`FieldError` UI 组件 + 后端 422 → 字段错误映射 | 19 个表单几乎都 ≤3 字段；校验权威在 Pydantic；RHF+zod +31.4 kB 只换来第二套 schema | E1 §4.7 |
| D11 | 表格 | **`@tanstack/react-table@9.2.4`** 用于案件台账（排序/筛选/列显隐/多选） | headless、+11.8 kB gzip、v9 features API 在 React 19 + tsc 下通过 | E1 §4.8 |
| D12 | 命令面板 | **`cmdk@1.1.1`** + shadcn `Command` 封装 | 老板要求「快捷键/命令」；+15.9 kB；shadcn 官方组件基础 | E1 §4.9、E2 [S11] |
| D13 | 虚拟列表 | **`@tanstack/react-virtual@3.14.10`** 仅用于 >200 行的台账与版本历史 | +7.3 kB；10 000 行 demo 构建通过 | E1 §4.10 |
| D14 | 日期与期限 | **`date-fns@4.4.0` + `@date-fns/tz@1.4.1`**；期限规则（送达推定 / 顺延 / 法定节假日）做成纯函数模块 `lib/deadline.ts`，节假日表为数据 | v4 原生时区（`TZDate`）保证期限按 Asia/Shanghai 算；+9.2 kB | E1 §4.11、E2 [S12] |
| D15 | Toast | 保留现有 zustand `toast()` + `Toasts.tsx`（已有 `aria-live`），不引入 sonner | 已工作且有测试；sonner +9.8 kB 无增量价值 | E1 §4.12 |
| D16 | 字号阶 | 收敛为 6 档 `--fs-2xs..--fs-xl`（11/12/13/14/16/20），取缔 `text-[10px]`（15 处）与 `text-[11px]`（74 处） | 现有 9 种字号写法；10px 中文不可读 | E1 §2.3 |
| D17 | 间距 / 圆角 / 阴影 / z-index | 4pt 栅格；圆角 3 档（4/6/8）；阴影 3 档不变；z-index 收敛为 6 个命名层 | 现 z 值 10/20/50/60 混用 | E1 §2.3、§6.4–6.6 |
| D18 | 断点 | 沿用 Tailwind 默认 sm 640 / md 768 / lg 1024 / xl 1280；**桌面/移动分界 = lg 1024**（与 `DESKTOP_QUERY` 一致） | 代码里 lg: 48 处、sm: 42 处已是事实标准 | E1 §2.3 |

**new_deps（全部满足「发布 ≥7 天」）**

| 包 | 版本 | 发布日期 | 用途 | 增量 gzip（相对 baseline） |
|---|---|---|---|---|
| `radix-ui` | 1.6.7 | 2026-07-24 | 合并 9 个 `@radix-ui/react-*` | ±0（93.2 → 93.3 kB） |
| `recharts` | 3.10.1 | 2026-07-25 | 台账统计图 | +105.8 kB（含 3 种图） |
| `@tanstack/react-table` | 9.2.4 | 2026-08-28 | 案件台账表格 | +11.8 kB |
| `@tanstack/react-virtual` | 3.14.10 | 2026-08-18 | 长列表虚拟化 | +7.3 kB |
| `cmdk` | 1.1.1 | 2025-03-14 | 命令面板 | +15.9 kB |
| `date-fns` | 4.4.0 | 2026-05-29 | 日期/期限 | +9.2 kB（含 tz） |
| `@date-fns/tz` | 1.4.1 | 2025-08-12 | Asia/Shanghai 期限 | （同上） |
| `@fontsource-variable/jetbrains-mono` | 5.3.0 | 2026-07-19 | 源码等宽字体自托管 | JS +0.1 kB；woff2 约 0.2 MB |
| `culori`（dev） | 4.0.2 | 2025-06-27 | tokens 对比度校验脚本 / 测试 | 仅 dev |
| `@types/culori`（dev） | 4.0.1 | — | 类型 | 仅 dev |

**不引入**：`@base-ui/react`、`@radix-ui/themes`、`@ark-ui/react`、`@phosphor-icons/react`、`@tabler/icons-react`、`@remixicon/react`、`echarts`、`echarts-for-react`、`@visx/*`、`chart.js`、`react-chartjs-2`、`motion`、`@formkit/auto-animate`、`react-hook-form`、`zod`、`@hookform/resolvers`、`sonner`、`@fontsource-variable/noto-sans-sc`、`@fontsource-variable/inter`。

---

## 1. 范围与方法

| 项 | 内容 |
|---|---|
| 目标 | 为「桌面 1440 + 移动 375 同一 Web」全站统一设计系统做有证据的选型，并给出 tokens 草案 + 迁移表 + 组件清单 |
| 不做 | 不改 `frontend/src`；不定页面布局（属 benchmark/three-view 课题）；不开 PR |
| 硬约束 | 单一 UI 原语；Tailwind v4；a11y（axe 无 serious/critical、对比度 ≥4.5:1、键盘可达）；新依赖成熟主流且发布 ≥7 天；正文预览字体与界面字体隔离 |
| 实测环境 | Ubuntu 22.04.5 · Node 22.23.2 · pnpm 11.9.0 · Vite 8.2.2 · React 19.2.8 · Tailwind 4.3.3 · TypeScript（仓库 `tsconfig.app.json`） |
| Spike 方法 | `git worktree add ~/w5-stack/spike spike/w5-stack`；`pnpm add` 全部候选；每个候选一个最小入口 `frontend/spike/entries/*.tsx`（真实渲染 1–3 个组件）；`spike/tsconfig.json` 继承 `tsconfig.app.json` 跑 `tsc`；`spike/measure.mjs` 用 Vite programmatic `build()` 逐入口构建并 `gzipSync` 统计；`baseline.tsx` = React 19 + ReactDOM 空挂载 |
| 现状对照 | `PATENT_PROJECTS_DIR=~/w5-stack/projects PATENT_STUDIO_AUTH=on make dev`；`/api/health` 返回 `soffice:true unoserver:true`；Chrome CDP 在 1440×900 与 375×812 截图；axe-core 4.13.0（仓库自带）跑 wcag2a/2aa/21aa |

---

## 2. 现状盘点（E1）

### 2.1 截图（1440 / 375，浅色 + 深色）

| 页面 | 1440 | 375 | 备注 |
|---|---|---|---|
| 登录 | [login-1440](https://app.devin.ai/attachments/b81e4ac9-47b4-44fb-8e87-9f6b1d6cc690/login-1440.png) | [login-375](https://app.devin.ai/attachments/619868c8-597d-405f-9275-363a9a5f3fe0/login-375.png) | 邮箱密码登录，`.test` 域名被后端 422 拒绝（用 `example.com` 注册） |
| 案卷台账 `#/` | [dashboard-1440](https://app.devin.ai/attachments/40854277-b86c-4344-aaf2-4e415270cb37/dashboard-1440.png) · [深色](https://app.devin.ai/attachments/50ed12da-cfab-41f8-8fd4-3f033535f45f/dashboard-dark-1440.png) | [dashboard-375](https://app.devin.ai/attachments/b46cdf76-363f-4e9e-8a5d-df02cc3dcbcf/dashboard-375.png) | 十档状态只用 5 种 tone（见 2.4）；移动端筛选 chips 横向溢出 |
| 工作台 `#/p/method` 源码+PDF | [workbench-1440](https://app.devin.ai/attachments/0c3bbffd-ce2a-41fd-b44d-f3f2233121f1/workbench-1440.png) · [深色](https://app.devin.ai/attachments/5c535aaa-ef4a-4f3d-9be0-76af6ae419d4/workbench-dark-1440.png) | [workbench-375](https://app.devin.ai/attachments/449b6548-59e0-4c59-b2ea-6cde46230e63/workbench-375.png) | 真实 LibreOffice PDF（22 页，docx 574 ms / pdf 990 ms） |
| 工作台 版面视图 | [workbench-layout-1440](https://app.devin.ai/attachments/47093b64-5650-47a6-87f5-c2ea3bb94d3d/workbench-layout-1440.png) | — | ProseMirror 版面 |
| 工作台 PDF 全宽 | [workbench-pdf-1440](https://app.devin.ai/attachments/cc907847-7483-44a2-8668-3cfeb919b6fe/workbench-pdf-1440.png) | [mobile-preview-375](https://app.devin.ai/attachments/46d41c6e-e664-44da-934c-03c8e89aa798/workbench-mobile-preview-375.png) | react-pdf 文字层 |
| 工作台 设置面板 | [workbench-settings-1440](https://app.devin.ai/attachments/b1849f48-7459-4402-b2f5-e3462f4c870d/workbench-settings-1440.png) | [mobile-console-375](https://app.devin.ai/attachments/b22f878c-9c56-466f-aad0-a653604c1b34/workbench-mobile-console-375.png) | |
| 递交页 | [deliver-1440](https://app.devin.ai/attachments/3ae50230-9fcb-478a-a843-7d5b30fdcd43/deliver-1440.png) | [deliver-375](https://app.devin.ai/attachments/7ba4eeda-57f2-4ff5-9981-a99f1305ff64/deliver-375.png) | |
| 账户 | [account-1440](https://app.devin.ai/attachments/be0ae53d-792e-4785-aa67-3b49a8760875/account-1440.png) | [account-375](https://app.devin.ai/attachments/60e04405-37e1-498d-8289-249a77585bb0/account-375.png) | |
| 机构管理 | [admin-1440](https://app.devin.ai/attachments/c371cefb-b1b6-426c-a69a-80d14dcb77e8/admin-1440.png) | [admin-375](https://app.devin.ai/attachments/5fee2263-5635-460f-8508-4f12bf9f2de1/admin-375.png) | 成员「头衔」是原生 `<select>`（`components/admin/MemberTable.tsx:40`），与 Radix Select 并存 |

### 2.2 现有依赖（`frontend/package.json`）

| 类别 | 现状 | 版本 |
|---|---|---|
| 原语 | `@radix-ui/react-{dialog,dropdown-menu,scroll-area,select,separator,slot,switch,tabs,tooltip}` 共 9 包 | 1.1.23 / 2.1.24 / 1.2.18 / 2.3.7 / 1.1.15 / 1.3.3 / 1.3.7 / 1.1.21 / 1.2.16 |
| 样式工具 | `class-variance-authority` 0.7.1 · `clsx` 2.1.1 · `tailwind-merge` 3.6.0 · `tw-animate-css` 1.4.0 | |
| 图标 | `lucide-react` ^1.39.0（157 个不同图标在用，`rg` 统计） | |
| 构建 | `vite` 8.2.2 · `@tailwindcss/vite` 4.3.3 · `tailwindcss` 4.3.3 | |
| a11y | `axe-core` 4.13.0 | |
| 已有 build 基线 | `index-*.js` 2 429 kB（gzip 761.5 kB）· `DockviewHost-*.js` 415 kB（gzip 98.8 kB）· `index-*.css` 108 kB（gzip 20.1 kB）· `pdf.worker.min.mjs` 1 046 kB | `pnpm build` 实测 |

### 2.3 样式用法统计（`rg` on `frontend/src`，E1）

| 维度 | 实测 | 问题 |
|---|---|---|
| 字号类 | `text-xs` 406 · `text-sm` 172 · `text-[11px]` 74 · `text-base` 37 · `text-[10px]` 15 · `text-[13px]` 10 · `text-lg` 9 · `text-[15px]` 3 · `text-xl` 1 | 4 种任意值绕开 token；10px 中文不可读 |
| 圆角类 | `rounded` 114 · `rounded-md` 86 · `rounded-full` 70 · `rounded-sm` 47 · `rounded-lg` 15 · `rounded-xl` 4 · `rounded-xs` 2 | `sm`/`md`/默认 三者都映射 4px（index.css `--radius-sm/--radius-md: var(--radius)`），语义重复 |
| z-index | `z-50` 10 · `z-10` 9 · `z-20` 2 · `z-[60]` 1（Toasts） | 无命名层；Toasts 用任意值 |
| 断点 | `lg:` 48 · `sm:` 42 · `md:` 14 · `xl:` 7 · `max-lg:` 5；`store/ui.ts` `DESKTOP_QUERY='(min-width: 1024px)'` | 分界一致（lg），可直接定为规范 |
| 硬编码色 | `#ef4444` 6 · `#eaf6ef` 4 · `#b83a33` 2 · `#3b82f6` 1 · `#f9f1f1` 1 · `#f4f5f6` 1；Tailwind 调色板 `amber-*` 8 处 | 应替换为 token（`--destructive`、`--primary-soft`、`--warning-*`） |
| 动效 | `transition-colors` 36 · `transition-transform` 8 · `transition-opacity` 6 · `animate-in` 9 · `fade-in` 8 · `animate-out` 6 · `zoom-in*` 5 · `slide-in-from-*` 5 | 全部是 CSS/tw-animate-css，无 JS 动效库 |
| 原生控件 | `<select>` 1（MemberTable）· `<input type="date">` 2（FilingDialog、CreateProjectDialog） | 日期用原生是正确的（移动端原生选择器最好），保留 |
| 表单 | `<form>` 19 个，绝大多数 ≤3 字段 | 见 §4.7 |
| 日期格式化 | 自写 `fmtRelative/fmtClock/fmtTime` 3 份（`shell/format.ts`、`review/reviewUtils.ts`、`deliver/DeliverReport.tsx`），`new Date(` 20 处，无日期库 | 期限计算尚未实现 |

### 2.4 案件状态色现状（`frontend/src/types/case.ts`）

十档 `CaseStatus` 只映射到 5 个 tone：`intake/closed→neutral`、`drafting→info`、`review/client_review→warning`、`final/filed/granted→primary`、`oa/rejected→destructive`。截图 dashboard-1440 左栏可见：内审 = 客户确认、定稿 = 已递交 = 授权、审查意见 = 驳回 同色，**无法一眼区分**。→ §6.2 十档色。

### 2.5 axe 冒烟（axe-core 4.13.0，wcag2a/2aa/21aa，E1）

| 路由 | 1440 | 375 |
|---|---|---|
| `#/` 台账 | 0 违规 | 0 |
| `#/p/method` 工作台 | 0 | **1 serious**：`scrollable-region-focusable`（`footer` 状态栏可滚动但不可聚焦） |
| `#/p/method/deliver` | 0 | 0 |
| `#/admin` | 0 | 0 |
| `#/account` | 0 | 0 |

结论：现状 a11y 基线良好；唯一 serious 是移动端状态栏，属 three-view/移动课题修复项，与选型无关。

### 2.6 现有 `components/ui` 清单

| 文件 | 导出 | 原语 | 备注 |
|---|---|---|---|
| `button.tsx` | `Button`, `buttonVariants` | `@radix-ui/react-slot` + cva | variant: default/destructive/outline/secondary/ghost/link；size: default(h-9)/sm(h-8)/lg(h-10)/icon/icon-sm |
| `dialog.tsx` | `Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription` | react-dialog | |
| `sheet.tsx` | `Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, sheetVariants` | react-dialog | side 变体 |
| `dropdown.tsx` | `DropdownMenu, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator` | react-dropdown-menu | 缺 CheckboxItem/RadioItem/Sub |
| `input.tsx` | `Input, Label, Textarea` | 原生 | |
| `tabs.tsx` | `Tabs, TabsList, TabsTrigger, TabsContent` | react-tabs | |
| `misc.tsx` | `Switch, Tooltip*, Select*, Badge, Separator` | switch/tooltip/select/separator | Badge 用 lucide `Check/ChevronDown` |

---

## 3. Spike 实测总表（E1）

所有入口 `tsc -p spike/tsconfig.json` **通过**；`vite build` 全部 **成功**；原项目 `tsc -b` 与 `pnpm build` 在装入全部候选依赖后仍通过（说明候选与现有依赖树无 peer 冲突）。

| 入口 | 候选 | 版本 | 发布日期 | JS gzip | Δ vs baseline | CSS gzip |
|---|---|---|---|---|---|---|
| baseline | React 19 + ReactDOM 空挂载 | 19.2.8 | 2026-07-21 | 59.3 kB | 0 | 0 |
| ui-radix-current | 现 9 个 `@radix-ui/react-*`（Dialog/Select/Tooltip/DropdownMenu/Tabs） | 见 §2.2 | 2026-07-24 | 93.3 kB | +34.0 kB | 0 |
| ui-radix-unified | `radix-ui` 单包同 5 组件 | 1.6.7 | 2026-07-24 | 93.2 kB | +33.9 kB | 0 |
| ui-base-ui | `@base-ui/react` 同 5 组件 | 1.7.0 | 2026-08-04 | 115.5 kB | +56.2 kB | 0 |
| ui-ark | `@ark-ui/react` 同 5 组件 | 5.39.1 | 2026-08-28 | 111.1 kB | +51.8 kB | 0 |
| ui-radix-themes | `@radix-ui/themes` Theme+Dialog+Select+Tooltip+DropdownMenu+Tabs | 3.3.0 | 2026-01-31 | 108.9 kB | +49.6 kB | **81.2 kB** |
| icons-lucide | 12 个图标 | 1.39.0 | 2026-09-01 | 62.3 kB | +3.0 kB | 0 |
| icons-tabler | 12 个图标 | 3.46.0 | 2026-07-28 | 61.8 kB | +2.5 kB | 0 |
| icons-remix | 12 个图标 | 4.9.0 | 2026-01-29 | 66.3 kB | +7.0 kB | 0 |
| icons-phosphor | 12 个图标 | 2.1.10 | 2025-05-22 | 83.1 kB | +23.8 kB | 0 |
| chart-recharts | Bar+Pie+Line+ResponsiveContainer | 3.10.1 | 2026-07-25 | 167.7 kB | +108.4 kB | 0 |
| chart-echarts | `echarts/core` tree-shake Bar+Pie+Line+Canvas | 6.1.0 | 2026-05-19 | 245.0 kB | +185.7 kB | 0 |
| chart-echarts-full | `echarts-for-react` 全量 | 3.0.6 | 2026-01-21 | 433.3 kB | +374.0 kB | 0 |
| chart-visx | `@visx/xychart` Bar+Line | 4.0.0 | 2026-06-11 | 95.6 kB | +36.3 kB | 0 |
| chart-chartjs | `chart.js` + `react-chartjs-2` Bar+Pie+Line | 4.5.1 / 5.3.1 | 2025-10-13 / 10-27 | 119.3 kB | +60.0 kB | 0 |
| motion-motion | `motion/react` motion+AnimatePresence+useReducedMotion | 13.1.1 | 2026-08-20 | 100.0 kB | +40.7 kB | 0 |
| motion-mini | `motion/react-m` + LazyMotion(domAnimation) | 13.1.1 | 2026-08-20 | 85.0 kB | +25.7 kB | 0 |
| motion-auto-animate | `@formkit/auto-animate` | 0.10.0 | 2026-07-10 | 62.1 kB | +2.8 kB | 0 |
| form-rhf-zod | RHF + zod + resolvers | 7.87.0 / 4.5.4 / 5.9.1 | 2026-08-30 / 08-29 / 08-17 | 91.4 kB | +32.1 kB | 0 |
| form-zod-only | `zod` | 4.5.4 | 2026-08-29 | 79.8 kB | +20.5 kB | 0 |
| form-zod-mini | `zod/mini` | 4.5.4 | 2026-08-29 | 63.5 kB | +4.2 kB | 0 |
| table-tanstack | `useTable` + sorting feature | 9.2.4 | 2026-08-28 | 71.4 kB | +12.1 kB | 0 |
| virtual-tanstack | `useVirtualizer` 10 000 行 | 3.14.10 | 2026-08-18 | 66.7 kB | +7.4 kB | 0 |
| cmdk | `Command` 全套 | 1.1.1 | 2025-03-14 | 75.6 kB | +16.3 kB | 0 |
| date-fns | addMonths/addDays/isWeekend/format(zhCN)+TZDate | 4.4.0 / 1.4.1 | 2026-05-29 / 2025-08-12 | 68.7 kB | +9.4 kB | 0 |
| toast-sonner | `Toaster` + `toast()` | 2.0.8 | 2026-08-09 | 69.1 kB | +9.8 kB | 0 |
| fonts-fontsource | Noto Sans SC + Inter + JetBrains Mono variable | 5.3.0 | 2026-07-19 | 59.3 kB | +0.05 kB | **46.8 kB**（仅 @font-face 声明；woff2 另计：Noto SC 4.6 MB / Inter 1.2 MB / JBMono 0.2 MB，`du -shL`） |
| color-culori | `oklch/formatHex/wcagContrast` | 4.0.2 | 2025-06-27 | 74.0 kB | +14.7 kB | 0 |

> 注：§0 表中的 Δ 采用另一次 `measure.mjs` 运行（baseline 57.9 kB）的数值，两次运行差异 ≤1.5 kB，量级结论不变。发布日期来自 `pnpm view <pkg> time`。

### 3.1 维护活跃度（`gh api repos/...`，2026-09-06 取样，E2）

| 仓库 | Stars | 最近 push | Open issues |
|---|---|---|---|
| radix-ui/primitives | 19 245 | 2026-08-08 | 349 |
| mui/base-ui | 10 830 | 2026-09-05 | 430 |
| chakra-ui/ark | 5 374 | 2026-09-05 | 11 |
| shadcn-ui/ui | 123 110 | 2026-09-04 | 1 965 |
| lucide-icons/lucide | 24 362 | 2026-09-04 | 498 |
| tabler/tabler-icons | 21 604 | 2026-09-03 | 106 |
| Remix-Design/RemixIcon | 8 344 | 2026-04-28 | 602 |
| phosphor-icons/react | 1 744 | 2026-01-06 | 20 |
| recharts/recharts | 27 544 | 2026-09-04 | 442 |
| apache/echarts | 67 247 | 2026-09-04 | 1 519 |
| airbnb/visx | 21 034 | 2026-06-22 | 149 |
| chartjs/Chart.js | 67 683 | 2026-05-27 | 588 |
| motiondivision/motion | 33 498 | 2026-09-02 | 108 |
| formkit/auto-animate | 13 913 | 2026-07-10 | 42 |
| react-hook-form/react-hook-form | 44 848 | 2026-09-04 | 10 |
| colinhacks/zod | 43 846 | 2026-09-05 | 58 |
| TanStack/table | 28 409 | 2026-08-31 | 63 |
| TanStack/virtual | 7 099 | 2026-08-26 | 117 |
| pacocoursey/cmdk | 12 950 | 2025-10-29 | 75 |
| date-fns/date-fns | 36 644 | 2026-08-30 | 1 004 |
| Wombosvideo/tw-animate-css | 797 | 2026-02-28 | 18 |
| emilkowalski/sonner | 12 937 | 2026-08-10 | 74 |

---

## 4. 逐项选型

### 4.1 UI 组件基座

| 维度 | 现 Radix + shadcn 风格（自有源码） | 完整 shadcn/ui 组件集（radix 变体） | Radix Themes | Ark UI / Park UI | Base UI |
|---|---|---|---|---|---|
| 单一原语 | ✅ 已是唯一原语 | ✅ 同一原语，只是多拷贝组件 | ❌ 自带样式层 + 全局 CSS，与 Tailwind token 双轨 | ❌ 第二套原语（Zag.js 状态机） | ❌ 第二套原语 |
| Tailwind v4 | ✅ `@theme inline` 已在用 | ✅ 官方 v4 文档 [S1] | ⚠️ 自带 CSS 81.2 kB gzip（实测），主题变量与 Tailwind 不通 | ✅ 无样式 | ✅ 无样式 |
| a11y | Radix WAI-ARIA 实现；现状 axe 0 serious（桌面） | 同左 | 同 Radix | Zag.js 官方称 accessible [S5] | v1.7.0 changelog 含 a11y 修复 [S4] |
| 维护 | push 2026-08-08，发布 2026-07-24，WorkOS 维护 [S10] | shadcn 每个新组件双库同发 [S3] | 3.3.0 2026-01-31，7 个月无版本 | 5.39.1 2026-08-28 | 1.8.0 2026-09-04，最活跃 |
| 体积（5 组件） | 93.3 kB | 93.3 kB | 108.9 + 81.2 CSS | 111.1 kB | 115.5 kB |
| 迁移成本（E3 推断） | 0 | 每补一个组件 10–30 分钟 | 全站重写样式 | 7 个 ui 文件 + 216 个消费者文件 import/props 改写 | 同 Ark |
| API 风格 | `Dialog.Trigger/Content` | 同 | `<Dialog.Root>` + `size/variant` props | `Dialog.Backdrop/Positioner/Content` | `Dialog.Popup/Positioner`（实测入口） |

**关键外部事实（E2）**

- shadcn 2026-07 changelog：「Base UI 成为新项目默认」，但同页写明「Radix is not being deprecated… every update and new component will ship for both libraries」「You do not need to migrate… we're not migrating」，`-b radix` 一个 flag 保持 Radix [S3]。
- shadcn Tailwind v4 文档：「Tailwind v4 and React 19」、`@theme inline`、OKLCH、`tw-animate-css` 代替 `tailwindcss-animate`；组件是项目源码而非隐藏抽象 [S1][S2]。
- Radix Themes 官方：pre-styled，需要引入 `@radix-ui/themes/styles.css` 并包 `<Theme>` [S7]。
- Ark UI 官方：基于 Zag.js 的跨框架 headless 组件 [S5]。
- Base UI 官方 releases：v1.7.0 2026-08-04；v1.0.0 稳定版 35 个 unstyled components [S4]。

**结论 D1/D2**：保留 Radix；补组件用 `pnpm dlx shadcn@latest add <name> -b radix`（或手抄 radix 变体源码），并把 9 个包合并为 `radix-ui` 单包——shadcn registry `new-york-v4/dialog.json` 实查 `dependencies: ["cn","radix-ui"]`、源码 `import { Dialog as DialogPrimitive } from "radix-ui"`（E1 `curl` [S17]），体积相同。**Base UI 是唯一有资格的替代者**，重评触发条件（E3）：Radix 连续 ≥6 个月无 npm 发布，或 shadcn 出现「仅 Base UI 才有」且本项目必需的组件。

### 4.2 图标库

| 维度 | lucide-react（现用） | Phosphor | Tabler | Remix |
|---|---|---|---|---|
| 图标数（E1，导出名统计） | 2 046 | 1 510 × 6 weights（prop 切换） | 5 184 outline + 1 057 filled | 1 538 line + 1 538 fill |
| 12 个图标 gzip 增量 | +3.0 kB | +23.8 kB（weights 全打进） | +2.5 kB | +7.0 kB |
| 专利场景 34 概念覆盖（E1 精确名匹配） | **31/34**，缺 PDF / Word 文件类型、微信 | 34/34 | 34/34 | 33/34，缺印章 |
| 风格 | 2px 描边、24 网格，与 shadcn 默认一致 | 圆润、多 weight | 1.5–2px 描边、密 | 线/面双版 |
| 维护 | push 2026-09-04，1.41.0 2026-09-04 | react 包 push 2026-01-06 | 2026-09-03 | 2026-04-28 |
| 迁移成本 | 0（157 个在用） | 157 处改名 | 157 处改名 | 157 处改名 |

34 概念覆盖细表（E1）：

| 场景 | lucide | Phosphor | Tabler | Remix |
|---|---|---|---|---|
| 案卷文件 | FileText | FileText | IconFileText | RiFileTextLine |
| PDF 文件 | ❌ | FilePdf | IconFileTypePdf | RiFilePdfLine |
| Word/DOCX | ❌ | FileDoc | IconFileTypeDoc | RiFileWordLine |
| XML/代码 | FileCode | FileCode | IconFileTypeXml | RiFileCodeLine |
| 印章/官方 | Stamp | Stamp | IconRubberStamp | ❌ |
| 法律/权利要求 | Scale | Scales | IconScale | RiScalesLine |
| 签名/定稿 | FileSignature | Signature | IconSignature | RiQuillPenLine |
| 证书/授权 | Award | Certificate | IconCertificate | RiMedalLine |
| 期限/日历 | CalendarClock | CalendarCheck | IconCalendarClock | RiCalendarScheduleLine |
| 沙漏/待审 | Hourglass | Hourglass | IconHourglass | RiHourglassLine |
| 批注/审查意见 | MessageSquareText | ChatText | IconMessage | RiChat1Line |
| 版本历史 | History | ClockCounterClockwise | IconHistory | RiHistoryLine |
| 差异/对比 | FileDiff | GitDiff | IconFileDiff | RiGitPullRequestLine |
| 附图 | Image | Image | IconPhoto | RiImageLine |
| 公式 | Sigma | Sigma | IconMath | RiFormula |
| 表格 | Table | Table | IconTable | RiTableLine |
| AI 助手 | Bot / Sparkles | Robot | IconRobot | RiRobot2Line |
| 协作成员 | Users | Users | IconUsers | RiGroupLine |
| 机构 | Building2 | Buildings | IconBuilding | RiBuildingLine |
| 递交 | Send | PaperPlaneTilt | IconSend | RiSendPlaneLine |
| 导出 | Download | Download | IconDownload | RiDownloadLine |
| 权限 | Lock / ShieldCheck | Lock | IconLock | RiLockLine |
| 命令面板 | Command | Command | IconCommand | RiCommandLine |
| 拖拽手柄 | GripVertical | DotsSixVertical | IconGripVertical | RiDraggable |
| 分栏 | Columns2 / PanelLeft | Columns | IconColumns2 | RiLayoutColumnLine |
| 三视图 源/版/PDF | Code / LayoutTemplate / FileText | Code / Layout / FileText | IconCode / IconLayout / IconFileText | RiCodeLine / RiLayoutLine / RiFileTextLine |
| 深浅主题 | Sun / Moon | Sun / Moon | IconSun / IconMoon | RiSunLine / RiMoonLine |
| 状态-授权 | CircleCheck | CheckCircle | IconCircleCheck | RiCheckboxCircleLine |
| 状态-驳回 | CircleX / Ban | XCircle | IconCircleX | RiCloseCircleLine |
| 状态-OA | MessageSquareWarning / TriangleAlert | Warning | IconAlertTriangle | RiAlertLine |
| 状态-结案 | Archive | Archive | IconArchive | RiArchiveLine |
| 字体/排版 | Type | TextT | IconTypography | RiFontSize |
| 页边距/纸张 | Ruler | Ruler | IconRuler | RiRulerLine |
| 微信 | ❌ | WechatLogo | IconBrandWechat | RiWechatLine |

**结论 D3**：lucide 留任。三个缺口都是「文件类型/品牌」类；本产品的 PDF/DOCX/XML 是三种导出物，用 `FileText` + `Badge` 文字「PDF」「DOCX」「XML」表达比品牌图标更清楚（E3 推断，与递交页现有做法一致）。禁止第二图标库。

### 4.3 图表库

| 维度 | Recharts 3 | Apache ECharts 6 | visx 4 | Chart.js 4 |
|---|---|---|---|---|
| 渲染 | SVG（React 组件树） | Canvas/SVG（命令式） | SVG（D3 低层积木） | Canvas |
| gzip（柱+饼+折线） | +108.4 kB | +185.7 kB（tree-shake 后）/ +374 kB（全量） | +36.3 kB（仅 xychart 柱+折线，饼另装） | +60.0 kB |
| 主题接入 | 直接用 CSS 变量 `fill="var(--status-granted-dot)"`；shadcn `ChartContainer` 把 `--color-*` 注入 [S6] | 需把 OKLCH 解析成 ECharts theme 对象（Canvas 不认 CSS 变量） | 手写 | 需 JS 色值 |
| 中文 | DOM 文本，系统字体自然生效 | Canvas 文本，需指定 `textStyle.fontFamily` | DOM 文本 | Canvas 文本 |
| 响应式 | `ResponsiveContainer`/shadcn `ChartContainer`（要求容器有 height/min-height/aspect [S6]） | 需 `resize()` 监听 | 需 `ParentSize` | `responsive: true` |
| a11y | SVG 元素可被 axe/读屏枚举；Recharts `BarChart` 等有 `accessibilityLayer` prop（官方 API 页 [S18]） | Canvas 需 `aria-label` 兜底 | 手写 | Canvas 需 aria |
| 维护 | push 2026-09-04 | 2026-09-04 | 2026-06-22 | 2026-05-27 |
| 适用性 | 台账统计（状态分布、期限分布、月度递交/授权趋势、撰写进度）恰好是柱/饼/折线/进度 | 强在大数据量、地图、关系图 —— 本产品无此需求 | 需自己写坐标轴/图例/tooltip | 可用但 Canvas 主题接入差 |

**结论 D4**：Recharts + shadcn `chart` 封装。ECharts 能力最强但体积 1.7 倍且主题与 CSS 变量双轨；visx 省体积但要自己写图例/tooltip（工期换体积不划算，E3）；Chart.js 与 OKLCH token 接入差。

### 4.4 动效

| 维度 | CSS + tw-animate-css（现用） | `motion` 全量 | `motion` mini（`react-m` + LazyMotion） | Auto-Animate |
|---|---|---|---|---|
| gzip | 0（CSS 已在 20 kB 里） | +40.7 kB | +25.7 kB | +2.8 kB |
| 能力 | 进出场、位移、透明、颜色；`@starting-style` 可做出场 | layout/共享元素/手势/spring | 同上但按需加载 | 列表增删排序自动过渡 |
| reduced motion | 已有全局 `@media (prefers-reduced-motion: reduce)` 把时长压到 0.01ms（index.css:280） | `MotionConfig reducedMotion="user"` / `useReducedMotion` [S8] | 同 | 内建尊重 |
| 本产品需要的动效（E1 盘点） | 面板开合 200ms、颜色 150ms、Sheet/Dialog 进出、`pulse-dot` | dockview 面板拖拽已由 dockview 自管；无手势/共享元素需求 | — | 台账排序 / 大纲增删 |
| 维护 | 1.4.0 2025-09-24；shadcn 官方推荐 [S1] | 2026-09-02 | 同 | 2026-07-10 |

**结论 D5**：CSS 为唯一动效层，动效 token 只在 CSS 变量里（§6.7）。`motion` 不进 wave 5——没有一个现存交互需要 spring/layout 动画；Auto-Animate 虽小，但台账排序切换用 CSS `view-transition`/无动效即可，不为一处引入第 2 套动效范式（E3）。若 three-view 课题定出「PDF 选区 ↔ 源码高亮」的跨面板指示动画，再评估 `motion` mini（+25.7 kB 可接受）。

### 4.5 字体

| 方案 | 首屏成本 | 中文覆盖 | 一致性 | 结论 |
|---|---|---|---|---|
| 系统栈（现 `--font-ui`）：`-apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", system-ui` | 0 | macOS 苹方 / Windows 雅黑 / Linux Noto CJK / Android 思源 | 各平台字形不同，但都是各平台「原生感」 | **采用（D6）**，微调：把 `system-ui` 提前到 `"Segoe UI"` 前以让 Windows 11 新字体优先（E3） |
| 自托管 Noto Sans SC Variable（`@fontsource-variable/noto-sans-sc`） | woff2 **4.6 MB**（`du -shL`，未子集化）；CSS 声明 46.8 kB gzip | 完整 | 全平台一致 | 否决：私有部署常在内网/弱网，4.6 MB 阻塞首屏；子集化会漏专利术语生僻字 |
| 自托管 Inter Variable | 1.2 MB | 仅拉丁 | 数字/英文一致 | 否决：中英混排时 Inter 与系统中文字体基线/字重不一致，反而更乱（E3） |
| 等宽自托管 JetBrains Mono Variable（`@fontsource-variable/jetbrains-mono`） | **0.2 MB** | 拉丁；中文回落到 `Sarasa Mono SC`/系统等宽 | 源码视图数字、标点对齐一致 | **采用**：源码/权项编号/案号/`tabular-nums` 场景 |
| 正文预览字体（PDF） | 后端 LibreOffice 渲染，`make fonts` 装宋体/黑体/仿宋等 | — | — | **与界面字体完全隔离**：界面 token 只影响 `body`/`.cm-scroller`；`.react-pdf__Page` 是位图+文字层，不受 `--font-ui` 影响 |

**结论 D6**：`--font-ui` 保持系统栈；`--font-code` 首选 `"JetBrains Mono Variable"`（自托管）并保留 `"Sarasa Mono SC", ui-monospace` 回落；`font-display: swap`。

### 4.6 颜色空间与主题

| 维度 | 现状 hex | OKLCH（决定） |
|---|---|---|
| 生态 | — | Tailwind v4 调色板与 shadcn 默认 token 均为 OKLCH [S1][S9] |
| 生成阶梯 | 手挑 10 个 hex，中性色色相在 247–268 之间漂 | 固定 hue/chroma，只变 L；十档状态色 hue 各异、L 相同 → 视觉等重 |
| 深色 | 单独手挑 | 同 hue、翻转 L；饱和度略降 |
| 对比度 | 注释里手算 | `culori.wcagContrast` 脚本自动算（§6.1 表 C，已复现全部注释值：primary 白字 4.55、primary-text 7.50、n7 白底 7.75…） |
| 浏览器 | — | Tailwind v4 本身最低要求 Chrome 111 / Safari 16.4 / Firefox 128（官方 compatibility 页 [S16]），OKLCH 在这些版本均可用；即项目已承担的浏览器基线不因 OKLCH 再收窄 |
| 迁移风险 | — | **零视觉变化**：每个现 hex 用 culori 转成等值 OKLCH（§7 表逐条给出），先做等值替换，再统一色相 |

**结论 D7–D9**：见 §6.1；`culori` 仅 devDependency（脚本 + vitest），运行时不需要。

### 4.7 表单

| 维度 | 受控原生表单 + `Field` UI（决定） | react-hook-form + zod |
|---|---|---|
| gzip | 0 | +32.1 kB（zod 单独 +20.5，`zod/mini` +4.2） |
| 现有表单 | 19 个 `<form>`（登录、注册、新建案卷、递交、账户、密码、机构、标签、模板、术语、成员、AI 输入…），绝大多数 ≤3 字段 | 同 |
| 校验权威 | 后端 Pydantic 2（422 带字段路径） | 前端再写一份 schema → 两份规则要同步 |
| 错误展示 | 新增 `Field/FieldLabel/FieldDescription/FieldError`（shadcn `field` 组件，纯 UI 无依赖） | RHF `formState.errors` + 同一 `Field` |
| 复杂表单 | 目前无 ≥8 字段/多步表单 | 优势场景 |
| 维护 | — | RHF 2026-09-04、zod 2026-09-05，都健康 |

**结论 D10**：不引入。规范：所有表单用同一 `Field` 组件 + `lib/api.ts` 里把 422 `detail[].loc` 映射到字段错误的 helper（现有 `api.ts` 已统一 fetch）。重评触发（E3）：出现案件元数据完整表单（申请人/发明人/优先权/费减等 ≥8 字段）或递交向导多步表单。

### 4.8 表格：TanStack Table v9

| 维度 | 实测/事实 |
|---|---|
| 版本 | 9.2.4（npm `latest`），2026-08-28；push 2026-08-31 |
| API | v9 改为 features 组合：`tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns })` + `createColumnHelper<typeof features, Row>()` + `useTable({ _features, columns, data })`；spike 入口 tsc 通过 |
| gzip | +12.1 kB（sorting 一个 feature） |
| 用途 | `dashboard/CaseTable.tsx`（现手写 `<table>`）：排序（期限/修改时间）、状态/标签筛选、列显隐、批量选择、分组视图 |
| 风险（E3） | v9 文档尚不完整（`/table/v9/docs/guide/migrating` 404）；API 以 TypeScript 类型为准 |

**结论 D11**：采用；只用于台账主表；小型列表（成员、术语）继续用语义 `<table>`。

### 4.9 命令面板：cmdk

| 维度 | 实测/事实 |
|---|---|
| 版本 | 1.1.1，2025-03-14；仓库最后 push 2025-10-29（10 个月静默，但 shadcn `Command` 仍基于它 [S11]） |
| gzip | +16.3 kB |
| 用途 | `⌘K/Ctrl+K`：跳转案卷、切换三视图、执行构建/导出、插入权项、AI 动作 |
| a11y | 内建 `role="combobox"`/`listbox`、键盘导航 |

**结论 D12**：采用，通过 shadcn `command` 组件封装（内部用现有 `Dialog`）。

### 4.10 虚拟列表：TanStack Virtual

| 维度 | 实测/事实 |
|---|---|
| 版本 | 3.14.10，2026-08-18 |
| gzip | +7.4 kB |
| 用途 | 台账 >200 行、版本历史、审阅批注列表、大纲（权项 >100） |
| 约束 | 与 `dnd-kit` 排序共存时用 `measureElement`；不用于 CodeMirror/ProseMirror（它们自带虚拟化） |

**结论 D13**：采用，仅在 >200 行时启用（E3 阈值，来自 375 视口一屏约 12 行）。

### 4.11 日期与期限：date-fns 4 + @date-fns/tz

| 维度 | 实测/事实 |
|---|---|
| 版本 | date-fns 4.4.0（2026-05-29）、@date-fns/tz 1.4.1（2025-08-12；1.5.0 为 2026-05-21，亦可） |
| gzip | +9.4 kB（含 zhCN locale + TZDate） |
| 期限规则（需 requirements 课题核对法条原文，**E3**） | 送达推定：邮寄自发文日满 15 日推定收到，电子送达以进入电子系统日为准（2023 修订《专利法实施细则》第 4 条，凭记忆，待核）；期限届满日为法定节假日则顺延到其后第一个工作日；第一次审查意见答复 4 个月、后续 2 个月；实质审查请求自申请日（优先权日）起 3 年；优先权 12 个月 |
| 实现形态 | `lib/deadline.ts` 纯函数：`dueDate(base, {months, days}, tz='Asia/Shanghai', holidays)`；节假日表 `data/cn-holidays-YYYY.json` 由机构管理员维护（国务院每年 11–12 月公布）；全部用 `TZDate` 保证客户端时区不影响 |
| 替换 | 统一 `fmtRelative/fmtClock/fmtTime` 三份手写为 `lib/format-date.ts`（基于 `format`/`formatDistanceToNowStrict` + zhCN） |

**结论 D14**：采用。原生 `<input type="date">` 保留作为输入控件（移动端体验最好）。

### 4.12 Toast

现有 `store/ui.ts` `toast(text, kind)` + `shell/Toasts.tsx`（`aria-live="polite"`，`z-[60]`）已覆盖 success/error/info；sonner +9.8 kB 提供堆叠/滑动关闭/promise toast，但当前没有 promise 型长任务需要它（构建状态走 `StatusPill`）。**结论 D15**：保留，只把 `z-[60]` 换成 `z-toast` token（§6.6）。

---

## 5. 综合体积影响（E1 推算）

| 项 | Δ gzip |
|---|---|
| radix-ui 合并 | ±0 |
| recharts（仅台账页，`lazy()` 按路由分包） | +108 kB，不进主包 |
| tanstack table + virtual | +19.5 kB |
| cmdk | +16.3 kB |
| date-fns + tz | +9.4 kB |
| JetBrains Mono woff2 | 0 JS；~200 kB 字体（`preload`，源码视图才用） |
| **主包合计** | **≈ +45 kB gzip**（现主包 761.5 kB gzip，+5.9%） |

---

## 6. Tokens 草案（CSS 变量；`frontend/src/index.css`）

原则：① 原始层（palette）→ 语义层（semantic）→ 组件层（Tailwind `@theme inline` 映射），组件只用语义层；② 全部 OKLCH；③ 每个语义配对有对比度断言；④ 数值先等值迁移（§7），再统一色相。

### 6.1 色板（浅色）

```css
:root {
  /* ---- 原始层：中性色（等值迁移自现 hex，culori 转换）---- */
  --n0: oklch(1 0 0);
  --n1: oklch(0.970 0.002 248);
  --n2: oklch(0.934 0.007 268);
  --n3: oklch(0.872 0.012 260);
  --n4: oklch(0.772 0.017 263);
  --n5: oklch(0.671 0.025 261);
  --n6: oklch(0.549 0.030 259);
  --n7: oklch(0.441 0.032 262);
  --n8: oklch(0.346 0.035 260);
  --n9: oklch(0.250 0.022 257);

  /* ---- 原始层：品牌绿（等值）---- */
  --green-600: oklch(0.549 0.145 151);   /* = #098842 */
  --green-700: oklch(0.470 0.101 155);   /* = #1e6b41 */
  --green-800: oklch(0.414 0.087 155);   /* = #195936 */
  --green-50:  oklch(0.962 0.016 161);   /* = #eaf6ef */

  /* ---- 语义层 ---- */
  --background: var(--n0);            --foreground: var(--n9);
  --surface: var(--n0);               --paper: var(--n1);
  --card: var(--surface);             --card-foreground: var(--foreground);
  --popover: var(--surface);          --popover-foreground: var(--foreground);
  --primary: var(--green-600);        --primary-foreground: var(--n0);      /* 4.55:1 */
  --primary-hover: var(--green-700);  --primary-soft: var(--green-50);
  --primary-text: var(--green-800);                                          /* on soft 7.50:1 */
  --secondary: var(--n1);             --secondary-foreground: var(--n9);
  --muted: var(--n1);                 --muted-foreground: var(--n7);         /* 7.75 / on n2 6.38 */
  --accent: var(--n2);                --accent-foreground: var(--n9);
  --placeholder: var(--n6);           /* 新增：4.87:1；原 n5 仅 2.98，不合规 */
  --destructive: oklch(0.532 0.163 27);          --destructive-foreground: var(--n0);   /* 5.69 */
  --destructive-soft: oklch(0.964 0.009 17);
  --warning: oklch(0.688 0.155 61);              --warning-foreground: oklch(0.481 0.109 59); /* on soft 6.03 */
  --warning-soft: oklch(0.963 0.022 74);
  --success: var(--green-700);                   --success-foreground: var(--n0);       /* 6.49 */
  --success-soft: var(--green-50);
  --info: oklch(0.538 0.142 259);                --info-foreground: var(--n0);          /* 5.18 */
  --info-soft: oklch(0.966 0.007 261);
  --border: var(--n2);  --border-2: var(--n3);  --input: var(--n3);  --ring: var(--primary);
  --selection: oklch(0.62 0.19 262 / 0.35);      /* 现 rgb(37 99 235 / .35) */
  --find-mark: oklch(0.86 0.17 92 / 0.45);       /* 现 rgb(250 204 21 / .45) */
  --find-mark-current: oklch(0.70 0.19 48 / 0.65);
}
```

对比度校验（culori `wcagContrast`，E1）：

| 配对 | 前景 | 背景 | 值 | 判定 |
|---|---|---|---|---|
| primary-foreground / primary | #ffffff | #098842 | 4.55 | ✅ |
| primary-text / primary-soft | #195936 | #eaf6ef | 7.50 | ✅ |
| muted-foreground / n0 | #495365 | #ffffff | 7.75 | ✅ |
| muted-foreground / n2 | #495365 | #e7e9ee | 6.38 | ✅ |
| destructive-foreground / destructive | #ffffff | #b83a33 | 5.69 | ✅ |
| warning-foreground / warning-soft | #8a4c0d | #fcf1e3 | 6.03 | ✅ |
| info-foreground / info | #ffffff | #366cbf | 5.18 | ✅ |
| **n5 placeholder / n0** | #8d96a5 | #ffffff | **2.98** | ❌ → 新 `--placeholder: var(--n6)` 4.87 ✅ |
| n6 / n0 | #677283 | #ffffff | 4.87 | ✅ |
| dark primary-foreground / primary | #1b222c | #53b57f | 6.31 | ✅ |
| dark primary-text / primary-soft | #86caa5 | #153826 | 6.77 | ✅ |
| dark muted-foreground / n8 | #afb5c0 | #2f3a4c | 5.57 | ✅ |
| dark foreground / n9 | #f4f5f6 | #1b222c | 14.67 | ✅ |
| dark destructive / n8 | #ec9790 | #2f3a4c | 5.13 | ✅ |
| dark info / n8 | #7fa8e6 | #2f3a4c | 4.72 | ✅ |
| dark n5 / n9 | #8d96a5 | #1b222c | 5.37 | ✅ |

校验方法（D9）：`frontend/scripts/check-contrast.mjs`（culori）读取 `index.css`，对上表 + 十档状态色的每个 `*-text/*-soft`、`*-foreground/*` 配对断言 ≥4.5，并作为 vitest 用例进 `make check`。

### 6.2 专利状态十档色

设计：每档一个 hue，三角色同 L（浅色 soft L=0.96 / text L≈0.50 / dot L=0.58；深色 soft 0.28 / text ≈0.85 / dot 0.72），文字色由脚本自动降 L 直到 对 soft 与对页面底 都 ≥4.5。hue 分配（E3，按流程语义）：接案/结案灰蓝与灰（未着色态）、撰写蓝、内审紫、客户确认琥珀、定稿青、已递交靛、审查意见橙、授权绿（与品牌同相）、驳回红。

浅色（E1 生成 + 校验）：

| status | 中文 | hue | `--status-*-soft` | `--status-*-text` | `--status-*-dot` | 字/soft | 字/白 | dot/白 |
|---|---|---|---|---|---|---|---|---|
| intake | 接案 | 250 | oklch(0.960 0.020 250) #e8f3ff | oklch(0.500 0.020 250) #5b646f | oklch(0.580 0.020 250) #727c86 | 5.34 | 5.99 | 4.27 |
| drafting | 撰写 | 250 | oklch(0.960 0.020 250) #e8f3ff | oklch(0.500 0.120 250) #2266a4 | oklch(0.580 0.130 250) #347ec4 | 5.34 | 5.99 | 4.27 |
| review | 内审 | 300 | oklch(0.959 0.023 300) #f4eeff | oklch(0.500 0.120 300) #6e519d | oklch(0.580 0.130 300) #8766bb | 5.58 | 6.31 | 4.51 |
| client_review | 客户确认 | 75 | oklch(0.960 0.030 75) #feefdc | oklch(0.499 0.105 77) #845900 | oklch(0.580 0.122 76) #a36e00 | 5.44 | 6.13 | 4.38 |
| final | 定稿 | 195 | oklch(0.960 0.030 195) #dcf9f8 | oklch(0.501 0.085 195) #007273 | oklch(0.580 0.099 195) #008c8c | 5.14 | 5.72 | 4.08 |
| filed | 已递交 | 270 | oklch(0.959 0.019 271) #edf1ff | oklch(0.500 0.120 270) #495da7 | oklch(0.580 0.130 270) #5d74c7 | 5.45 | 6.14 | 4.38 |
| oa | 审查意见 | 50 | oklch(0.960 0.022 50) #ffeee5 | oklch(0.500 0.120 50) #984b16 | oklch(0.580 0.150 50) #be5a0a | 5.56 | 6.28 | 4.53 |
| granted | 授权 | 155 | oklch(0.960 0.030 155) #e3f8e9 | oklch(0.500 0.120 155) #0b7643 | oklch(0.580 0.130 155) #249057 | 5.09 | 5.66 | 4.03 |
| rejected | 驳回 | 25 | oklch(0.959 0.020 25) #ffedeb | oklch(0.500 0.120 25) #9c433f | oklch(0.580 0.150 25) #c34f4b | 5.62 | 6.37 | 4.61 |
| closed | 结案 | — | oklch(0.960 0 0) #f2f2f2 | oklch(0.500 0 0) #636363 | oklch(0.580 0 0) #7a7a7a | 5.34 | 6.00 | 4.28 |

深色（`.dark`）：

| status | `--status-*-soft` | `--status-*-text` | `--status-*-dot` | 字/soft | 字/n9 | dot/n9 |
|---|---|---|---|---|---|---|
| intake | oklch(0.280 0.030 250) #1d2a37 | oklch(0.850 0.020 250) #c4cfdb | oklch(0.720 0.020 250) #9ba6b1 | 9.23 | 10.14 | 6.47 |
| drafting | oklch(0.280 0.050 250) #142a41 | oklch(0.849 0.077 253) #aad1ff | oklch(0.720 0.130 250) #60aaf3 | 9.21 | 10.13 | 6.49 |
| review | oklch(0.280 0.050 300) #2d233e | oklch(0.846 0.090 301) #d6bfff | oklch(0.720 0.130 300) #b191ea | 9.03 | 9.75 | 6.17 |
| client_review | oklch(0.280 0.050 75) #372508 | oklch(0.850 0.120 75) #fcc270 | oklch(0.720 0.130 75) #d49838 | 9.16 | 9.99 | 6.33 |
| final | oklch(0.280 0.048 195) #003030 | oklch(0.850 0.100 195) #76e2e2 | oklch(0.720 0.100 195) #49b8b8 | 9.41 | 10.52 | 6.73 |
| filed | oklch(0.280 0.050 270) #1f2742 | oklch(0.847 0.076 273) #bccaff | oklch(0.720 0.130 270) #859ff6 | 9.12 | 9.94 | 6.34 |
| oa | oklch(0.280 0.050 50) #3c2111 | oklch(0.848 0.092 50) #ffbc97 | oklch(0.720 0.150 50) #ee8545 | 9.09 | 9.83 | 6.15 |
| granted | oklch(0.280 0.050 155) #12301e | oklch(0.850 0.120 155) #8ae5ab | oklch(0.720 0.130 155) #57bc80 | 9.48 | 10.60 | 6.82 |
| rejected | oklch(0.280 0.050 25) #3e1e1c | oklch(0.847 0.084 25) #ffb8b1 | oklch(0.720 0.150 25) #f47b74 | 9.02 | 9.72 | 6.05 |
| closed | oklch(0.280 0 0) #292929 | oklch(0.850 0 0) #cecece | oklch(0.720 0 0) #a4a4a4 | 9.23 | 10.13 | 6.45 |

注：intake 与 drafting 浅色 soft 同值（同 hue、intake 低饱和度文字区分），若 UX 走查认为不够，intake hue 改 230（E3）。`types/case.ts` 的 `STATUS_TONE` 改为直接返回 status 名，`Badge` 增加 `tone="status"` + `data-status` 由 CSS `[data-status=oa]` 取 token。

### 6.3 字体与字号阶（D16）

```css
:root {
  --font-ui: -apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, "Segoe UI", sans-serif;
  --font-code: "JetBrains Mono Variable", "JetBrains Mono", "Sarasa Mono SC", ui-monospace, Menlo, Consolas, monospace;
  --fs-2xs: 11px; --lh-2xs: 16px;   /* 仅状态栏/角标；禁止 10px */
  --fs-xs: 12px;  --lh-xs: 16px;
  --fs-sm: 13px;  --lh-sm: 18px;
  --fs-base: 14px;--lh-base: 20px;
  --fs-lg: 16px;  --lh-lg: 24px;
  --fs-xl: 20px;  --lh-xl: 28px;
  --fs-2xl: 24px; --lh-2xl: 32px;   /* 登录页标题/空态 */
  --editor-font-size: 13px;         /* 现 12px；E3：13px 中文可读性更好，待 three-view 课题定 */
  --editor-line-height: 1.6;
  --fw-normal: 400; --fw-medium: 500; --fw-semibold: 600;
}
```

| 用途 | token | 现状对应 |
|---|---|---|
| 正文/控件 | `--fs-base` 14 | `text-base` 37 处（注意 Tailwind 默认 base=16，本项目覆盖为 14） |
| 次级文字/表格 | `--fs-sm` 13 | `text-sm` 172 + `text-[13px]` 10 |
| 辅助/标签 | `--fs-xs` 12 | `text-xs` 406 |
| 角标/状态栏 | `--fs-2xs` 11 | `text-[11px]` 74 + `text-[10px]` 15（升到 11） |
| 面板标题 | `--fs-lg` 16 | `text-lg` 9 + `text-[15px]` 3 |
| 页标题 | `--fs-xl` 20 | `text-xl` 1 |

### 6.4 间距（4pt 栅格）

沿用 Tailwind v4 默认 `--spacing: 0.25rem`（4px 基数）；允许步进 0/0.5/1/1.5/2/3/4/5/6/8/10/12/16/20/24；禁止任意值 `p-[7px]` 类写法。布局尺寸 token 保留现有（`--h-topbar 40 --w-rail 40 --w-side 209 --h-pdftb 32 --h-statusbar 24 --h-control 32 --h-control-mobile 40 --h-icon-btn 32/40 --h-mobile-topbar 48 --h-mobile-tabs 56 …`），其中 `--w-side: 209px` 改 `208px`、`--w-split-handle: 7px` 改 `8px`、`--h-side-handle: 6px` 改 `8px` 以落栅格（E3，视觉差 ≤1px）。触控目标：移动端控件 ≥40px（现 `--h-control-mobile` 已是）。

### 6.5 圆角

| token | 值 | 用途 | 现状 |
|---|---|---|---|
| `--radius-sm` | 4px | 控件、Badge、输入框、按钮 | `rounded`/`rounded-sm`/`rounded-md` 三者都是 4px → 统一写 `rounded-sm` |
| `--radius-md` | 6px | 卡片、Popover、Dropdown | 现 `--radius-lg: 6px` |
| `--radius-lg` | 8px | Dialog、Sheet、页面卡片 | 现 `--radius-xl: 8px` |
| `--radius-full` | 9999px | 头像、pill | `rounded-full` 70 处不变 |

### 6.6 阴影与层级

```css
:root {
  --sh-sm: 0 1px 2px oklch(0 0 0 / 0.08);
  --sh-md: 0 4px 12px oklch(0 0 0 / 0.10), 0 1px 3px oklch(0 0 0 / 0.06);
  --sh-paper: 0 1px 3px oklch(0 0 0 / 0.15), 0 4px 16px oklch(0 0 0 / 0.08);
  --z-base: 0; --z-sticky: 10; --z-panel: 20; --z-overlay: 40; --z-popover: 50; --z-toast: 60;
}
@theme inline { --z-index-sticky: var(--z-sticky); --z-index-panel: var(--z-panel); --z-index-overlay: var(--z-overlay); --z-index-popover: var(--z-popover); --z-index-toast: var(--z-toast); }
```

| 层 | 值 | 用于 | 现状映射 |
|---|---|---|---|
| sticky | 10 | 表头、面板头、状态栏 | `z-10` 9 处 |
| panel | 20 | 拖拽手柄、浮动工具条 | `z-20` 2 处 |
| overlay | 40 | Dialog/Sheet 遮罩 | 新 |
| popover | 50 | Dropdown/Select/Tooltip/Dialog 内容 | `z-50` 10 处 |
| toast | 60 | Toasts | `z-[60]` 1 处 |

### 6.7 动效

```css
:root {
  --duration-fast: 100ms;   /* hover 颜色 */
  --duration-color: 150ms;  /* 现有 */
  --duration-panel: 200ms;  /* 现有：面板开合、Sheet */
  --duration-slow: 300ms;   /* 页面级过渡 */
  --ease-panel: cubic-bezier(0.2, 0.8, 0.2, 1);   /* 现有 */
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
}
@media (prefers-reduced-motion: reduce) { :root { --duration-fast: 0ms; --duration-color: 0ms; --duration-panel: 0ms; --duration-slow: 0ms; } }
```

现有全局 `*{animation-duration:0.01ms!important}` 保留作兜底；tw-animate-css 的 `duration-*` 类改用 token。

### 6.8 断点（D18）

| 名称 | 宽 | 用途 |
|---|---|---|
| `sm` | 640 | 大手机横屏/小平板：表格→卡片阈值 |
| `md` | 768 | 平板：双栏 |
| `lg` | 1024 | **桌面/移动分界**（= `DESKTOP_QUERY`）：dockview 三视图 vs 底部 Tab |
| `xl` | 1280 | 三栏 + 侧栏常驻 |
| 目标视口 | 375 / 1440 | 验收截图基准 |

### 6.9 深色主题与 reduced motion

- 机制不变：`.dark` class（`store/ui.ts` 依 `theme: 'light'|'dark'|'system'` 切换）+ `@custom-variant dark (&:where(.dark, .dark *))`。
- 深色 token：中性色反转（`--background: var(--n9)`…），品牌绿 `oklch(0.700 0.123 157)`（= #53b57f）等值迁移；十档状态色见 6.2。
- `color-scheme: light dark` 加到 `:root`，让原生 `<input type="date">`/滚动条跟随。
- reduced motion 见 6.7。

---

## 7. 现有 `index.css` → 新 tokens 映射/迁移表

| 现 token / 写法 | 现值 | 新 token | 新值 | 动作 |
|---|---|---|---|---|
| `--n0`…`--n9` | hex | 同名 | OKLCH 等值（§6.1） | 等值替换 |
| `--primary` | #098842 | `--primary: var(--green-600)` | oklch(0.549 0.145 151) | 等值 |
| `--primary-hover` | #1e6b41 | `var(--green-700)` | oklch(0.470 0.101 155) | 等值 |
| `--primary-soft` | #eaf6ef | `var(--green-50)` | oklch(0.962 0.016 161) | 等值 |
| `--primary-text` | #195936 | `var(--green-800)` | oklch(0.414 0.087 155) | 等值 |
| `--destructive` | #b83a33 | 同名 | oklch(0.532 0.163 27) | 等值 |
| `--destructive-soft` | #f9f1f1 | 同名 | oklch(0.964 0.009 17) | 等值 |
| `--warning` | #de8014 | 同名 | oklch(0.688 0.155 61) | 等值 |
| `--warning-foreground` | #8a4c0d | 同名 | oklch(0.481 0.109 59) | 等值 |
| `--warning-soft` | #fcf1e3 | 同名 | oklch(0.963 0.022 74) | 等值 |
| `--info` | #366cbf | 同名 | oklch(0.538 0.142 259) | 等值 |
| `--info-soft` | #f1f4f9 | 同名 | oklch(0.966 0.007 261) | 等值 |
| `.dark --primary` | #53b57f | 同名 | oklch(0.700 0.123 157) | 等值 |
| `.dark --primary-hover/-text` | #86caa5 | 同名 | oklch(0.783 0.087 160) | 等值 |
| `.dark --primary-soft` | #153826 | 同名 | oklch(0.309 0.052 159) | 等值 |
| `.dark --destructive` | #ec9790 | 同名 | oklch(0.761 0.104 25) | 等值 |
| `.dark --destructive-soft` | #3a1f1e | 同名 | oklch(0.275 0.042 23) | 等值 |
| `.dark --warning` | #f0a54a | 同名 | oklch(0.779 0.138 68) | 等值 |
| `.dark --warning-foreground` | #f5c98a | 同名 | oklch(0.860 0.094 76) | 等值 |
| `.dark --warning-soft` | #3a2a14 | 同名 | oklch(0.298 0.042 74) | 等值 |
| `.dark --info` | #7fa8e6 | 同名 | oklch(0.726 0.101 259) | 等值 |
| `.dark --info-soft` | #1c2a40 | 同名 | oklch(0.284 0.045 259) | 等值 |
| （无） | — | `--placeholder` | var(--n6) | 新增，`placeholder:text-n5` → `placeholder:text-placeholder` |
| （无） | — | `--status-{10}-{soft,text,dot}` ×2 主题 | §6.2 | 新增 60 个变量 |
| `STATUS_TONE` 5 tone | ts | `data-status` + CSS | — | `Badge` 改造 |
| `.react-pdf__Page__textContent ::selection` `rgb(37 99 235/.35)` | 硬编码 | `--selection` | oklch | 替换 |
| `mark` `rgb(250 204 21/.45)` / `.pdf-find-current` `rgb(249 115 22/.65)` | 硬编码 | `--find-mark` / `--find-mark-current` | oklch | 替换 |
| tsx 内 `#ef4444` ×6 | 硬编码 | `var(--destructive)` | — | 替换 |
| tsx 内 `#eaf6ef` ×4 / `#f9f1f1` / `#f4f5f6` / `#b83a33` / `#3b82f6` | 硬编码 | `--primary-soft`/`--destructive-soft`/`--n1`/`--destructive`/`--info` | — | 替换 |
| `text-amber-*` / `bg-amber-500` ×8 | Tailwind 调色板 | `--warning*` | — | 替换 |
| `--fs-xs..--fs-xl` 5 档 | 12/13/14/16/20 | + `--fs-2xs` 11、`--fs-2xl` 24 | 7 档 | 扩充；`text-[10px]`/`text-[11px]` → `text-2xs`；`text-[13px]` → `text-sm`；`text-[15px]` → `text-lg` |
| `--editor-font-size` | 12px | 同名 | 13px（待 three-view 定） | 调整 |
| `--font-code` | JetBrains Mono（系统） | 同名 | 前置 "JetBrains Mono Variable"（自托管） | 加 `@import '@fontsource-variable/jetbrains-mono'` |
| `--radius` 4 / `--radius-lg` 6 / `--radius-xl` 8；`--radius-sm/md` 都 = 4 | | `--radius-sm` 4 / `--radius-md` 6 / `--radius-lg` 8 | | **注意** Tailwind 类名 `rounded-md` 将从 4px 变 6px，须 codemod 一次改完：`rounded`/`rounded-sm`/`rounded-md`（现均 4）→ `rounded-sm`；`rounded-lg`（现 6）→ `rounded-md`；`rounded-xl`（现 8）→ `rounded-lg`；`rounded-full` 不变 |
| `--sh-sm/--sh-md/--sh-paper` | rgb | 同名 | oklch 写法，值不变 | 等值 |
| `z-10/z-20/z-50/z-[60]` | 数字 | `z-sticky/z-panel/z-popover/z-toast` | 10/20/50/60 | 替换；Dialog/Sheet 遮罩加 `z-overlay` 40 |
| `--duration-color/--duration-panel/--ease-panel` | 150/200 | 同名 + `--duration-fast/--duration-slow/--ease-out/--ease-in` | | 扩充 |
| `--w-side` 209 / `--w-split-handle` 7 / `--h-side-handle` 6 | | 208 / 8 / 8 | | 落 4pt 栅格 |
| `@theme inline` 映射块 | | 增加 `--color-status-*`、`--color-placeholder`、`--z-index-*`、`--text-2xs`、`--text-2xl`、`--radius-full` | | 扩充 |

迁移顺序（E3）：① 等值替换（零视觉变化，截图 diff 应为 0）→ ② 新增 token + 校验脚本进 `make check` → ③ codemod 圆角/字号/z-index 类名 → ④ 十档状态色接入 Badge/台账 → ⑤ 替换硬编码色。每步独立 PR，各跑 `make check`。

---

## 8. 组件清单（`frontend/src/components/ui`）

### 8.1 现有组件的规范化改动

| 组件 | 改动 |
|---|---|
| `Button` | size 与 token 对齐：`sm` h-8(32)=`--h-control`、`default` h-9(36)、`lg` h-10(40)=`--h-control-mobile`；新增 `size="icon-lg"` h-10 w-10 供移动端；`variant` 不变；`focus-visible:ring-2 ring-ring/60` 不变 |
| `Badge` | 新增 `tone: 'neutral'\|'primary'\|'info'\|'warning'\|'destructive'\|'status'`，`status` 时读 `data-status` → `bg-status-*-soft text-status-*-text`，可选前置 `dot` |
| `Input/Textarea/Label` | 高度 `--h-control`（移动端 `lg:` 前为 40）；`placeholder:text-placeholder`；错误态 `aria-invalid:border-destructive` |
| `Select`（Radix） | 替换 `MemberTable.tsx` 唯一原生 `<select>` |
| `DropdownMenu` | 补 `CheckboxItem/RadioGroup/RadioItem/Sub*/Shortcut/Label` |
| `Dialog/Sheet` | 遮罩用 `z-overlay`，内容 `z-popover`；圆角 `rounded-lg`(8) |
| `Tooltip/Switch/Separator` | 不变 |

### 8.2 补进的组件（全部 shadcn `radix` 变体源码或纯 UI；依赖见 new_deps）

shadcn registry 实查（`curl https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`，E1）：`field` deps `cn`（regDeps label/separator）· `chart` deps `recharts@3.8.0, lucide-react`（regDeps card）· `command` deps `cmdk`（regDeps dialog）· `kbd`/`table` 仅 `cn` · `checkbox`/`toggle-group`/`popover`/`progress`/`avatar` deps `radix-ui`。即下表「依赖」列与官方 registry 一致。

| 组件 | 来源 | 依赖 | API 形状（关键 props / 子组件） | 变体 | 首批使用处 |
|---|---|---|---|---|---|
| `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`, `FieldLegend` | shadcn `field` [S19] | 无 | `<Field><FieldLabel htmlFor/><Input aria-invalid/><FieldDescription/><FieldError>msg</FieldError></Field>`；`FieldSet > FieldLegend + FieldGroup` | `orientation="horizontal"`（Switch/Checkbox 行） | 19 个表单 |
| `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandShortcut` | shadcn `command` | `cmdk` | `<CommandDialog open onOpenChange><CommandInput placeholder/><CommandList><CommandGroup heading><CommandItem onSelect/>` | — | 全局 ⌘K |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableCaption` | shadcn `table` | 无（语义 `<table>`） | 纯样式包装 | density: default/compact | 成员表、术语表、台账（配 TanStack 渲染） |
| `DataTable`（项目自有，`components/dashboard/`） | 自写 | `@tanstack/react-table`, `@tanstack/react-virtual` | `useTable({_features, columns, data, state})`；列显隐/排序/行选 | — | `CaseTable.tsx` |
| `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartConfig` | shadcn `chart` | `recharts` | `<ChartContainer config={{granted:{label:'授权',color:'var(--status-granted-dot)'}}} className="min-h-[200px]"><BarChart …>` | — | 台账统计卡 |
| `Popover`, `PopoverTrigger`, `PopoverContent` | shadcn `popover` | `radix-ui`(Popover) | 标准 | side/align | 台账筛选、日期说明 |
| `Checkbox` | shadcn `checkbox` | `radix-ui`(Checkbox) | `checked/onCheckedChange/indeterminate` | — | 台账多选（现原生 `input[type=checkbox]`） |
| `RadioGroup`, `RadioGroupItem` | shadcn | `radix-ui`(RadioGroup) | 标准 | — | 设置面板 |
| `Progress` | shadcn | `radix-ui`(Progress) | `value` | tone | 撰写进度/构建 |
| `Skeleton` | shadcn | 无 | `className` | — | 台账/PDF 加载 |
| `Alert`, `AlertTitle`, `AlertDescription` | shadcn | 无 | `variant` | default/destructive/warning/info | 递交页、预检 |
| `Avatar`, `AvatarImage`, `AvatarFallback` | shadcn | `radix-ui`(Avatar) | 标准 | size: sm/md | 协作者、在线者 |
| `ScrollArea`, `ScrollBar` | shadcn | `radix-ui`(ScrollArea)（已装） | 标准 | — | 大纲、面板 |
| `Toggle`, `ToggleGroup`, `ToggleGroupItem` | shadcn | `radix-ui`(Toggle/ToggleGroup) | `type="single"` | size/variant | 三视图切换（源码/版面/PDF）、列表/卡片视图 |
| `Kbd` | shadcn `kbd` | 无 | children | — | 命令面板、帮助 |
| `Breadcrumb*` | shadcn | 无 | 标准 | — | 案卷 → 文件 → 视图 |
| `Collapsible*` | shadcn | `radix-ui`(Collapsible) | 标准 | — | 大纲、设置组 |
| `Drawer`（移动底部抽屉） | **不引入 vaul**；用现有 `Sheet side="bottom"` | — | — | — | 移动端菜单 |

**不补**：`Form`（RHF 绑定版，见 D10）、`Sonner`（D15）、`Calendar/DatePicker`（原生 `type=date` 更适合移动；桌面若需范围选择再评估 `react-day-picker`）、`Carousel`、`Resizable`（dockview 已管分栏）。

### 8.3 组件通用 API 约定

| 约定 | 内容 |
|---|---|
| 文件 | 一组件一文件 kebab-case（现 `misc.tsx` 拆为 `switch.tsx tooltip.tsx select.tsx badge.tsx separator.tsx`） |
| 样式 | `cva` variants + `cn()`；只用语义 token 类（`bg-primary`、`text-muted-foreground`），禁 `bg-green-600`/任意值色 |
| 可访问性 | 所有交互组件 `focus-visible:ring-2 ring-ring/60 outline-none`；图标按钮必带 `aria-label`；`data-slot="ComponentName"` 供测试与 axe 定位 |
| 尺寸 | 桌面控件 32px、移动 40px 用 `h-control lg:h-control` 写法或 size 变体 |
| 主题 | 组件不感知 `.dark`，全靠 token 双值 |

---

## 9. 风险与未决

| 项 | 风险 | 处置 |
|---|---|---|
| TanStack Table v9 文档缺口 | 迁移指南 404，靠类型摸 API | spike 已验证核心用法；`DataTable` 封装隔离 |
| cmdk 10 个月无发布 | 若与 React 19.x 新版本不兼容 | 实测 React 19.2.8 通过；shadcn 仍依赖它，出现问题跟随 shadcn 处理 |
| 圆角类名语义变化 | `rounded-md` 从 4→6 会波及 86 处 | 用 codemod 一次改完并截图 diff |
| Radix 活跃度下降 | 见 D1 触发条件 | 每波次复查 npm 发布日期 |
| 期限法条 | 本文法条为记忆，未核原文 | 交 requirements 课题核对《专利法实施细则》2023 修订本 |
| intake/drafting 浅色 soft 同色 | 可辨性 | UX 走查后决定是否改 hue 230 |

---

## 10. 验证记录（实事求是）

**已验证（E1）**

- `make install && make dev` 起服务；`/api/health` 返回 `soffice:true, unoserver:true, pdf_backend:cli`；浏览器 1440/375 共 19 张截图（§2.1）
- 全部候选 `pnpm add` 成功；`tsc -p spike/tsconfig.json` 通过；29 个入口 `vite build` 成功并测得 gzip（§3）
- 装入候选后原项目 `tsc -b`、`pnpm build` 通过
- 图标数量与 34 概念覆盖：Node 脚本对四个包导出名精确匹配（§4.2）
- OKLCH 等值转换与全部对比度数值：culori 4.0.2 计算（§6.1、§6.2）
- axe-core 4.13.0 五路由 ×2 视口（§2.5）
- GitHub 活跃度：`gh api`（§3.1）；发布日期：`pnpm view <pkg> time`
- 目标分支 `make check`、`make zero-drift`、`make roundtrip`、`git status --short -- examples/`：见提交信息与结构化输出（本文档提交前执行）

**未验证（E3 / 未做）**

- 任何候选在真实页面（非最小入口）的渲染效果与交互体验；未做键盘可达性逐项走查
- 十档状态色在真实台账 UI 中的可辨性（仅数值校验，未渲染）
- 期限法条原文；节假日数据源
- `radix-ui` 单包替换 9 个包后的全量 `make check`（只做了 spike 入口）
- JetBrains Mono Variable 自托管在中文混排下的基线对齐（未渲染对比）
- 截图期间浏览器记录到 4 条 HTTP 401（登录前的受保护 API 请求所致，**推断**，未逐条核对请求）

---

## 11. 证据索引

| # | 来源 | 用途 |
|---|---|---|
| S1 | https://ui.shadcn.com/docs/tailwind-v4 | Tailwind v4 + React 19、`@theme inline`、OKLCH、tw-animate-css |
| S2 | https://ui.shadcn.com/docs | 组件是开放源码、组合式、CLI 分发 |
| S3 | https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default | Base UI 默认；Radix 不弃用、无需迁移、`-b radix` |
| S4 | https://base-ui.com/react/overview/releases | v1.7.0 2026-08-04；v1.0.0 35 组件；a11y 修复 |
| S5 | https://ark-ui.com/docs/overview/introduction | Zag.js、跨框架、40+ accessible components |
| S6 | https://ui.shadcn.com/docs/components/chart | Recharts v3、ChartContainer 需高度、CSS 变量/OKLCH 着色 |
| S7 | https://www.radix-ui.com/themes/docs/overview/getting-started | Radix Themes 需全局 CSS + `<Theme>` |
| S8 | https://motion.dev/docs/react-accessibility | `MotionConfig reducedMotion` / `useReducedMotion` |
| S9 | https://tailwindcss.com/docs/colors | Tailwind v4 调色板为 OKLCH |
| S10 | https://github.com/radix-ui/primitives | WorkOS 维护、19 245 stars |
| S11 | https://github.com/pacocoursey/cmdk ；https://ui.shadcn.com/docs/components/radix/sonner | cmdk；shadcn 组件页结构 |
| S12 | https://date-fns.org/docs/Getting-Started | date-fns v4 文档 |
| S13 | https://echarts.apache.org/handbook/en/basics/import | ECharts 按需引入方式 |
| S14 | https://lucide.dev/guide/ | lucide 1600+ 图标、tree-shaking |
| S15 | https://ui.shadcn.com/docs/changelog/2026-01-base-ui | 双库同 API |
| S16 | https://tailwindcss.com/docs/compatibility | Tailwind v4 浏览器基线 Chrome 111 / Safari 16.4 / Firefox 128 |
| S17 | https://ui.shadcn.com/r/styles/new-york-v4/dialog.json （及 field/chart/command/kbd/table/checkbox/toggle-group/popover/progress/avatar.json） | shadcn 组件真实依赖：`radix-ui` 单包、`cmdk`、`recharts` |
| S18 | https://recharts.github.io/en-US/api/BarChart | `accessibilityLayer` prop |
| S19 | https://ui.shadcn.com/docs/components/radix/field | Field 组件族 API（Field/FieldLabel/FieldDescription/FieldError/FieldGroup/FieldSet/FieldLegend） |
| 本仓库 | `frontend/src/index.css`、`frontend/src/components/ui/*.tsx`、`frontend/src/types/case.ts`、`frontend/src/store/ui.ts`、`frontend/src/components/admin/MemberTable.tsx`、`frontend/src/components/shell/{Toasts,format}.ts(x)`、`frontend/package.json` | 现状盘点 |
| 截图 | §2.1 19 个附件 URL | 现状对照 |
| Spike | worktree `spike/w5-stack`（未 push）：`frontend/spike/entries/*.tsx`、`spike/measure.mjs`、`spike/tokens.mjs`、`spike/tsconfig.json` | 体积 / tsc / tokens 生成脚本；本文档表格即其输出 |
