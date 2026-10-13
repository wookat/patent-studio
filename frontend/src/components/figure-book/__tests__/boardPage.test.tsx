// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { BoardPage } from '../BoardPage'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

/* jsdom 无 canvas：画布与桥接整体桩掉，验证页面对象契约（路由参数/图源读写/导出/守卫） */
const updateScene = vi.fn()
const scrollToContent = vi.fn()
const addFiles = vi.fn()
/* 画布元素视图：测试可改写以模拟冷载空画布（D-W17-1 重灌验证） */
let sceneEls: { id: string; type: string; version?: number }[] = [{ id: 'e1', type: 'rectangle' }]
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (p: { excalidrawAPI?: (a: unknown) => void }) => {
    const api = {
      updateScene, scrollToContent, addFiles,
      getSceneElements: () => sceneEls as never,
      getAppState: () => ({}) as never,
      getFiles: () => ({}),
    } satisfies Partial<ExcalidrawImperativeAPI>
    p.excalidrawAPI?.(api)
    return null
  },
  convertToExcalidrawElements: (els: unknown[]) => els,
  exportToBlob: vi.fn(async () => new Blob(['png-bytes'], { type: 'image/png' })),
  FONT_FAMILY: { Helvetica: 2 },
}))
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))
vi.mock('@excalidraw/mermaid-to-excalidraw', () => ({
  parseMermaidToExcalidraw: vi.fn(async (code: string) => {
    if (code.includes('bad syntax')) throw new Error('Parse error on line 1: bad syntax')
    return { elements: [{ id: 'e1', type: 'rectangle', roughness: 1 }], files: {} }
  }),
}))
// BoardCanvas 是 lazy 默认导出——桩为同步组件，把 onApi 立刻回调（走真实 BoardPage 装配链）
vi.mock('../BoardCanvas', () => ({
  __esModule: true,
  default: (p: { onApi: (a: unknown) => void; onUserEdit: () => void; viewOnly: boolean }) => {
    const api = {
      updateScene, scrollToContent, addFiles,
      getSceneElements: () => sceneEls as never,
      getAppState: () => ({}) as never,
      getFiles: () => ({}),
    } satisfies Partial<ExcalidrawImperativeAPI>
    queueMicrotask(() => p.onApi(api))
    return <div data-testid="board-canvas-stub" data-viewonly={p.viewOnly} />
  },
}))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const testQC = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  /* jsdom 无 createObjectURL——spec 预览 img src 走桩值即可（断言 POST 而非图像内容） */
  URL.createObjectURL ??= () => 'blob:mock-preview'
  URL.revokeObjectURL ??= () => {}
  /* jsdom 无 ResizeObserver——React Flow 视口观测桩掉（不验缩放只验结构） */
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  /* jsdom 无 DOMMatrixReadOnly——React Flow 内部用它算变换，桩为恒等 */
  globalThis.DOMMatrixReadOnly ??= class {
    constructor(_init?: string) {}
    readonly m22 = 1
    readonly m11 = 1
    readonly m12 = 0
    readonly m21 = 0
    readonly m41 = 0
    readonly m42 = 0
    static fromMatrix() { return new (globalThis.DOMMatrixReadOnly as any)() }
    translate() { return new (globalThis.DOMMatrixReadOnly as any)() }
    scale() { return new (globalThis.DOMMatrixReadOnly as any)() }
    inverse() { return new (globalThis.DOMMatrixReadOnly as any)() }
    transformPoint(p: { x: number; y: number }) { return p }
  } as unknown as typeof DOMMatrixReadOnly
})

beforeEach(() => {
  useStudio.setState({ pid: 'p1', toasts: [], figures: [], project: { id: 'p1', title: '测试案', role: 'editor' } as never, projectLoading: false })
  window.location.hash = '#/p/p1/board'
  updateScene.mockClear()
  sceneEls = [{ id: 'e1', type: 'rectangle' }]
})

