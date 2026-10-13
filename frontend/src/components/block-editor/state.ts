import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { FocusSource } from '@/types/focus'

/**
 * 块编辑器打开请求（21 §5.4）：PDF 双击 / 版面移动端 / 任何来源都可 `openBlockEditor`；
 * <BlockEditorHost/>（挂在预览面板）消费。模块级外部 store，不进 zustand（瞬态 UI，不持久化）。
 */
/** 选块在视口里的包围盒（横向 = 所在 PDF 页 / 版面纸，纵向 = 被点的那一行），桌面卡片据此锚到块的右侧或下方 */
export interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

export interface BlockEditorAnchor {
  x: number
  y: number
  rect?: AnchorRect
}

export interface BlockEditorRequest {
  blockId: string
  /** 触发来源；保存后按此来源重发 Focus（PDF 重建后 overlay 按新索引重画） */
  source: FocusSource
  /** 桌面卡片锚点（视口坐标）：有 rect 时锚在块右侧 / 下方，只有点击点时锚在点击处；缺省居中 */
  anchor?: BlockEditorAnchor
  /** 打开瞬间的块原行（`blockSource` 快照）：patchBlock 乐观并发基线，服务端发现块被改 → 409 */
  base?: string
}

/** 由 PDF 文字层 / 版面里被点的元素算锚点：横向取其所在页（`[data-page]`），纵向取该元素本身 */
export function anchorFromElement(el: Element, point: { x: number; y: number }): BlockEditorAnchor {
  const page = el.closest('[data-page]') ?? el
  const er = el.getBoundingClientRect()
  const pr = page.getBoundingClientRect()
  return { ...point, rect: { left: pr.left, top: er.top, width: pr.width, height: er.height } }
}

let current: BlockEditorRequest | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openBlockEditor(req: BlockEditorRequest): void {
  current = req
  emit()
}

export function closeBlockEditor(): void {
  if (!current) return
  current = null
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const get = () => current

export function getBlockEditorRequest(): BlockEditorRequest | null {
  return current
}

export function useBlockEditorRequest(): BlockEditorRequest | null {
  return useSyncExternalStore(subscribe, get, get)
}

/**
 * 宿主可能同时挂在多个 PdfPreview（桌面 dock 多卡片）；只有最先挂载的一个渲染，避免弹两份。
 * 占用 / 释放都在 effect 里（StrictMode 的 挂载→卸载→重挂 后仍能重新占用）；前一个宿主卸载后下一个接管。
 */
let owner: symbol | null = null
const hosts: symbol[] = []
const ownerListeners = new Set<() => void>()
const emitOwner = () => ownerListeners.forEach((l) => l())
const subscribeOwner = (l: () => void) => {
  ownerListeners.add(l)
  return () => ownerListeners.delete(l)
}

export function claimHost(me: symbol): void {
  hosts.push(me)
  if (!owner) {
    owner = me
    emitOwner()
  }
}

export function releaseHost(me: symbol): void {
  const i = hosts.indexOf(me)
  if (i >= 0) hosts.splice(i, 1)
  if (owner === me) {
    owner = hosts[0] ?? null
    emitOwner()
  }
}

export function useHostOwnership(): boolean {
  const me = useRef<symbol | null>(null)
  if (me.current === null) me.current = Symbol('block-editor-host')
  useEffect(() => {
    const token = me.current!
    claimHost(token)
    return () => releaseHost(token)
  }, [])
  return useSyncExternalStore(
    subscribeOwner,
    () => owner === me.current,
    () => false,
  )
}
