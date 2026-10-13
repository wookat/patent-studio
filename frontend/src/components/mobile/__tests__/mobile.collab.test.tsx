// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileShell } from '../MobileShell'
import { destroyAllRooms, roomEntries } from '@/collab/registry'
import { applyMinimal } from '@/collab/useCollabMirror'
import { FakeServer, flush } from '@/collab/__tests__/fakeServer'
import { splitBooks } from '@/lib/docset'
import type { ProjectDetail } from '@/lib/types'
import { useStudio } from '@/store'

/** 预览 Tab 的 react-pdf 在 jsdom 无 DOMMatrix；本文件不碰预览 */
vi.mock('../MobilePreview', () => ({ MobilePreview: () => <div data-testid="mobile-preview" /> }))

/**
 * W5 走查 domain-03：owner 在 375 单书编辑（activeBook≠all）下审阅采纳别的书的建议，
 * 本地 marks 1→0 但磁盘仍含 {++…++}、刷新回 1 —— 移动壳只接了当前书的房间，别的书的 store 改动没有房间可推、
 * 协同模式又关闭了本地 PUT。修法：单书模式挂 CollabMirror（与桌面 DockviewHost 同一条镜像）。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getClientRects ??= rects
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const CLAIMS = '1. C1\n2. C2\n\n'
const DESC_MARKED = 'D1{++本系统还可采集实时流量数据。++}\nD2\n'
const DOC = `# 题\n\n## 摘要\nA1\n\n## 权利要求书\n${CLAIMS}## 说明书\n${DESC_MARKED}`
const st = () => useStudio.getState()

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    project: { id: 'p1', name: 'p1', role: 'owner' } as unknown as ProjectDetail,
    authStatus: 'off',
    user: null,
    content: DOC,
    saved: DOC,
    contentEditedAt: 0,
    scrollRequest: null,
    activeBlock: null,
    ast: null,
    editorHandle: null,
    editorView: 'source',
    editorMode: 'edit',
    collabReadonly: false,
    mobileTab: 'edit',
    mobileSettingsOpen: false,
    collabProbed: 'p1',
    marks: [
      {
        id: 'm1',
        kind: 'ins',
        line: 11,
        from: 2,
        to: DESC_MARKED.indexOf('++}') + 3,
        a: '',
        b: '本系统还可采集实时流量数据。',
        final: '本系统还可采集实时流量数据。',
        original: '',
      },
    ],
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  destroyAllRooms()
  vi.unstubAllGlobals()
  useStudio.setState({ pid: null, marks: [], activeBook: 'all' })
  st().resetCollab()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  await act(async () => {
    await flush()
  })
  return host
}

describe('移动壳单书编辑 + 审阅采纳持久化（W5 domain-03）', () => {
  it('activeBook=claims：采纳说明书里的插入建议 → 经镜像推进 content 房间，服务端全文不再含 {++…++}', async () => {
    const server = new FakeServer({ claims: CLAIMS, content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ activeBook: 'claims' })
    await mount(<MobileShell />)
    expect(st().collabStatus).toBe('connected')
    expect(roomEntries().map((e) => e.book).sort()).toEqual(['claims', 'content'])

    await act(async () => {
      st().acceptMark('m1')
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
    })
    expect(st().marks).toHaveLength(0)
    const remote = server.text('content')
    expect(remote).not.toContain('{++')
    expect(splitBooks(remote).books.description?.text).toBe('D1本系统还可采集实时流量数据。\nD2\n')
    expect(splitBooks(remote).books.claims?.text).toBe(CLAIMS)
  })

  it('对端在 content 房间改了说明书 → 单书模式下也合入 store（PDF / 大纲不停在旧文本）', async () => {
    const server = new FakeServer({ claims: CLAIMS, content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ activeBook: 'claims' })
    await mount(<MobileShell />)
    await act(async () => {
      applyMinimal(server.room('content').doc.getText('content'), DOC.replace('D2', 'D2 远端'), 'server')
      await flush()
    })
    expect(splitBooks(st().content).books.description?.text).toBe(`${DESC_MARKED.replace('D2', 'D2 远端')}`)
  })

  it('activeBook=all：全文 Editor 自己接 content 房间，不再叠一条镜像（避免同一改动推两次）', async () => {
    const server = new FakeServer({ content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ activeBook: 'all' })
    await mount(<MobileShell />)
    expect(roomEntries().map((e) => e.book)).toEqual(['content'])
    expect(server.accepts).toBe(1)
  })
})
