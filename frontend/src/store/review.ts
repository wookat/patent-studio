import { ApiError, api, isNotImplemented } from '@/lib/api'
import type { CriticMark, ReviewMode } from '@/lib/types'
import type { ReviewAssignResult } from '@/types/timeline'
import { levelForReviewMode, reviewModeFor, type MarkupLevel } from '@/components/layout-view/review/markupLevel'
import type { Slice } from './types'

/** ReviewRail 三 Tab（docs/plan/22 决策 5） */
export type ReviewRailTab = 'marks' | 'comments' | 'changes'

/** 编辑停止 → POST /critic 的防抖（与 AST_DEBOUNCE_MS 同 200ms） */
export const MARKS_DEBOUNCE_MS = 200

/**
 * R6 修订（docs/plan/07 §5.1 / §6）。
 * `reviewMode` 驱动构建（build.ts fire 传 mode）与 PDF 工具条 ModeSwitch；`marks` 来自后端 /critic，
 * CodeMirror 装饰（components/review/criticExtension）与审阅面板只消费 marks，不在前端解析。
 * 逐条接受/拒绝 = 用 mark 的 [from,to) 与 final/original 做纯文本替换（07 §4.2）。
 */
export interface ReviewSlice {
  reviewMode: ReviewMode
  marks: CriticMark[]
  marksLoading: boolean
  /** 后端 /critic 501（C2 未落地）：本案内不再随编辑重试 */
  marksUnavailable: boolean
  /** 审阅 Drawer（W5 §4.3：桌面右侧 320 伴随编辑器；375 全屏 Sheet） */
  reviewDrawerOpen: boolean
  /** `#/p/<pid>?c=<cid>` 到达：等该案打开后开 Drawer 并滚到批注（不随 resetReview 清空） */
  reviewRequest: { pid: string; cid: string } | null
  /** POST …/review-assign 501（share-confirm-backend 未落地） */
  reviewAssignUnavailable: boolean
  /** 版面四档标记（22 决策 4）；与 reviewMode 同步：all↔markup、original↔original、simple/none↔final */
  markupLevel: MarkupLevel
  /** ReviewRail 当前 Tab */
  reviewRailTab: ReviewRailTab
  /** 卡片 ↔ 正文双向高亮：当前激活的 CriticMark.id（`line:from`） */
  activeMarkId: string | null
  /** 修订卡片「回复」→ 批注 Tab 的待开草稿锚点（ReviewBody 挂载后消费） */
  replyDraft: { line: number; quote: string } | null
  /** 主批注草稿——批70 起存 store（ReviewBody 实例随 Tab/宿主卸载，本地态会静默丢稿）；null = 未开 */
  commentDraft: { line: number; quote: string; body: string } | null
  /** 每卡回复表单：key 在 = 回复表单开着，value = 已输入正文（'' 也合法，与 commentDraft 同理防卸载丢稿） */
  replyBodies: Record<string, string>

  /** 切模式；改变时立刻重建（enqueue 'manual'） */
  setReviewMode(mode: ReviewMode): void
  loadMarks(pid: string): Promise<CriticMark[] | null>
  /** setContent 后调用：防抖 MARKS_DEBOUNCE_MS 再 loadMarks(当前 pid) */
  scheduleMarks(): void
  cancelMarks(): void
  acceptMark(id: string): void
  rejectMark(id: string): void
  /** 整簇（同一逻辑修订的若干相邻标记）一次接受 / 拒绝 */
  acceptMarks(ids: readonly string[]): void
  rejectMarks(ids: readonly string[]): void
  acceptAll(): void
  rejectAll(): void
  openReviewDrawer(opts?: { commentId?: string }): void
  closeReviewDrawer(): void
  setReviewDrawerOpen(open: boolean): void
  toggleReviewDrawer(): void
  requestReviewComment(pid: string, cid: string): void
  clearReviewRequest(): void
  /** 切四档：同时把 PDF 卡 reviewMode 切到对应三档（触发重建） */
  setMarkupLevel(level: MarkupLevel): void
  setReviewRailTab(tab: ReviewRailTab): void
  setActiveMark(id: string | null): void
  setReplyDraft(d: { line: number; quote: string } | null): void
  setCommentDraft(d: { line: number; quote: string; body: string } | null): void
  /** body=null 删除键（关闭该卡回复表单） */
  setReplyBody(cid: string, body: string | null): void
  /** 指派审阅（R-REV-06）：成员 + 到期日 → api.reviewAssign；501 置 reviewAssignUnavailable；其余错误 toast；返回 null 表示失败 */
  assignReview(pid: string, userId: string, due: string | null): Promise<ReviewAssignResult | null>
  resetReview(): void
}

