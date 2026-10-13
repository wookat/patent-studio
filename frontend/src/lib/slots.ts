import { useSyncExternalStore } from 'react'
import type { Extension } from '@codemirror/state'
import type { ComponentType, ReactNode } from 'react'
import type { BookName } from '@/types/ast'

/**
 * 注入点注册表（21 §5.5 prep ⑥）：功能单元不改 `editor/** · layout-view/** · preview/**`，
 * 在自己的模块顶层 `registerXxx(id, ...)` 即可把 CodeMirror 扩展 / 版面块装饰 / PDF 浮层挂进三视图。
 *
 * - 幂等：同 id 重复注册覆盖（HMR 友好）；返回的函数用于注销。
 * - 响应式：消费端 `useEditorSlotExtensions()` 等 hook 走 useSyncExternalStore，lazy 单元晚注册也生效。
 * - 顺序：按 `order`（默认 0）升序，同序按注册先后。
 * - 消费点（prep 接线后冻结给 three-view 单元）：Editor.tsx（extensions 合并）· LayoutView.tsx（块级 `<LayoutDecorations/>`）· PdfPreview.tsx（`<PdfOverlays/>`）。
 */

interface Entry<T> {
  id: string
  order: number
  seq: number
  value: T
}

class Registry<T> {
  private map = new Map<string, Entry<T>>()
  private seq = 0
  private listeners = new Set<() => void>()
  private snapshot: readonly T[] = []

  register(id: string, value: T, order = 0): () => void {
    this.map.set(id, { id, order, seq: this.seq++, value })
    this.emit()
    return () => {
      if (this.map.get(id)?.value === value) {
        this.map.delete(id)
        this.emit()
      }
    }
  }

  unregister(id: string): void {
    if (this.map.delete(id)) this.emit()
  }

  private emit() {
    this.snapshot = [...this.map.values()].sort((a, b) => a.order - b.order || a.seq - b.seq).map((e) => e.value)
    for (const l of this.listeners) l()
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  getSnapshot = () => this.snapshot

  /** 仅测试用 */
  clear(): void {
    this.map.clear()
    this.emit()
  }
}

/* ---------------- 源码视图：CodeMirror 扩展 ---------------- */

/** 每次渲染 CodeMirror state 时调用；返回 Extension（可为数组 / []）。ai-panel 用它挂 Proposal gutter 标记 */
export type EditorExtensionFactory = () => Extension

const editorExtensions = new Registry<EditorExtensionFactory>()

export function registerEditorExtension(id: string, factory: EditorExtensionFactory, order?: number): () => void {
  return editorExtensions.register(id, factory, order)
}

export function useEditorSlotExtensions(): readonly EditorExtensionFactory[] {
  return useSyncExternalStore(editorExtensions.subscribe, editorExtensions.getSnapshot, editorExtensions.getSnapshot)
}

/* ---------------- 版面视图：块旁装饰 ---------------- */

export interface LayoutDecorationProps {
  book: BookName
  /** AST 块 id（= Focus.blockId） */
  blockId: string
  /** 块在纸面上的 DOM（用于测量 / 定位气泡） */
  element: HTMLElement | null
}

/** 返回 null 则该块无装饰。ai-panel（内嵌建议卡）/ notify-review（批注计数）用 */
export type LayoutDecorationFactory = (props: LayoutDecorationProps) => ReactNode

const layoutDecorations = new Registry<LayoutDecorationFactory>()

export function registerLayoutDecoration(id: string, factory: LayoutDecorationFactory, order?: number): () => void {
  return layoutDecorations.register(id, factory, order)
}

export function useLayoutDecorations(): readonly LayoutDecorationFactory[] {
  return useSyncExternalStore(layoutDecorations.subscribe, layoutDecorations.getSnapshot, layoutDecorations.getSnapshot)
}

/* ---------------- PDF 视图：页面浮层 ---------------- */

export interface PdfOverlayProps {
  /** 1-based 页码 */
  page: number
  /** 当前渲染宽高（CSS px，已含 zoom） */
  width: number
  height: number
  /** 当前展示的 PDF url（含 build 版本参数；与 build.pdfUrl / pdf_tagged 元数据对齐） */
  url: string
  /** 该页是否在前台槽（双缓冲中隐藏槽也会渲染） */
  active: boolean
}

/** 绝对定位在每页 `<div data-page>` 内（容器 position:relative）。three-view 的定位高亮 / 失败气泡用 */
export type PdfOverlayComponent = ComponentType<PdfOverlayProps>

const pdfOverlays = new Registry<PdfOverlayComponent>()

export function registerPdfOverlay(id: string, Component: PdfOverlayComponent, order?: number): () => void {
  return pdfOverlays.register(id, Component, order)
}

export function usePdfOverlays(): readonly PdfOverlayComponent[] {
  return useSyncExternalStore(pdfOverlays.subscribe, pdfOverlays.getSnapshot, pdfOverlays.getSnapshot)
}

/* ---------------- 顶栏 / 侧栏动作 ---------------- */

export interface ActionSlotItem {
  id: string
  /** 渲染函数（拿到 compact=移动/窄屏） */
  render: (ctx: { compact: boolean }) => ReactNode
}

const topBarItems = new Registry<ActionSlotItem>()
const railItems = new Registry<ActionSlotItem>()

/** 工作台顶栏右侧（UserMenu 左边）；notify-review 放通知铃铛 */
export function registerTopBarItem(item: ActionSlotItem, order?: number): () => void {
  return topBarItems.register(item.id, item, order)
}
export function useTopBarItems(): readonly ActionSlotItem[] {
  return useSyncExternalStore(topBarItems.subscribe, topBarItems.getSnapshot, topBarItems.getSnapshot)
}

/** 桌面左侧 Rail 底部；dashboard/deadlines 单元放入口图标 */
export function registerRailItem(item: ActionSlotItem, order?: number): () => void {
  return railItems.register(item.id, item, order)
}
export function useRailItems(): readonly ActionSlotItem[] {
  return useSyncExternalStore(railItems.subscribe, railItems.getSnapshot, railItems.getSnapshot)
}

/* ---------------- W6 伴随栏（CompanionPanel）正文 ---------------- */

/**
 * 伴随栏正文注册（W6 prep；消费点 shell/CompanionHost.tsx）：单元在模块顶层
 * `registerCompanionBody('ai', AgentPanelBody)` 即可把面板正文挂进 DesktopShell 第 4 列 / 移动 Sheet，不改 CompanionHost。
 * id 值域 = store/ui.ts CompanionId；每 id 只取最后一次注册（HMR 友好）。正文组件自滚、无 primary 按钮。
 */
export interface CompanionBodyEntry {
  id: string
  Component: ComponentType
  /** 头部右侧 ghost 图标动作（可选） */
  actions?: ComponentType
}

const companionBodies = new Registry<CompanionBodyEntry>()

export function registerCompanionBody(id: string, Component: ComponentType, actions?: ComponentType): () => void {
  return companionBodies.register(id, { id, Component, actions })
}
export function useCompanionBodies(): readonly CompanionBodyEntry[] {
  return useSyncExternalStore(companionBodies.subscribe, companionBodies.getSnapshot, companionBodies.getSnapshot)
}

