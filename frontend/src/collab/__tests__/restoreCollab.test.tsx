// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceCard } from '@/components/cards/SourceCard'
import { useStudio } from '@/store'
import { api } from '@/lib/api'
import { splitBooks } from '@/lib/docset'
import { destroyAllRooms } from '../registry'
import { applyMinimal, useCollabMirror } from '../useCollabMirror'
import { FakeServer, flush } from './fakeServer'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import type { Ast } from '@/types/ast'
import type { ProjectDetail } from '@/lib/types'

/**
 * W4 深度走查 P1：协同在线时「恢复历史版本」把正文变成两份交错内容。
 * 服务端 restore 走 save_content → on_saved → apply_external（对每个活跃房间做最小 diff 替换），
 * 同时前端拿到响应后 setContent(全文) → 卡片/镜像再把同一份全文推进 Y.Text。两路对同一旧状态的并发替换在 CRDT 合并后就是重复。
 * 修复后：服务端已改写的正文只走 CRDT 下发，前端不再对 Y.Text 二次全量写入。
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
const OLD_CLAIMS = '1. 旧权项一\n2. 旧权项二\n3. 旧权项三\n\n'
const OLD = DOC.replace(CLAIMS, OLD_CLAIMS).replace('D1\nD2\n', '旧说明书第一段\n旧说明书第二段\n')
/** DOC 的最小 AST：只有 claims/1（第 7 行）可编辑 */
const DOC_AST: Ast = {
  ...SYNTH_AST,
  books: { abstract: { offset: 3, length: 3 }, claims: { offset: 6, length: 4 }, description: { offset: 10, length: 3 } },
  abstract: { ...SYNTH_AST.abstract, paragraphs: [] },
  claims: [{ ...SYNTH_AST.claims[0], id: 'claims/1', lines: { start: 1, end: 1 } }],
  description: [],
}
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
  vi.restoreAllMocks()
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

function viewOf(testId: string): EditorView {
  const content = host.querySelector(`[data-testid="${testId}"] .cm-content`)
  const v = content && EditorView.findFromDOM(content as HTMLElement)
  if (!v) throw new Error(`no EditorView under ${testId}`)
  return v
}

function Mirror() {
  useCollabMirror()
  return null
}

const card = (book: 'abstract' | 'claims' | 'description') => (
  <SourceCard panelId={`source:${book}`} kind="source" book={book} active onSwitchBook={() => {}} />
)

