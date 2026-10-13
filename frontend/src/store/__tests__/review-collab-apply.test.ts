// @vitest-environment jsdom
/**
 * R115-批49 D-B49-1 回归钉：协同在线时 accept/reject 的合并文本必须经活房间（CRDT）或 PUT 落盘——
 * 只写本地 store 会让活书房间的标记原文经服务端落盘留在磁盘，重载即复活。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { applyTermReplace } from '@/components/terms/termsModel'
import { registerCollabContentWriter } from '../layoutView'
import { useStudio } from '../index'
import type { CriticMark } from '@/lib/types'

const INS = '{++QA-NEW++}'
const CONTENT = `# 标题

## 权利要求书

1. 一种装置，${INS}包括 A。

## 说明书

正文。
`
const LINE = '1. 一种装置，{++QA-NEW++}包括 A。'
const from = LINE.indexOf(INS)
const mark: CriticMark = { id: '5:12', kind: 'ins', line: 5, from, to: from + INS.length, a: '', b: 'QA-NEW', final: 'QA-NEW', original: '' }
const MERGED = CONTENT.replace(INS, 'QA-NEW')

describe('D-B49-1 协同在线修订写穿（活房间/PUT）', () => {
  const initial = useStudio.getInitialState()
  beforeEach(() => {
    useStudio.setState({ ...initial, pid: 'method', collabStatus: 'connected', content: CONTENT, saved: CONTENT, marks: [mark], collabReadonly: false }, false)
    vi.spyOn(api, 'putDoc').mockResolvedValue({ ok: true, backup: null, backups: [] } as never)
    vi.spyOn(api, 'saveContent').mockResolvedValue({ ok: true, backup: null, backups: [] } as never)
  })
  afterEach(() => {
    registerCollabContentWriter(null)
    vi.restoreAllMocks()
  })

  it('claims 有活房间 → 写进房间（covered 含 claims），不发 PUT', () => {
    const write = vi.fn().mockReturnValue(new Set(['claims', 'content']))
    registerCollabContentWriter(write)
    useStudio.getState().acceptMark(mark.id)
    expect(write).toHaveBeenCalledWith('method', CONTENT, MERGED)
    expect(api.putDoc).not.toHaveBeenCalled()
    expect(api.saveContent).not.toHaveBeenCalled()
    expect(useStudio.getState().content).toBe(MERGED)
  })

  it('claims 无活房间且无镜像 → PUT /docs/claims 落盘', async () => {
    registerCollabContentWriter(vi.fn().mockReturnValue(new Set()))
    useStudio.getState().acceptMark(mark.id)
    // 批78 契约：书级写带 base_sha 第三键，且哈希计算在异步微任务里
    await vi.waitFor(() =>
      expect(api.putDoc).toHaveBeenCalledWith('method', 'claims', {
        content: expect.not.stringContaining('{++'),
        base_sha: expect.anything(),
      }),
    )
    expect(api.saveContent).not.toHaveBeenCalled()
  })

  it('无活房间（writer 返回 null）→ 变化的书逐个 PUT', async () => {
    registerCollabContentWriter(vi.fn().mockReturnValue(null))
    useStudio.getState().acceptMark(mark.id)
    await vi.waitFor(() =>
      expect(api.putDoc).toHaveBeenCalledWith('method', 'claims', {
        content: expect.any(String),
        base_sha: expect.anything(),
      }),
    )
    expect(api.saveContent).not.toHaveBeenCalled()
  })

  it('镜像房写入整篇（covered 含 content）→ 未变化书不补 PUT', () => {
    registerCollabContentWriter(vi.fn().mockReturnValue(new Set(['content'])))
    useStudio.getState().acceptMark(mark.id)
    expect(api.putDoc).not.toHaveBeenCalled()
  })

  it('头部有变且未覆盖 content 房 → PUT /content 兜底', async () => {
    const headMark: CriticMark = { ...mark, id: '1:0', line: 1, from: 0, to: INS.length, a: '', b: 'H' }
    const headContent = CONTENT.replace('# 标题', `${INS}# 标题`)
    useStudio.setState({ content: headContent, saved: headContent, marks: [headMark] })
    registerCollabContentWriter(vi.fn().mockReturnValue(new Set(['claims'])))
    useStudio.getState().acceptMark(headMark.id)
    // 头部标记已被合并进 PUT 全文（claims 行那枚不在本次应用范围，保持原样）
    // 批76 契约：base = saved 哈希为第三参，且写口在异步微任务里发——waitFor 轮询到位
    await vi.waitFor(() =>
      expect(api.saveContent).toHaveBeenCalledWith('method', expect.stringContaining('QA-NEW# 标题'), expect.anything()),
    )
  })

  it('viewer 只读角色 → 不经房间，直接 PUT /content（服务端再判 403）', async () => {
    useStudio.setState({ project: { id: 'method', role: 'viewer' } as never })
    const write = vi.fn()
    registerCollabContentWriter(write)
    useStudio.getState().acceptMark(mark.id)
    expect(write).not.toHaveBeenCalled()
    // 批76 契约：写口改异步 + base 第三参
    await vi.waitFor(() => expect(api.saveContent).toHaveBeenCalledWith('method', MERGED, expect.anything()))
  })

  it('collab off → 不写房间不发 PUT（离线脏态由既有 save 链负责）', () => {
    useStudio.setState({ collabStatus: 'off' })
    const write = vi.fn()
    registerCollabContentWriter(write)
    useStudio.getState().acceptMark(mark.id)
    expect(write).not.toHaveBeenCalled()
    expect(api.putDoc).not.toHaveBeenCalled()
    expect(api.saveContent).not.toHaveBeenCalled()
    expect(useStudio.getState().content).toBe(MERGED)
  })

  it('同族收编点：术语行替换（applyTermReplace）collab 在线同样写穿 persistMergedContent', () => {
    const write = vi.fn().mockReturnValue(new Set(['claims']))
    registerCollabContentWriter(write)
    expect(applyTermReplace(5, '包括 A', '包括 B')).toBe(true)
    expect(write).toHaveBeenCalledWith('method', CONTENT, CONTENT.replace('包括 A', '包括 B'))
    expect(api.putDoc).not.toHaveBeenCalled()
    expect(useStudio.getState().content).toBe(CONTENT.replace('包括 A', '包括 B'))
  })
})
