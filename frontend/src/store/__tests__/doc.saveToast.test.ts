// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, contentSha } from '@/lib/api'
import { useStudio } from '@/store'

/** W12-B3-①：保存成功提示是业务语言，不暴露 content.md.bak-… 这类实现细节；备份去向指向「版本历史」。 */
afterEach(() => {
  vi.restoreAllMocks()
  useStudio.setState({ toasts: [], saving: false })
})

describe('doc.save 成功提示', () => {
  it('有备份：提示上一版已入版本历史，不含 .bak 文件名', async () => {
    vi.spyOn(api, 'saveContent').mockResolvedValueOnce({
      ok: true,
      backup: 'content.md.bak-20260909-125233',
      backups: [{ name: 'content.md.bak-20260909-125233', mtime: 1, size: 1 }],
    })
    useStudio.setState({ pid: 'method', content: '# A\n改', saved: '# A\n', collabStatus: 'off' })
    expect(await useStudio.getState().save()).toBe(true)
    const texts = useStudio.getState().toasts.map((t) => t.text)
    expect(texts).toContain('已保存（上一版已入版本历史）')
    expect(texts.join('\n')).not.toMatch(/\.bak|content\.md/)
  })

  it('无备份（首次保存）：只提示已保存', async () => {
    vi.spyOn(api, 'saveContent').mockResolvedValueOnce({ ok: true, backup: null, backups: [] })
    useStudio.setState({ pid: 'method', content: '# A\n', saved: '', collabStatus: 'off' })
    expect(await useStudio.getState().save()).toBe(true)
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('已保存')
  })

  /* 批76：save 把「自认与盘一致」的 saved 哈希带上做乐观并发——base 不符服务端 409，不再静默覆盖 */
  it('保存请求带 base = saved 的内容 sha256', async () => {
    const spy = vi.spyOn(api, 'saveContent').mockResolvedValueOnce({ ok: true, backup: null, backups: [] })
    useStudio.setState({ pid: 'method', content: '# A\n改', saved: '# A\n', collabStatus: 'off' })
    expect(await useStudio.getState().save()).toBe(true)
    expect(spy).toHaveBeenCalledWith('method', '# A\n改', await contentSha('# A\n'))
  })

  it('contentSha 产出 64 位 hex（crypto.subtle 可用时）', async () => {
    expect(await contentSha('x')).toMatch(/^[0-9a-f]{64}$/)
  })

  /* 批79（OBS-B78-1）：无脏态 Ctrl+S 早退——不发 PUT（陈旧页签 clean 保存原会误吃 409） */
  it('content === saved 时不发请求直返 true', async () => {
    const spy = vi.spyOn(api, 'saveContent')
    useStudio.setState({ pid: 'method', content: '# A\n', saved: '# A\n', collabStatus: 'off' })
    expect(await useStudio.getState().save()).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    expect(useStudio.getState().toasts).toEqual([])
  })
})
