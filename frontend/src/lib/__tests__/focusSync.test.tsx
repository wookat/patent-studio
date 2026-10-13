// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useStudio } from '@/store'
import type { Focus } from '@/types/focus'
import { COMPARE_LOCK_DEBOUNCE_MS, FOCUS_FLASH_CLASS, blockElement, cursorFocusDriver, flash, useFocusConsumer } from '../focusSync'
import { SYNTH_AST } from './astFixture'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** 说明书块 → 全文行（books.description.offset + lines.start） */
const fullLine = (b: { lines: { start: number } }) => SYNTH_AST.books.description.offset + b.lines.start

function Consumer({ self, ready, onFocus }: { self: Focus['source']; ready: boolean; onFocus: (f: Focus) => void }) {
  useFocusConsumer(self, ready, onFocus)
  return null
}

let root: Root | null = null
let host: HTMLElement
function mount(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
}
function unmount() {
  act(() => root?.unmount())
  root = null
  host?.remove()
}

beforeEach(() => {
  useStudio.setState({ focus: null, compareLock: false } as never)
})
afterEach(() => {
  unmount()
  vi.useRealTimers()
})

const set = (f: Omit<Focus, 'seq'>) => act(() => useStudio.getState().setFocus(f))

describe('useFocusConsumer', () => {
  it('收别人发的 Focus；忽略自己发的；同 seq 不重复', () => {
    const got = vi.fn()
    mount(<Consumer self="layout" ready onFocus={got} />)
    set({ book: 'description', blockId: 'description/技术领域/p0001', source: 'source' })
    expect(got).toHaveBeenCalledTimes(1)
    expect(got.mock.calls[0][0]).toMatchObject({ blockId: 'description/技术领域/p0001', source: 'source' })
    set({ book: 'description', blockId: 'description/技术领域/p0002', source: 'layout' })
    expect(got).toHaveBeenCalledTimes(1)
    act(() => root!.render(<Consumer self="layout" ready onFocus={got} />))
    expect(got).toHaveBeenCalledTimes(1)
  })

  it('switchView 保持位置：视图重新挂载时重放最近一次 Focus（即使是自己发的）', () => {
    set({ book: 'claims', blockId: 'claims/2', line: 12, source: 'pdf' })
    const got = vi.fn()
    mount(<Consumer self="pdf" ready onFocus={got} />)
    expect(got).toHaveBeenCalledTimes(1)
    expect(got.mock.calls[0][0]).toMatchObject({ blockId: 'claims/2', line: 12 })
    unmount()
    const again = vi.fn()
    mount(<Consumer self="source" ready onFocus={again} />)
    expect(again).toHaveBeenCalledTimes(1)
    expect(again.mock.calls[0][0]).toMatchObject({ blockId: 'claims/2' })
  })

  it('ready=false（PDF 索引未建）期间不消费；ready 变 true 时重放最近 Focus', () => {
    const got = vi.fn()
    mount(<Consumer self="pdf" ready={false} onFocus={got} />)
    set({ book: 'description', blockId: 'description/技术领域/p0001', source: 'source' })
    expect(got).not.toHaveBeenCalled()
    act(() => root!.render(<Consumer self="pdf" ready onFocus={got} />))
    expect(got).toHaveBeenCalledTimes(1)
    expect(got.mock.calls[0][0]).toMatchObject({ blockId: 'description/技术领域/p0001' })
  })
})

describe('cursorFocusDriver（对照锁）', () => {
  const para = SYNTH_AST.description.find((b) => b.kind === 'paragraph')!
  const paraLine = fullLine(para)

  beforeEach(() => vi.useFakeTimers())

  it('显式动作（点击）立刻广播 Focus{source}', () => {
    const d = cursorFocusDriver('source')
    expect(d.cursor(SYNTH_AST, paraLine, true)).toBe(true)
    expect(useStudio.getState().focus).toMatchObject({ blockId: para.id, source: 'source', line: paraLine })
    d.dispose()
  })

  it('键盘移动：对照锁关 → 不广播；开 → 去抖 150ms 后广播，同块不重发', () => {
    const d = cursorFocusDriver('source')
    expect(d.cursor(SYNTH_AST, paraLine, false)).toBe(false)
    expect(useStudio.getState().focus).toBeNull()

    useStudio.setState({ compareLock: true } as never)
    expect(d.cursor(SYNTH_AST, paraLine, false)).toBe(true)
    expect(useStudio.getState().focus).toBeNull()
    vi.advanceTimersByTime(COMPARE_LOCK_DEBOUNCE_MS - 1)
    expect(useStudio.getState().focus).toBeNull()
    vi.advanceTimersByTime(1)
    expect(useStudio.getState().focus).toMatchObject({ blockId: para.id, source: 'source' })
    const seq = useStudio.getState().focus!.seq

    // 同块内移动：不重发
    expect(d.cursor(SYNTH_AST, paraLine, false)).toBe(false)
    vi.advanceTimersByTime(COMPARE_LOCK_DEBOUNCE_MS)
    expect(useStudio.getState().focus!.seq).toBe(seq)

    // 快速跨两块：只发最后一块
    const paras = SYNTH_AST.description.filter((b) => b.kind === 'paragraph')
    const p2 = paras[1]
    const p3 = paras[2]
    d.cursor(SYNTH_AST, fullLine(p2), false)
    vi.advanceTimersByTime(50)
    d.cursor(SYNTH_AST, fullLine(p3), false)
    vi.advanceTimersByTime(COMPARE_LOCK_DEBOUNCE_MS)
    expect(useStudio.getState().focus).toMatchObject({ blockId: p3.id })
    expect(useStudio.getState().focus!.seq).toBe(seq + 1)
    d.dispose()
  })

  it('被别的视图定位到的块（光标随之落上）不回声广播', () => {
    useStudio.setState({ compareLock: true } as never)
    useStudio.getState().setFocus({ book: 'description', blockId: para.id, source: 'pdf' })
    const d = cursorFocusDriver('source')
    expect(d.cursor(SYNTH_AST, paraLine, false)).toBe(false)
    d.dispose()
  })

  it('block()：版面已知块直接驱动', () => {
    const d = cursorFocusDriver('layout')
    expect(d.block('claims', 'claims/1', undefined, true)).toBe(true)
    expect(useStudio.getState().focus).toMatchObject({ book: 'claims', blockId: 'claims/1', source: 'layout' })
    d.dispose()
  })
})

describe('flash / blockElement', () => {
  it('flash 加类并在时限后移除；blockElement 按 data-block-id（含 / 与中文）查找', () => {
    vi.useFakeTimers()
    const el = document.createElement('div')
    el.dataset.blockId = 'description/技术领域/p0001'
    document.body.appendChild(el)
    expect(blockElement(document.body, 'description/技术领域/p0001')).toBe(el)
    expect(blockElement(document.body, 'nope')).toBeNull()
    flash(el, FOCUS_FLASH_CLASS, 100)
    expect(el.classList.contains(FOCUS_FLASH_CLASS)).toBe(true)
    vi.advanceTimersByTime(100)
    expect(el.classList.contains(FOCUS_FLASH_CLASS)).toBe(false)
    el.remove()
  })
})