afterEach(async () => {
  vi.restoreAllMocks()
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: React.ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<QueryClientProvider client={testQC}>{el}</QueryClientProvider>))
  return host
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const click = (el: Element | null) => act(async () => el?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const input = (el: Element, v: string) => act(async () => {
  const t = el as HTMLInputElement | HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(t), 'value')!.set!
  setter.call(t, v)
  t.dispatchEvent(new Event('input', { bubbles: true }))
})

async function waitFor(fn: () => boolean, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await act(async () => new Promise((r) => setTimeout(r, 25)))
  }
  expect(fn()).toBe(true)
}

describe('BoardPage（W17：Excalidraw 画板页）', () => {
  it('图源列表+模板落画布；改名保存 PUT 源码', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp, init) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
      if (url.endsWith('/figures-src')) return json({ sources: [] })
      if (url.includes('/figures-src/')) return json({ name: 'flow1.mmd', size: 1 })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src={null} />)
    await waitFor(() => el.querySelector('[data-testid="board-canvas-stub"]') !== null)
    await waitFor(() => updateScene.mock.calls.length > 0) // 模板已解析落画布
    const last = updateScene.mock.calls.at(-1)?.[0] as { elements?: { roughness?: number }[] } | undefined
    expect(last?.elements?.[0]?.roughness).toBe(0)

    await input(el.querySelector('[data-testid="board-name"]')!, '中文名')
    expect(el.querySelector('[data-testid="board-name-err"]')).toBeTruthy()
    expect((el.querySelector('[data-testid="board-save"]') as HTMLButtonElement).disabled).toBe(true)

    await input(el.querySelector('[data-testid="board-name"]')!, 'flow1')
    await click(el.querySelector('[data-testid="board-save"]'))
    await waitFor(() => calls.some((c) => c.method === 'PUT' && c.url.includes('/figures-src/flow1.mmd')))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(put.body as string).source).toContain('flowchart')
  })

  it('?src= 打开已存图源回填并应用画布；导出 PNG 走上传管线', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp, init) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
      if (url.endsWith('/figures-src')) return json({ sources: [{ name: 'flow1.mmd', size: 1 }] })
      if (url.endsWith('/figures-src/flow1.mmd')) return json({ name: 'flow1.mmd', source: 'flowchart LR\n  A-->B\n' })
      if (url.endsWith('/figures')) return json({ figures: [], settings: {} })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src="flow1" />)
    await waitFor(() => (el.querySelector('[data-testid="board-name"]') as HTMLInputElement).value === 'flow1')
    await waitFor(() => updateScene.mock.calls.length > 0)

    await click(el.querySelector('[data-testid="board-export"]'))
    await waitFor(() => calls.some((c) => c.method === 'POST' && c.url.endsWith('/figures')))
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/figures'))!
    const f = (post.body as FormData).get('files') as File
    expect(f.name).toBe('flow1.png')
  })

  it('脏态守卫：改源码后返回被 DiscardDialog 拦截', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ sources: [] }))
    const el = await mount(<BoardPage pid="p1" src={null} />)
    await waitFor(() => el.querySelector('[data-testid="board-canvas-stub"]') !== null)
    await click(el.querySelector('[data-testid="board-src-toggle"]'))
    const ta = el.querySelector('[data-testid="board-code"]') as HTMLTextAreaElement
    await input(ta, 'flowchart TB\n  A[改过]')

    await click(el.querySelector('[data-testid="board-back"]'))
    await waitFor(() => document.querySelector('[data-testid="discard-dialog"]') !== null)
    expect(window.location.hash).toBe('#/p/p1/board') // 未跳走
    await click(document.querySelector('[data-testid="discard-stay"]')!)
    await click(el.querySelector('[data-testid="board-back"]'))
    await waitFor(() => document.querySelector('[data-testid="discard-confirm"]') !== null)
    await click(document.querySelector('[data-testid="discard-confirm"]')!)
    await waitFor(() => window.location.hash === '#/p/p1?panel=figures')
  })

  it('冷载空画布核验重灌：mount 期画布被清则重灌一次（D-W17-1）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ sources: [] }))
    const el = await mount(<BoardPage pid="p1" src={null} />)
    await waitFor(() => el.querySelector('[data-testid="board-canvas-stub"]') !== null)
    await waitFor(() => updateScene.mock.calls.length > 0)
    updateScene.mockClear()
    sceneEls = [] // 模拟 mount 期 initialData 覆盖 updateScene——画布回到空
    await act(async () => new Promise((r) => setTimeout(r, 250))) // 走首轮 +80ms 核验窗
    sceneEls = [{ id: 'e1', type: 'rectangle' }]
    expect(updateScene.mock.calls.length).toBeGreaterThanOrEqual(1) // 核验发现空画布重灌
  })

  it('viewer 只读：画布 viewOnly + 写钮禁用', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ sources: [] }))
    useStudio.setState({ project: { id: 'p1', title: 't', role: 'viewer' } as never })
    const el = await mount(<BoardPage pid="p1" src={null} />)
    await waitFor(() => el.querySelector('[data-testid="board-canvas-stub"]') !== null)
    expect(el.querySelector('[data-testid="board-canvas-stub"]')?.getAttribute('data-viewonly')).toBe('true')
    expect((el.querySelector('[data-testid="board-save"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('?src= 打开 .spec 图源进 spec 模式：JSON 预览渲染 + 保存/导出走 spec 链路', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp, init) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
      if (url.endsWith('/figures-src')) return json({ sources: [{ name: 'net2.spec', size: 1 }] })
      if (url.endsWith('/figures-src/net2.mmd')) return json({ detail: '图源不存在' }, 404)
      if (url.endsWith('/figures-src/net2.spec')) return json({ name: 'net2.spec', source: '{"bands":[{"title":"层","blocks":[{"id":"A","label":"输入 101"}]}],"edges":[]}' })
      if (url.endsWith('/figures-preview')) return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
      if (url.endsWith('/figures')) return json({ figures: [], settings: {} })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src="net2" />) /* 冷开 URL 下覆盖判定走 GET /figures 而非 store */
    await waitFor(() => (el.querySelector('[data-testid="board-name"]') as HTMLInputElement).value === 'net2')
    // spec 模式：不上 excalidraw，中心区是交互画布
    await waitFor(() => el.querySelector('[data-testid="spec-canvas"]') !== null)
    expect(el.querySelector('[data-testid="board-canvas-stub"]')).toBeNull()
    expect(el.querySelector('[data-testid="canvas-block-A"]')).toBeTruthy()
    // 「渲染预览」按需取后端 PNG 弹层
    await click(el.querySelector('[data-testid="board-show-render"]'))
    await waitFor(() => el.querySelector('[data-testid="board-render-overlay"] img') !== null)
    const preview = calls.find((c) => c.url.endsWith('/figures-preview'))!
    expect(JSON.parse(preview.body as string).source).toContain('bands')

    // 保存 → PUT .spec 扩展名
    await click(el.querySelector('[data-testid="board-save"]'))
    await waitFor(() => calls.some((c) => c.method === 'PUT' && c.url.includes('/figures-src/net2.spec')))

    // 导出 → preview blob 走上传管线
    await click(el.querySelector('[data-testid="board-export"]'))
    await waitFor(() => calls.some((c) => c.method === 'POST' && c.url.endsWith('/figures')))
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/figures'))!
    const f = (post.body as FormData).get('files') as File
    expect(f.name).toBe('net2.png')
  })

  it('新建 .spec 进入 JSON 编辑+预览模式', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      if (url.endsWith('/figures-src')) return json({ sources: [] })
      if (url.endsWith('/figures-preview')) return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src={null} />)
    await waitFor(() => el.querySelector('[data-testid="board-canvas-stub"]') !== null)
    await click(el.querySelector('[data-testid="board-new-spec"]'))
    await waitFor(() => el.querySelector('[data-testid="spec-canvas"]') !== null)
    expect(el.querySelector('[data-testid="board-canvas-stub"]')).toBeNull()
    expect(el.querySelectorAll('[data-testid^="canvas-block-"]').length).toBe(3)
    await click(el.querySelector('[data-testid="board-src-toggle"]'))
    // 默认表单视图：层/块/连线结构件齐
    await waitFor(() => el.querySelector('[data-testid="spec-form"]') !== null)
    expect(el.querySelectorAll('[data-testid^="spec-block-"]').length).toBeGreaterThan(0)
    expect(el.querySelector('[data-testid="spec-edges"]')).toBeTruthy()
    // 切源码视图出 JSON 文本窗
    await click(el.querySelector('[data-testid="spec-view-code"]'))
    await waitFor(() => el.querySelector('[data-testid="board-code"]') !== null)
    const ta = el.querySelector('[data-testid="board-code"]') as HTMLTextAreaElement
    expect(ta.value).toContain('bands')
    expect(ta.getAttribute('aria-label')).toBe('figspec JSON 图源')
  })

  it('spec 表单微调：改块文案/删连线写回 JSON 真源', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      if (url.endsWith('/figures-src')) return json({ sources: [{ name: 'net2.spec', size: 1 }] })
      if (url.endsWith('/figures-src/net2.mmd')) return json({ detail: 'x' }, 404)
      if (url.endsWith('/figures-src/net2.spec')) return json({ name: 'net2.spec', source: '{"bands":[{"title":"层","blocks":[{"id":"A","label":"输入 101"},{"id":"B","label":"处理 102"}]}],"edges":[{"from":"A","to":"B","dashed":false}]}' })
      if (url.endsWith('/figures-preview')) return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
      if (url.endsWith('/figures')) return json({ figures: [], settings: {} })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src="net2" />)
    await waitFor(() => (el.querySelector('[data-testid="board-name"]') as HTMLInputElement).value === 'net2')
    await click(el.querySelector('[data-testid="board-src-toggle"]'))
    await waitFor(() => el.querySelector('[data-testid="spec-block-label-A"]') !== null)

    // 表单改 label → 写回 JSON
    await input(el.querySelector('[data-testid="spec-block-label-A"]')!, '数据输入 101')
    await click(el.querySelector('[data-testid="spec-view-code"]'))
    await waitFor(() => (el.querySelector('[data-testid="board-code"]') as HTMLTextAreaElement).value.includes('数据输入 101'))

    // 表单删连线 → JSON edges 清空
    await click(el.querySelector('[data-testid="spec-view-form"]'))
    await waitFor(() => el.querySelector('[data-testid="spec-edge-0"]') !== null)
    await click(el.querySelector('[data-testid="spec-edge-0"] [aria-label="删除连线 1"]'))
    await click(el.querySelector('[data-testid="spec-view-code"]'))
    await waitFor(() => (el.querySelector('[data-testid="board-code"]') as HTMLTextAreaElement).value.includes('"edges": []'))
  })

  it('同名 PNG 已存在：导出先武装确认，确认后走 /image 整组替换', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp, init) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
      if (url.endsWith('/figures-src')) return json({ sources: [{ name: 'flow1.mmd', size: 1 }] })
      if (url.endsWith('/figures-src/flow1.mmd')) return json({ name: 'flow1.mmd', source: 'flowchart LR\n  A-->B\n' })
      if (url.includes('/figures/flow1.png/image')) return json({ figures: [], settings: {} })
      if (url.endsWith('/figures')) return json({ figures: [{ name: 'flow1.png', marks: {} }], settings: {} })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src="flow1" />)
    await waitFor(() => (el.querySelector('[data-testid="board-name"]') as HTMLInputElement).value === 'flow1')

    await click(el.querySelector('[data-testid="board-export"]'))
    await waitFor(() => el.querySelector('[data-testid="board-export-confirm"]') !== null)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/figures'))).toBe(false)
    await click(el.querySelector('[data-testid="board-export-confirm"]'))
    await waitFor(() => calls.some((c) => c.method === 'PUT' && c.url.includes('/figures/flow1.png/image')))
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/image'))!
    const f = (put.body as FormData).get('files') as File
    expect(f.name).toBe('flow1.png')
  })

  it('sceneToPng 导出尺寸钳制：大场景自动降档防 canvas 超限（couldn\'t export to blob 回归）', async () => {
    const { exportToBlob } = await import('@excalidraw/excalidraw')
    const { sceneToPng, DRAW_EXPORT_MAX_SIDE } = await import('../figureDraw')
    const mocked = vi.mocked(exportToBlob)
    const api = {
      getSceneElements: () => [{ id: 'e1' }],
      getFiles: () => ({}),
    } as never
    await sceneToPng(api)
    const dims = mocked.mock.calls.at(-1)![0].getDimensions!
    // 3000px 场景：4× 会出 12000px——钳到 8192 上限内
    const big = dims(3000, 6000)
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(DRAW_EXPORT_MAX_SIDE + 1)
    // 500px 小场景：保留满 4× 清晰度
    const small = dims(500, 400)
    expect(small.scale).toBe(4)
    expect(small.width).toBe(2000)
    // exportToBlob 返 null → 抛可读错误而非吞 null
    mocked.mockResolvedValueOnce(null as never)
    await expect(sceneToPng(api)).rejects.toThrow('导出失败')
  })
})

