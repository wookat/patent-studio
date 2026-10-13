import { formErrorsFrom } from '@/components/account/formErrors'
import { api, ApiError } from '@/lib/api'
import type { AdminUser, AdminUserIn, MeIn, Org } from '@/types/account'
import type { Slice } from './types'

/**
 * W4-E E2 账户 / 机构管理（docs/plan/17 §3）：#/account 个人资料、#/admin 成员 / 机构名称。
 * 标签管理复用 dashboard slice 的 tags / saveTag / deleteTag；模板预设复用 templates slice。
 * 后端 501（E2 未落地 / auth=off）→ *Unavailable=true，页面显示占位、不弹 toast。
 */
export interface AccountSlice {
  meSaving: boolean
  /** PUT /users/me 501 ⇒ true：AccountPage 表单只读并显示「E2 待落地」 */
  meUnavailable: boolean
  adminUsers: AdminUser[]
  adminLoading: boolean
  adminUnavailable: boolean
  adminError: string | null
  org: Org | null

  /** 成功后以响应覆盖 auth.user 并 toast（改密成功则登出——R71-01 后端已使旧会话失效）；失败返回字段级错误（formErrorsFrom），501 ⇒ meUnavailable */
  saveMe(patch: MeIn): Promise<Record<string, string> | null>
  loadAdmin(): Promise<void>
  /** 禁用 / 提升 / 改头衔；成功后替换该行 */
  updateAdminUser(userId: string, patch: AdminUserIn): Promise<boolean>
  saveOrg(name: string): Promise<boolean>
  resetAccount(): void
}

export const accountSlice: Slice<AccountSlice> = (set, get) => {
  const fail = (e: unknown, unavailable: Partial<Pick<AccountSlice, 'meUnavailable' | 'adminUnavailable'>>) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof ApiError && e.status === 501) set({ ...unavailable, adminError: msg })
    else get().toast(msg, 'error')
    return false
  }

  return {
    meSaving: false,
    meUnavailable: false,
    adminUsers: [],
    adminLoading: false,
    adminUnavailable: false,
    adminError: null,
    org: null,

    saveMe: async (patch) => {
      set({ meSaving: true })
      try {
        const u = await api.putMe(patch)
        set({ user: u, meUnavailable: false })
        if (patch.password) {
          get().toast('密码已修改，请重新登录', 'success')
          await get().logout()
        } else {
          get().toast('个人资料已保存', 'success')
        }
        return null
      } catch (e) {
        if (e instanceof ApiError && e.status === 501) {
          set({ meUnavailable: true, adminError: e.message })
          return { _form: e.message }
        }
        const fe = formErrorsFrom(e, ['display_name', 'title', 'avatar_color', 'password', 'current', 'next', 'confirm'])
        if (fe.password) {
          fe.current = fe.password // 后端 detail='password' 指当前密码错（users_me.py）
          delete fe.password
        }
        if (fe._form) get().toast(fe._form, 'error') // 无字段归属的错误仍 toast 兜底
        return fe
      } finally {
        set({ meSaving: false })
      }
    },

    loadAdmin: async () => {
      set({ adminLoading: true, adminError: null })
      try {
        const [users, org] = await Promise.all([api.adminUsers(), api.org()])
        set({ adminUsers: users, org, adminUnavailable: false })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ adminError: msg, adminUnavailable: e instanceof ApiError && e.status === 501 })
      } finally {
        set({ adminLoading: false })
      }
    },

    updateAdminUser: async (userId, patch) => {
      try {
        const u = await api.updateAdminUser(userId, patch)
        set({ adminUsers: get().adminUsers.map((x) => (x.id === userId ? u : x)) })
        return true
      } catch (e) {
        return fail(e, { adminUnavailable: true })
      }
    },

    saveOrg: async (name) => {
      try {
        const org = await api.putOrg({ name })
        set({ org })
        get().toast('机构名称已保存', 'success')
        return true
      } catch (e) {
        return fail(e, { adminUnavailable: true })
      }
    },

    resetAccount: () => set({ adminUsers: [], adminLoading: false, adminError: null, adminUnavailable: false, org: null, meSaving: false, meUnavailable: false }),
  }
}
