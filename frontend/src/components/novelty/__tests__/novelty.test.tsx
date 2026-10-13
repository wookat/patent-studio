// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { NoveltyPage } from '../NoveltyPage'
import type { NoveltyRecord } from '@/types/novelty'

/**
 * W19 批4 查新记录卡页（#/p/<pid>/novelty）：
 * GET 装载 → 行渲染；编辑 → 脏 → PUT；viewer 只读；失败重试。
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

const REC: NoveltyRecord = {
  updated_at: '2026-09-30T10:00:00',
  queries: [{ query: 'transformer AND 时间序列', provider: 'OPS', ran_at: '2026-09-30' }],
  hits: [{ number: 'CN114519469B', title: '一种预测方法', relevance: 'Y', note: '区别在移位窗口', link: 'https://example.com/x' }],
  conclusion: '具备新颖性初步判断',
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: q === DESKTOP_QUERY, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    authStatus: 'authed',
    project: { id: 'p1', title: '测试案', role: 'agent', case: { status: 'intake' } } as never,
  })
  vi.spyOn(api, 'getNovelty').mockResolvedValue(REC)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}

const change = async (el: Element | null, v: string) => {
  expect(el, 'input to change').not.toBeNull()
  await act(async () => {
    const i = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(i, v)
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function loadPage() {
  const h = await mount(<NoveltyPage pid="p1" />)
  await act(async () => Promise.resolve())
  return h
}

describe('NoveltyPage', () => {
  it('GET 装载 → 检索式/对比文件/结论行渲染；保存钮在干净态禁用', async () => {
    const h = await loadPage()
    expect(h.querySelector('[data-testid="novelty-form"]')).not.toBeNull()
    expect((h.querySelector('[data-testid="query-text-0"]') as HTMLInputElement).value).toBe('transformer AND 时间序列')
    expect((h.querySelector('[data-testid="hit-number-0"]') as HTMLInputElement).value).toBe('CN114519469B')
    expect((h.querySelector('[data-testid="novelty-conclusion-input"]') as HTMLTextAreaElement).value).toContain('新颖性')
    expect((h.querySelector('[data-testid="novelty-save"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('编辑 → 脏 → 保存 PUT 正确载荷；保存后干净', async () => {
    const put = vi.spyOn(api, 'putNovelty').mockResolvedValue({ ...REC, updated_at: '2026-10-01T01:00:00' })
    const h = await loadPage()
    await change(h.querySelector('[data-testid="hit-number-0"]'), 'CN114519469A')
    const save = h.querySelector('[data-testid="novelty-save"]') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await click(save)
    expect(put).toHaveBeenCalledTimes(1)
    const body = put.mock.calls[0][1]
    expect(body.hits[0].number).toBe('CN114519469A')
    expect(body.queries[0].provider).toBe('OPS')
    expect(body.conclusion).toContain('新颖性')
    expect((h.querySelector('[data-testid="novelty-save"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('添加/删除检索式与对比文件行', async () => {
    vi.spyOn(api, 'getNovelty').mockResolvedValue({ updated_at: null, queries: [], hits: [], conclusion: '' })
    const h = await loadPage()
    expect(h.querySelector('[data-testid="queries-empty"]')).not.toBeNull()
    await click(h.querySelector('[data-testid="add-query"]'))
    expect(h.querySelector('[data-testid="query-text-0"]')).not.toBeNull()
    await change(h.querySelector('[data-testid="query-text-0"]'), 'shifted window')
    await click(h.querySelector('[data-testid="add-hit"]'))
    await change(h.querySelector('[data-testid="hit-title-0"]'), '对比文件甲')
    await click(h.querySelector('[data-testid="del-query-0"]'))
    expect(h.querySelector('[data-testid="query-text-0"]')).toBeNull()
    expect(h.querySelector('[data-testid="queries-empty"]')).not.toBeNull()
    expect(h.querySelector('[data-testid="hit-title-0"]')).not.toBeNull()
  })

  it('viewer → 输入全禁 + 只读提示 + 无保存钮', async () => {
    useStudio.setState({ project: { id: 'p1', title: '测试案', role: 'viewer', case: { status: 'intake' } } as never })
    const h = await loadPage()
    expect(h.querySelector('[data-testid="novelty-readonly"]')).not.toBeNull()
    expect((h.querySelector('[data-testid="query-text-0"]') as HTMLInputElement).disabled).toBe(true)
    expect(h.querySelector('[data-testid="novelty-save"]')).toBeNull()
    expect(h.querySelector('[data-testid="add-query"]')).toBeNull()
  })

  it('GET 失败 → 错误态带重试；重试重拉', async () => {
    const get = vi.spyOn(api, 'getNovelty').mockRejectedValueOnce(new ApiError(500, 'boom')).mockResolvedValue(REC)
    const h = await loadPage()
    expect(h.querySelector('[data-testid="novelty-retry"]')).not.toBeNull()
    await click(h.querySelector('[data-testid="novelty-retry"]'))
    await act(async () => Promise.resolve())
    expect(get).toHaveBeenCalledTimes(2)
    expect(h.querySelector('[data-testid="novelty-form"]')).not.toBeNull()
  })
})
