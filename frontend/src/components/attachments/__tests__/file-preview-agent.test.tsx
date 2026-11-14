// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import type { AttachmentItem } from '@/types/attachments'
import { FilePreviewPanel } from '../FilePreviewPanel'
import { AiChat } from '@/components/ai/AiChat'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

const att: AttachmentItem = { name: '交底书.pdf', ext: '.pdf', size: 10, mtime: '', kind: 'text', url: '/x' }

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    previewAttachment: '交底书.pdf',
    previewFig: null,
    attachments: [att],
    settings: { ai_enabled: true } as never,
    authStatus: 'off',
    user: null,
    companion: null,
    agentTab: 'proposals',
    aiChatMaterials: [],
    aiChatAttachments: [],
    aiChatDraft: '',
    chat: [],
    sentScopeKeys: [],
    aiScope: null,
    mobileNav: { open: true, tab: 'files' },
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

describe('T4 附件预览「带入 Agent」', () => {
  it('点击 → 材料名入 aiChatMaterials + 打开 AI 对话页签（不关导航抽屉外，不自动发送）', async () => {
    const el = await mount(<FilePreviewPanel />)
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="attachment-to-agent"]')!
    expect(btn).toBeTruthy()
    await act(async () => btn.click())
    const s = useStudio.getState()
    expect(s.aiChatMaterials).toEqual(['交底书.pdf'])
    expect(s.agentTab).toBe('chat')
    expect(s.companion).toBe('ai')
    // 未发送：chat 仍为空
    expect(s.chat).toEqual([])
  })

  it('AI 关闭时不显示「带入 Agent」；figs/ 预览也不显示', async () => {
    useStudio.setState({ settings: { ai_enabled: false } as never })
    let el = await mount(<FilePreviewPanel />)
    expect(el.querySelector('[data-testid="attachment-to-agent"]')).toBeNull()
    await act(async () => root?.unmount())
    useStudio.setState({ settings: { ai_enabled: true } as never, previewAttachment: null, previewFig: 'fig1.png', figuresPid: 'p1', figures: [] })
    el = await mount(<FilePreviewPanel />)
    expect(el.querySelector('[data-testid="attachment-to-agent"]')).toBeNull()
  })

  it('材料 chip 出现在 AiChat 并可撤销；scope.materials 含材料名', async () => {
    useStudio.setState({ aiChatMaterials: ['交底书.pdf'] })
    const el = await mount(<AiChat enabled compact />)
    const rm = el.querySelector<HTMLButtonElement>('[data-testid="ai-material-rm-交底书.pdf"]')!
    expect(rm).toBeTruthy()
    expect(el.querySelector('[data-testid="ai-attach-chips"]')!.textContent).toContain('案卷材料')
    // scope 快照已把材料名写进授权白名单
    await act(async () => {
      await Promise.resolve()
    })
    expect(useStudio.getState().aiScope?.materials).toContain('交底书.pdf')
    await act(async () => rm.click())
    expect(useStudio.getState().aiChatMaterials).toEqual([])
    await act(async () => {
      await Promise.resolve()
    })
    expect(useStudio.getState().aiScope?.materials ?? []).not.toContain('交底书.pdf')
  })
})
