import type { Focus, PdfLocateFail } from '@/types/focus'
import type { Slice } from './types'

/**
 * W5 三视图共享定位（docs/plan/21 §5.2）。
 * 写：任一来源调 `setFocus`（seq 自增）；读：源码 / 版面 / PDF 各自 `subscribe(s => s.focus)` 按 seq 判重后滚动 + 闪烁 1.2s。
 * 对照锁 `compareLock` 仍在 layout slice（`setCompareLock`）；这里的 `toggleCompareLock` 只是同名别名，热键 `Mod-Shift-L` 走它。
 * 单元 three-view 填实 PdfBlockIndex 并写 `pdfLocateFail`；prep 只定形状。
 */
export interface FocusSlice {
  focus: Focus | null
  /** 最近一次 PDF 定位失败原因（成功或清除时 null）；状态栏 aria-live 播报 */
  pdfLocateFail: PdfLocateFail | null
  /** 多候选时的候选页（≤3；用户选一个后清空） */
  pdfLocateCandidates: { page: number; score: number }[]
  /** `#/p/<pid>?focus=<block_id>` 待消费请求（R56-02）：hash 路由先挂起，案 + AST 就绪后由 shell 定位并清掉 */
  focusRequest: { pid: string; blockId: string } | null

  setFocus(f: Omit<Focus, 'seq'>): void
  clearFocus(): void
  setPdfLocateFail(reason: PdfLocateFail | null, candidates?: { page: number; score: number }[]): void
  requestFocusBlock(pid: string, blockId: string): void
  clearFocusRequest(): void
  toggleCompareLock(): void
}

let seq = 0

export const focusSlice: Slice<FocusSlice> = (set, get) => ({
  focus: null,
  pdfLocateFail: null,
  pdfLocateCandidates: [],
  focusRequest: null,

  requestFocusBlock: (pid, blockId) => set({ focusRequest: { pid, blockId } }),
  clearFocusRequest: () => set({ focusRequest: null }),

  setFocus: (f) => {
    seq += 1
    set({ focus: { ...f, seq }, pdfLocateFail: null, pdfLocateCandidates: [] })
  },
  clearFocus: () => set({ focus: null, pdfLocateFail: null, pdfLocateCandidates: [] }),
  setPdfLocateFail: (reason, candidates = []) => set({ pdfLocateFail: reason, pdfLocateCandidates: reason === 'ambiguous' ? candidates : [] }),
  toggleCompareLock: () => get().setCompareLock(),
})
