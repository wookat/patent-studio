import { api, isNotImplemented } from '@/lib/api'
import type { Notification } from '@/types/notify'
import type { Slice } from './types'

/** 铃铛轮询间隔（契约无 SSE，只有 GET /api/notify） */
export const NOTIFY_POLL_MS = 30_000
/** 铃铛 Popover 最近条数 */
export const NOTIFY_RECENT = 10

/**
 * W5 通知 `#/inbox` + 顶栏铃铛（docs/plan/21 §4.2；notify-review-frontend 单元消费，notify-audit-backend 单元填实）。
 * 未读数 `unreadCount` 由列表接口回带；铃铛只读它，不自算。轮询 / SSE 由单元决定（prep 不开定时器）。
 */
export interface NotifySlice {
  notifications: Notification[]
  /** 仪表盘未读集（今日摘要「提及」/dashFocus 用）——与收件箱有序列表分仓：
      unread:true 的过滤结果并入 notifications 会把老未读塞到尾部，loadMore 的 at(-1) 游标随之跳过整段区间（R115-批32） */
  dashUnread: Notification[]
  /** 收件箱「未读」筛选页的专属流——与 notifications 同理分仓：unread loadMore 结果并入
      all 流会把过滤项塞尾部，此后 all 流的 at(-1) 游标同样跳区间（R115-批33，批32 同族第二站） */
  unreadNotifications: Notification[]
  unreadLoading: boolean
  unreadHasMore: boolean
  unreadMoreLoading: boolean
  unreadCount: number
  notifyLoading: boolean
  notifyUnavailable: boolean
  notifyError: string | null

  notifyHasMore: boolean
  notifyMoreLoading: boolean

  loadNotifications(opts?: { limit?: number }): Promise<void>
  /** 仪表盘专用未读集拉取（unread:true limit:200）——不写 notifications，见 dashUnread 注释 */
  loadDashUnread(): Promise<void>
  /** 收件箱未读筛选页专属流首页（unread:true limit:100）——与 all 流互不混入 */
  loadUnreadNotifications(): Promise<void>
  /** 未读流翻页：游标 = unreadNotifications.at(-1)，追加去重 */
  loadMoreUnread(): Promise<void>
  /** 以当前最后一条为游标取更早一页（追加 + id 去重）；all 流专用——过滤流走 unreadNotifications 仓 */
  loadMoreNotifications(opts?: { limit?: number }): Promise<void>
  markRead(nid: string): Promise<boolean>
  markAllRead(): Promise<boolean>
  /** 开始 30s 轮询（立即拉一次；页面隐藏 / 501 时跳过）；多处调用共享一个计时器，返回销毁函数 */
  startNotifyPolling(): () => void
  resetNotify(): void
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollRefs = 0

export const notifySlice: Slice<NotifySlice> = (set, get) => {
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (isNotImplemented(e)) set({ notifyUnavailable: true, notifyError: msg })
    else get().toast(msg, 'error')
    return false
  }

  return {
    notifications: [],
    dashUnread: [],
    unreadNotifications: [],
    unreadLoading: false,
    unreadHasMore: false,
    unreadMoreLoading: false,
    unreadCount: 0,
    notifyLoading: false,
    notifyUnavailable: false,
    notifyError: null,

    notifyHasMore: false,
    notifyMoreLoading: false,

    loadNotifications: async (opts = {}) => {
      set({ notifyLoading: true, notifyError: null })
      try {
        const r = await api.notifications(opts)
        const prev = get().notifications
        /* 轮询刷新第一页时保留已翻到的更早页（游标页全在首页之下，位置稳定） */
        const freshIds = new Set(r.items.map((n) => n.id))
        set({ notifications: [...r.items, ...prev.filter((n) => !freshIds.has(n.id))], unreadCount: r.unread, notifyHasMore: r.has_more, notifyUnavailable: false })
        /* 成员变更（降级/移出）经 system 通知下发：当前案出现新通知时重取 project 元——
           否则被降级者的写操作 affordance 陈旧到 reload，点了才撞 403 */
        const cur = get().pid
        if (cur && get().project?.id === cur && prev.length) {
          const fresh = r.items.some((n) => n.pid === cur && !prev.some((o) => o.id === n.id))
          if (fresh) void get().refreshProjectMeta(cur)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ notifyError: msg, notifyUnavailable: isNotImplemented(e) })
      } finally {
        set({ notifyLoading: false })
      }
    },

