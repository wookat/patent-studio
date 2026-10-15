// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import { replaceBook, splitBooks } from '@/lib/docset'
import type { ProjectDetail } from '@/lib/types'
import { blockSource, findBlockLines, spliceBlock, useStudio } from '@/store'
import { CONFLICT_TOAST, registerCollabBookWriter, registerCollabContentWriter } from '@/store/layoutView'
import type { Ast } from '@/types/ast'
import fixture from '../../../../backend/tests/fixtures/ast_rich.json'
import METHOD from '../../../../backend/tests/fixtures/rich/content.md?raw'

/**
 * W9 saveBook（store 入口 doc.saveBook(book, newMd, {review}) → layoutView.saveBookDoc）：
 * bookDiff 单块 → patchBlock；多块 → PUT /docs/{book}{content, base_sha}；409 → toast + 刷新；协同在线 → Y.Text 写入器。
 */
const ast = fixture as unknown as Ast
const content = METHOD
const initial = useStudio.getInitialState()
const claimsMd = () => splitBooks(useStudio.getState().content).books.claims!.text
const c1 = ast.claims[0].id
const c2 = ast.claims[1].id

const editClaim = (id: string, suffix: string) => {
  const l = findBlockLines(ast, id)!
  const lines = claimsMd().split('\n')
  lines[l.start - 1] += suffix
  return lines.join('\n')
}

beforeEach(() => {
  useStudio.setState({ ...initial, pid: 'method', content, saved: content, ast, astContent: content, settings: null }, false)
  vi.spyOn(api, 'projects').mockResolvedValue([])
})
afterEach(() => {
  vi.restoreAllMocks()
  registerCollabBookWriter(null)
  registerCollabContentWriter(null)
})

