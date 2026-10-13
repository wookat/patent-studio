// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { resetPdfIndex } from '../pdfFocus'
import { PdfPreview } from '../PdfPreview'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

/** react-pdf 行为脚本：docLoad 决定 Document.onLoadSuccess 何时调；pageRender 决定 Page 回调 */
const harness = vi.hoisted(() => ({
  docLoad: 'ok' as 'ok' | 'never',
  pageRender: 'ok' as 'ok' | 'never' | 'error',
  docs: [] as { numPages: number }[],
}))
vi.mock('react-pdf', async () => {
  const { useEffect, useRef, createElement } = await import('react')
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({ children, onLoadSuccess }: { children?: React.ReactNode; onLoadSuccess?: (d: { numPages: number }) => void }) => {
      const cb = useRef(onLoadSuccess)
      useEffect(() => {
        if (harness.docLoad === 'ok') {
          const doc = { numPages: 3, getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }) }
          harness.docs.push(doc)
          cb.current?.(doc)
        }
      }, [])
      return createElement('div', null, children)
    },
    Page: ({ onRenderSuccess, onRenderError }: { onRenderSuccess?: () => void; onRenderError?: () => void }) => {
      const cb = useRef({ onRenderSuccess, onRenderError })
      useEffect(() => {
        if (harness.pageRender === 'ok') cb.current.onRenderSuccess?.()
        else if (harness.pageRender === 'error') cb.current.onRenderError?.()
      }, [])
      return createElement('div')
    },
  }
})
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}))
vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))
vi.mock('../pdf-focus.css', () => ({}))
vi.mock('../PdfFocusOverlay', () => ({}))

describe('R68 PdfPreview 槽交换看门狗', () => {
  let host: HTMLDivElement
  let root: Root
  const mount = async (el: ReactElement) => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(el))
    return host
  }
  const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))
  const testid = (id: string) => host.querySelector(`[data-testid="${id}"]`)

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    harness.docLoad = 'ok'
    harness.pageRender = 'ok'
    harness.docs = []
    resetPdfIndex()
    useStudio.setState({ ast: { description: [] }, lastOk: { ok: true, pdf_tagged: false }, zoomFit: 'width', toasts: [] } as never)
    // 假 fetch：返回任何字节即可
    global.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch
    // jsdom 无 ResizeObserver：容器盒保持默认 600×800
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    host?.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('正常路径不受影响：视口页全画完 → 交换到前台', async () => {
    await mount(<PdfPreview url="/api/p/1/build/out.pdf" zoom={1} />)
    await sleep(50)
    expect(testid('pdf-active')).not.toBeNull()
    expect(testid('pdf-staging')).toBeNull()
  })

  it('R68-1 页渲染悬挂：staging 超时后强制交换，不留死槽', async () => {
    harness.pageRender = 'never'
    await mount(<PdfPreview url="/api/p/1/build/out.pdf" zoom={1} />)
    await sleep(50)
    // 楔死状态：staging 挂着、前台无物
    expect(testid('pdf-staging')).not.toBeNull()
    expect(testid('pdf-active')).toBeNull()
    // 看门狗 20s 后强制交换（真计时器跑；轮询推进）
    const t0 = Date.now()
    let swapped = false
    while (Date.now() - t0 < 21_500) {
      await sleep(250)
      if (testid('pdf-active')) { swapped = true; break }
    }
    expect(swapped).toBe(true)
    expect(testid('pdf-staging')).toBeNull()
  }, 25_000)

  it('R68-2 Document 永不加载页数：超时 → 放弃暂存 + 错误条（可点重新构建）', async () => {
    harness.docLoad = 'never'
    await mount(<PdfPreview url="/api/p/1/build/out.pdf" zoom={1} />)
    await sleep(50)
    const t0 = Date.now()
    let failed = false
    while (Date.now() - t0 < 21_500) {
      await sleep(250)
      if (testid('pdf-load-failed')) { failed = true; break }
    }
    expect(failed).toBe(true)
    expect(testid('pdf-retry')).not.toBeNull()
  }, 25_000)
})
