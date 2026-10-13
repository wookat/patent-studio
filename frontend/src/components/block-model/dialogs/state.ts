import { create } from 'zustand'
import type { TableSpec } from './table'

/**
 * 结构编辑对话框的开合状态（06 §5.4：受控组件，一次只开一个）。
 * 与主 store 分开：对话框只在结构视图内部有意义，且 B3 不改共享 store/*（§7）。
 * 打开方由工具条 / 把手 / B2 公式节点调用 open*()，`StructureDialogs`（全局单例）读状态渲染。
 * close() 只翻 open=false、保留 payload（关闭动画期间内容不闪）；seq 每次打开递增，供宿主以 key 重挂对话框重置内部状态。
 */
export type DialogPayload =
  | { kind: 'formula'; initial: string; onSubmit: (source: string) => void; returnTo: string | null }
  | { kind: 'table'; initial: TableSpec | null; onSubmit: (markdown: string) => void; returnTo: string | null }
  | { kind: 'figure'; onSubmit: (markdown: string) => void; returnTo: string | null }
  | { kind: 'delete'; blockId: string; returnTo: string | null }

interface DialogStore {
  open: boolean
  seq: number
  payload: DialogPayload | null
  show(payload: DialogPayload): void
  close(): void
}

export const useDialogStore = create<DialogStore>((set) => ({
  open: false,
  seq: 0,
  payload: null,
  show: (payload) => set((s) => ({ open: true, seq: s.seq + 1, payload })),
  close: () => set({ open: false }),
}))

export interface OpenOptions {
  /** 关闭后焦点回到的块（data-block-id）；null = 交给 Radix 默认（回到打开前的焦点元素） */
  returnTo?: string | null
}

export function openFormulaDialog(initial: string, onSubmit: (source: string) => void, opts: OpenOptions = {}) {
  useDialogStore.getState().show({ kind: 'formula', initial, onSubmit, returnTo: opts.returnTo ?? null })
}

export function openTableDialog(initial: TableSpec | null, onSubmit: (markdown: string) => void, opts: OpenOptions = {}) {
  useDialogStore.getState().show({ kind: 'table', initial, onSubmit, returnTo: opts.returnTo ?? null })
}

export function openFigureDialog(onSubmit: (markdown: string) => void, opts: OpenOptions = {}) {
  useDialogStore.getState().show({ kind: 'figure', onSubmit, returnTo: opts.returnTo ?? null })
}

export function openDeleteDialog(blockId: string, opts: OpenOptions = {}) {
  useDialogStore.getState().show({ kind: 'delete', blockId, returnTo: opts.returnTo ?? null })
}

export const closeStructureDialog = () => useDialogStore.getState().close()

/**
 * 对话框 / 菜单内容的 onKeyDown：Escape 只关自己，不冒泡到 StructureView（它会退回源码视图）。
 * Radix 的 Escape 关闭监听挂在 document 捕获阶段，早于 React 冒泡，故这里 stopPropagation 不影响关闭。
 */
export function keepEscapeLocal(e: { key: string; stopPropagation(): void }) {
  if (e.key === 'Escape') e.stopPropagation()
}

/** 把焦点还给某个结构块（对话框 / 菜单 onCloseAutoFocus 用） */
export function focusBlock(id: string | null) {
  if (!id) return false
  for (const el of document.querySelectorAll<HTMLElement>('[data-block-id]')) {
    if (el.dataset.blockId === id) {
      el.focus()
      return true
    }
  }
  return false
}
