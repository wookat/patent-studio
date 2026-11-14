// @vitest-environment jsdom
/** P03：机构外发策略卡三态——服务不可用可重试 / 无机构 / 本地文件模式不适用；
 *  不把 403/网络失败静默渲染成「没有机构」（fail-closed）。 */
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { workbenchApi } from '@/workbench/api'
import { OrgEgressPolicyCard } from '../OrgEgressPolicyCard'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  return host
}

const q = (sel: string, el: ParentNode = document) => el.querySelector<HTMLElement>(sel)

const ORG = { id: 'o1', name: '某所', slug: 'firm-a', status: 'active', my_role: 'member' }
const POLICY = { ai_egress: true, training_consent: false, note: '', version: 3, updated_by: 'u1', updated_at: '2025-01-01T00:00:00Z' }

describe('OrgEgressPolicyCard 三态（P03）', () => {
  it('服务不可用：错误提示 + 重试钮，不冒充「无机构」', async () => {
    const spy = vi.spyOn(workbenchApi, 'organizations').mockRejectedValue(new Error('403'))
    const el = await mount(<OrgEgressPolicyCard />)
    const alert = q('[data-testid="egress-error"]', el)!
    expect(alert).not.toBeNull()
    expect(alert.textContent).toContain('机构策略不可用')
    expect(q('[data-testid="egress-no-org"]', el)).toBeNull()
    // 重试成功后正常出策略卡
    spy.mockResolvedValue([ORG] as never)
    vi.spyOn(workbenchApi, 'orgPolicy').mockResolvedValue(POLICY as never)
    vi.spyOn(workbenchApi, 'me').mockResolvedValue({ id: 'u1' } as never)
    vi.spyOn(workbenchApi, 'memberships').mockResolvedValue([{ principal_id: 'u1', role: 'member', status: 'active' }] as never)
    await act(async () => q('[data-testid="egress-retry"]', el)!.click())
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect(spy).toHaveBeenCalledTimes(2)
    expect(q('[data-testid="egress-error"]', el)?.textContent ?? 'NONE').toBe('NONE')
    expect(q('[data-testid="egress-readonly"]', el)).not.toBeNull() // member → 只读说明
  })

  it('无机构：明示没有可管理策略', async () => {
    vi.spyOn(workbenchApi, 'organizations').mockResolvedValue([])
    const el = await mount(<OrgEgressPolicyCard />)
    expect(q('[data-testid="egress-no-org"]', el)!.textContent).toContain('不属于任何平台机构')
  })

  it('本地文件模式（platformExpected=false）：明示不适用，不请求机构列表', async () => {
    const spy = vi.spyOn(workbenchApi, 'organizations')
    const el = await mount(<OrgEgressPolicyCard platformExpected={false} />)
    expect(spy).not.toHaveBeenCalled()
    expect(q('[data-testid="egress-local"]', el)!.textContent).toContain('不适用')
  })
})
