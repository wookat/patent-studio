// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { api } from '../api'

/**
 * R24-04：网络层失败（fetch 抛 TypeError）必须有用户可见反馈——toast 一次（3s 去抖），错误照旧抛出。
 */
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useStudio.setState({ toasts: [] })
})

describe('api 网络失败反馈（R24-04）', () => {
  it('fetch TypeError → toast「网络不可用」且原错误向上抛', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.health()).rejects.toThrow('Failed to fetch')
    await vi.waitFor(() => expect(useStudio.getState().toasts.map((t) => t.text)).toContain('网络不可用，请检查连接'))
  })

  it('navigator.onLine=false → toast「网络已离线」；3s 窗口内第二次失败不再重复弹', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 4000) // 越过模块级去抖窗口（上个用例已弹过一次）
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.health()).rejects.toThrow('Failed to fetch')
    await expect(api.projects()).rejects.toThrow('Failed to fetch')
    await vi.waitFor(() => expect(useStudio.getState().toasts.map((t) => t.text)).toContain('网络已离线，操作未发送'))
    expect(useStudio.getState().toasts.filter((t) => t.text === '网络已离线，操作未发送')).toHaveLength(1)
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  })

  it('HTTP 错误（非网络层）不触发网络 toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"boom"}', { status: 500 })))
    await expect(api.health()).rejects.toThrow('boom')
    await Promise.resolve()
    expect(useStudio.getState().toasts).toHaveLength(0)
  })
})

describe('api 会话过期（R115 批11b：mid-session 401 → 登录墙）', () => {
  const u = { id: 'u1', email: 'u1@x.test', display_name: 'u1', is_superuser: false }
  const stub401 = () => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"未认证"}', { status: 401 })))

  it('authed 态请求 401 → expireSession 翻 anon + user 清空 + 「登录已过期」toast；ApiError 照旧抛', async () => {
    useStudio.setState({ authStatus: 'authed', user: u, members: [{ user_id: 'u1', email: u.email, display_name: 'u1', role: 'owner' }], toasts: [] })
    stub401()
    await expect(api.projects()).rejects.toMatchObject({ status: 401 })
    await vi.waitFor(() => expect(useStudio.getState().authStatus).toBe('anon'))
    expect(useStudio.getState().user).toBeNull()
    expect(useStudio.getState().members).toEqual([])
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('登录已过期，请重新登录')
  })

  it('非 authed 态（登录页密码错 / 启动探测）的 401 不翻转、不弹过期 toast', async () => {
    useStudio.setState({ authStatus: 'anon', user: null, toasts: [] })
    stub401()
    await expect(api.projects()).rejects.toMatchObject({ status: 401 })
    await new Promise((r) => setTimeout(r, 30))
    expect(useStudio.getState().authStatus).toBe('anon')
    expect(useStudio.getState().toasts).toHaveLength(0)
  })

  it('并发多个 401 只翻一次、只弹一次 toast（首个翻转后已非 authed）', async () => {
    useStudio.setState({ authStatus: 'authed', user: u, toasts: [] })
    stub401()
    await Promise.allSettled([api.projects(), api.projects(), api.projects()])
    await vi.waitFor(() => expect(useStudio.getState().authStatus).toBe('anon'))
    expect(useStudio.getState().toasts.filter((t) => t.text === '登录已过期，请重新登录')).toHaveLength(1)
  })
})

describe('api 错误文案（R115 批36：非 JSON 错误体 → 中文状态兜底）', () => {
  it('裸 5xx/4xx 非 JSON 体不再吐英文 statusText', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }))))
    await expect(api.projects()).rejects.toMatchObject({ status: 502, message: '网关错误，请稍后再试' })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }))))
    await expect(api.projects()).rejects.toMatchObject({ status: 429, message: '请求过于频繁，请稍后再试' })
  })

  it('JSON detail 依旧优先于状态兜底', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{"detail":"自定义原因"}', { status: 409, statusText: 'Conflict' }))))
    await expect(api.projects()).rejects.toMatchObject({ status: 409, message: '自定义原因' })
  })

  it('pydantic 422 数组 detail → 可读字段文案而非 JSON 坨（批83 .local 邮箱 OBS）', async () => {
    const body = JSON.stringify({
      detail: [
        { type: 'value_error', loc: ['body', 'email'], msg: 'value is not a valid email address: The part after the @-sign is a reserved name', input: 'a@b.local' },
        { type: 'string_too_short', loc: ['body', 'password'], msg: 'String should have at least 8 characters', input: 'x' },
      ],
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(body, { status: 422 }))))
    await expect(api.projects()).rejects.toMatchObject({ status: 422, message: 'email：邮箱格式无效；password：至少 8 个字符' })
  })
})

describe('api 请求超时（R115 批35：req 默认 120s，长任务/FormData 豁免）', () => {
  it('JSON 请求自动带超时 signal；TimeoutError → ApiError(0)「请求超时」', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.projects()).rejects.toMatchObject({ status: 0, message: '请求超时，请检查网络后重试' })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('FormData 上传不带默认超时 signal；timeout:false 端点（build）豁免', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response('{"diagnostics":[],"figures":[],"settings":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } })))
    vi.stubGlobal('fetch', fetchMock)
    await api.uploadFigures('p1', [new File(['x'], 'f.png')])
    expect(fetchMock.mock.calls.at(-1)![1].signal).toBeUndefined()
    await api.build('p1', {})
    expect(fetchMock.mock.calls.at(-1)![1].signal).toBeUndefined()
  })

  it('调用方 signal 与默认超时复合——caller abort 时复合信号随之 abort', async () => {
    const ac = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"figures":[],"settings":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api.getFigures('p1', ac.signal)
    const sig = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(sig).toBeInstanceOf(AbortSignal)
    ac.abort()
    expect(sig.aborted).toBe(true)
  })
})
