// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import type { AiJob } from '@/types/ai'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 手动兑现的 fetch：用来把响应卡在「pid 已切换」之后落地 */
const deferredFetch = () => {
  let resolve!: (r: Response) => void
  const promise = new Promise<Response>((r) => { resolve = r })
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => promise)
  return resolve
}

const job = (pid: string): AiJob => ({
  id: `j-${pid}`, kind: 'review', pid, status: 'running', progress: 0,
  message: '', result: null, error: null, created_at: 0, updated_at: 0,
})

afterEach(() => {
  vi.restoreAllMocks()
  useStudio.setState({
    pid: null, comments: [], versions: [], members: [], jobs: [], historyDiff: null, toasts: [],
    publicLinks: [], collabSettings: undefined, access: null, invites: [],
  })
})

describe('R115-批26 案域残留清场', () => {
  it('openProject 起调即清旧案 publicLinks/块旗标，不闪旧数据', async () => {
    const resolve = deferredFetch()
    useStudio.setState({
      pid: 'p1', project: { id: 'p1' } as never,
      publicLinks: [{ token: 'old' } as never],
      editingBlockId: 'abstract/p1', blockPending: true, blockError: 'x',
    })
    const pending = useStudio.getState().openProject('p2')
    const s = useStudio.getState()          // fetch 未回，先看起调清场
    expect(s.publicLinks).toEqual([])
    expect(s.editingBlockId).toBeNull()
    expect(s.blockPending).toBe(false)
    expect(s.blockError).toBeNull()
    resolve(json({ id: 'p2', settings: {}, figs: [], backups: [], content: '# p2' }))
    await pending
  })

  it('块写 PATCH 在飞切案 → blockPending 不留孤儿（原状永久禁用新案块提交）', () => {
    useStudio.setState({ pid: 'p2', blockPending: true, editingBlockId: 'claims/p3' })
    useStudio.getState().closeWorkspace()
    const s = useStudio.getState()
    expect(s.blockPending).toBe(false)
    expect(s.editingBlockId).toBeNull()
    expect(s.publicLinks).toEqual([])
  })
})

describe('D-CROSS 换案加载窗：旧案正文/AST 起调即清', () => {
  it('openProject 起调即清 content/saved/serverContent/ast；窗内 saveBook/patchBlock 拒写跨案', async () => {
    const resolve = deferredFetch()
    const putDoc = vi.spyOn(api, 'putDoc')
    const patchBlock = vi.spyOn(api, 'patchBlock')
    useStudio.setState({
      pid: 'p1', project: { id: 'p1' } as never,
      content: '旧案全文', saved: '旧案全文', serverContent: '旧案全文', contentEditedAt: 1,
      ast: { id: 'a' } as never, astContent: '旧案全文', astPid: 'p1',
      bookSha: { claims: 's' }, bookDoc: {} as never,
    })
    const pending = useStudio.getState().openProject('p2')
    const s = useStudio.getState()          // fetch 未回：窗口内必须不见旧案正文
    expect(s.content).toBe('')
    expect(s.saved).toBe('')
    expect(s.serverContent).toBeNull()
    expect(s.contentEditedAt).toBe(0)
    expect(s.ast).toBeNull()
    expect(s.astContent).toBeNull()
    expect(s.astPid).toBeNull()
    expect(s.bookSha).toEqual({})
    /* 陈旧编辑器的迟发写（卸载 flush / idle 保存）：ast 已清 → 全部拒写，不 PUT 不 PATCH */
    expect(await useStudio.getState().saveBook('claims', '陈旧权项文本')).toBe(false)
    expect(await useStudio.getState().patchBlock('c1', '陈旧块文本', '')).toBe(false)
    expect(putDoc).not.toHaveBeenCalled()
    expect(patchBlock).not.toHaveBeenCalled()
    resolve(json({ id: 'p2', settings: {}, figs: [], backups: [], content: '# p2' }))
    await pending
    expect(useStudio.getState().content).toBe('# p2')
  })
})

