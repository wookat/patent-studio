import { api, isNotImplemented, isShareExpired, isShareNotFound } from '@/lib/api'
import type { Ast } from '@/types/ast'
import type { PublicComment, PublicCommentIn, PublicShareLink, PublicShareLinkIn, PublicShareMeta } from '@/types/public-share'
import type { Slice } from './types'

/**
 * W5 客户公开审阅（docs/plan/21 §4.5；client-review-frontend 单元消费 `#/c/<token>`，share-confirm-backend 单元填实）。
 * 两半：登录态的链接管理（协作者中心「链接」tab 的「客户审阅链接」段）与 匿名态的审阅页状态（meta / ast / css / comments / confirm）。
 * 访客姓名存 localStorage `patent-studio:guest-name`（一次填写）。
 * 匿名页错误分四类：404 not_found ⇒ publicInvalid（链接失效）；410 share.expired / share.revoked ⇒ publicExpired；501 ⇒ publicUnavailable；其余 ⇒ publicError（页面显示重试）。
 * openPublic 对同一 token 的并发调用（StrictMode 双挂载 / 快速重试）复用同一批请求：`/public/<token>/meta` 404 只出现一次且只在 token 无效时出现。
 */
export const GUEST_NAME_KEY = 'patent-studio:guest-name'

export type PublicView = 'pdf' | 'layout'

export interface PublicShareSlice {
  publicLinks: PublicShareLink[]
  publicLinksLoading: boolean
  publicLinksUnavailable: boolean
  /** GET /public-links 非 501 失败：段内显示，不 toast（与 loadShareLinks 一致） */
  publicLinksError: string | null

  publicToken: string | null
  publicMeta: PublicShareMeta | null
  publicAst: Ast | null
  /** GET /public/{token}/layout-css 文本；null = 用 layout-view.css 默认变量 */
  publicCss: string | null
  publicComments: PublicComment[]
  publicView: PublicView
  publicLoading: boolean
  /** 410 share.expired / share.revoked ⇒ 页面显示「链接已过期」 */
  publicExpired: boolean
  /** 404 not_found（token 不存在 / 已删除）⇒ 页面显示「链接失效」 */
  publicInvalid: boolean
  publicUnavailable: boolean
  publicError: string | null
  guestName: string

  loadPublicLinks(pid: string): Promise<void>
  createPublicLink(pid: string, body: PublicShareLinkIn): Promise<PublicShareLink | null>
  revokePublicLink(pid: string, token: string): Promise<boolean>

  openPublic(token: string): Promise<void>
  setPublicView(v: PublicView): void
  setGuestName(name: string): void
  addPublicComment(body: Omit<PublicCommentIn, 'guest_name'>): Promise<boolean>
  confirmPublic(note?: string): Promise<boolean>
  resetPublic(): void
}

