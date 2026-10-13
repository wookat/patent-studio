// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import type { Comment } from '@/lib/types'
import { ReviewBody } from '../ReviewBody'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
})

const comment = (id: string, author: Comment['author']): Comment => ({
  id,
  anchor: { block_id: 'B1', line: 3, quote: '处理单元' },
  body: `${id} 正文`,
  author,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  resolved: false,
  replies: [],
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1', content: '# a\n\n处理单元\n', marks: [], reviewMode: 'final', ast: null, cursor: { line: 1, col: 1 },
    commentsUnavailable: false, marksUnavailable: false, activeCommentId: null, commentDraft: null, replyBodies: {},
    comments: [comment('ai1', { id: 'ai', name: 'AI 审阅' }), comment('me1', { id: null, name: '我' }), comment('u2', { id: 'u-2', name: '张代理' })],
    loadComments: async () => {},
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

describe('ReviewPanel：AI 审阅批注徽章（09 §6.1，author.id === "ai"）', () => {
  it('仅 author.id=ai 的批注显示「AI」徽章；axe 0 critical/serious', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<TooltipProvider><ReviewBody pid="p1" /></TooltipProvider>))
    const badges = host.querySelectorAll('[data-testid="comment-ai-badge"]')
    expect(badges).toHaveLength(1)
    const row = badges[0].closest('li')
    expect(row?.textContent).toContain('AI 审阅')
    expect(row?.textContent).not.toContain('张代理')
    const res = await axe.run(host, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
    })
    expect(res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
  })
})
