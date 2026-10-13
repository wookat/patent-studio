import { useSyncExternalStore } from 'react'
import type { PanelId } from '@/store/layout'

/**
 * 面板头插槽（05 §1.7 / §4 S3：面板头 --h-panel-header 32 **单行** = dockview 文件 Tab + 视图 Tabs + 工具）。
 * dockview 每个 group 的标题栏右侧（GroupActions）为**活动面板**挂一个空容器并在此登记；
 * 卡片（CardHeader）拿到自己的容器后用 createPortal 把「源码|版面|PDF + 脏标 + 工具 + 打开为…」渲染进去，
 * 不再在卡片正文上方再画一行 32 —— 消除 W5 的双层头（02-w6-page-audit #10）。
 * 无 dock（窄桌面回退 / 单测直接挂卡片）时插槽为 null，CardHeader 退回卡片内单行头。
 */
const slots = new Map<PanelId, HTMLElement>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function setHeaderSlot(panelId: PanelId, el: HTMLElement | null): void {
  if (el) {
    if (slots.get(panelId) === el) return
    slots.set(panelId, el)
  } else if (!slots.delete(panelId)) return
  notify()
}

export function getHeaderSlot(panelId: PanelId): HTMLElement | null {
  return slots.get(panelId) ?? null
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useHeaderSlot(panelId: PanelId | undefined): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => (panelId ? getHeaderSlot(panelId) : null))
}

/** 仅测试用 */
export function resetHeaderSlots(): void {
  slots.clear()
  notify()
}
