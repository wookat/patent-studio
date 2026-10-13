import { ApiError, api } from '@/lib/api'
import { blockAtLine, type Ast, type BlockLocation } from '@/types/ast'
import type { Slice } from './types'

/** 谁把某块设为当前块（docs/plan/04-r1-design.md §5.3）；结构预览仅在 source ≠ 'structure' 时滚动跟随 */
export type ActiveBlockSource = 'editor' | 'structure' | 'outline'

export interface ActiveBlock {
  id: string
  source: ActiveBlockSource
}

/** 编辑停止 → POST /ast 的防抖（04 §5.3 / TE-9：200ms；不占构建锁，与 build.debounceMs 无关） */
export const AST_DEBOUNCE_MS = 200

export interface AstSlice {
  /** 最近一次成功解析的 AST（请求中/失败时保留旧值） */
  ast: Ast | null
  /** ast 对应的 content 快照；ast != null 且 !== content 即 astStale */
  astContent: string | null
  astLoading: boolean
  /** 最近一次 /ast 失败的消息（路由 501 期间恒为 "R1 B2 未实现…"；不弹 toast） */
  astError: string | null
  /** 已请求过 AST 的 pid（切案时清空 ast） */
  astPid: string | null
  /** 后端 /ast 返回 501（未实现）：本案内不再随编辑重试，直到 resetAst / 显式 loadAst */
  astUnavailable: boolean
  activeBlock: ActiveBlock | null

  /** 立即请求 pid 的 AST（默认用当前编辑区内容 + 当前设置；打开案子时用磁盘内容）；最新者胜 */
  loadAst(pid: string, opts?: { fromDisk?: boolean }): Promise<Ast | null>
  /** setContent 后调用：防抖 AST_DEBOUNCE_MS 再 loadAst(当前 pid) */
  scheduleAst(): void
  cancelAst(): void
  setActiveBlock(id: string | null, source: ActiveBlockSource): void
  /** 编辑器光标行（全文 1-based）→ 所在块；找不到则清空 activeBlock */
  selectBlockAt(fullLine: number): BlockLocation | null
  /** 切案 / 关闭案子时清空 */
  resetAst(): void
}

let astTimer: ReturnType<typeof setTimeout> | null = null
let astAbort: AbortController | null = null
let astSeq = 0

export const astSlice: Slice<AstSlice> = (set, get) => ({
  ast: null,
  astContent: null,
  astLoading: false,
  astError: null,
  astPid: null,
  astUnavailable: false,
  activeBlock: null,

  loadAst: async (pid, opts) => {
    get().cancelAst()
    const seq = ++astSeq
    const ctrl = new AbortController()
    astAbort = ctrl
    const s = get()
    const content = opts?.fromDisk ? null : s.content
    const body = opts?.fromDisk ? {} : { content: s.content, settings: s.settings ?? undefined }
    set({ astLoading: true, astPid: pid })
    try {
      const ast = await api.getAst(pid, body, ctrl.signal)
      if (seq !== astSeq) return null
      set({ ast, astContent: content ?? get().content, astLoading: false, astError: null, astUnavailable: false })
      return ast
    } catch (e) {
      if (seq !== astSeq || ctrl.signal.aborted) return null
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
      set({ astLoading: false, astError: msg, astUnavailable: e instanceof ApiError && e.status === 501 })
      return null
    } finally {
      if (astAbort === ctrl) astAbort = null
    }
  },

  scheduleAst: () => {
    if (astTimer) clearTimeout(astTimer)
    astTimer = setTimeout(() => {
      astTimer = null
      const { pid, project, astUnavailable } = get()
      if (pid && project && !astUnavailable) void get().loadAst(pid)
    }, AST_DEBOUNCE_MS)
  },

  cancelAst: () => {
    if (astTimer) {
      clearTimeout(astTimer)
      astTimer = null
    }
    if (astAbort) {
      astAbort.abort()
      astAbort = null
    }
    astSeq++
    if (get().astLoading) set({ astLoading: false })
  },

  setActiveBlock: (id, source) => {
    const cur = get().activeBlock
    if (id === null) {
      if (cur) set({ activeBlock: null })
      return
    }
    if (cur && cur.id === id && cur.source === source) return
    set({ activeBlock: { id, source } })
  },

  selectBlockAt: (fullLine) => {
    const ast = get().ast
    if (!ast) return null
    const loc = blockAtLine(ast, fullLine)
    get().setActiveBlock(loc ? loc.block.id : null, 'editor')
    return loc
  },

  resetAst: () => {
    get().cancelAst()
    set({ ast: null, astContent: null, astError: null, astPid: null, astUnavailable: false, activeBlock: null })
  },
})

/** AST 落后于编辑区（请求中或最近一次失败）；无 AST 时 false（F1 据此显示"正在更新"细条而非空白） */
export const selectAstStale = (s: { ast: Ast | null; astContent: string | null; content: string }) =>
  s.ast !== null && s.astContent !== s.content
