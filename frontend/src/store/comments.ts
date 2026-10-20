import { ApiError, api } from '@/lib/api'
import { ROLE_RANK, type Comment, type CommentAnchor, type Role } from '@/lib/types'
import type { Proposal } from '@/types/agent'
import type { Slice } from './types'

/** 批注来源（R-REV-02 筛选）：AI 审阅 / 客户免登录评论 / 团队成员 */
export type CommentSource = 'human' | 'ai' | 'client'
export type CommentStatusFilter = 'open' | 'resolved' | 'all'

export interface CommentFilter {
  status: CommentStatusFilter
  source: CommentSource | 'all'
  /** 作者键（`commentAuthorKey`）；null = 全部 */
  author: string | null
}

export const DEFAULT_COMMENT_FILTER: CommentFilter = { status: 'open', source: 'all', author: null }

/** R6 批注线程（docs/plan/07 §4.2 / §5.1）；后端 501 期间 `commentsUnavailable=true`，面板显示占位文案 */
export interface CommentsSlice {
  comments: Comment[]
  commentsLoading: boolean
  commentsUnavailable: boolean
  commentsError: string | null
  activeCommentId: string | null
  /** `#/p/<pid>?c=<cid>` 到达后待滚动到的批注；面板滚到后 `consumePendingComment` */
  pendingCommentId: string | null
  commentFilter: CommentFilter

  /** quiet=true（后台轮询）不翻 commentsLoading / 不记错误——失败静默，下次轮询再试 */
  loadComments(pid: string, quiet?: boolean): Promise<void>
  addComment(pid: string, anchor: CommentAnchor, body: string): Promise<Comment | null>
  updateComment(pid: string, cid: string, patch: { body?: string; anchor?: CommentAnchor }): Promise<void>
  replyComment(pid: string, cid: string, body: string): Promise<void>
  resolveComment(pid: string, cid: string, resolved?: boolean): Promise<void>
  deleteComment(pid: string, cid: string): Promise<void>
  /** Z18 批注一键转修改提案：提案并入 s.proposals（AI 面板「建议」可见） */
  commentToProposal(pid: string, cid: string): Promise<Proposal | null>
  setActiveComment(id: string | null): void
  /** 选中并要求面板滚到该批注（通知 / hash ?c= 入口） */
  focusComment(id: string): void
  consumePendingComment(): void
  setCommentFilter(patch: Partial<CommentFilter>): void
  resetComments(): void
}

export const commentsSlice: Slice<CommentsSlice> = (set, get) => {
  const replace = (c: Comment) => {
    set({ comments: get().comments.map((x) => (x.id === c.id ? c : x)) })
  }
  return {
    comments: [],
    commentsLoading: false,
    commentsUnavailable: false,
    commentsError: null,
    activeCommentId: null,
    pendingCommentId: null,
    commentFilter: DEFAULT_COMMENT_FILTER,

    loadComments: async (pid, quiet = false) => {
      if (!quiet) set({ commentsLoading: true, commentsError: null })
      try {
        const items = await api.comments(pid)
        if (get().pid && get().pid !== pid) return
        set({ comments: items, commentsLoading: false, commentsUnavailable: false })
      } catch (e) {
        if (quiet || (get().pid && get().pid !== pid)) return
        const unavailable = e instanceof ApiError && e.status === 501
        set({ commentsLoading: false, commentsUnavailable: unavailable, commentsError: unavailable ? null : e instanceof Error ? e.message : String(e) })
      }
    },
    addComment: async (pid, anchor, body) => {
      const c = await api.addComment(pid, anchor, body)
      /* 迟发响应撞翻案：批注已落在旧案服务端，不得再塞进新案的空批注列表（批26 同族守卫） */
      if (get().pid && get().pid !== pid) return c
      set({ comments: [...get().comments, c], activeCommentId: c.id })
      return c
    },
    updateComment: async (pid, cid, patch) => replace(await api.updateComment(pid, cid, patch)),
    replyComment: async (pid, cid, body) => replace(await api.replyComment(pid, cid, body)),
    resolveComment: async (pid, cid, resolved = true) => replace(await api.resolveComment(pid, cid, resolved)),
    deleteComment: async (pid, cid) => {
      await api.deleteComment(pid, cid)
      if (get().pid && get().pid !== pid) return
      set({ comments: get().comments.filter((c) => c.id !== cid) })
    },
    commentToProposal: async (pid, cid) => {
      const { proposal } = await api.commentToProposal(pid, cid)
      if (get().pid && get().pid !== pid) return proposal
      set((s) => ({ proposals: s.proposals.some((p) => p.id === proposal.id) ? s.proposals : [...s.proposals, proposal] }))
      return proposal
    },
    setActiveComment: (id) => {
      if (get().activeCommentId !== id) set({ activeCommentId: id })
    },
    focusComment: (id) => set({ activeCommentId: id, pendingCommentId: id }),
    consumePendingComment: () => {
      if (get().pendingCommentId) set({ pendingCommentId: null })
    },
    setCommentFilter: (patch) => set({ commentFilter: { ...get().commentFilter, ...patch } }),
    resetComments: () => {
      set({
        comments: [],
        commentsLoading: false,
        commentsUnavailable: false,
        commentsError: null,
        activeCommentId: null,
        pendingCommentId: null,
        commentFilter: DEFAULT_COMMENT_FILTER,
      })
    },
  }
}

export const selectOpenCommentCount = (s: { comments: Comment[] }) => s.comments.filter((c) => !c.resolved).length

/** 来源判定：AI 审阅批注 author.id === 'ai'；客户批注 API 透 source='client'（客户页自身列表带 guest）；其余为成员 */
export function commentSource(c: Comment): CommentSource {
  if (c.author.id === 'ai' || c.source === 'ai') return 'ai'
  if (c.source === 'client' || ('guest' in c && Boolean(c.guest))) return 'client'
  return 'human'
}

/** 批注写操作需要的本案角色下限（与后端 _comment_perm 一致：编辑/删除 editor+，解决/重开 reviewer+） */
export type CommentMutateNeed = 'editor' | 'reviewer'

/**
 * 批注写操作门控：作者本人，或本案角色 ≥ need；客户批注（author.id=null）只能角色管。
 * role 缺失（AUTH off / superuser / 尚未取到）按可写渲染——后端仍 403 兜底，与 selectEditorMode 的 null 口径一致。
 */
export function canMutateComment(
  s: { user: { id: string; is_superuser: boolean } | null; project: { role?: string | null } | null },
  c: Comment,
  need: CommentMutateNeed,
): boolean {
  const u = s.user
  if (!u || u.is_superuser) return true
  if (c.author.id !== null && c.author.id === u.id) return true
  const role = s.project?.role
  if (!role) return true
  return (ROLE_RANK[role as Role] ?? -1) >= ROLE_RANK[need]
}

/** 作者筛选键：有 id 用 id，匿名 / 客户用显示名 */
export const commentAuthorKey = (c: Comment) => c.author.id ?? `name:${c.author.name}`

export function matchesCommentFilter(c: Comment, f: CommentFilter): boolean {
  if (f.status === 'open' && c.resolved) return false
  if (f.status === 'resolved' && !c.resolved) return false
  if (f.source !== 'all' && commentSource(c) !== f.source) return false
  if (f.author && commentAuthorKey(c) !== f.author) return false
  return true
}

export const selectFilteredComments = (s: { comments: Comment[]; commentFilter: CommentFilter }) =>
  s.comments.filter((c) => matchesCommentFilter(c, s.commentFilter))