describe('BoardPage 全图类可编辑（mmd→spec 转换 + 位图标注模式）', () => {
  it('「转 .spec」按钮：mmd 源码 → spec 交互画布', async () => {
    const SPEC = { bands: [{ title: '层', blocks: [{ id: 'A', label: '甲' }, { id: 'B', label: '乙' }] }], edges: [{ from: 'A', to: 'B' }] }
    const calls: { url: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp, init) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      calls.push({ url, body: init?.body })
      if (url.endsWith('/figures-mmd-to-spec')) return json({ spec: JSON.stringify(SPEC) })
      if (url.endsWith('/figures-src')) return json({ sources: [] })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src={null} />)
    await waitFor(() => el.querySelector('[data-testid="board-to-spec"]') !== null)
    await click(el.querySelector('[data-testid="board-to-spec"]'))
    await waitFor(() => el.querySelector('[data-testid="spec-canvas"]') !== null)
    expect(el.querySelector('[data-testid="canvas-block-A"]')).toBeTruthy()
    expect(el.querySelector('[data-testid="canvas-block-B"]')).toBeTruthy()
    const conv = calls.find((c) => c.url.endsWith('/figures-mmd-to-spec'))!
    expect(JSON.parse(conv.body as string).source).toContain('flowchart')
  })

  it('?img= 位图标注：原图落画布、无源码/保存钮、导出走覆盖确认', { timeout: 20000 }, async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp, init) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
      if (url.includes('/figs/fig7.png')) return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
      if (url.endsWith('/figures')) return json({ figures: [{ name: 'fig7.png' }], settings: {} })
      if (url.includes('/image')) return json({ figures: [] })
      if (url.endsWith('/figures-src')) return json({ sources: [] })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src={null} img="fig7.png" />)
    await waitFor(() => el.querySelector('[data-testid="board-image-badge"]') !== null)
    expect(el.querySelector('[data-testid="board-src-toggle"]')).toBeNull()
    expect(el.querySelector('[data-testid="board-save"]')).toBeNull()
    expect((el.querySelector('[data-testid="board-name"]') as HTMLInputElement).value).toBe('fig7')
    // 原图经 imageBlobToScene 上画布（jsdom 不解码图——走 probe 回落尺寸）
    await waitFor(() => updateScene.mock.calls.length > 0, 160)
    const last = updateScene.mock.calls.at(-1)?.[0] as { elements?: { type?: string }[] } | undefined
    expect(last?.elements?.some((e) => e.type === 'image')).toBe(true)
    // 导出 → 同名图存在 → 覆盖确认 → PUT /figures/fig7.png/image
    await click(el.querySelector('[data-testid="board-export"]'))
    await waitFor(() => el.querySelector('[data-testid="board-export-confirm"]') !== null)
    await click(el.querySelector('[data-testid="board-export-confirm"]'))
    await waitFor(() => calls.some((c) => c.method === 'PUT' && c.url.includes('/figures/fig7.png/image')))
  })
})