describe('saveBook：单块 → patchBlock', () => {
  it('行内格式改动只发块补丁，不发 PUT；review=true 时块内容为 CriticMarkup', async () => {
    const put = vi.spyOn(api, 'putDoc')
    const patch = vi.spyOn(api, 'patchBlock').mockImplementation(async (_pid, bid, body) => ({
      ast,
      content: spliceBlock(ast, content, bid, body.markdown)!,
      changed_lines: { start: 1, end: 1 },
      block_id: bid,
      backup: null,
    }))
    const next = editClaim(c1, ' **粗**')
    expect(await useStudio.getState().saveBook('claims', next)).toBe(true)
    expect(put).not.toHaveBeenCalled()
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch.mock.calls[0][1]).toBe(c1)
    const newBlock = patch.mock.calls[0][2].markdown
    expect(newBlock.split('\n')[0].endsWith(' **粗**')).toBe(true)
    expect(newBlock).toBe(blockSource(ast, content, c1)!.replace('\n', ' **粗**\n'))
    expect(splitBooks(useStudio.getState().content).books.claims!.text).toBe(next)
    expect(useStudio.getState().saved).toBe(useStudio.getState().content)

    useStudio.setState({ content, saved: content, ast, astContent: content })
    expect(await useStudio.getState().saveBook('claims', editClaim(c1, ' 甲'), { review: true })).toBe(true)
    const critic = patch.mock.calls[1][2].markdown
    expect(critic).toMatch(/\{\+\+|\{~~/)
    expect(critic).not.toBe(blockSource(ast, content, c1))
  })

  it('无变化直接 true 且不发请求；非规范三书 / 无 ast 返回 false', async () => {
    const put = vi.spyOn(api, 'putDoc')
    const patch = vi.spyOn(api, 'patchBlock')
    expect(await useStudio.getState().saveBook('claims', claimsMd())).toBe(true)
    useStudio.setState({ ast: null })
    expect(await useStudio.getState().saveBook('claims', claimsMd() + '\nx')).toBe(false)
    expect(put).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })
})

describe('saveBook：多块 → PUT /docs/{book}', () => {
  const twoClaims = () => {
    const l1 = findBlockLines(ast, c1)!
    const l2 = findBlockLines(ast, c2)!
    const lines = claimsMd().split('\n')
    lines[l1.start - 1] += ' 甲'
    lines[l2.start - 1] += ' 乙'
    return lines.join('\n')
  }

  it('乐观 setContent → PUT {content, base_sha} → 以返回 ast/content/sha 为准', async () => {
    useStudio.getState().setBookSha('claims', 'sha-old')
    const next = twoClaims()
    const full = replaceBook(content, 'claims', next)
    let seen: string | null = null
    const patch = vi.spyOn(api, 'patchBlock')
    const put = vi.spyOn(api, 'putDoc').mockImplementation(async (_pid, book, body) => {
      seen = useStudio.getState().content
      expect(book).toBe('claims')
      expect(body).toEqual({ content: next, base_sha: 'sha-old' })
      return { ok: true, backup: null, backups: [], ast, content: full, changed_lines: { start: 1, end: 2 }, sha: 'sha-new' }
    })
    expect(await useStudio.getState().saveBook('claims', next)).toBe(true)
    expect(patch).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledTimes(1)
    expect(seen).toBe(full)
    const s = useStudio.getState()
    expect(s.content).toBe(full)
    expect(s.saved).toBe(full)
    expect(s.bookSha.claims).toBe('sha-new')
    expect(s.bookSaving).toBe(false)
  })

  it('旧后端（无 ast/sha 返回）：saved 只换本书，base_sha 为 null', async () => {
    const next = twoClaims()
    const put = vi.spyOn(api, 'putDoc').mockResolvedValue({ ok: true, backup: null, backups: [] })
    expect(await useStudio.getState().saveBook('claims', next)).toBe(true)
    expect(put.mock.calls[0][2]).toEqual({ content: next, base_sha: null })
    expect(useStudio.getState().saved).toBe(replaceBook(content, 'claims', next))
  })

  it('409 → 回滚 content/saved、toast「内容已被他人修改」并从服务端刷新', async () => {
    const next = twoClaims()
    vi.spyOn(api, 'putDoc').mockRejectedValue(new ApiError(409, 'conflict'))
    const server = { id: 'method', title: 't', role: null, settings: null, figs: [], backups: [], content } as unknown as ProjectDetail
    const proj = vi.spyOn(api, 'project').mockResolvedValue(server)
    const loadAst = vi.fn(async () => ast)
    useStudio.setState({ loadAst })
    expect(await useStudio.getState().saveBook('claims', next)).toBe(false)
    const s = useStudio.getState()
    expect(s.content).toBe(content)
    expect(s.saved).toBe(content)
    expect(s.toasts.at(-1)).toMatchObject({ kind: 'error', text: CONFLICT_TOAST })
    expect(proj).toHaveBeenCalledWith('method')
    expect(loadAst).toHaveBeenCalledWith('method', { fromDisk: true })
    expect(s.bookSaving).toBe(false)
  })

  it('其它错误 → 回滚 + 「保存失败」toast', async () => {
    vi.spyOn(api, 'putDoc').mockRejectedValue(new ApiError(500, 'boom'))
    expect(await useStudio.getState().saveBook('claims', twoClaims())).toBe(false)
    expect(useStudio.getState().content).toBe(content)
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('保存失败')
  })

  it('review=true：整书 CriticMarkup 作为 PUT content', async () => {
    const next = twoClaims()
    const put = vi.spyOn(api, 'putDoc').mockResolvedValue({ ok: true, backup: null, backups: [] })
    expect(await useStudio.getState().saveBook('claims', next, { review: true })).toBe(true)
    const body = put.mock.calls[0][2]
    expect(body.content).toMatch(/\{\+\+|\{~~/)
    expect(body.content).not.toBe(next)
  })
})

describe('saveBook：协同在线 → Y.Text 写入器，不发 HTTP', () => {
  it('selectCollabActive 时调用注册的写入器（bookText + fullContent）', async () => {
    useStudio.setState({ collabStatus: 'connected' })
    const writer = vi.fn(() => true)
    registerCollabBookWriter(writer)
    const put = vi.spyOn(api, 'putDoc')
    const patch = vi.spyOn(api, 'patchBlock')
    const next = editClaim(c1, ' 甲')
    expect(await useStudio.getState().saveBook('claims', next)).toBe(true)
    expect(writer).toHaveBeenCalledTimes(1)
    expect(writer.mock.calls[0]).toEqual(['method', 'claims', next, replaceBook(content, 'claims', next)])
    expect(put).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('无可写房间：经 persistMergedContent——未覆盖变化书 PUT /docs/{book} 兜底（镜像也死时不丢）', async () => {
    useStudio.setState({ collabStatus: 'connected' })
    registerCollabBookWriter(() => false)
    const put = vi.spyOn(api, 'putDoc').mockResolvedValue({ sha: 's2' } as never)
    const next = editClaim(c1, ' 甲')
    expect(await useStudio.getState().saveBook('claims', next)).toBe(true)
    expect(useStudio.getState().content).toBe(replaceBook(content, 'claims', next))
    // 批78 契约：书级写带 base_sha（saved 书文 sha1），且哈希计算在异步微任务里
    await vi.waitFor(() =>
      expect(put).toHaveBeenCalledWith('method', 'claims', { content: next, base_sha: expect.anything() }),
    )
  })

  it('无可写书房但 content 镜像房覆盖：不重复 PUT', async () => {
    useStudio.setState({ collabStatus: 'connected' })
    registerCollabBookWriter(() => false)
    registerCollabContentWriter(() => new Set(['content']))
    const put = vi.spyOn(api, 'putDoc')
    const next = editClaim(c1, ' 甲')
    expect(await useStudio.getState().saveBook('claims', next)).toBe(true)
    expect(put).not.toHaveBeenCalled()
  })
})
