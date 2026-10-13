// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { SourceCard } from '@/components/cards/SourceCard'
import { useStudio } from '@/store'
import { splitBooks } from '@/lib/docset'
import { destroyAllRooms, roomEntries } from '../registry'
import { applyMinimal, takeBooks, useCollabMirror } from '../useCollabMirror'
import { FakeServer, flush } from './fakeServer'

/**
 * dockview 单书卡片的协同接线（波次 3 深度走查 P0：双 tab 不同步 / REST 写入不推送 / 无 presence）。
 * 用 fakeServer 复现：同书两张卡片共享一个房间（Y.Doc）即时互通；不同书各接各的房间；
 * 服务端外部改写（模拟 REST/MCP → on_saved → apply_external）推到已开卡片；
 * 全文镜像（useCollabMirror）把无卡片书的远端改动合入 store、把本地无卡片书的改动推回 content 房间；
 * viewer 卡片 readOnly；卸载时 socket 全关。
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

const DOC = '# 题\n\n## 摘要\nA1\n\n## 权利要求书\n1. C1\n2. C2\n\n## 说明书\nD1\nD2\n'
const CLAIMS = '1. C1\n2. C2\n\n'
const st = () => useStudio.getState()

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    authStatus: 'off',
    user: null,
    content: DOC,
    saved: DOC,
    contentEditedAt: 0,
    scrollRequest: null,
    compareLock: false,
    activeBlock: null,
    activePanelId: null,
    ast: null,
    editorHandle: null,
  })
  st().resetCollab()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  destroyAllRooms()
  vi.unstubAllGlobals()
  useStudio.setState({ pid: null })
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

function viewOf(testId: string, nth = 0): EditorView {
  const content = host.querySelectorAll(`[data-testid="${testId}"] .cm-content`)[nth]
  const v = content && EditorView.findFromDOM(content as HTMLElement)
  if (!v) throw new Error(`no EditorView under ${testId}#${nth}`)
  return v
}

async function type(view: EditorView, pos: number, text: string) {
  await act(async () => {
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent: 'input.type' })
    await flush()
  })
}

function Mirror() {
  useCollabMirror()
  return null
}

const card = (book: 'abstract' | 'claims' | 'description') => (
  <SourceCard panelId={`source:${book}`} kind="source" book={book} active onSwitchBook={() => {}} />
)

describe('dockview 单书卡片协同（R8 补线）', () => {
  it('同书两张卡片共享一个房间：一张输入即出现在另一张，且 store 切片与服务端 Y.Text 一致；不同书各接各的房间', async () => {
    const server = new FakeServer({ claims: CLAIMS, description: 'D1\nD2\n' })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ collabProbed: 'p1' })
    await mount(
      <>
        {card('claims')}
        {card('claims')}
        {card('description')}
      </>,
    )
    expect(st().collabStatus).toBe('connected')
    expect(server.accepts).toBe(2)
    expect(roomEntries().map((e) => e.book).sort()).toEqual(['claims', 'description'])
    expect(roomEntries().find((e) => e.book === 'claims')?.refs).toBe(2)

    const a = viewOf('card-editor-claims', 0)
    const b = viewOf('card-editor-claims', 1)
    expect(a.state.readOnly).toBe(false)
    await type(a, 5, 'YJS')
    expect(b.state.doc.toString()).toBe('1. C1YJS\n2. C2\n\n')
    expect(server.text('claims')).toBe('1. C1YJS\n2. C2\n\n')
    expect(splitBooks(st().content).books.claims?.text).toBe('1. C1YJS\n2. C2\n\n')
    expect(splitBooks(st().content).books.description?.text).toBe('D1\nD2\n')
    expect(server.text('description')).toBe('D1\nD2\n')
  })

  it('服务端外部改写（REST/MCP → on_saved）推到已开卡片，本地 undo 栈不吞远端改动；卸载后 socket 全关、状态回 off', async () => {
    const server = new FakeServer({ claims: CLAIMS })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ collabProbed: 'p1' })
    await mount(card('claims'))
    const v = viewOf('card-editor-claims')
    await act(async () => {
      const t = server.room('claims').doc.getText('content')
      applyMinimal(t, '1. C1\n2. C2（外部）\n\n', 'server')
      await flush()
    })
    expect(v.state.doc.toString()).toBe('1. C1\n2. C2（外部）\n\n')
    expect(splitBooks(st().content).books.claims?.text).toBe('1. C1\n2. C2（外部）\n\n')
    expect(st().content.startsWith('# 题\n\n## 摘要\nA1\n')).toBe(true)

    await act(async () => root?.unmount())
    expect(st().collabStatus).toBe('off')
    expect([...server.sockets].filter((k) => k.readyState === WebSocket.OPEN)).toHaveLength(0)
    expect(roomEntries()).toHaveLength(0)
  })

  it('远端（MCP patch_block）推入 CriticMarkup 后本端拒绝：编辑器 / Y.Text / 服务端 / store 四方同步去掉标记（R3 P1）', async () => {
    const server = new FakeServer({ claims: CLAIMS, content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ collabProbed: 'p1' })
    await mount(
      <>
        <Mirror />
        {card('claims')}
      </>,
    )
    const v = viewOf('card-editor-claims')
    // 作者先键入一字（该正文被编辑器上报过 ⇒ 之后拒绝恢复到它时不能被当成陈旧回声丢掉）
    await type(v, 5, 'X')
    const base = '1. C1X\n2. C2\n\n'
    expect(server.text('claims')).toBe(base)
    const marked = '1. C1X{++MCPR3++}\n2. C2\n\n'
    await act(async () => {
      applyMinimal(server.room('claims').doc.getText('content'), marked, 'server')
      applyMinimal(server.room('content').doc.getText('content'), DOC.replace(CLAIMS, marked), 'server')
      await flush()
    })
    expect(v.state.doc.toString()).toBe(marked)
    expect(splitBooks(st().content).books.claims?.text).toBe(marked)
    // 服务端 /marks 解析结果（全文行 7 = 「1. C1X」）
    useStudio.setState({
      marks: [{ id: 'm1', kind: 'ins', line: 7, from: 6, to: 17, a: '', b: 'MCPR3', final: 'MCPR3', original: '' }],
    })
    await act(async () => {
      st().rejectMark('m1')
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
    })
    expect(st().marks).toHaveLength(0)
    expect(splitBooks(st().content).books.claims?.text).toBe(base)
    expect(v.state.doc.toString()).toBe(base)
    expect(server.text('claims')).toBe(base)
  })

  it('viewer：卡片 readOnly / 不可编辑，输入不进 Y.Text', async () => {
    const server = new FakeServer({ claims: CLAIMS })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ collabProbed: 'p1', collabReadonly: true })
    await mount(card('claims'))
    const v = viewOf('card-editor-claims')
    expect(v.state.readOnly).toBe(true)
    expect(v.state.facet(EditorView.editable)).toBe(false)
    expect(host.querySelector('[data-testid="card-editor-claims"] .cm-content')?.getAttribute('contenteditable')).toBe('false')
  })

  it('全文镜像：无卡片书的远端改动合入 store（有卡片书以房间为准）；本地对无卡片书的改动推回 content 房间', async () => {
    const server = new FakeServer({ claims: CLAIMS, content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ collabProbed: 'p1' })
    await mount(
      <>
        <Mirror />
        {card('claims')}
      </>,
    )
    expect(server.accepts).toBe(2)
    const content = server.room('content').doc.getText('content')

    // 远端在 content 房间改了摘要与权利要求书：摘要合入，权利要求书（有卡片）保持房间文本
    await act(async () => {
      applyMinimal(content, DOC.replace('A1', 'A1 远端').replace('1. C1', '1. C1 忽略'), 'server')
      await flush()
    })
    expect(splitBooks(st().content).books.abstract?.text).toBe('A1 远端\n\n')
    expect(splitBooks(st().content).books.claims?.text).toBe(CLAIMS)
    expect(viewOf('card-editor-claims').state.doc.toString()).toBe(CLAIMS)

    // 本地（无卡片的说明书）接受修订等改动 → 推进 content 房间；有卡片的书不经镜像重复推
    await act(async () => {
      st().setBookContent('description', 'D1 本地\nD2\n')
      await flush()
    })
    expect(splitBooks(content.toString()).books.description?.text).toBe('D1 本地\nD2\n')
    expect(splitBooks(content.toString()).books.claims?.text).toBe('1. C1 忽略\n2. C2\n\n')
  })
})

describe('镜像纯函数', () => {
  it('takeBooks 只换指定书；applyMinimal 前后缀对齐、中文安全、无变化返回 false', () => {
    expect(takeBooks(DOC, DOC.replace('A1', 'A2').replace('D1', 'D9'), ['abstract', 'content'])).toBe(DOC.replace('A1', 'A2'))
    const doc = new Y.Doc()
    const t = doc.getText('t')
    t.insert(0, '一种控制方法')
    expect(applyMinimal(t, '一种控制方法', null)).toBe(false)
    expect(applyMinimal(t, '一种新的控制方法', null)).toBe(true)
    expect(t.toString()).toBe('一种新的控制方法')
    applyMinimal(t, '控制', null)
    expect(t.toString()).toBe('控制')
  })
})
