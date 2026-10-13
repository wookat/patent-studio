// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import type { Version } from '@/lib/types'
import { HistoryPanel } from '../HistoryPanel'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      history: vi.fn(async (): Promise<Version[]> => versions),
      historyVersion: vi.fn(async (_pid: string, sha: string) => ({ sha, content: sha === B ? 'l1\nl2 改\n' : 'l1\nl2\n' })),
      historyDiff: vi.fn(async (_pid: string, a: string, b = 'work') => ({ a, b, diff: '--- a/content.md\n+++ b/content.md\n@@ -1,2 +1,2 @@\n l1\n-l2\n+l2 改\n' })),
      restoreVersion: vi.fn(async () => ({ ok: true, content: 'l1\nl2\n', sha_new: 'c'.repeat(40), changed: true })),
    },
  }
})

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const versions: Version[] = [
  { sha: B, at: 1_767_258_100, message: 'save', author: 'alice@example.com', added: 3, deleted: 1 },
  { sha: A, at: 1_767_258_000, message: 'backup 2026-01-01 09:00:00', author: 'studio', added: 0, deleted: 0 },
  { sha: 'd'.repeat(40), at: 1_767_257_000, message: 'restore abc1234', author: 'studio', added: 0, deleted: 2 },
]

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // Radix Select 在 jsdom 需要这些（同 OaRounds/collab-center 惯例）
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  vi.clearAllMocks()
  useStudio.getState().resetHistory()
  useStudio.setState({ pid: 'p1', content: 'l1\nl2 改\n', saved: 'l1\nl2 改\n', dirty: false, project: null, projectLoading: false } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount() {
  host = document.createElement('aside')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider><HistoryPanel /></TooltipProvider>))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

