// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import { selectCollabActive, useStudio } from '@/store'
import { PEER_COLORS, colorFor, initialOf, labelText, localDoc } from '@/collab'
import { CURSOR_LABEL_TEXT } from '@/collab/colors'

afterEach(() => {
  vi.restoreAllMocks()
  useStudio.getState().resetCollab()
  useStudio.setState({ collabUnavailable: false })
})

describe('collab slice（docs/plan/11 §5.2）', () => {
  it('默认 off：与现状一致，selectCollabActive=false', () => {
    const s = useStudio.getState()
    expect(s.collabStatus).toBe('off')
    expect(s.collabUnavailable).toBe(false)
    expect(s.peers).toEqual([])
    expect(s.collabReadonly).toBe(false)
    expect(s.collabError).toBeNull()
    expect(selectCollabActive(s)).toBe(false)
  })

  it('setCollabStatus / setPeers / setCollabReadonly / resetCollab', () => {
    const s = useStudio.getState()
    s.setCollabStatus('reconnecting', '1008')
    s.setPeers([{ id: 7, name: '张三', color: colorFor('张三'), line: 12, readonly: true }])
    s.setCollabReadonly(true)
    let n = useStudio.getState()
    expect(n.collabStatus).toBe('reconnecting')
    expect(n.collabError).toBe('1008')
    expect(n.peers).toHaveLength(1)
    expect(n.collabReadonly).toBe(true)
    expect(selectCollabActive(n)).toBe(true)
    s.setCollabStatus('connected')
    expect(useStudio.getState().collabError).toBeNull()
    s.resetCollab()
    n = useStudio.getState()
    expect(n.collabStatus).toBe('off')
    expect(n.peers).toEqual([])
    expect(n.collabReadonly).toBe(false)
  })

  it('loadCollabStatus：501（G1 未落地）与 {enabled:false} 都 → collabUnavailable；其他错误不算不可用', async () => {
    vi.spyOn(api, 'collabStatus').mockRejectedValueOnce(new ApiError(501, 'not_implemented'))
    await useStudio.getState().loadCollabStatus('method')
    expect(useStudio.getState().collabUnavailable).toBe(true)

    vi.spyOn(api, 'collabStatus').mockResolvedValueOnce({ enabled: false, readonly: false, mode: 'edit', rooms: [] })
    await useStudio.getState().loadCollabStatus('method')
    expect(useStudio.getState().collabUnavailable).toBe(true)

    vi.spyOn(api, 'collabStatus').mockResolvedValueOnce({ enabled: true, readonly: true, mode: 'readonly', rooms: [{ book: 'claims', peers: 2 }] })
    await useStudio.getState().loadCollabStatus('method')
    expect(useStudio.getState().collabUnavailable).toBe(false)
    expect(useStudio.getState().collabReadonly).toBe(true)
    expect(useStudio.getState().collabProbed).toBe('method')

    vi.spyOn(api, 'collabStatus').mockRejectedValueOnce(new ApiError(500, 'boom'))
    await useStudio.getState().loadCollabStatus('method')
    expect(useStudio.getState().collabUnavailable).toBe(false)
  })

  it('协同生效时 doc.save 不 PUT /content，只清脏标记（§4.3）', async () => {
    const put = vi.spyOn(api, 'saveContent')
    useStudio.setState({ pid: 'method', content: '# A\n', saved: '', saving: false })
    useStudio.getState().setCollabStatus('connected')
    expect(await useStudio.getState().save()).toBe(true)
    expect(put).not.toHaveBeenCalled()
    expect(useStudio.getState().saved).toBe('# A\n')
  })
})

describe('api.collabWs（同源 y-websocket serverUrl/roomname）', () => {
  it('http → ws，https → wss；roomname = book', () => {
    expect(api.collabWs('p1', 'claims', { protocol: 'http:', host: 'localhost:5173' })).toEqual({
      serverUrl: 'ws://localhost:5173/api/projects/p1/collab',
      roomname: 'claims',
    })
    expect(api.collabWs('p 1', 'content', { protocol: 'https:', host: 'x.example' }).serverUrl).toBe(
      'wss://x.example/api/projects/p%201/collab',
    )
  })
})

describe('collab/colors', () => {
  it('同名稳定、色盘内、标签前景有值', () => {
    for (const n of ['张三', 'alice', '', '代理人 Bob']) {
      const c = colorFor(n)
      expect(PEER_COLORS).toContain(c)
      expect(colorFor(n)).toBe(c)
      expect(['#0b1220', '#ffffff']).toContain(labelText(c))
    }
    expect(initialOf('张三')).toBe('张')
    expect(initialOf('alice')).toBe('A')
    expect(initialOf('  ')).toBe('?')
  })

  it('光标名字条（11px）前景在 8 色底上 WCAG 对比度均 ≥ 4.5:1', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    for (const c of PEER_COLORS) expect(ratio(c, CURSOR_LABEL_TEXT)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('yjs 本地文档（依赖已装、Text 键名固定）', () => {
  it('localDoc 建 Y.Text 并可 insert 中文', () => {
    const { doc, text } = localDoc('权利要求 1')
    text.insert(text.length, '。')
    expect(text.toString()).toBe('权利要求 1。')
    expect(doc.getText('content')).toBe(text)
    doc.destroy()
  })
})