/** 对 content 应用一批标记的替换（同一行内按 from 从后往前，行号互不影响） */
export function applyMarks(content: string, marks: CriticMark[], pick: 'final' | 'original'): string {
  if (marks.length === 0) return content
  const lines = content.split('\n')
  const byLine = new Map<number, CriticMark[]>()
  for (const m of marks) {
    const arr = byLine.get(m.line) ?? []
    arr.push(m)
    byLine.set(m.line, arr)
  }
  for (const [line, arr] of byLine) {
    let s = lines[line - 1]
    if (s === undefined) continue
    for (const m of [...arr].sort((x, y) => y.from - x.from)) s = s.slice(0, m.from) + m[pick] + s.slice(m.to)
    lines[line - 1] = s
  }
  return lines.join('\n')
}

const OPEN: Record<CriticMark['kind'], string> = { ins: '{++', del: '{--', sub: '{~~', comment: '{>>', mark: '{==' }
const CLOSE: Record<CriticMark['kind'], string> = { ins: '++}', del: '--}', sub: '~~}', comment: '<<}', mark: '==}' }

/** mark 的 [from,to) 在当前正文里仍是一整个该类标记（不是解析：只看两端标记符，与 criticExtension 的 exact 判定同口径） */
export function markIntact(content: string, m: CriticMark): boolean {
  const line = content.split('\n')[m.line - 1]
  if (line === undefined || m.from < 0 || m.to > line.length) return false
  const seg = line.slice(m.from, m.to)
  const open = OPEN[m.kind]
  const close = CLOSE[m.kind]
  return seg.length >= open.length + close.length && seg.startsWith(open) && seg.endsWith(close)
}

/**
 * 已在本地应用了 `applied` 之后，把其余 marks 同一行、位于其右侧的列偏移按替换差值平移；与其区间相交的（不该发生）丢弃。
 * 后端 /critic 回来前（200ms 防抖 + 往返）连续接受 / 拒绝同一行的第二条标记，没有这一步就会按陈旧列切错（W7 qa-01）。
 */
export function shiftMarks(marks: CriticMark[], applied: CriticMark[], pick: 'final' | 'original'): CriticMark[] {
  const out: CriticMark[] = []
  for (const m of marks) {
    let from = m.from
    let to = m.to
    let dead = false
    for (const a of applied) {
      if (a.line !== m.line || a === m) continue
      if (a.to <= m.from) {
        const d = a[pick].length - (a.to - a.from)
        from += d
        to += d
      } else if (a.from < m.to) {
        dead = true
      }
    }
    if (dead) continue
    out.push(from === m.from ? m : { ...m, from, to })
  }
  return out
}