describe('R83 切案竞态：晚到的响应不写进新案 store', () => {
  it('loadComments 往返间 pid 已切 → comments 不被旧案覆盖；同案正常落地', async () => {
    const resolve = deferredFetch()
    useStudio.setState({ pid: 'p1' })
    const pending = useStudio.getState().loadComments('p1')
    useStudio.setState({ pid: 'p2', comments: [] })
    resolve(json([{ id: 'c-p1' }]))
    await pending
    expect(useStudio.getState().comments).toEqual([])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json([{ id: 'c-p2' }]))
    await useStudio.getState().loadComments('p2')
    expect(useStudio.getState().comments.map((c) => c.id)).toEqual(['c-p2'])
  })

  it('loadHistory / loadDiff / loadMembers / loadPublicLinks 同款守卫', async () => {
    type Case = { start: () => Promise<unknown>; read: () => unknown; sentinel: unknown }
    const cases: Case[] = [
      { start: () => useStudio.getState().loadHistory('p1'), read: () => useStudio.getState().versions, sentinel: [] },
      { start: () => useStudio.getState().loadDiff('p1', 'a'), read: () => useStudio.getState().historyDiff, sentinel: null },
      { start: () => useStudio.getState().loadMembers('p1'), read: () => useStudio.getState().members, sentinel: [] },
      { start: () => useStudio.getState().loadPublicLinks('p1'), read: () => useStudio.getState().publicLinks, sentinel: [] },
      { start: () => useStudio.getState().loadAccess('p1'), read: () => useStudio.getState().access, sentinel: null },
      { start: () => useStudio.getState().loadInvites('p1'), read: () => useStudio.getState().invites, sentinel: [] },
      { start: () => useStudio.getState().loadCollabSettings('p1'), read: () => useStudio.getState().collabSettings, sentinel: undefined },
      { start: () => useStudio.getState().loadJobs('p1'), read: () => useStudio.getState().jobs, sentinel: [] },
      { start: () => useStudio.getState().loadOaItems('p1'), read: () => useStudio.getState().oaItems, sentinel: [] },
    ]
    for (const c of cases) {
      const resolve = deferredFetch()
      useStudio.setState({ pid: 'p1' })
      const pending = c.start()
      useStudio.setState({ pid: 'p2' })
      resolve(json({ items: [], jobs: [job('p1')] }))
      await pending.catch(() => undefined)
      expect(c.read()).toEqual(c.sentinel)
      vi.restoreAllMocks()
    }
  })

  it('upsertJob：pid 不符的任务（含 SSE/轮询晚到帧）不进本案 jobs 表', () => {
    useStudio.setState({ pid: 'p2' })
    useStudio.getState().upsertJob(job('p1'))
    expect(useStudio.getState().jobs).toEqual([])
    useStudio.getState().upsertJob(job('p2'))
    expect(useStudio.getState().jobs.map((j) => j.id)).toEqual(['j-p2'])
  })
})

describe('R115-批45 批注写链迟发守卫', () => {
  it('addComment 往返间 pid 已切 → 不塞旧案批注进新案空列表；同案正常追加', async () => {
    const resolve = deferredFetch()
    useStudio.setState({ pid: 'p1', comments: [] })
    const pending = useStudio.getState().addComment('p1', { paraId: 'p', quote: 'q' } as never, 'hi')
    useStudio.setState({ pid: 'p2', comments: [] })   // 翻案清场（openProject resetComments）
    resolve(json({ id: 'c-p1' }))
    await pending
    expect(useStudio.getState().comments).toEqual([])
    expect(useStudio.getState().activeCommentId).not.toBe('c-p1')

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ id: 'c-p2' }))
    await useStudio.getState().addComment('p2', { paraId: 'p', quote: 'q' } as never, 'hi')
    expect(useStudio.getState().comments.map((c) => c.id)).toEqual(['c-p2'])
  })

  it('deleteComment 往返间 pid 已切 → 不再触碰新案批注列表', async () => {
    const resolve = deferredFetch()
    useStudio.setState({ pid: 'p1', comments: [{ id: 'c1' } as never] })
    const pending = useStudio.getState().deleteComment('p1', 'c1')
    useStudio.setState({ pid: 'p2', comments: [{ id: 'c1' } as never, { id: 'c2' } as never] })
    resolve(json({ ok: true }))
    await pending
    expect(useStudio.getState().comments.map((c) => c.id)).toEqual(['c1', 'c2'])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ ok: true }))
    await useStudio.getState().deleteComment('p2', 'c1')
    expect(useStudio.getState().comments.map((c) => c.id)).toEqual(['c2'])
  })
})