describe('位图「区域移动」（框选抠块可拖）', () => {
  it('regionOverlap/pickImageElement/regionToPixels 几何换算', async () => {
    const { regionOverlap, pickImageElement, regionToPixels } = await import('../figureDraw')
    // 相交/包含/相离
    expect(regionOverlap({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 }))
      .toEqual({ x: 50, y: 50, width: 50, height: 50 })
    expect(regionOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 })).toBeNull()
    expect(regionOverlap({ x: 0, y: 0, width: 3, height: 3 }, { x: 0, y: 0, width: 1, height: 1 })).toBeNull() // >1 边长闸
    // 最上层命中：两图叠放时取数组序靠后（层序高）者；isDeleted 跳过
    const els = [
      { id: 'a', type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: 'fa' },
      { id: 'b', type: 'image', x: 10, y: 10, width: 50, height: 50, fileId: 'fb' },
      { id: 'c', type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: 'fc', isDeleted: true },
    ]
    expect(pickImageElement(els, { x: 20, y: 20, width: 10, height: 10 })?.id).toBe('b')
    expect(pickImageElement(els, { x: 90, y: 90, width: 10, height: 10 })?.id).toBe('a')
    expect(pickImageElement(els, { x: 500, y: 500, width: 10, height: 10 })).toBeNull()
    // 元素坐标 → 源图像素：元素 200×100 显示 800×400 自然图 → 4x 缩放
    const px = regionToPixels(
      { id: 'i', type: 'image', x: 10, y: 10, width: 200, height: 100, fileId: 'f' },
      { x: 60, y: 35, width: 100, height: 50 },
      800, 400,
    )
    expect(px).toEqual({ sx: 200, sy: 100, sw: 400, sh: 200 })
    // 带 excalidraw crop 窗口：crop=(100,50,400,200) 显示为 200×100 → 源图偏移换算
    const px2 = regionToPixels(
      { id: 'i', type: 'image', x: 0, y: 0, width: 200, height: 100, fileId: 'f', crop: { x: 100, y: 50, width: 400, height: 200 } },
      { x: 0, y: 0, width: 200, height: 100 },
      800, 400,
    )
    expect(px2).toEqual({ sx: 100, sy: 50, sw: 400, sh: 200 })
  })

  it('「区域移动」钮仅在位图模式出现；armed 出选框层，小框不触发抠取', { timeout: 20000 }, async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (inp) => {
      const url = typeof inp === 'string' ? inp : inp instanceof URL ? inp.href : inp.url
      if (url.includes('/figs/fig7.png')) return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
      if (url.endsWith('/figures')) return json({ figures: [{ name: 'fig7.png' }], settings: {} })
      if (url.endsWith('/figures-src')) return json({ sources: [] })
      return json({})
    })
    const el = await mount(<BoardPage pid="p1" src={null} img="fig7.png" />)
    await waitFor(() => el.querySelector('[data-testid="board-image-badge"]') !== null)
    const btn = el.querySelector('[data-testid="board-region-move"]')!
    expect(el.querySelector('[data-testid="board-region-overlay"]')).toBeNull()
    await click(btn)
    const overlay = el.querySelector('[data-testid="board-region-overlay"]')!
    expect(overlay).toBeTruthy()
    // 微小拖选（<4 场景单位）→ 不抠取：updateScene 无新增调用
    const before = updateScene.mock.calls.length
    overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }))
    overlay.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 102, clientY: 102, pointerId: 1 }))
    overlay.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 102, clientY: 102, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 30))
    expect(updateScene.mock.calls.length).toBe(before)
    expect(el.querySelector('[data-testid="board-region-overlay"]')).toBeNull() // 一次性 arm
  })
})
