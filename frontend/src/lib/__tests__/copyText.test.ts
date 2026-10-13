// @vitest-environment jsdom
/**
 * 批77 回归钉：非安全上下文无 clipboard API 时 copyText 走 execCommand('copy') 旧路径——
 * http://IP:端口 直连 VPS 的部署形态下「复制」钮不再只剩 toast 死端。
 * jsdom 未实现 execCommand：用例先把它挂成桩函数再断言调用。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../download'

const stubExec = (ret: boolean) => {
  const fn = vi.fn().mockReturnValue(ret)
  document.execCommand = fn
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (document as { execCommand?: unknown }).execCommand
})

describe('copyText 非安全上下文兜底', () => {
  it('clipboard API 缺席 → execCommand 旧路径兜底成功', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    const exec = stubExec(true)
    expect(await copyText('sh-ref-abc')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    /* 兜底 textarea 用完即收，不留 DOM */
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('clipboard 写被拒 → 同样回退旧路径', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } })
    stubExec(true)
    expect(await copyText('x')).toBe(true)
  })

  it('两条路径都失败 → false（调用方各自 toast）', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    stubExec(false)
    expect(await copyText('x')).toBe(false)
  })

  it('clipboard 可用 → 直走现代路径不碰旧路径', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const exec = stubExec(true)
    expect(await copyText('x')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('x')
    expect(exec).not.toHaveBeenCalled()
  })
})