const readGuestName = () => {
  try {
    return localStorage.getItem(GUEST_NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

interface PublicPayload {
  meta: PublicShareMeta
  ast: Ast
  comments: PublicComment[]
  css: string | null
}

/** 同一 token 进行中的整批加载（meta → ast / comments / css）；settle 后清除 */
const inflight = new Map<string, Promise<PublicPayload>>()

function loadPublic(token: string): Promise<PublicPayload> {
  const cached = inflight.get(token)
  if (cached) return cached
  const p = (async () => {
    const meta = await api.publicMeta(token)
    const [ast, comments, css] = await Promise.all([
      api.publicAst(token),
      meta.scope === 'read' ? Promise.resolve([]) : api.publicComments(token),
      api.publicLayoutCss(token).catch(() => null),
    ])
    return { meta, ast, comments, css }
  })()
  inflight.set(token, p)
  const settle = () => {
    if (inflight.get(token) === p) inflight.delete(token)
  }
  p.then(settle, settle)
  return p
}

export const publicShareSlice: Slice<PublicShareSlice> = (set, get) => {
  const fail = (e: unknown, key: 'publicLinksUnavailable' | 'publicUnavailable') => {
    const msg = e instanceof Error ? e.message : String(e)
    if (isNotImplemented(e)) set({ [key]: true, publicError: msg })
    else if (isShareExpired(e)) set({ publicExpired: true, publicError: msg })
    else if (key === 'publicUnavailable' && isShareNotFound(e)) set({ publicInvalid: true, publicError: msg })
    else get().toast(msg, 'error')
    return false
  }

  return {
    publicLinks: [],
    publicLinksLoading: false,
    publicLinksUnavailable: false,
    publicLinksError: null,

    publicToken: null,
    publicMeta: null,
    publicAst: null,
    publicCss: null,
    publicComments: [],
    publicView: 'pdf',
    publicLoading: false,
    publicExpired: false,
    publicInvalid: false,
    publicUnavailable: false,
    publicError: null,
    guestName: readGuestName(),

    loadPublicLinks: async (pid) => {
      set({ publicLinksLoading: true, publicLinksError: null })
      try {
        const publicLinks = await api.publicLinks(pid)
        if (!get().pid || get().pid === pid) set({ publicLinks, publicLinksUnavailable: false })
      } catch (e) {
        if (isNotImplemented(e)) set({ publicLinksUnavailable: true })
        else set({ publicLinksError: e instanceof Error ? e.message : String(e) })
      } finally {
        set({ publicLinksLoading: false })
      }
    },

    createPublicLink: async (pid, body) => {
      try {
        const link = await api.createPublicLink(pid, body)
        if (!get().pid || get().pid === pid) set((s) => ({ publicLinks: [link, ...s.publicLinks] }))
        return link
      } catch (e) {
        fail(e, 'publicLinksUnavailable')
        return null
      }
    },

    revokePublicLink: async (pid, token) => {
      try {
        await api.revokePublicLink(pid, token)
        if (!get().pid || get().pid === pid) set((s) => ({ publicLinks: s.publicLinks.map((l) => (l.token === token ? { ...l, revoked: true } : l)) }))
        return true
      } catch (e) {
        return fail(e, 'publicLinksUnavailable')
      }
    },

    openPublic: async (token) => {
      set({ publicToken: token, publicLoading: true, publicExpired: false, publicInvalid: false, publicUnavailable: false, publicError: null })
      try {
        const { meta, ast, comments, css } = await loadPublic(token)
        if (get().publicToken !== token) return
        set({ publicMeta: meta, publicAst: ast, publicComments: comments, publicCss: css })
      } catch (e) {
        if (get().publicToken !== token) return
        const msg = e instanceof Error ? e.message : String(e)
        set({ publicError: msg, publicUnavailable: isNotImplemented(e), publicExpired: isShareExpired(e), publicInvalid: isShareNotFound(e) })
      } finally {
        if (get().publicToken === token) set({ publicLoading: false })
      }
    },

    setPublicView: (publicView) => set({ publicView }),

    setGuestName: (name) => {
      set({ guestName: name })
      try {
        localStorage.setItem(GUEST_NAME_KEY, name)
      } catch {
        /* ignore */
      }
    },

    addPublicComment: async (body) => {
      const { publicToken, guestName } = get()
      if (!publicToken) return false
      try {
        const c = await api.addPublicComment(publicToken, { ...body, guest_name: guestName })
        set((s) => ({ publicComments: [...s.publicComments, c] }))
        return true
      } catch (e) {
        return fail(e, 'publicUnavailable')
      }
    },

    confirmPublic: async (note) => {
      const { publicToken, guestName } = get()
      if (!publicToken) return false
      try {
        const confirmation = await api.publicConfirm(publicToken, { name: guestName, note })
        set((s) => ({ publicMeta: s.publicMeta ? { ...s.publicMeta, confirmation } : s.publicMeta }))
        return true
      } catch (e) {
        return fail(e, 'publicUnavailable')
      }
    },

    resetPublic: () =>
      set({
        publicToken: null,
        publicMeta: null,
        publicAst: null,
        publicCss: null,
        publicComments: [],
        publicView: 'pdf',
        publicLoading: false,
        publicExpired: false,
        publicInvalid: false,
        publicUnavailable: false,
        publicError: null,
      }),
  }
}
