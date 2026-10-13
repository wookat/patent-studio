import { useSyncExternalStore, type ReactNode } from 'react'

/**
 * W9 view-switch 单元留给其他单元的两个插槽（注册表模式，与 lib/slots 同思路；本单元不 import 它们的内部）：
 *  - `bottomBarActions`：375 底部工具栏中段的按钮（format-toolbar 单元提供 B / 插入 … 的 command）；
 *  - `rightRail`：版面卡右侧 320 栏内容（review-rail 单元提供审阅面板）。
 * 集成时可并入 LayoutViewSlots.rightRail（见 integration_requests）。
 */
export interface SlotItem {
  id: string
  /** 排序（小在前） */
  order?: number
  render(): ReactNode
}

function createSlot(name: string) {
  const items = new Map<string, SlotItem>()
  const subs = new Set<() => void>()
  let snapshot: readonly SlotItem[] = []
  const emit = () => {
    snapshot = [...items.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    for (const cb of subs) cb()
  }
  return {
    name,
    register(item: SlotItem): () => void {
      items.set(item.id, item)
      emit()
      return () => {
        if (items.get(item.id) === item) {
          items.delete(item.id)
          emit()
        }
      }
    },
    list: () => snapshot,
    subscribe(cb: () => void) {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
    /** 测试用 */
    clear() {
      items.clear()
      emit()
    },
  }
}

export const bottomBarActions = createSlot('bottomBarActions')
export const rightRailSlot = createSlot('rightRail')

export type WorkbenchSlot = ReturnType<typeof createSlot>

export function useSlotItems(slot: WorkbenchSlot): readonly SlotItem[] {
  return useSyncExternalStore(slot.subscribe, slot.list, slot.list)
}

export interface HistoryProvider {
  canUndo(): boolean
  canRedo(): boolean
  undo(): boolean
  redo(): boolean
}

export interface HistoryState {
  ready: boolean
  canUndo: boolean
  canRedo: boolean
}

const HISTORY_IDLE: HistoryState = { ready: false, canUndo: false, canRedo: false }

function createHistorySlot() {
  let provider: HistoryProvider | null = null
  let snapshot: HistoryState = HISTORY_IDLE
  const subs = new Set<() => void>()
  const emit = () => {
    const next: HistoryState = provider ? { ready: true, canUndo: provider.canUndo(), canRedo: provider.canRedo() } : HISTORY_IDLE
    if (next.ready !== snapshot.ready || next.canUndo !== snapshot.canUndo || next.canRedo !== snapshot.canRedo) snapshot = next
    for (const cb of subs) cb()
  }
  return {
    /** 版面编辑器挂载时注册自己的撤销栈；返回注销函数。文档 / 选区变化后调 `notify()` 刷新按钮态 */
    register(p: HistoryProvider): () => void {
      provider = p
      emit()
      return () => {
        if (provider === p) {
          provider = null
          emit()
        }
      }
    },
    notify: emit,
    undo: () => (provider ? provider.undo() : false),
    redo: () => (provider ? provider.redo() : false),
    getState: () => snapshot,
    subscribe(cb: () => void) {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
    /** 测试用 */
    clear() {
      provider = null
      emit()
    },
  }
}

/**
 * 375 底栏「撤销 / 重做」的目标：版面视图注册整书 ProseMirror 历史；未注册时底栏退回 CodeMirror 源码历史。
 * 两套历史不可混用——源码历史回滚的是整段落盘补丁（含「接受修订」这类非键入事务），会把已接受文本变回 `{++…++}`。
 */
export const layoutHistory = createHistorySlot()

export function useLayoutHistory(): HistoryState {
  return useSyncExternalStore(layoutHistory.subscribe, layoutHistory.getState, layoutHistory.getState)
}
