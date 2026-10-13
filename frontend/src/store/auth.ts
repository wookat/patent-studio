import { ApiError, api } from '@/lib/api'
import { queryClient } from '@/lib/query'
import type { Member, Role, ShareLink, User } from '@/lib/types'
import type { Slice } from './types'

/**
 * R6 账号（docs/plan/07 §5.1）。
 * unknown = 启动尚未探测；off = 后端 PATENT_STUDIO_AUTH=off（/users/me 204 无人）；anon = 需登录（401）；authed = 已登录。
 * W7 qa-10：登出时在 localStorage 记下「已知匿名」标记（ANON_HINT_KEY），下次启动 authStatus 直接为 'anon'，不再发 GET /users/me（必 401 → console.error）；
 * 登录 / 注册成功清除。并发的 loadMe（StrictMode 双效应）复用同一个请求。
 */
export type AuthStatus = 'unknown' | 'off' | 'anon' | 'authed'

export const ANON_HINT_KEY = 'patent-studio:auth-anon'

const readAnonHint = (): boolean => {
  try {
    return localStorage.getItem(ANON_HINT_KEY) === '1'
  } catch {
    return false
  }
}

const writeAnonHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ANON_HINT_KEY, '1')
    else localStorage.removeItem(ANON_HINT_KEY)
  } catch {
    /* ignore */
  }
}

/** 进行中的 GET /users/me；并发 loadMe 复用 */
let meInflight: Promise<void> | null = null

export interface AuthSlice {
  authStatus: AuthStatus
  user: User | null
  authError: string | null
  members: Member[]
  membersLoading: boolean
  /** 成员 / 协作链接读取失败：协同抽屉内上屏 + 重试（不复用 authError——那是登录 / 账户面的字段） */
  membersError: string | null
  shareLinks: ShareLink[]
  shareLinksLoading: boolean
  shareLinksError: string | null

