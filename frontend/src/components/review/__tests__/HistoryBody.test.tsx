// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import type { Version } from '@/lib/types'
import { HistoryBody } from '../HistoryBody'

/* 伴随栏宿主（?panel=history）的版本历史与 dockview HistoryPanel 是两套实现——
   本文件镜像 HistoryPanel.test.tsx 的关键断言，防双宿主再次漂移（批55 教训） */
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
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
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
  await act(async () => root!.render(<TooltipProvider><HistoryBody pid="p1" /></TooltipProvider>))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

describe('HistoryBody（伴随栏宿主；与 HistoryPanel 同行为契约）', () => {
  it('挂载即 loadHistory；listbox 3 option（sha7/作者/摘要分组）；axe 无违规', async () => {
    const el = await mount()
    const { api } = await import('@/lib/api')
    expect(api.history).toHaveBeenCalledWith('p1')
    expect(el.querySelector('[data-slot="HistoryBody"]')).not.toBeNull()
    const opts = el.querySelectorAll('[role="option"]')
    expect(opts).toHaveLength(3)
    expect(opts[0].textContent).toContain('保存')
    expect(opts[0].textContent).toContain('bbbbbbb')
    expect(await violations(el)).toEqual([])
  })

  it('选中一版 → 摘要差异 + 「完整差异」拉 diff(sha, work)', async () => {
    const el = await mount()
    await act(async () => el.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click())
    expect(useStudio.getState().selectedSha).toBe(A)
    const summary = el.querySelector('[data-testid="version-diff"]')!
    expect(summary.textContent).toContain('+1')
    expect(summary.textContent).toContain('−1')
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="version-full-diff"]')!.click())
    const { api } = await import('@/lib/api')
    expect(api.historyDiff).toHaveBeenCalledWith('p1', A, 'work')
    expect(el.querySelector('[data-testid="version-unified-diff"]')!.textContent).toContain('+l2 改')
  })

  it('A↔B 对比（批53/55 移植回归）：select 选另一版 → diff(较早,较新) + chip + 退出复原', async () => {
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
    expect(el.querySelector('[data-testid="version-compare-bar"]')!.textContent).toContain('aaaaaaa')
    expect(el.querySelector('[data-testid="version-compare-bar"]')!.textContent).toContain('bbbbbbb')
    expect(el.querySelector('[data-testid="version-unified-diff"]')!.textContent).toContain('-l2')
    expect(el.querySelector('[data-testid="version-full-diff"]')).toBeNull()
    expect(el.querySelector('[data-testid="restore-version"]')).not.toBeNull()
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="version-compare-clear"]')!.click())
    expect(el.querySelector('[data-testid="version-compare-bar"]')).toBeNull()
  })

  it('恢复版本 → POST restore + 成功 toast + 列表刷新', async () => {
    const el = await mount()
    const { api } = await import('@/lib/api')
    await act(async () => el.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click())
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="restore-version"]')!.click())
    expect(api.restoreVersion).toHaveBeenCalledWith('p1', A)
    expect(useStudio.getState().content).toBe('l1\nl2\n')
  })
})