describe('协同在线时恢复历史版本（W4 走查 P1）', () => {
  it('服务端 restore 下发 + 前端响应落 store：卡片 / 镜像 / 服务端 Y.Text / store 四方都恰好等于目标正文，不重复不交错', async () => {
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
    expect(v.state.doc.toString()).toBe(CLAIMS)

    // 服务端：restore → save_content → on_saved → 各房间 apply_external（最小 diff），随后 HTTP 响应带回全文
    vi.spyOn(api, 'restoreVersion').mockImplementation(async () => {
      applyMinimal(server.room('claims').doc.getText('content'), OLD_CLAIMS, 'server')
      applyMinimal(server.room('content').doc.getText('content'), OLD, 'server')
      return { ok: true, content: OLD, sha_new: 'deadbeef', changed: true }
    })
    await act(async () => {
      st().restoreVersion('p1', 'abc1234')
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
    })

    expect(server.text('claims')).toBe(OLD_CLAIMS)
    expect(v.state.doc.toString()).toBe(OLD_CLAIMS)
    expect(splitBooks(st().content).books.claims?.text).toBe(OLD_CLAIMS)
    expect(splitBooks(st().content).books.description?.text).toBe('旧说明书第一段\n旧说明书第二段\n')
    expect(server.text('content')).toBe(OLD)
    expect(st().content).toBe(OLD)
    expect(st().saved).toBe(OLD)
  })

  it('服务端已改写但 WS 下发晚于 HTTP 响应到达（真实竞争）：本端不得对同一旧状态再做一次全量替换', async () => {
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
    // 扣住服务端 → 本端的 WS 投递（两个房间），模拟 WS 帧比 HTTP 响应晚到
    const held: Array<() => void> = []
    for (const sock of server.sockets) {
      const orig = sock.onmessage!
      sock.onmessage = (ev) => {
        held.push(() => orig(ev))
      }
    }
    vi.spyOn(api, 'restoreVersion').mockImplementation(async () => {
      applyMinimal(server.room('claims').doc.getText('content'), OLD_CLAIMS, 'server')
      applyMinimal(server.room('content').doc.getText('content'), OLD, 'server')
      return { ok: true, content: OLD, sha_new: 'deadbeef', changed: true }
    })
    await act(async () => {
      st().restoreVersion('p1', 'abc1234')
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
    })
    // 本端已按响应更新 store；此时放行被扣住的 WS 帧
    expect(st().content).toBe(OLD)
    await act(async () => {
      for (const f of held.splice(0)) f()
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
    })
    expect(server.text('claims')).toBe(OLD_CLAIMS)
    expect(server.text('content')).toBe(OLD)
    expect(v.state.doc.toString()).toBe(OLD_CLAIMS)
    expect(st().content).toBe(OLD)
  })

  it('响应先到、服务端 CRDT 下发后到（网络乱序）同样收敛到目标正文', async () => {
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
    vi.spyOn(api, 'restoreVersion').mockResolvedValue({ ok: true, content: OLD, sha_new: 'deadbeef', changed: true })
    await act(async () => {
      st().restoreVersion('p1', 'abc1234')
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
      applyMinimal(server.room('claims').doc.getText('content'), OLD_CLAIMS, 'server')
      applyMinimal(server.room('content').doc.getText('content'), OLD, 'server')
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
    })
    expect(server.text('claims')).toBe(OLD_CLAIMS)
    expect(v.state.doc.toString()).toBe(OLD_CLAIMS)
    expect(server.text('content')).toBe(OLD)
    expect(st().content).toBe(OLD)
  })

  it('reviewer 版面视图提交 CriticMarkup 建议（块补丁）：本端只读连接的写入被服务端丢弃，正文只经服务端下发一次，不出现双份', async () => {
    const server = new FakeServer({ claims: CLAIMS, content: DOC })
    server.readonlyNames.add('审阅者')
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({
      collabProbed: 'p1',
      authStatus: 'authed',
      user: { id: 'u2', email: 'r@x', display_name: '审阅者', is_superuser: false },
      project: { id: 'p1', role: 'reviewer' } as unknown as ProjectDetail,
      ast: DOC_AST,
      astContent: DOC,
    })
    await mount(
      <>
        <Mirror />
        {card('claims')}
      </>,
    )
    const v = viewOf('card-editor-claims')
    expect(v.state.doc.toString()).toBe(CLAIMS)
    const NEW_CLAIMS = '1. C1{++ 建议++}\n2. C2\n\n'
    const NEW = DOC.replace(CLAIMS, NEW_CLAIMS)
    // 服务端：reviewer 走 /blocks 落 CriticMarkup → save_content → on_saved 推进各房间，随后 HTTP 响应带回全文
    vi.spyOn(api, 'patchBlock').mockImplementation(async () => {
      applyMinimal(server.room('claims').doc.getText('content'), NEW_CLAIMS, 'server')
      applyMinimal(server.room('content').doc.getText('content'), NEW, 'server')
      return { ast: DOC_AST, content: NEW, changed_lines: { start: 7, end: 7 }, block_id: 'claims/1', backup: null }
    })
    await act(async () => {
      await st().patchBlock('claims/1', '1. C1{++ 建议++}')
      await flush()
      await new Promise((r) => setTimeout(r, 5))
      await flush()
    })
    expect(server.text('claims')).toBe(NEW_CLAIMS)
    expect(server.text('content')).toBe(NEW)
    expect(v.state.doc.toString()).toBe(NEW_CLAIMS)
    expect(st().content).toBe(NEW)
    expect(st().content.match(/建议/g)?.length).toBe(1)
  })
})
