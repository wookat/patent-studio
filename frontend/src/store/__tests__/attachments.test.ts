// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import type { FigureItem } from '@/types/figures'
import { ATTACHMENT_MAX_BYTES, attachmentReject, type AttachmentsResponse } from '@/types/attachments'
import { FIG_WIDTH_MAX, FIG_WIDTH_MIN, clampFigWidth } from '@/store/figuresBook'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const notImplemented = () =>
  json({ error: { code: 'not_implemented', message: 'attachments 未实现', detail: null } }, 501)

const item = (name: string): AttachmentsResponse['items'][number] => ({
  name, ext: '.pdf', size: 10, mtime: '2026-01-01T00:00:00Z', kind: 'pdf', url: `/api/projects/p1/attachments/${name}`,
})

afterEach(() => {
  vi.restoreAllMocks()
  useStudio.getState().resetAttachments()
  useStudio.getState().resetFiguresBook()
  useStudio.setState({ pid: null, toasts: [] })
})

describe('attachments slice（15 §4.1）', () => {
  it('GET → attachments；501 → attachmentsUnavailable 且不 toast', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ items: [item('a.pdf')] })).mockResolvedValueOnce(notImplemented())
    const s = useStudio.getState()
    expect(await s.loadAttachments('p1')).toEqual([item('a.pdf')])
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/p1/attachments')
    expect(useStudio.getState().attachmentsPid).toBe('p1')
    expect(await s.loadAttachments('p1')).toBeNull()
    expect(useStudio.getState().attachmentsUnavailable).toBe(true)
    expect(useStudio.getState().toasts).toEqual([])
  })

  it('attachmentReject：白名单 + 50 MB；上传前任一被拒 → 不发请求并 toast', async () => {
    expect(attachmentReject(new File(['x'], 'ok.pdf'))).toBeNull()
    expect(attachmentReject(new File(['x'], 'ok.PDF'))).toBeNull()
    expect(attachmentReject(new File(['x'], 'bad.exe'))).toMatch(/类型/)
    const big = new File([''], 'big.zip')
    Object.defineProperty(big, 'size', { value: ATTACHMENT_MAX_BYTES + 1 })
    expect(attachmentReject(big)).toMatch(/50 MB/)

    const fetchMock = vi.spyOn(globalThis, 'fetch')
    useStudio.setState({ pid: 'p1' })
    expect(await useStudio.getState().uploadAttachments([new File(['x'], 'ok.pdf'), new File(['x'], 'bad.exe')])).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('bad.exe')
  })

  it('上传 multipart files[]；删除后响应整表覆盖并清掉同名预览', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ items: [item('a.pdf'), item('b.pdf')] }))
      .mockResolvedValueOnce(json({ items: [item('a.pdf')] }))
    useStudio.setState({ pid: 'p1' })
    const s = useStudio.getState()
    expect(await s.uploadAttachments([new File(['x'], 'b.pdf')])).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/projects/p1/attachments')
    expect(init?.method).toBe('POST')
    expect(((init as RequestInit).body as FormData).getAll('files')).toHaveLength(1)
    expect(useStudio.getState().attachments.map((a) => a.name)).toEqual(['a.pdf', 'b.pdf'])

    s.setPreviewAttachment('b.pdf')
    expect(await s.deleteAttachment('b.pdf')).toBe(true)
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE')
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/projects/p1/attachments/b.pdf')
    expect(useStudio.getState().attachments.map((a) => a.name)).toEqual(['a.pdf'])
    expect(useStudio.getState().previewAttachment).toBeNull()
  })

  it('seedIntakeTemplate：POST seed-intake 整表覆盖并 toast；409 当作 info 不算失败', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ items: [item('技术交底书模板.md')] }))
      .mockResolvedValueOnce(json({ detail: { kind: 'attachments', message: '已存在', line: null, detail: null } }, 409))
    useStudio.setState({ pid: 'p1' })
    const s = useStudio.getState()
    expect(await s.seedIntakeTemplate()).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/projects/p1/attachments/seed-intake')
    expect(init?.method).toBe('POST')
    expect(useStudio.getState().attachments.map((a) => a.name)).toEqual(['技术交底书模板.md'])
    expect(useStudio.getState().toasts.at(-1)?.kind).not.toBe('error')

    expect(await s.seedIntakeTemplate()).toBe(true)
    const last = useStudio.getState().toasts.at(-1)
    expect(last?.kind).toBe('info')
    expect(last?.text).toContain('已存在')
  })
})

describe('figuresBook slice（15 §4.1）', () => {
  it('clampFigWidth：2–17，步进 0.5', () => {
    expect(clampFigWidth(0)).toBe(FIG_WIDTH_MIN)
    expect(clampFigWidth(99)).toBe(FIG_WIDTH_MAX)
    expect(clampFigWidth(12.26)).toBe(12.5)
    expect(clampFigWidth(12.24)).toBe(12)
  })

  it('setFigureAspect 忽略非法比值；resetFiguresBook 清空', () => {
    const s = useStudio.getState()
    s.setFigureAspect('fig1.svg', 1.5)
    s.setFigureAspect('fig2.svg', 0)
    s.setFigureAspect('fig3.svg', Number.NaN)
    expect(useStudio.getState().figureAspects).toEqual({ 'fig1.svg': 1.5 })
    s.setPreviewFig('fig1.svg')
    s.resetFiguresBook()
    expect(useStudio.getState()).toMatchObject({ previewFig: null, figureAspects: {} })
  })

  it('unifyFigureWidth 只写不相等的说明书图；unifyFigureHeight 按宽高比换算并跳过未知比值', async () => {
    const fig = (name: string, num: number | null, width: number | null): FigureItem => ({
      name, ext: '.svg', size: 1, num, alt: num ? `图${num}` : null, width, is_abstract: num === 1, abstract_width: num === 1 ? 14.5 : null,
      preview: name, companions: [],
    })
    const figs = [fig('fig1.svg', 1, 15), fig('fig2.svg', 2, 10), fig('loose.svg', null, null)]
    const resp = () => json({ figures: figs, settings: {} })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => resp())
    useStudio.setState({ pid: 'p1', figures: figs, scheduleAst: () => {} })

    await useStudio.getState().unifyFigureWidth(15)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/p1/figures/fig2.svg')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ width: 15 })

    fetchMock.mockClear()
    useStudio.getState().setFigureAspect('fig1.svg', 2)
    await useStudio.getState().unifyFigureHeight(6)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects/p1/figures/fig1.svg')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ width: 12 })
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('fig2.svg')
  })
})