    loadDashUnread: async () => {
      try {
        const r = await api.notifications({ unread: true, limit: 200 })
        set({ dashUnread: r.items, unreadCount: r.unread })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ notifyError: msg })
      }
    },

    loadUnreadNotifications: async () => {
      set({ unreadLoading: true, notifyError: null })
      try {
        const r = await api.notifications({ unread: true, limit: 100 })
        set({ unreadNotifications: r.items, unreadHasMore: r.has_more, unreadCount: r.unread })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ notifyError: msg })
      } finally {
        set({ unreadLoading: false })
      }
    },

    loadMoreUnread: async () => {
      const last = get().unreadNotifications.at(-1)
      if (!last || get().unreadMoreLoading) return
      set({ unreadMoreLoading: true, notifyError: null })
      try {
        const r = await api.notifications({ unread: true, limit: 100, before_id: last.id })
        const seen = new Set(get().unreadNotifications.map((n) => n.id))
        set({
          unreadNotifications: [...get().unreadNotifications, ...r.items.filter((n) => !seen.has(n.id))],
          unreadCount: r.unread,
          unreadHasMore: r.has_more,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ notifyError: msg })
      } finally {
        set({ unreadMoreLoading: false })
      }
    },

    loadMoreNotifications: async (opts = {}) => {
      const last = get().notifications.at(-1)
      if (!last || get().notifyMoreLoading) return
      set({ notifyMoreLoading: true, notifyError: null })
      try {
        const r = await api.notifications({ limit: 100, before_id: last.id, ...opts })
        const seen = new Set(get().notifications.map((n) => n.id))
        set({
          notifications: [...get().notifications, ...r.items.filter((n) => !seen.has(n.id))],
          unreadCount: r.unread,
          notifyHasMore: r.has_more,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ notifyError: msg })
      } finally {
        set({ notifyMoreLoading: false })
      }
    },

    markRead: async (nid) => {
      const before = get().notifications.find((n) => n.id === nid)
      if (before?.read) return true
      try {
        const n = await api.readNotification(nid)
        set((s) => ({ notifications: s.notifications.map((x) => (x.id === n.id ? n : x)), dashUnread: s.dashUnread.filter((x) => x.id !== nid), unreadNotifications: s.unreadNotifications.filter((x) => x.id !== nid), unreadCount: Math.max(0, s.unreadCount - 1) }))
        return true
      } catch (e) {
        return fail(e)
      }
    },

    markAllRead: async () => {
      try {
        await api.readAllNotifications()
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })), dashUnread: [], unreadNotifications: [], unreadCount: 0 }))
        return true
      } catch (e) {
        return fail(e)
      }
    },

    startNotifyPolling: () => {
      pollRefs += 1
      if (!pollTimer) {
        void get().loadNotifications()
        pollTimer = setInterval(() => {
          if (document.visibilityState === 'hidden' || get().notifyUnavailable || get().notifyLoading) return
          void get().loadNotifications()
        }, NOTIFY_POLL_MS)
      }
      let released = false
      return () => {
        if (released) return
        released = true
        pollRefs = Math.max(0, pollRefs - 1)
        if (pollRefs === 0 && pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      }
    },

    resetNotify: () => set({ notifications: [], dashUnread: [], unreadNotifications: [], unreadLoading: false, unreadHasMore: false, unreadMoreLoading: false, unreadCount: 0, notifyLoading: false, notifyUnavailable: false, notifyError: null, notifyHasMore: false, notifyMoreLoading: false }),
  }
}
