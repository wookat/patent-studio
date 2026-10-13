import { createElement, type ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { PanelErrorBoundary } from '@/components/ui/error-boundary'
import { BOOK_LABELS } from '@/lib/docset'
import { PANEL_KINDS, parsePanelId, type BookView, type PanelId, type PanelKind } from '@/store/layout'

/**
 * 面板注册表（docs/plan/08-r4-dockview-design.md §3）。
 * kind（= dockview `contentComponent` 名）→ React 组件 + 图标 + 标题函数。
 * 面板 id = `kind[:book]`；同一 kind 带书参数的卡片（source / structure）可同时打开多张，其余 kind 单实例。
 * D1 在 layout/panels.tsx 注册内建面板；轨道 E/F 只需 `registerPanel('ai', {...})`，不改本文件。
 */

export interface PanelParams {
  /** source / structure 卡片的书；其他 kind 为 null */
  book: BookView | null
}

/** dockview 传给面板组件的 props 子集（与 dockview-react `IDockviewPanelProps<PanelParams>` 兼容；D1 直接透传） */
export interface PanelComponentProps {
  params: PanelParams
  api: { id: string; isActive: boolean; setActive(): void; close(): void; setTitle(title: string): void }
}

export interface PanelDef {
  component: ComponentType<PanelComponentProps>
  icon: LucideIcon
  /** kind 级名称（菜单分组 / 不带书），如「源码」「结构」「PDF」 */
  label: string
  /** tab 标题；带书的 kind 会收到 book */
  title: (params: PanelParams) => string
  /** 允许多实例（按 book 区分）；缺省 false */
  perBook?: boolean
  /** 所在 group 的最小宽（px）；宿主在 addPanel / fromJSON 后用 group.api.setConstraints 套用（W5 §4.3：ai 面板 min 280） */
  minWidth?: number
}

/** 面板级最小宽：同一 group 内取最大值；都未声明 ⇒ undefined（交给 dockview 缺省） */
export function groupMinWidth(panelIds: readonly string[]): number | undefined {
  let w: number | undefined
  for (const id of panelIds) {
    const m = describePanel(id)?.def.minWidth
    if (m != null && (w == null || m > w)) w = m
  }
  return w
}

const defs = new Map<PanelKind, PanelDef>()

export function registerPanel(kind: PanelKind, def: PanelDef): void {
  if (!(PANEL_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown panel kind: ${kind}`)
  defs.set(kind, def)
}

export function getPanel(kind: PanelKind): PanelDef | undefined {
  return defs.get(kind)
}

export function listPanels(): [PanelKind, PanelDef][] {
  return PANEL_KINDS.filter((k) => defs.has(k)).map((k) => [k, defs.get(k)!])
}

/** 面板卡级错误边界：单卡渲染崩溃只死该卡（重试/关闭），不再白屏整个工作台（批17 伴随栏同模式） */
function withBoundary(def: PanelDef): ComponentType<PanelComponentProps> {
  const Inner = def.component
  const Wrapped = (props: PanelComponentProps) =>
    createElement(
      PanelErrorBoundary,
      // oxlint-disable-next-line react/no-children-prop —— 本文件为 .ts 无 JSX，createElement 只能经 props 传 children
      { label: def.title(props.params), onClose: () => props.api.close(), children: createElement(Inner, props) },
    )
  Wrapped.displayName = `PanelBoundary(${def.label})`
  return Wrapped
}

/** dockview `components` 映射：kind → 组件（DockviewReact 的 components prop） */
export function panelComponents(): Record<string, ComponentType<PanelComponentProps>> {
  return Object.fromEntries(listPanels().map(([k, d]) => [k, withBoundary(d)]))
}

/** 由面板 id 得到注册表条目与标题；未注册 / 非法 id → null */
export function describePanel(id: PanelId): { kind: PanelKind; params: PanelParams; def: PanelDef; title: string } | null {
  const p = parsePanelId(id)
  if (!p) return null
  const def = defs.get(p.kind)
  if (!def) return null
  const params: PanelParams = { book: p.book }
  return { kind: p.kind, params, def, title: def.title(params) }
}

/** 书视图的可读名（tab 标题用）：全文 / 摘要 / 权利要求书 / 说明书 */
export function bookViewLabel(book: BookView | null): string {
  return book === null || book === 'all' ? '全文' : BOOK_LABELS[book]
}

/** 测试 / HMR 用 */
export function clearPanels(): void {
  defs.clear()
}
