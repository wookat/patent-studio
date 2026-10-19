// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { ClaimDetail, ClaimPreview } from '@/lib/api/claims'
import type { PreflightReport } from '@/types/preflight'
import { ClaimsSandboxPage } from '../ClaimsSandboxPage'

/**
 * Z20 权项沙盘页复核回归：
 * - 非法引用输入（abc / 1.5 / -1 / 0）→ 显式报错且不发送预览请求
 * - detail 响应乱序闸：快选 2→5，慢响应 2 不得覆盖 5
 * - 换案（pid 变）→ tree/detail/selected/preview 全重置
 * - 编辑输入后旧预览失效
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
let root: Root | null = null
let host: HTMLElement

const TREE = [
  { num: 1, kind: 'independent', category: 'method', refs: [], children: [], line: 1, issues: [] },
  { num: 2, kind: 'dependent', category: 'method', refs: [1], children: [3, 4], line: 3, issues: [] },
  { num: 3, kind: 'dependent', category: 'method', refs: [2], children: [], line: 5, issues: [] },
  { num: 4, kind: 'dependent', category: 'method', refs: [2], children: [], line: 7, issues: [] },
  { num: 5, kind: 'dependent', category: 'method', refs: [1], children: [], line: 9, issues: [] },
] as unknown as PreflightReport['claim_tree']

const DETAIL = (num: number): ClaimDetail => ({
  claim: num,
  ok: true,
  node: { num, kind: 'dependent', category: 'method', refs: [1], issues: [], line: num },
  current_refs: [1],
  direct_dependents: [],
  downstream: [],
  upstream: [1],
  support: [],
})

const PREVIEW_OK = (num: number): ClaimPreview => ({
  claim: num,
  ok: true,
  blockers: [],
  warnings: [],
  current_refs: [1],
  proposed_refs: [1, 3],
  ref_diff: { added: [3], removed: [] },
  downstream: [],
  upstream: [1, 2, 3],
  support: [],
})

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
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

async function loadPage(pid = 'p1') {
  vi.spyOn(api, 'getPreflight').mockResolvedValue({ claim_tree: TREE } as PreflightReport)
  const h = await mount(<ClaimsSandboxPage pid={pid} />)
  await act(async () => Promise.resolve())
  return h
}

describe('ClaimsSandboxPage 复核项1/2', () => {
  it('非法引用输入 → 显式报错且不发送预览请求', async () => {
    const preview = vi.spyOn(api, 'claimPreview').mockResolvedValue(PREVIEW_OK(5))
    vi.spyOn(api, 'claimDetail').mockResolvedValue(DETAIL(5))
    const h = await loadPage()
    await click(h.querySelector('[data-node="claim-5"]'))
    await vi.waitFor(() => expect(h.querySelector('[data-testid="claim-detail"]')).not.toBeNull())
    for (const bad of ['abc', '1.5', '-1', '0', '1,a']) {
      await change(h.querySelector('[data-testid="preview-refs-input"]'), bad)
      await click(h.querySelector('[data-testid="preview-run"]'))
      const err = h.querySelector('[data-testid="preview-input-error"]')
      expect(err, `input=${bad}`).not.toBeNull()
      expect(err!.textContent).toContain('不合法')
    }
    expect(preview).not.toHaveBeenCalled()
    // 合法输入恢复正常：空输入 = 清空引用（发送 refs:[]）
    await change(h.querySelector('[data-testid="preview-refs-input"]'), '')
    await click(h.querySelector('[data-testid="preview-run"]'))
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('p1', 5, [], expect.anything()))
  })

  it('detail 乱序闸：快选 2→5，晚到的 2 响应不得覆盖 5', async () => {
    let resolve2!: (d: ClaimDetail) => void
    const detail = vi.spyOn(api, 'claimDetail').mockImplementation((_pid, num) => {
      if (num === 2)
        return new Promise<ClaimDetail>((res) => {
          resolve2 = res
        })
      return Promise.resolve(DETAIL(num))
    })
    const h = await loadPage()
    await click(h.querySelector('[data-node="claim-2"]'))
    await click(h.querySelector('[data-node="claim-5"]'))
    // 权5 详情先落地
    await vi.waitFor(() => expect(h.querySelector('[data-testid="claim-detail"]')?.textContent).toContain('权利要求 5'))
    // 权2 的慢响应随后到达——被丢弃，不回写
    await act(async () => resolve2(DETAIL(2)))
    await act(async () => Promise.resolve())
    expect(h.querySelector('[data-testid="claim-detail"]')?.textContent).toContain('权利要求 5')
    expect(h.querySelector('[data-testid="claim-detail"]')?.textContent).not.toContain('权利要求 2')
    expect(detail).toHaveBeenCalledTimes(2)
  })

  it('换案重置：pid 变化清空 tree/detail/selected/preview 与输入', async () => {
    vi.spyOn(api, 'claimDetail').mockResolvedValue(DETAIL(5))
    vi.spyOn(api, 'claimPreview').mockResolvedValue(PREVIEW_OK(5))
    const h = await loadPage()
    await click(h.querySelector('[data-node="claim-5"]'))
    await vi.waitFor(() => expect(h.querySelector('[data-testid="claim-detail"]')).not.toBeNull())
    await change(h.querySelector('[data-testid="preview-refs-input"]'), '1,3')
    await click(h.querySelector('[data-testid="preview-run"]'))
    await vi.waitFor(() => expect(h.querySelector('[data-testid="claim-preview-result"]')).not.toBeNull())
    // 换案 → 全部回到初始态
    await act(async () => root!.render(<ClaimsSandboxPage pid="p2" />))
    await act(async () => Promise.resolve())
    expect(api.getPreflight).toHaveBeenLastCalledWith('p2', {}, expect.anything())
    expect(h.querySelector('[data-testid="claim-detail"]')).toBeNull()
    expect(h.querySelector('[data-testid="claim-preview-result"]')).toBeNull()
    expect(h.querySelector('[data-testid="preview-refs-input"]')).toBeNull()
    expect(h.querySelector('[data-testid="claims-sandbox-page"]')!.textContent).toContain('在左侧选择一项权利要求')
  })

  it('编辑输入使旧预览失效（不再展示为当前输入的结论）', async () => {
    vi.spyOn(api, 'claimDetail').mockResolvedValue(DETAIL(5))
    vi.spyOn(api, 'claimPreview').mockResolvedValue(PREVIEW_OK(5))
    const h = await loadPage()
    await click(h.querySelector('[data-node="claim-5"]'))
    await vi.waitFor(() => expect(h.querySelector('[data-testid="claim-detail"]')).not.toBeNull())
    await change(h.querySelector('[data-testid="preview-refs-input"]'), '1,3')
    await click(h.querySelector('[data-testid="preview-run"]'))
    await vi.waitFor(() => expect(h.querySelector('[data-testid="claim-preview-result"]')).not.toBeNull())
    // 改输入 → 旧结果消失
    await change(h.querySelector('[data-testid="preview-refs-input"]'), '1,4')
    expect(h.querySelector('[data-testid="claim-preview-result"]')).toBeNull()
  })

  it('detail 失败展示错误信息而非假通过', async () => {
    vi.spyOn(api, 'claimDetail').mockRejectedValue(new (await import('@/lib/api')).ApiError(500, '服务错误'))
    const h = await loadPage()
    await click(h.querySelector('[data-node="claim-3"]'))
    await vi.waitFor(() => expect(h.querySelector('[role="alert"]')?.textContent).toContain('服务错误'))
  })
})