describe('HistoryPanel（R6 C3：读 history slice，不再读 .bak）', () => {
  it('挂载即 loadHistory；列表 = versions（sha7 / 作者 / 摘要）；axe 无违规', async () => {
    const el = await mount()
    const { api } = await import('@/lib/api')
    expect(api.history).toHaveBeenCalledWith('p1')
    const opts = el.querySelectorAll('[role="option"]')
    expect(opts).toHaveLength(3)
    expect(opts[0].textContent).toContain('保存')
    expect(opts[0].textContent).toContain('alice@example.com')
    expect(opts[0].textContent).toContain('bbbbbbb')
    expect(opts[1].textContent).toContain('旧备份 2026-01-01 09:00:00')
    expect(opts[2].textContent).toContain('恢复自 abc1234')
    expect(await violations(el)).toEqual([])
  })

  it('选中一版 → 拉取内容并显示与当前内容的摘要；「完整差异」拉 diff(sha, work) 并逐行渲染', async () => {
    const el = await mount()
    const btn = el.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]
    await act(async () => btn.click())
    expect(useStudio.getState().selectedSha).toBe(A)
    expect(el.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('aaaaaaa')
    const summary = el.querySelector('[data-testid="version-diff"]')!
    expect(summary.textContent).toContain('+1')
    expect(summary.textContent).toContain('−1')
    expect(summary.textContent).toContain('第 2 行')

    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="version-full-diff"]')!.click())
    const { api } = await import('@/lib/api')
    expect(api.historyDiff).toHaveBeenCalledWith('p1', A, 'work')
    const pre = el.querySelector('[data-testid="version-unified-diff"]')!
    expect(pre.textContent).toContain('-l2')
    expect(pre.textContent).toContain('+l2 改')
    expect(await violations(el)).toEqual([])
  })

  it('A↔B 对比：选中版为锚，对比选择器选另一版 → diff(较早,较新)；退出对比恢复 vs-work 态', async () => {
    const el = await mount()
    const { api } = await import('@/lib/api')
    await act(async () => el.querySelectorAll<HTMLButtonElement>('[role="option"]')[0].click())
    expect(useStudio.getState().selectedSha).toBe(B)
    // Radix Select：trigger pointerdown 开后按 portal 内 role=option 选（同 OaRounds 惯例；
    // 版本列表本身也用 role=option，须限定在 select-content 域内查）
    await act(async () => el.querySelector('[data-testid="version-compare-select"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false })))
    const content = document.querySelector('[data-slot="select-content"]')!
    const opt = Array.from(content.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.textContent?.includes('aaaaaaa'))!
    await act(async () => opt.click())
    expect(api.historyDiff).toHaveBeenCalledWith('p1', A, B)
    expect(el.querySelector('[data-testid="version-compare-bar"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="version-compare-bar"]')!.textContent).toContain('aaaaaaa')
    expect(el.querySelector('[data-testid="version-unified-diff"]')!.textContent).toContain('-l2')
    // 对比态：vs-work 摘要与「完整差异」钮隐去，「恢复此版本」仍在
    expect(el.querySelector('[data-testid="version-full-diff"]')).toBeNull()
    expect(el.querySelector('[data-testid="restore-version"]')).not.toBeNull()
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="version-compare-clear"]')!.click())
    expect(el.querySelector('[data-testid="version-compare-bar"]')).toBeNull()
  })

  it('恢复：无脏内容时直接 POST restore，编辑区载入返回内容，列表刷新且清空选中', async () => {
    const el = await mount()
    await act(async () => el.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click())
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="restore-version"]')!.click())
    const { api } = await import('@/lib/api')
    expect(api.restoreVersion).toHaveBeenCalledWith('p1', A)
    expect(useStudio.getState().content).toBe('l1\nl2\n')
    expect(useStudio.getState().selectedSha).toBeNull()
    expect(api.history).toHaveBeenCalledTimes(2)
  })

  it('viewer：「恢复此版本」禁用——R62-01 死端收口（写路径过 selectReadonly）', async () => {
    useStudio.setState({ project: { role: 'viewer' } } as never)
    const el = await mount()
    await act(async () => el.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click())
    expect(el.querySelector<HTMLButtonElement>('[data-testid="restore-version"]')!.disabled).toBe(true)
    expect(el.querySelector<HTMLButtonElement>('[data-testid="version-full-diff"]')!.disabled).toBe(false)
  })

  it('501 ⇒ 未启用文案；空列表 ⇒ 暂无版本', async () => {
    const { api, ApiError } = await import('@/lib/api')
    vi.mocked(api.history).mockRejectedValueOnce(new ApiError(501, 'not implemented'))
    let el = await mount()
    expect(el.textContent).toContain('未启用版本历史')
    await act(async () => root?.unmount())
    root = null
    host.remove()

    vi.mocked(api.history).mockResolvedValueOnce([])
    el = await mount()
    expect(el.textContent).toContain('暂无版本')
    // W12 R2-01：空态不是 listbox 里的裸 li（axe aria-required-children / listitem），而是 role=status 的兄弟节点
    expect(el.querySelector('[role="listbox"]')).toBeNull()
    expect(el.querySelector('li')).toBeNull()
    expect(el.querySelector('[role="status"]')?.textContent).toContain('暂无版本')
  })
})

describe('HistoryPanel 刷新触发（W12 R10-02，docs/plan/25）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    useStudio.setState({ collabStatus: 'off' } as never)
    vi.useRealTimers()
  })

  it('协同在线：正文变化后 2 s 去抖再拉一次；连续改动只多拉 1 次；saved 不变', async () => {
    useStudio.setState({ collabStatus: 'connected' } as never)
    await mount()
    const { api } = await import('@/lib/api')
    expect(api.history).toHaveBeenCalledTimes(1)

    await act(async () => useStudio.setState({ content: 'l1\nl2 改\n协同键入' } as never))
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(api.history).toHaveBeenCalledTimes(1)
    await act(async () => useStudio.setState({ content: 'l1\nl2 改\n协同键入更多' } as never))
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(api.history).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(api.history).toHaveBeenCalledTimes(2)
    expect(useStudio.getState().saved).toBe('l1\nl2 改\n')
  })

  it('非协同：正文每键都变，不因 content 变化拉列表；saved 变化仍立即拉', async () => {
    await mount()
    const { api } = await import('@/lib/api')
    await act(async () => useStudio.setState({ content: 'l1\nl2 改\n本地键入' } as never))
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(api.history).toHaveBeenCalledTimes(1)
    await act(async () => useStudio.setState({ saved: 'l1\nl2 改\n本地键入' } as never))
    expect(api.history).toHaveBeenCalledTimes(2)
  })
})
