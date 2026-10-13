// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import type { User } from '@/lib/types'
import { useStudio } from '@/store'
import { ANON_HINT_KEY } from '@/store/auth'

const me: User = { id: 'u1', email: 'a@b.c', display_name: '', is_superuser: false }

beforeEach(() => {
  localStorage.clear()
  useStudio.setState({ authStatus: 'unknown', user: null, authError: null, members: [], shareLinks: [], toasts: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('auth · W7 qa-10 登出后不再并发 401', () => {
  it('并发 loadMe（StrictMode 双效应）只发一次 GET /users/me', async () => {
    const meSpy = vi.spyOn(api, 'me').mockRejectedValue(new ApiError(401, '未登录'))
    const st = useStudio.getState()
    await Promise.all([st.loadMe(), st.loadMe()])
    expect(meSpy).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().authStatus).toBe('anon')

    // 结算后再调 ⇒ 重新探测（不是永久缓存）
    meSpy.mockResolvedValue(me)
    await useStudio.getState().loadMe()
    expect(meSpy).toHaveBeenCalledTimes(2)
    expect(useStudio.getState().authStatus).toBe('authed')
  })

  it('logout 记 anon 标记；之后 loadMe 直接判 anon、不发请求；login 清标记并重新探测', async () => {
    const meSpy = vi.spyOn(api, 'me').mockResolvedValue(me)
    vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    vi.spyOn(api, 'login').mockResolvedValue(undefined)
    await useStudio.getState().loadMe()
    expect(useStudio.getState().authStatus).toBe('authed')

    await useStudio.getState().logout()
    expect(useStudio.getState().authStatus).toBe('anon')
    expect(localStorage.getItem(ANON_HINT_KEY)).toBe('1')

    meSpy.mockClear()
    await Promise.all([useStudio.getState().loadMe(), useStudio.getState().loadMe()])
    expect(meSpy).not.toHaveBeenCalled()
    expect(useStudio.getState().authStatus).toBe('anon')
    expect(useStudio.getState().user).toBeNull()

    expect(await useStudio.getState().login('a@b.c', 'pw')).toBe(true)
    expect(localStorage.getItem(ANON_HINT_KEY)).toBeNull()
    expect(meSpy).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().authStatus).toBe('authed')
  })

  it('login 失败不清标记也不探测 me；api.logout 抛错仍记标记', async () => {
    localStorage.setItem(ANON_HINT_KEY, '1')
    const meSpy = vi.spyOn(api, 'me').mockResolvedValue(me)
    vi.spyOn(api, 'login').mockRejectedValue(new ApiError(401, '邮箱或密码错误'))
    expect(await useStudio.getState().login('a@b.c', 'bad')).toBe(false)
    expect(localStorage.getItem(ANON_HINT_KEY)).toBe('1')
    expect(meSpy).not.toHaveBeenCalled()
    expect(useStudio.getState().authError).toBe('邮箱或密码错误')

    localStorage.clear()
    useStudio.setState({ authStatus: 'authed', user: me })
    vi.spyOn(api, 'logout').mockRejectedValue(new ApiError(500, '打盹'))
    await expect(useStudio.getState().logout()).rejects.toThrow('打盹')
    expect(useStudio.getState().authStatus).toBe('anon')
    expect(localStorage.getItem(ANON_HINT_KEY)).toBe('1')
  })
})
