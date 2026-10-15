// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/net'
import { splitBooks } from '@/lib/docset'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Ast } from '@/types/ast'
import type { Document, WorkingCopy } from '@/workbench/types'
import astMethod from '../../../../../backend/tests/golden/ast_method.json'
import mdMethod from '../../../../../examples/method/content.md?raw'

const ast = astMethod as unknown as Ast
const md = mdMethod
const claimsText = splitBooks(md).books.claims!.text

const api = vi.hoisted(() => ({
  document: vi.fn(),
  case: vi.fn(),
  workingCopies: vi.fn(),
  openWorkingCopy: vi.fn(),
  workingCopyContent: vi.fn(),
  documentAst: vi.fn(),
  saveWorkingCopyContent: vi.fn(),
  commitWorkingCopy: vi.fn(),
  flushCollab: vi.fn(),
}))

vi.mock('@/workbench/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/workbench/api')>()
  return { ...mod, workbenchApi: { ...mod.workbenchApi, ...api } }
})

import { DocEditorPage } from '../DocEditorPage'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const DOC: Document = { id: 'd1', case_id: 'c1', book: 'claims', current_revision_id: 'r1' }
const CASE = { id: 'c1', organization_id: 'o1', case_key: 'METHOD-1', title: '一种控制方法', kind: 'invention', status: 'drafting' }
const COPY: WorkingCopy = {
  id: 'wc1',
  document_id: 'd1',
  principal_id: 'p1',
  base_revision_id: 'r1',
  version: 1,
  content_ref: { key: 'sha256/x', sha256: 'x', size: 1, content_type: 'text/markdown' },
}

let root: Root | null = null
let host: HTMLDivElement
let client: QueryClient

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  vi.clearAllMocks()
  api.document.mockResolvedValue(DOC)
  api.case.mockResolvedValue(CASE)
  api.workingCopies.mockResolvedValue([])
  api.openWorkingCopy.mockResolvedValue(COPY)
  api.workingCopyContent.mockResolvedValue(claimsText)
  api.documentAst.mockResolvedValue({ ast, content: md })
  api.saveWorkingCopyContent.mockImplementation(async (_id: string, version: number) => ({ ...COPY, version: version + 1 }))
  api.commitWorkingCopy.mockResolvedValue({ id: 'op1', status: 'succeeded' })
  api.flushCollab.mockResolvedValue({ flushed: 0 })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root?.render(element))
  return host
}

async function settle() {
  await act(async () => new Promise((r) => setTimeout(r, 0)))
}

const page = () => (
  <QueryClientProvider client={client}>
    <TooltipProvider>
      <DocEditorPage caseId="c1" docId="d1" />
    </TooltipProvider>
  </QueryClientProvider>
)

describe('DocEditorPage（B12 旧编辑器接 /api/v1）', () => {
  it('开工作副本 → 读正文 → AST → BookEditor 渲染真实权项文本', async () => {
    const el = await mount(page())
    await settle()
    await settle()

    expect(api.openWorkingCopy).toHaveBeenCalledWith('d1', 'r1', undefined)
    expect(api.workingCopyContent.mock.calls[0][0]).toBe('wc1')
    expect(api.documentAst).toHaveBeenCalledWith('d1', claimsText)
    const book = el.querySelector('[data-testid="ps-book-claims"]')
    expect(book).not.toBeNull()
    expect(book!.textContent).toContain('一种')
  })

  it('已有工作副本 → 直接恢复（不再新建），刷新后未提交草稿不丢', async () => {
    api.workingCopies.mockResolvedValue([COPY])
    const el = await mount(page())
    await settle()
    await settle()

    expect(api.openWorkingCopy).not.toHaveBeenCalled()
    expect(api.workingCopyContent.mock.calls[0][0]).toBe('wc1')
    expect(el.querySelector('[data-testid="ps-book-claims"]')!.textContent).toContain('一种')
  })

  it('提交 revision：先把当前 doc 序列化保存（乐观锁版本），再 commit', async () => {
    const el = await mount(page())
    await settle()
    await settle()

    await act(async () => (el.querySelector('[data-testid="doc-editor-commit"]') as HTMLButtonElement).click())
    await settle()

    expect(api.saveWorkingCopyContent).toHaveBeenCalled()
    const [copyId, version, text] = api.saveWorkingCopyContent.mock.calls.at(-1)!
    expect(copyId).toBe('wc1')
    expect(version).toBe(1)
    expect(text).toContain('一种')
    expect(api.commitWorkingCopy).toHaveBeenCalledWith('wc1', 2)
    expect(el.querySelector('[data-testid="doc-editor-committed"]')).not.toBeNull()
  })

  it('保存 409 → 冲突横幅提示重载', async () => {
    api.saveWorkingCopyContent.mockRejectedValue(new ApiError(409, 'conflict', { kind: 'conflict', message: '版本已过期', line: null, detail: null }))
    const el = await mount(page())
    await settle()
    await settle()

    await act(async () => (el.querySelector('[data-testid="doc-editor-commit"]') as HTMLButtonElement).click())
    await settle()

    expect(el.querySelector('[data-testid="doc-editor-conflict"]')).not.toBeNull()
    expect(api.commitWorkingCopy).not.toHaveBeenCalled()
  })

  it('无修订文档开工作副本带空 content_ref', async () => {
    const doc = { ...DOC, current_revision_id: null }
    api.document.mockResolvedValue(doc)
    api.documentAst.mockResolvedValue({ ast, content: md })
    const el = await mount(page())
    await settle()
    await settle()

    const [, base, ref] = api.openWorkingCopy.mock.calls[0]
    expect(base).toBeNull()
    expect(ref?.size).toBe(0)
    expect(ref?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(el.querySelector('[data-testid="ps-book-claims"]')).not.toBeNull()
  })

  it('引导失败（403）→ ErrorPanel', async () => {
    api.openWorkingCopy.mockRejectedValue(new ApiError(403, 'denied', { kind: 'denied', message: '没有权限', line: null, detail: null }))
    const el = await mount(page())
    await settle()
    await settle()
    await settle()

    expect(el.querySelector('[data-testid="workbench-forbidden"]')).not.toBeNull()
  })
})
