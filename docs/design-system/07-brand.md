# 设计系统 07 · 品牌识别（VI V1 定稿）

- 日期：2026-10-03
- 性质：**已上线事实档**。VI V1 由 PR #336 落地（develop@ee49b29 系），本文档记录定稿规格与使用规则，不是提案。

## 0. 定稿一览

| # | 项目 | 定稿 | 备注 |
|---|---|---|---|
| B1 | 标志 | **方向 B：篆刻「专」字方印**（Thomas 拍板） | 墨青方印 + 白文篆体「专」+ 翠绿压线 |
| B2 | 标志源文件 | `frontend/public/logo-mark.svg`（22KB，vtracer 矢量化，单源） | favicon・顶栏・登录区全部引用同一文件 |
| B3 | 登录品牌区底纹 | 专利证书纽索纹（雕刻线），亮暗双版 | `.brand-hero` 类，正文区不铺设 |
| B4 | 品牌色 | 墨青 `#162732` / 翠绿 `#18875E` / 纸白 `#F8F7F2` | 功能色体系不动，品牌色只进品牌位 |
| B5 | 否决项 | 方向 A「印玺笔尖 + 朱砂点睛」落选 → **朱砂红不作品牌色** | 避免与状态红混淆 |

## 1. 标志规格

`logo-mark.svg` 结构：`viewBox 0 0 744 766`，`rx=96` squircle 裁切，底 `#162732`，白文「专」`#F8F7F2`，底缘压线 `#18875E`。

| 槽位 | 文件 | 尺寸 |
|---|---|---|
| favicon | `index.html` link[rel=icon] | SVG 自适应 |
| TopBar | `shell/TopBar.tsx` | `size-6 rounded-sm` |
| 登录/领取页 BrandMark | `auth/AuthFrame.tsx` | `size-7`（sm）/ `size-8`（md），圆角随档位 |
| 台账顶栏 home | `dashboard/OrgShell.tsx` | `size-6 rounded-sm` |
| 页面壳 home | `shell/PageChrome.tsx`（account/admin/deadlines/inbox/deliver 共用一个壳） | `size-6 rounded-sm` |

规则：
- **单源**：任何品牌位一律引 `/logo-mark.svg`，禁止再贴 PNG 副本或 Lucide `FileText` 代替（V1 走查曾在 OrgShell/PageChrome 漏过两处）。
- 四角圆角由使用方 `rounded-*` 类控制（小尺寸 `rounded-sm`，中尺寸 `rounded-md`），SVG 本身已带 squircle 裁切。
- `alt=""` + `aria-hidden`：品牌位均相邻文字商标「知撰」，图属装饰。
- 禁止改色/加阴影/旋转；深色主题下同一份 SVG（墨青在暗底对比合格，勿出反白版）。

## 2. 品牌色

| 色 | hex | 用途 |
|---|---|---|
| 墨青 | `#162732` | 印面底色、品牌区主文字 |
| 翠绿 | `#18875E` | 压线、品牌强调（与 UI 功能绿 `--success` 分离使用） |
| 纸白 | `#F8F7F2` | 印文、品牌区浅底 |

品牌色**不进功能 token 体系**——状态色/交互色仍走 01 号档的 OKLCH tokens；品牌色只出现在品牌位与品牌区。

## 3. 登录品牌区底纹（`.brand-hero`）

`frontend/src/index.css`：

```css
.brand-hero { background-color: var(--bg-sunken); background-image: url('/brand-bg-light.jpg'); background-size: cover; background-position: center; }
.dark .brand-hero { background-image: url('/brand-bg-dark.jpg'); }
```

- 资产：`frontend/public/brand-bg-light.jpg`（96KB）/ `brand-bg-dark.jpg`（48KB），纽索纹（guilloche）雕刻线，源图经 vtracer 转 SVG 再回写 JPG 位图（位图体积小、渲染便宜，底纹本就无矢量化收益）。
- 仅登录/领取页 `AuthFrame` 品牌区使用；正文区、面板、对话框一律素底。
- 底纹对比度刻意压低（视觉装饰层），可读性由 `--bg-sunken` 底色保证；叠加文字一律 `text-foreground` 系 token。

## 4. 资产生成管线（复用记录）

`logo-mark.svg` 与底纹经 vtracer（`pip install vtracer`）矢量化，要点：

- `vtracer.convert_image_to_svg_py(..., hierarchical='stacked', mode='spline', filter_speckle=8)`——stacked 追踪产出的 subpath **带非零 `transform="translate(...)"`**，提取 path 重组 SVG 时**必须保留 transform**，否则整组偏移裁掉（V1 首轮翻车点）。
- 底布 `#162732` 与四角补片色按 fill 丢弃后包 `clipPath` 圆角矩形。

## 5. 后续路线（未拍板项）

- V3 空态/错误插画族：沿用雕刻线语言，SVG 化后接 EmptyState 组件面（空台账/无通知/无期限等面）。
  - 首件已落地：`empty-dossier.webp`（448px 透明底雕线案卷+印，96KB）——`EmptyState.illustration` 槽替代图标芯片（仅 md 生效），台账全空英雄位启用；暗色 `dark:invert` 翻墨青→暖白。管线：生成 PNG → 亮度转 alpha → WebP；SVG 矢量化版留 `/home/ubuntu/ps-audit/vi/` 备后续错误族用。
  - 第二批：`empty-inbox.webp`（信封+火漆印，收件箱 all 空态仅桌面）、`empty-deadline.webp`（台历+沙漏，期限页空态）、`error-boundary.webp`（裂碑+卷轴，AppErrorBoundary 整屏兜底替图标芯片）。
- 品牌位扩面：公开分享页/客户确认页的品牌露出是否升级，待走查反馈。
- PWA/apple-touch-icon：现仅 SVG favicon，iOS 主屏添加快捷图标需 PNG 180px 派生件（未做）。
