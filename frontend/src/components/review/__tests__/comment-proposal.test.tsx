// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import type { Comment } from '@/lib/types'
import type { Proposal } from '@/types/agent'
import { CommentCard } from '../CommentCard'
import { AiProposals } from '@/components/ai/AiProposals'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    comments: [],
    proposals: [],
    settings: { ai_enabled: true } as never,
    authStatus: 'off',
    user: null,
    agentTab: 'chat',
    companion: null,
    mobileTab: 'edit',
    reviewDrawerOpen: false,
    pendingProposalId: null,
    replyBodies: {},
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

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: 'c1',
  anchor: { block_id: 'claims/1', line: 9, quote: '其特征在于' },
  body: '建议改写这句',
  author: { id: null, name: '客户甲' },
  created_at: 0,
  updated_at: 0,
  resolved: false,
  replies: [],
  source: 'client',
  ...over,
})

const proposal: Proposal = {
  id: 'prop_1',
  job_id: 'job_x',
  scenario: 's3',
  kind: 'critic',
  anchor: { book: 'claims', block_id: 'claims/1', line_start: 9, line_end: 9 },
  critic_markdown: '{~~其特征在于~>其特征为~~}',
  comment_body: null,
  patch: null,
  checks: [],
  model: 'mock',
  usage: { prompt: 1, completion: 1 },
  created_at: 0,
  state: 'pending',
  source: { kind: 'comment', comment_id: 'c1', quote: '其特征在于', author: '客户甲', body: '建议改写这句' },
}

const run = async (fn: () => Promise<unknown>) => {
  await fn()
}

describe('Z18 批注 → 修改提案（前端入口）', () => {
  it('块锚批注 + AI 已开 → 显示「转提案」，点击调用 API 并把提案并入列表、跳建议 tab', async () => {
    const spy = vi.spyOn(api, 'commentToProposal').mockResolvedValue({
      job: { id: 'job_x', kind: 'comment2proposal', pid: 'p1', status: 'done', progress: 1, message: '', result: null, error: null, created_at: 0, updated_at: 0 },
      proposal,
    })
    const el = await mount(
      <CommentCard pid="p1" comment={comment()} active={false} atCursor={false} desktop busy={false} onLocate={() => {}} run={run} />,
    )
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="review-to-proposal-c1"]')!
    expect(btn).toBeTruthy()
    await act(async () => btn.click())
    expect(spy).toHaveBeenCalledWith('p1', 'c1')
    expect(useStudio.getState().proposals.map((p) => p.id)).toEqual(['prop_1'])
    expect(useStudio.getState().agentTab).toBe('proposals')
    // T1：桌面开 AI 伴随栏（不再走已映射回大纲的 railTab('ai')），并标记待定位提案
    expect(useStudio.getState().companion).toBe('ai')
    expect(useStudio.getState().pendingProposalId).toBe('prop_1')
  })

  it('移动端（matchMedia 不匹配桌面）：转提案 → 底栏切 AI 页签，审阅 Sheet / 抽屉不再盖在上面', async () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    useStudio.setState({ reviewDrawerOpen: true, mobileNav: { open: true, tab: 'outline' }, moreOpen: true })
    const spy = vi.spyOn(api, 'commentToProposal').mockResolvedValue({
      job: { id: 'job_x', kind: 'comment2proposal', pid: 'p1', status: 'done', progress: 1, message: '', result: null, error: null, created_at: 0, updated_at: 0 },
      proposal,
    })
    const el = await mount(
      <CommentCard pid="p1" comment={comment()} active={false} atCursor={false} desktop={false} busy={false} onLocate={() => {}} run={run} />,
    )
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-to-proposal-c1"]')!.click())
    expect(spy).toHaveBeenCalled()
    const s = useStudio.getState()
    expect(s.mobileTab).toBe('ai')
    expect(s.agentTab).toBe('proposals')
    expect(s.reviewDrawerOpen).toBe(false)
    expect(s.mobileNav.open).toBe(false)
    expect(s.moreOpen).toBe(false)
    expect(s.pendingProposalId).toBe('prop_1')
    mm.mockRestore()
  })

  it('已有关联提案的批注显示「查看建议」回链，点击定位到同一条提案', async () => {
    useStudio.setState({ proposals: [proposal] })
    const el = await mount(
      <CommentCard pid="p1" comment={comment()} active={false} atCursor={false} desktop busy={false} onLocate={() => {}} run={run} />,
    )
    const backlink = el.querySelector<HTMLButtonElement>('[data-testid="review-goto-proposal-c1"]')!
    expect(backlink).toBeTruthy()
    await act(async () => backlink.click())
    const s = useStudio.getState()
    expect(s.companion).toBe('ai')
    expect(s.agentTab).toBe('proposals')
    expect(s.pendingProposalId).toBe('prop_1')
  })

  it('pendingProposalId 落到建议 tab：消费标记并给目标卡短暂高亮（data-flash）', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    useStudio.setState({ proposals: [proposal], pendingProposalId: 'prop_1' })
    const el = await mount(<AiProposals pid="p1" compact={false} canAct />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    const card = el.querySelector('[data-testid="ai-proposal-prop_1"]')!
    expect(card).toBeTruthy()
    expect(scroll).toHaveBeenCalled()
    expect(card.getAttribute('data-flash')).toBe('true')
    expect(useStudio.getState().pendingProposalId).toBeNull()
  })

  it('五操作全在时行允许换行（flex-wrap），且每个按钮有可访问名称——窄栏（~300px）不再溢出截断', async () => {
    useStudio.setState({ proposals: [proposal] })
    const el = await mount(
      <CommentCard pid="p1" comment={comment()} active={false} atCursor={false} desktop busy={false} onLocate={() => {}} run={run} />,
    )
    const backlink = el.querySelector<HTMLButtonElement>('[data-testid="review-goto-proposal-c1"]')!
    const row = backlink.parentElement!
    expect(row.className).toContain('flex-wrap')
    // 回复 / 转提案 / 查看建议 / 解决 / 删除 全在该行，每个都有可访问名称（文本或 aria-label）
    const names = [...row.querySelectorAll('button')].map((b) => b.textContent?.trim() || b.getAttribute('aria-label') || '')
    expect(names.filter(Boolean).length).toBe(row.querySelectorAll('button').length)
    expect(names).toContain('删除批注')
    expect(names.join('')).toContain('查看建议')
  })

  it('AI 未开启 → 不显示入口', async () => {
    useStudio.setState({ settings: { ai_enabled: false } as never })
    const el = await mount(
      <CommentCard pid="p1" comment={comment()} active={false} atCursor={false} desktop busy={false} onLocate={() => {}} run={run} />,
    )
    expect(el.querySelector('[data-testid="review-to-proposal-c1"]')).toBeNull()
  })
})