/** 廉价门：文本里连一个 CriticMarkup 开口都没有就不请求后端（不是解析，解析只在后端 critic.py） */
const CRITIC_OPENER = /\{(\+\+|--|~~|>>|==)/
export const mayHaveMarks = (content: string) => CRITIC_OPENER.test(content)

let marksTimer: ReturnType<typeof setTimeout> | null = null
let marksAbort: AbortController | null = null
let marksSeq = 0

export const reviewSlice: Slice<ReviewSlice> = (set, get) => {
  const apply = (ids: Set<string> | null, pick: 'final' | 'original') => {
    const { marks, content, pid } = get()
    const chosen = ids ? marks.filter((m) => ids.has(m.id)) : marks
    if (chosen.length === 0) return
    // 正文已被（协作方 / 本地键入）改到与 mark 位置对不上：不按陈旧列切，丢掉这条并立刻重取
    const intact = chosen.filter((m) => markIntact(content, m))
    // 协同在线必须写穿活房间/PUT，否则房间旧文回推、标记复活（D-B49-1）；逻辑收进 persistMergedContent
    if (intact.length) get().persistMergedContent(applyMarks(content, intact, pick))
    set({ marks: shiftMarks(marks.filter((m) => !chosen.includes(m)), intact, pick) })
    if (intact.length !== chosen.length && pid) void get().loadMarks(pid)
  }
  // 审阅栏打开时与伴随栏、移动端导航抽屉 / 更多 Sheet 互斥（先清让位记录，免得 closeCompanion 反过来恢复另一栏）
  const yieldCompanion = () => {
    const s = get()
    if (s.mobileNav.open) s.closeMobileNav()
    if (s.moreOpen) s.toggleMore(false)
    if (!s.companion) return
    set({ reviewHiddenByCompanion: null })
    s.closeCompanion()
  }
  return {
    reviewMode: 'final',
    marks: [],
    marksLoading: false,
    marksUnavailable: false,
    reviewDrawerOpen: false,
    reviewRequest: null,
    reviewAssignUnavailable: false,
    markupLevel: 'none',
    reviewRailTab: 'marks',
    activeMarkId: null,
    replyDraft: null,
    commentDraft: null,
    replyBodies: {},

    setReviewMode: (mode) => {
      if (get().reviewMode === mode) return
      set({ reviewMode: mode, markupLevel: levelForReviewMode(mode, get().markupLevel) })
      if (get().pid) get().enqueue('manual', true)
    },
    setMarkupLevel: (level) => {
      if (get().markupLevel !== level) set({ markupLevel: level })
      get().setReviewMode(reviewModeFor(level))
    },
    setReviewRailTab: (tab) => {
      if (get().reviewRailTab !== tab) set({ reviewRailTab: tab })
    },
    setActiveMark: (id) => {
      if (get().activeMarkId !== id) set({ activeMarkId: id })
    },
    setReplyDraft: (d) => set({ replyDraft: d }),
    setCommentDraft: (d) => set({ commentDraft: d }),
    setReplyBody: (cid, body) => {
      if (body === null) {
        if (!(cid in get().replyBodies)) return
        const next = { ...get().replyBodies }
        delete next[cid]
        set({ replyBodies: next })
      } else {
        set({ replyBodies: { ...get().replyBodies, [cid]: body } })
      }
    },

    loadMarks: async (pid) => {
      get().cancelMarks()
      const content = get().content
      if (!mayHaveMarks(content)) {
        if (get().marks.length) set({ marks: [] })
        return []
      }
      const seq = ++marksSeq
      const ctrl = new AbortController()
      marksAbort = ctrl
      set({ marksLoading: true })
      try {
        const r = await api.critic(pid, { content }, ctrl.signal)
        if (seq !== marksSeq) return null
        if (get().content !== content) {
          // 往返期间正文又变了（scheduleMarks 已排下一次）：这批 marks 的列已过期，不落地
          set({ marksLoading: false })
          return null
        }
        set({ marks: r.marks, marksLoading: false, marksUnavailable: false })
        return r.marks
      } catch (e) {
        if (seq !== marksSeq || ctrl.signal.aborted) return null
        set({ marksLoading: false, marksUnavailable: e instanceof ApiError && e.status === 501 })
        return null
      } finally {
        if (marksAbort === ctrl) marksAbort = null
      }
    },

    scheduleMarks: () => {
      if (marksTimer) clearTimeout(marksTimer)
      marksTimer = setTimeout(() => {
        marksTimer = null
        const { pid, project, marksUnavailable } = get()
        if (pid && project && !marksUnavailable) void get().loadMarks(pid)
      }, MARKS_DEBOUNCE_MS)
    },

    cancelMarks: () => {
      if (marksTimer) {
        clearTimeout(marksTimer)
        marksTimer = null
      }
      if (marksAbort) {
        marksAbort.abort()
        marksAbort = null
      }
      marksSeq++
      if (get().marksLoading) set({ marksLoading: false })
    },

    acceptMark: (id) => apply(new Set([id]), 'final'),
    rejectMark: (id) => apply(new Set([id]), 'original'),
    acceptMarks: (ids) => apply(new Set(ids), 'final'),
    rejectMarks: (ids) => apply(new Set(ids), 'original'),
    acceptAll: () => apply(null, 'final'),
    rejectAll: () => apply(null, 'original'),

    openReviewDrawer: (opts) => {
      yieldCompanion()
      set(opts?.commentId ? { reviewDrawerOpen: true, reviewRailTab: 'comments' } : { reviewDrawerOpen: true })
      if (opts?.commentId) get().focusComment(opts.commentId)
    },
    closeReviewDrawer: () => {
      if (get().reviewDrawerOpen) set({ reviewDrawerOpen: false })
    },
    setReviewDrawerOpen: (open) => {
      if (open) yieldCompanion()
      if (get().reviewDrawerOpen !== open) set({ reviewDrawerOpen: open })
    },
    toggleReviewDrawer: () => get().setReviewDrawerOpen(!get().reviewDrawerOpen),
    requestReviewComment: (pid, cid) => set({ reviewRequest: { pid, cid } }),
    clearReviewRequest: () => {
      if (get().reviewRequest) set({ reviewRequest: null })
    },

    assignReview: async (pid, userId, due) => {
      try {
        const r = await api.reviewAssign(pid, { user_id: userId, due })
        set({ reviewAssignUnavailable: false })
        return r
      } catch (e) {
        if (isNotImplemented(e)) set({ reviewAssignUnavailable: true })
        else get().toast(`指派失败：${e instanceof Error ? e.message : String(e)}`, 'error')
        return null
      }
    },

    resetReview: () => {
      get().cancelMarks()
      set({ marks: [], marksLoading: false, marksUnavailable: false, reviewDrawerOpen: false, reviewAssignUnavailable: false, activeMarkId: null, replyDraft: null, commentDraft: null, replyBodies: {} })
    },
  }
}
