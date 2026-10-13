// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useStudio } from '@/store'

/** R89：网络层失败已被 api.netFetch 全局 toast——调用方 catch 再 toast「X失败：Failed to fetch」属双报，按文案特征单点过滤。 */
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useStudio.setState({ toasts: [] })
})

describe('网络失败 toast 去重', () => {
  it('fetch TypeError 原文 toast 被过滤（netFetch 已报），非 fetch 错误照常', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    // 任一真实 api 调用即可触发 netFetch 的全局 toast + 抛出
    await expect(api.project('p1')).rejects.toBeInstanceOf(TypeError)
    // netFetch 的全局 toast 走动态 import——等微任务落地
    await vi.waitFor(() => expect(useStudio.getState().toasts).toHaveLength(1))
    const texts = useStudio.getState().toasts.map((t) => t.text)
    expect(texts[0]).toMatch(/网络/)

    // 调用方把 TypeError 原文拼进业务文案——应被过滤，不双报
    useStudio.getState().toast('递交包生成失败：Failed to fetch', 'error')
    expect(useStudio.getState().toasts).toHaveLength(1)

    // 非 fetch 的 TypeError / 普通错误文案照常报
    useStudio.getState().toast("块写回失败：Cannot read properties of undefined (reading 'x')", 'error')
    expect(useStudio.getState().toasts).toHaveLength(2)
  })
})
