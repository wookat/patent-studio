// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'

/** 批6：批量上传逐件跳过——响应 skipped 名单透出 toast（不再 409 整批拒死）。 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.restoreAllMocks()
  useStudio.getState().resetFigures()
  useStudio.setState({ pid: null, toasts: [] })
})

describe('figures.uploadFigures skipped', () => {
  it('响应带 skipped → toast 名单 + figures/settings 照常落地', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json({ figures: [{ name: 'ok.png', ext: '.png', size: 1, num: null, alt: null, width: null, is_abstract: false, abstract_width: null, preview: null, companions: [] }], settings: {}, skipped: [{ name: 'a.svg', reason: '不支持的附图格式：.svg' }] }),
    )
    useStudio.setState({ pid: 'p1' })
    await useStudio.getState().uploadFigures([new File(['x'], 'ok.png'), new File(['x'], 'a.svg')])
    const s = useStudio.getState()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/p1/figures')
    expect(s.figures.map((f) => f.name)).toEqual(['ok.png'])
    expect(s.toasts.at(-1)).toMatchObject({ kind: 'info' })
    expect(s.toasts.at(-1)?.text).toContain('已跳过 1 件')
    expect(s.toasts.at(-1)?.text).toContain('a.svg')
  })

  it('无 skipped / 空名单不 toast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ figures: [], settings: {}, skipped: [] }))
    useStudio.setState({ pid: 'p1' })
    await useStudio.getState().uploadFigures([new File(['x'], 'ok.png')])
    expect(useStudio.getState().toasts).toEqual([])
  })
})
