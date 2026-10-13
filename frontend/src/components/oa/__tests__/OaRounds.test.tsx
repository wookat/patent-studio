// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import type { OaRound } from '@/types/oa'
import { OaRounds } from '@/components/oa/OaRounds'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

const ROUND: OaRound = {
  id: 'r1', kind: 'first', issued_on: '2026-09-28', delivery: 'electronic',
  deadline_id: 'oa-1', items: 3, extensions: [], filed_on: null, created_at: 1,
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // Radix Select 在 jsdom 需要这些
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  useStudio.setState({
    pid: 'method',
    toasts: [],
    oaRounds: [ROUND],
    oaActiveRoundId: 'r1',
    oaRoundsLoading: false,
    oaRoundsUnavailable: false,
  })
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
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
const click = async (el: HTMLElement | null) => act(async () => el?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe('R115-批29：新增轮次类型自动默认', () => {
  it('挂载时 rounds 为空、轮次后到达 → 类型默认「后续通知」不冻成「一通」（错走 4 个月期限回归）', async () => {
    useStudio.setState({ oaRounds: [] })
    await mount(<OaRounds />)
    await act(async () => useStudio.setState({ oaRounds: [ROUND] }))
    await click(q('[data-testid="oa-round-add"]'))
    expect(q('[data-testid="oa-round-kind"]')!.textContent).toContain('后续通知')
  })

  it('用户手选「复审」后仍然生效（override 不被自动默认吞掉）', async () => {
    const createSpy = vi.spyOn(api, 'createOaRound').mockResolvedValue(ROUND)
    useStudio.setState({ oaRounds: [ROUND] })
    await mount(<OaRounds />)
    await click(q('[data-testid="oa-round-add"]'))
    // Radix Select：trigger pointerdown 开后按 role=option 选（同 collab-center-sections 惯例）
    await act(async () => q('[data-testid="oa-round-kind"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false })))
    const opts = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    expect(opts.length).toBeGreaterThan(0)
    const opt = opts.find((o) => o.textContent?.includes('复审'))!
    await act(async () => opt.click())
    expect(q('[data-testid="oa-round-kind"]')!.textContent).toContain('复审')
    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe('OaRounds 延期 / 标已答复（R35-01）', () => {
  it('活动轮次渲染延期与标已答复入口；延期 +1月调 API 并刷新轮次与期限', async () => {
    const updated = { ...ROUND, extensions: [{ months: 1, requested_at: '2026-10-01' }] }
    const extendSpy = vi.spyOn(api, 'oaExtendRound').mockResolvedValue(updated)
    const reloadSpy = vi.spyOn(useStudio.getState(), 'loadDeadlines').mockResolvedValue()
    await mount(<OaRounds />)
    expect(q('[data-testid="oa-extend-1"]')).toBeTruthy()
    expect(q('[data-testid="oa-extend-2"]')).toBeTruthy()
    expect(q('[data-testid="oa-filed-toggle"]')).toBeTruthy()
    await click(q('[data-testid="oa-extend-1"]'))
    expect(extendSpy).toHaveBeenCalledWith('method', 'r1', 1)
    expect(useStudio.getState().oaRounds[0].extensions).toHaveLength(1)
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('累计延期 ≥2 月时两个延期钮禁用并提示上限', async () => {
    useStudio.setState({ oaRounds: [{ ...ROUND, extensions: [{ months: 1, requested_at: 'x' }, { months: 1, requested_at: 'y' }] }] })
    await mount(<OaRounds />)
    expect((q('[data-testid="oa-extend-1"]') as HTMLButtonElement).disabled).toBe(true)
    expect((q('[data-testid="oa-extend-2"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('累计延期已达上限')
  })

  it('标已答复：展开日期输入 → PUT filed_on → 轮次徽章 + 期限重拉', async () => {
    const updated = { ...ROUND, filed_on: '2026-10-15' }
    const patchSpy = vi.spyOn(api, 'updateOaRound').mockResolvedValue(updated)
    const reloadSpy = vi.spyOn(useStudio.getState(), 'loadDeadlines').mockResolvedValue()
    await mount(<OaRounds />)
    await click(q('[data-testid="oa-filed-toggle"]'))
    const date = q('[data-testid="oa-filed-date"]') as HTMLInputElement
    expect(date).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(date, '2026-10-15')
      date.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="oa-filed-save"]'))
    expect(patchSpy).toHaveBeenCalledWith('method', 'r1', { filed_on: '2026-10-15' })
    expect(useStudio.getState().oaRounds[0].filed_on).toBe('2026-10-15')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('已答复轮次：隐藏操作、只显状态徽标', async () => {
    useStudio.setState({ oaRounds: [{ ...ROUND, filed_on: '2026-10-15' }] })
    await mount(<OaRounds />)
    expect(q('[data-testid="oa-extend-1"]')).toBeNull()
    expect(q('[data-testid="oa-round-filed"]')?.textContent).toContain('2026-10-15')
  })
})

describe('批10：驳回决定轮次（法定期限不可延期；filed_on=复审请求递交日）', () => {
  const REJ: OaRound = { ...ROUND, id: 'r9', kind: 'rejection' }

  it('类型下拉含「驳回决定」；轮次条标题直显驳回决定', async () => {
    useStudio.setState({ oaRounds: [REJ], oaActiveRoundId: 'r9' })
    await mount(<OaRounds />)
    expect(q('[data-testid="oa-round-r9"]')!.textContent).toContain('驳回决定')
    await click(q('[data-testid="oa-round-add"]'))
    await act(async () => q('[data-testid="oa-round-kind"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false })))
    const opts = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    expect(opts.some((o) => o.textContent?.includes('驳回决定'))).toBe(true)
  })

  it('驳回决定轮次无延期钮；登记入口文案为复审请求，已递交显示「已提复审请求」', async () => {
    useStudio.setState({ oaRounds: [REJ], oaActiveRoundId: 'r9' })
    await mount(<OaRounds />)
    expect(q('[data-testid="oa-extend-1"]')).toBeNull()
    expect(q('[data-testid="oa-extend-2"]')).toBeNull()
    expect(q('[data-testid="oa-filed-toggle"]')!.textContent).toContain('登记复审请求')
    await act(async () => useStudio.setState({ oaRounds: [{ ...REJ, filed_on: '2026-05-20' }] }))
    expect(q('[data-testid="oa-round-filed"]')!.textContent).toContain('已提复审请求')
    expect(host.textContent).toContain('已请求 2026-05-20')
  })
})
