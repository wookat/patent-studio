// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { colorFor } from '../colors'
import { acquireRoom, destroyAllRooms } from '../registry'
import { FakeServer, flush } from './fakeServer'

/**
 * R24-02：浏览器级 offline（ws 仍挂着的半死网络）必须立刻呈现——navigator.onLine=false + 'offline'
 * 事件让聚合状态落到 reconnecting + 「网络已离线」；'online' 后回 connected（房间本身一直连着）。
 */
function setOnline(v: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true })
}

afterEach(() => {
  setOnline(true)
  destroyAllRooms()
  useStudio.getState().resetCollab()
  vi.unstubAllGlobals()
})

describe('registry 离线聚合（R24-02）', () => {
  it('offline 事件 → reconnecting +「网络已离线」；online → 回 connected', async () => {
    const server = new FakeServer({ content: 'x' })
    vi.stubGlobal('WebSocket', server.WebSocket)
    const entry = acquireRoom('p1', 'content', { name: 'n', color: colorFor('n'), readonly: false })
    expect(entry).not.toBeNull()
    await flush()
    expect(useStudio.getState().collabStatus).toBe('connected')

    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    expect(useStudio.getState().collabStatus).toBe('reconnecting')
    expect(useStudio.getState().collabError).toBe('网络已离线')

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    expect(useStudio.getState().collabStatus).toBe('connected')
    expect(useStudio.getState().collabError).toBeNull()
  })
})