  /** GET /users/me → authStatus；StoreBootstrap 启动时调用一次。登出后的已知 anon 态不发请求；并发调用复用同一请求 */
  loadMe(): Promise<void>
  login(email: string, password: string): Promise<boolean>
  register(email: string, password: string, displayName?: string): Promise<boolean>
  logout(): Promise<void>
  /** 会话中任何请求吃到 401 ⇒ 服务端会话已失效：翻回登录墙（仅 authed 态触发，登录页自身的 401 不管） */
  expireSession(): void
  /** 清账号级/机构级残留（通知/账号/机构/PAT/期限/台账表/标签字典）——logout 与 expireSession 共用 */
  clearSession(): void
  clearAuthError(): void
  loadMembers(pid: string): Promise<void>
  setMember(pid: string, email: string, role: Role): Promise<void>
  removeMember(pid: string, userId: string): Promise<void>
  loadShareLinks(pid: string): Promise<void>
  createShareLink(pid: string, role: Exclude<Role, 'owner'>, expiresInDays: number | null): Promise<ShareLink | null>
  revokeShareLink(pid: string, token: string): Promise<void>
  /** 登录用户领取分享链接 → 返回 pid（前端随后跳 #/<pid>） */
  acceptShare(token: string): Promise<string | null>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const authSlice: Slice<AuthSlice> = (set, get) => ({
  authStatus: readAnonHint() ? 'anon' : 'unknown',
  user: null,
  authError: null,
  members: [],
  membersLoading: false,
  membersError: null,
  shareLinks: [],
  shareLinksLoading: false,
  shareLinksError: null,

  loadMe: async () => {
    if (readAnonHint()) {
      set({ authStatus: 'anon', user: null })
      return
    }
    if (meInflight) return meInflight
    meInflight = (async () => {
      try {
        const user = await api.me()
        if (user) set({ user, authStatus: 'authed', authError: null })
        else set({ authStatus: 'off', user: null })
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) set({ authStatus: 'anon', user: null })
        else set({ authError: msg(e) })
      } finally {
        meInflight = null
      }
    })()
    return meInflight
  },

  login: async (email, password) => {
    try {
      await api.login(email, password)
      writeAnonHint(false)
      await get().loadMe()
      return get().authStatus === 'authed'
    } catch (e) {
      set({ authError: msg(e) })
      return false
    }
  },

  register: async (email, password, displayName = '') => {
    try {
      await api.register(email, password, displayName)
      return get().login(email, password)
    } catch (e) {
      set({ authError: msg(e) })
      return false
    }
  },

  /* 会话边界：登出/会话过期时清账号级与机构级数据——同机换账号登录不得瞥见上一用户的通知/台账/机构/PAT/期限 */
  clearSession: () => {
    get().resetNotify()
    get().resetAccount()
    get().resetMcp()
    get().resetTemplates()
    get().resetDeadlines()
    get().resetOrg()
    get().resetImporter()
    get().resetPublic()
    get().clearDashFilters()
    queryClient.clear()
    /* dash 筛选/范围/未决表单属账号域（筛选词与标签名是上一用户的）；dashView/排序等持久化查看偏好属设备域，不动 */
    set({ tags: [], dashSelected: [], dashScope: 'all', caseFormPid: null, caseFormField: null, caseFormDraft: null, dashLoading: false })
  },

  logout: async () => {
    try {
      await api.logout()
    } finally {
      writeAnonHint(true)
      get().closeWorkspace()
      get().clearSession()
      set({ user: null, authStatus: 'anon', authError: null, members: [], membersLoading: false, membersError: null, shareLinks: [], shareLinksLoading: false, shareLinksError: null })
    }
  },
  /* 不动 workspace 内容：pid 留在 hash，重新登录后 enterWorkspace(returnPid) 回到原案；但案卷列表/标签等账号面数据照样清（⌘K/登录页不得露上一账号） */
  expireSession: () => {
    if (get().authStatus !== 'authed') return
    writeAnonHint(true)
    get().clearSession()
    set({ authStatus: 'anon', user: null, authError: null, members: [], membersLoading: false, membersError: null, shareLinks: [], shareLinksLoading: false, shareLinksError: null, projects: [] })
    get().toast('登录已过期，请重新登录', 'error')
  },
  clearAuthError: () => set({ authError: null }),

  loadMembers: async (pid) => {
    set({ membersLoading: true, membersError: null })
    try {
      const members = await api.members(pid)
      if (!get().pid || get().pid === pid) set({ members })
    } catch (e) {
      if (!get().pid || get().pid === pid) set({ membersError: msg(e) })
    } finally {
      set({ membersLoading: false })
    }
  },
  setMember: async (pid, email, role) => {
    const members = await api.setMember(pid, email, role)
    if (!get().pid || get().pid === pid) set({ members, membersError: null })
  },
  removeMember: async (pid, userId) => {
    const members = await api.removeMember(pid, userId)
    if (!get().pid || get().pid === pid) set({ members, membersError: null })
  },

  loadShareLinks: async (pid) => {
    set({ shareLinksLoading: true, shareLinksError: null })
    try {
      const shareLinks = await api.shareLinks(pid)
      if (!get().pid || get().pid === pid) set({ shareLinks })
    } catch (e) {
      if (!get().pid || get().pid === pid) set({ shareLinksError: msg(e) })
    } finally {
      set({ shareLinksLoading: false })
    }
  },
  createShareLink: async (pid, role, expiresInDays) => {
    try {
      const link = await api.createShareLink(pid, role, expiresInDays)
      if (!get().pid || get().pid === pid) set({ shareLinks: [link, ...get().shareLinks], shareLinksError: null })
      return link
    } catch (e) {
      set({ authError: msg(e) })
      return null
    }
  },
  revokeShareLink: async (pid, token) => {
    const shareLinks = await api.revokeShareLink(pid, token)
    if (!get().pid || get().pid === pid) set({ shareLinks, shareLinksError: null })
  },

  acceptShare: async (token) => {
    try {
      const r = await api.acceptShare(token)
      return r.pid
    } catch (e) {
      set({ authError: msg(e) })
      return null
    }
  },
})
