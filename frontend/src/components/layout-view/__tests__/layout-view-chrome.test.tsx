// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import goldenMethod from '../../../../../backend/tests/golden/ast_method.json'
import content from '../../../../../examples/method/content.md?raw'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import type { Ast } from '@/types/ast'
import { LayoutView } from '..'
import { LAYOUT_NOTICE_KEY } from '../LayoutView'

vi.mock('@/components/preview/PdfPreview', () => ({ PdfPreview: () => null }))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const method = goldenMethod as unknown as Ast
const initial = useStudio.getInitialState()
const templates = [{ kind: 'paragraph' as const, label: '段落', book: ['abstract', 'claims', 'description'] as const, markdown: '', cursor: { line: 1, col: 1 } }]

let root: Root | null = null
let host: HTMLElement
let desktop = true

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q.includes('min-width') ? desktop : !desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  desktop = true
  localStorage.removeItem(LAYOUT_NOTICE_KEY)
  useStudio.setState({ ...initial, pid: 'method', content, saved: content, ast: method, astContent: content, activeBlock: null, blockTemplates: [...templates] } as never, false)
  vi.spyOn(api, 'projects').mockResolvedValue([])
  vi.spyOn(api, 'getFigures').mockRejectedValue(new Error('offline'))
  vi.spyOn(api, 'styleCss').mockRejectedValue(new Error('offline'))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)
const qa = (sel: string) => host.querySelectorAll(sel)

describe('版面视图上方 chrome：一个「插入」入口 + 可关的提示条（W11 第二批）', () => {
  it('桌面编辑：格式工具条是唯一的 layout-insert（模式条不再重复）；点它开 / 关 `/` 菜单并同步 aria-expanded / aria-controls', async () => {
    await mount(<LayoutView mode="edit" books={['description']} />)
    expect(q('[data-testid="format-bar"]')).not.toBeNull()
    expect(qa('[data-testid="layout-insert"]').length).toBe(1)
    expect(q('[data-testid="format-insert"]')).toBeNull()
    const btn = q<HTMLButtonElement>('[data-testid="layout-insert"]')!
    expect(btn.closest('[data-testid="format-bar"]')).not.toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-controls')).toBeNull()
    await click(btn)
    expect(q('[data-testid="slash-menu"]')).not.toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe('ps-slash-menu')
    await click(btn)
    expect(q('[data-testid="slash-menu"]')).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('提示条：关掉后记住（localStorage）；编辑模式下模式条无内容整条不渲染，工具条贴顶（data-bar=off）', async () => {
    await mount(<LayoutView mode="edit" books={['description']} />)
    expect(q('[data-testid="layout-notice"]')).not.toBeNull()
    expect(q('[data-testid="layout-view"]')!.getAttribute('data-bar')).toBeNull()
    await click(q('[data-testid="layout-notice-dismiss"]')!)
    expect(localStorage.getItem(LAYOUT_NOTICE_KEY)).toBe('1')
    expect(q('[data-testid="layout-notice"]')).toBeNull()
    expect(q('[data-testid="layout-bar"]')).toBeNull()
    expect(q('[data-testid="layout-view"]')!.getAttribute('data-bar')).toBe('off')
    expect(q('[data-testid="format-bar"]')).not.toBeNull()
    expect(qa('[data-testid="layout-insert"]').length).toBe(1)
  })

  it('提示条已关时挂载不再出提示；审阅模式仍保留模式条（审阅徽章）', async () => {
    localStorage.setItem(LAYOUT_NOTICE_KEY, '1')
    await mount(<LayoutView mode="review" books={['description']} />)
    expect(q('[data-testid="layout-notice"]')).toBeNull()
    expect(q('[data-testid="layout-notice-dismiss"]')).toBeNull()
    expect(q('[data-testid="layout-bar"]')).not.toBeNull()
    expect(q('[data-testid="layout-review-badge"]')).not.toBeNull()
    expect(q('[data-testid="layout-view"]')!.getAttribute('data-bar')).toBeNull()
  })

  it('提示条已关 + 解析失败：模式条仍显示状态（关提示不吞状态）', async () => {
    localStorage.setItem(LAYOUT_NOTICE_KEY, '1')
    useStudio.setState({ astError: '解析失败' } as never, false)
    await mount(<LayoutView mode="edit" books={['description']} />)
    expect(q('[data-testid="layout-bar"]')).not.toBeNull()
    expect(q('[data-testid="layout-notice"]')).toBeNull()
  })

  it('移动端：无格式工具条，且模式条也不放插入（插入由底部 MobileLayoutToolbar 唯一承担）；关掉提示后模式条整条消失', async () => {
    desktop = false
    await mount(<LayoutView mode="edit" books={['description']} />)
    expect(q('[data-testid="format-bar"]')).toBeNull()
    expect(qa('[data-testid="layout-insert"], [data-testid="format-insert"]').length).toBe(0)
    expect(q('[data-testid="layout-notice-dismiss"]')).not.toBeNull()
    await act(async () => q<HTMLButtonElement>('[data-testid="layout-notice-dismiss"]')!.click())
    expect(q('[data-testid="layout-bar"]')).toBeNull()
  })
})
