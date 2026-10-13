// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import { blockSource, findBlockLines, spliceBlock, useStudio } from '@/store'
import type { Ast } from '@/types/ast'
import fixtureMethod from '../../../../backend/tests/golden/ast_method.json'
import fixtureSystem from '../../../../backend/tests/golden/ast_system.json'
import METHOD from '../../../../examples/method/content.md?raw'
import SYSTEM from '../../../../examples/system/content.md?raw'

/**
 * R3 blocks slice（06 §4 / §6）。golden：backend/tests/golden/ast_{method,system}.json 是 parse_ast(examples/…/content.md) 的真输出，
 * 对两案每个可编辑块 blockSource → spliceBlock 回填必须逐字节还原全文（行区间法则与后端 patch_block 一致）。
 */
const cases: [string, Ast, string][] = [
  ['method', fixtureMethod as unknown as Ast, METHOD],
  ['system', fixtureSystem as unknown as Ast, SYSTEM],
]
const editableIds = (ast: Ast) => [
  ...ast.abstract.paragraphs.map((p) => p.id),
  ...ast.claims.map((c) => c.id),
  ...ast.description.map((b) => b.id),
]

describe('行区间法则（两案 golden）', () => {
  it.each(cases)('%s：每个可编辑块 splice(source) 恒等，且块源码不含块间空行', (_name, ast, content) => {
    const ids = editableIds(ast)
    expect(ids.length).toBeGreaterThan(70)
    for (const id of ids) {
      const src = blockSource(ast, content, id)
      expect(src, id).not.toBeNull()
      expect(src!.startsWith('\n') || src!.endsWith('\n'), id).toBe(false)
      expect(spliceBlock(ast, content, id, src!), id).toBe(content)
    }
  })

  it.each(cases)('%s：替换单块只改该块行区间；title / 摘要整块 / 附图不可编辑', (_name, ast, content) => {
    const id = ast.description.find((b) => b.kind === 'paragraph')!.id
    const loc = findBlockLines(ast, id)!
    const before = content.split('\n')
    const after = spliceBlock(ast, content, id, 'X\nY')!.split('\n')
    expect(after.length).toBe(before.length - (loc.end - loc.start + 1) + 2)
    expect(after.slice(0, loc.offset + loc.start - 1)).toEqual(before.slice(0, loc.offset + loc.start - 1))
    expect(after.slice(loc.offset + loc.start + 1)).toEqual(before.slice(loc.offset + loc.end))
    expect(findBlockLines(ast, 'title')).toBeNull()
    expect(findBlockLines(ast, 'abstract')).toBeNull()
    for (const f of ast.figures) expect(findBlockLines(ast, f.id)).toBeNull()
  })
})

describe('patchBlock 乐观更新与回滚', () => {
  const [, ast, content] = cases[0]
  const initial = useStudio.getInitialState()
  const id = ast.claims[0].id

  beforeEach(() => {
    useStudio.setState({ ...initial, pid: 'method', content, saved: content, ast, astContent: content, settings: null }, false)
    vi.spyOn(api, 'projects').mockResolvedValue([])
  })
  afterEach(() => vi.restoreAllMocks())

  it('成功：先本地拼接（content 立即变），再以后端返回为准并视为已保存', async () => {
    const md = '1.改后的权项。'
    const expected = spliceBlock(ast, content, id, md)!
    let seen: string | null = null
    vi.spyOn(api, 'patchBlock').mockImplementation(async (_pid, _bid, body) => {
      seen = useStudio.getState().content
      expect(body.content).toBe(content)
      return { ast, content: expected, changed_lines: { start: 1, end: 1 }, block_id: id, backup: null }
    })
    useStudio.getState().startBlockEdit(id)
    expect(useStudio.getState().editingBlockId).toBe(id)
    const ok = await useStudio.getState().patchBlock(id, md)
    expect(ok).toBe(true)
    expect(seen).toBe(expected)
    const s = useStudio.getState()
    expect(s.content).toBe(expected)
    expect(s.saved).toBe(expected)
    expect(s.astContent).toBe(expected)
    expect(s.editingBlockId).toBeNull()
    expect(s.blockPending).toBe(false)
    expect(s.activeBlock).toEqual({ id, source: 'structure' })
  })

  it('失败（422 带行 / 501）：回滚 content/saved/ast 并 toast，blocksUnavailable 只在 501 置位', async () => {
    vi.spyOn(api, 'patchBlock').mockRejectedValueOnce(
      new ApiError(422, '权项须以数字编号开头', { kind: 'content', message: '权项须以数字编号开头', line: 9, detail: null }),
    )
    expect(await useStudio.getState().patchBlock(id, 'x')).toBe(false)
    let s = useStudio.getState()
    expect(s.content).toBe(content)
    expect(s.saved).toBe(content)
    expect(s.ast).toBe(ast)
    expect(s.blockError).toContain('权项须以数字编号开头')
    expect(s.blockError).not.toMatch(/第 \d+ 行|L\d+/)
    expect(s.blocksUnavailable).toBe(false)
    expect(s.toasts.at(-1)?.kind).toBe('error')

    vi.spyOn(api, 'patchBlock').mockRejectedValueOnce(new ApiError(501, 'R3 B1-patch-api 未实现'))
    expect(await useStudio.getState().patchBlock(id, 'x')).toBe(false)
    s = useStudio.getState()
    expect(s.content).toBe(content)
    expect(s.blocksUnavailable).toBe(true)
  })

  it('insert / delete 走后端结果；块不存在时 patch 直接失败不发请求', async () => {
    const spy = vi.spyOn(api, 'patchBlock')
    expect(await useStudio.getState().patchBlock('claims/999', 'x')).toBe(false)
    expect(spy).not.toHaveBeenCalled()

    vi.spyOn(api, 'insertBlock').mockResolvedValue({ ast, content, changed_lines: { start: 20, end: 20 }, block_id: 'claims/2', backup: null })
    expect(await useStudio.getState().insertBlock({ kind: 'claim', after_block_id: id })).toBe('claims/2')
    expect(useStudio.getState().activeBlock?.id).toBe('claims/2')

    vi.spyOn(api, 'deleteBlock').mockResolvedValue({ ast, content, changed_lines: { start: 20, end: 19 }, block_id: null, backup: null })
    useStudio.getState().setActiveBlock('claims/2', 'structure')
    expect(await useStudio.getState().deleteBlock('claims/2')).toBe(true)
    expect(useStudio.getState().activeBlock).toBeNull()
  })
})
