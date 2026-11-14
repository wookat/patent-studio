// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useStudio } from '@/store'
import { PdfToolbar } from '../PdfToolbar'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
beforeEach(() => {
  useStudio.setState({ ...initial, pid: 'method', pageInfo: { page: 3, total: 12 } }, false)
  host = document.createElement('div')
  host.dataset.density = 'touch'
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  host.remove()
})

async function mount(variant: 'desktop' | 'mobile') {
  await act(async () => root!.render(<PdfToolbar variant={variant} />))
  return host.querySelector<HTMLElement>('[data-testid="pdf-toolbar"]')!
}
const q = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = host) => el.querySelector<T>(sel)

describe('PdfToolbar 触控两行（06 §2 预览工具条）', () => {
  it('移动：两行栅格；第一行 44 = 构建 md primary + 控制台 icon-md + 状态；第二行容器 44、控件 md 36 + touch-hit、页码 Input lg', async () => {
    const tb = await mount('mobile')
    expect(tb.dataset.variant).toBe('mobile')
    expect(tb.className).toContain('grid')
    expect(tb.className).not.toContain('overflow-hidden')

    const left = q('[data-testid="pdf-toolbar-left"]', tb)!
    expect(left.className).toContain('h-touch')
    expect(left.className).toContain('px-page-m')
    expect(left.className).toContain('gap-group-m')
    const split = q('[data-testid="rebuild-split"]', left)!
    expect(split.dataset.variant).toBe('mobile')
    const rebuild = q<HTMLButtonElement>('[data-testid="rebuild"]', split)!
    expect(rebuild.dataset.size).toBe('md')
    expect(rebuild.dataset.variant).toBe('primary')
    expect(rebuild.className).toContain('touch-hit')
    expect(q<HTMLButtonElement>('[data-testid="rebuild-menu"]', split)!.dataset.size).toBe('icon-md')
    expect(q<HTMLButtonElement>('[data-testid="console-toggle"]', left)!.dataset.size).toBe('icon-md')
    expect(q('[data-testid="preview-status"]', left)).not.toBeNull()
    expect(q('[data-testid="download-pdf"]', left)).toBeNull() // R5：下载 PDF 只留顶栏导出 / 递交页，工具条不再重复

    const right = q('[data-testid="pdf-toolbar-right"]', tb)!
    expect(right.className).toContain('h-touch')
    expect(right.className).toContain('px-page-m')
    expect(right.className).toContain('gap-group-m')
    for (const id of ['pdf-find-toggle', 'zoom-out', 'zoom-in']) {
      const b = q<HTMLButtonElement>(`[data-testid="${id}"]`, right)!
      expect(b.dataset.size, id).toBe('icon-md')
      expect(b.className, id).toContain('touch-hit')
    }
    expect(q<HTMLButtonElement>('[data-testid="fit-width"]', right)!.dataset.size).toBe('md')
    const input = q<HTMLInputElement>('[data-testid="page-input"]', right)!
    expect(input.className).toContain('w-lg-control')
    expect(input.className).not.toContain('h-xs-control')
    expect(input.value).toBe('3')
    expect(q('[data-testid="page-prev"]', right)).toBeNull()
    expect(q('[data-testid="zoom-menu"]', right)).toBeNull()
  })

  it('桌面：单行 h-pdftb，构建 split xs、图标 icon-xs、页码 Input sm/h-xs-control（W8 不改桌面）', async () => {
    const tb = await mount('desktop')
    expect(tb.className).toContain('h-pdftb')
    expect(tb.className).toContain('overflow-hidden')
    const split = q('[data-testid="rebuild-split"]', tb)!
    expect(split.dataset.variant).not.toBe('mobile')
    expect(q<HTMLButtonElement>('[data-testid="rebuild"]', split)!.className).toContain('h-xs-control')
    for (const id of ['console-toggle', 'pdf-find-toggle', 'zoom-out', 'zoom-in', 'page-prev', 'page-next']) {
      expect(q<HTMLButtonElement>(`[data-testid="${id}"]`, tb)!.dataset.size, id).toBe('icon-xs')
    }
    expect(q('[data-testid="download-pdf"]', tb)).toBeNull()
    expect(q<HTMLInputElement>('[data-testid="page-input"]', tb)!.className).toContain('h-xs-control')
    expect(q('[data-testid="fit-width"]', tb)).toBeNull()
    expect(q('[data-testid="zoom-menu"]', tb)).not.toBeNull()
  })

  it('桌面审阅分段（W9 审阅 bug）：单一 radiogroup、容器 < 640 退为图标分段（min-w-6，文字进 aria-label）、< 400 溢出菜单；分段在被裁的左组之外，不与页码重叠', async () => {
    useStudio.setState({ reviewMode: 'markup' })
    const tb = await mount('desktop')
    const left = q('[data-testid="pdf-toolbar-left"]', tb)!
    expect(left.className).toContain('min-w-0')
    expect(left.className).toContain('overflow-x-clip')
    expect(q('[data-testid="pdf-toolbar-right"]', tb)!.className).toContain('shrink-0')
    const groups = tb.querySelectorAll('[data-testid="review-mode-switch"]')
    expect(groups.length).toBe(1)
    const sw = groups[0] as HTMLElement
    expect(sw.dataset.responsive).toBe('true')
    expect(sw.className).toContain('shrink-0')
    expect(left.contains(sw)).toBe(false)
    expect(sw.className).toContain('@[400px]/pdftb:inline-flex')
    expect(sw.compareDocumentPosition(q('[data-testid="page-input"]', tb)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const menu = q<HTMLButtonElement>('[data-testid="review-mode-menu"]', tb)!
    expect(left.contains(menu)).toBe(false)
    expect(menu.className).toContain('@[400px]/pdftb:hidden')
    expect(menu.getAttribute('aria-label')).toContain('标记')
    for (const id of ['page-prev', 'page-next', 'zoom-out', 'zoom-in']) {
      expect(q(`[data-testid="${id}"]`, tb)!.className, id).toContain('@max-[400px]/pdftb:hidden')
    }
    expect(q('[data-testid="page-input"]', tb)!.className).not.toContain('@max-[400px]/pdftb:hidden')
    for (const m of ['original', 'final', 'markup']) {
      const b = q<HTMLButtonElement>(`[data-testid="review-mode-${m}"]`, sw)!
      expect(b.getAttribute('aria-label')).toBeTruthy()
      expect(b.className).toContain('min-w-6')
      expect(b.className).toContain('@[640px]/pdftb:px-2')
      expect(b.querySelector('svg')!.getAttribute('class')).toContain('@[640px]/pdftb:hidden')
      const label = b.querySelector('span')!
      expect(label.textContent).toBe(b.getAttribute('aria-label'))
      expect(label.className).toContain('hidden')
      expect(label.className).toContain('@[640px]/pdftb:inline')
    }
    expect(q<HTMLButtonElement>('[data-testid="review-mode-markup"]', sw)!.getAttribute('aria-checked')).toBe('true')
  })

  it('页码 Esc 取消草稿（R72-01）：blur 落在 commit 上，Esc 后不跳页', async () => {
    const tb = await mount('desktop')
    const input = q<HTMLInputElement>('[data-testid="page-input"]', tb)!
    await act(async () => input.focus())
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.value).toBe('5')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    // Esc 已 blur；blur→commit 必须被挡——不发 pageRequest、输入恢复当前页
    expect(useStudio.getState().pageRequest).toBeNull()
    await act(async () => Promise.resolve())
    expect(input.value).toBe('3')
    // 正常失焦提交仍可用（回归对照）
    await act(async () => input.focus())
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '7')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.blur())
    expect(useStudio.getState().pageRequest?.page).toBe(7) // 失焦提交发 pageRequest
  })

  it('缩放边界：到最小/最大时 −/+ 钮禁用（R115 批13）', async () => {
    const tb = await mount('desktop')
    const out = q<HTMLButtonElement>('[data-testid="zoom-out"]', tb)!
    const inp = q<HTMLButtonElement>('[data-testid="zoom-in"]', tb)!
    expect(out.disabled).toBe(false)
    expect(inp.disabled).toBe(false)
    await act(async () => useStudio.setState({ zoomFit: null, zoom: 0.5 }))
    expect(out.disabled).toBe(true)
    expect(inp.disabled).toBe(false)
    await act(async () => useStudio.setState({ zoom: 3 }))
    expect(out.disabled).toBe(false)
    expect(inp.disabled).toBe(true)
  })

  it('移动工具条不挂分段；日志视图下桌面也不挂', async () => {
    useStudio.setState({ reviewMode: 'markup' })
    let tb = await mount('mobile')
    expect(q('[data-testid="review-mode-switch"]', tb)).toBeNull()
    expect(q('[data-testid="review-mode-menu"]', tb)).toBeNull()
    await act(async () => root?.unmount())
    root = createRoot(host)
    useStudio.setState({ pdfView: 'logs' })
    tb = await mount('desktop')
    expect(q('[data-testid="review-mode-switch"]', tb)).toBeNull()
    expect(q('[data-testid="review-mode-menu"]', tb)).toBeNull()
  })
})
