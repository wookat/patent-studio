// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_MS, createPdfGestures, type GestureCallbacks } from '../gestures'

/**
 * PDF 文字层四手势（21 §5.3 / R-MOB-05）：单击 / 拖选 / 双击（dblclick 事件，见 pdfFocus.test）/ 触控长按 500ms。
 * 直接驱动纯函数对象，不依赖 React 事件系统。
 */
function setup(selText = '') {
  const cb: GestureCallbacks = { click: vi.fn(), select: vi.fn(), longPress: vi.fn() }
  const target = document.createElement('span')
  document.body.appendChild(target)
  const sel = selText
    ? ({ toString: () => selText, isCollapsed: false, anchorNode: target } as unknown as Selection)
    : ({ toString: () => '', isCollapsed: true, anchorNode: null } as unknown as Selection)
  const g = createPdfGestures(cb, { getSelection: () => sel })
  const at = (x: number, y: number, pointerType = 'mouse') => ({ clientX: x, clientY: y, pointerType, target })
  return { cb, g, target, at }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('createPdfGestures', () => {
  it('单击：按下抬起未移动、无选区 → click(target, x, y)，不消费 click 事件', () => {
    const { cb, g, target, at } = setup()
    g.down(at(10, 10))
    g.up(at(11, 12))
    expect(cb.click).toHaveBeenCalledWith(target, 11, 12)
    expect(cb.select).not.toHaveBeenCalled()
    expect(g.consumed()).toBe(false)
  })

  it('拖动超过 8px 且无选区 → 既不是单击也不是拖选', () => {
    const { cb, g, at } = setup()
    g.down(at(10, 10))
    g.move(at(30, 10))
    g.up(at(30, 10))
    expect(cb.click).not.toHaveBeenCalled()
    expect(cb.select).not.toHaveBeenCalled()
    expect(g.consumed()).toBe(true)
  })

  it('拖选：抬起时存在非空 Selection → select(sel, anchor, x, y)，并标记已消费', () => {
    const { cb, g, target, at } = setup('所述漂移分数按滑窗计算')
    g.down(at(10, 10))
    g.move(at(80, 10))
    g.up(at(80, 12))
    expect(cb.select).toHaveBeenCalledTimes(1)
    const [sel, anchor, x, y] = (cb.select as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(sel.toString()).toBe('所述漂移分数按滑窗计算')
    expect(anchor).toBe(target)
    expect([x, y]).toEqual([80, 12])
    expect(cb.click).not.toHaveBeenCalled()
    expect(g.consumed()).toBe(true)
  })

  it('触控长按 500ms 不动 → longPress，随后抬起不再触发单击', () => {
    const { cb, g, target, at } = setup()
    g.down(at(10, 10, 'touch'))
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(cb.longPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb.longPress).toHaveBeenCalledWith(target, 10, 10)
    expect(g.consumed()).toBe(true)
    g.up(at(10, 10, 'touch'))
    expect(cb.click).not.toHaveBeenCalled()
  })

  it('触控按下后移动 / 提前抬起 → 取消长按；鼠标按下永不长按', () => {
    const a = setup()
    a.g.down(a.at(10, 10, 'touch'))
    a.g.move(a.at(40, 10, 'touch'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(a.cb.longPress).not.toHaveBeenCalled()

    const b = setup()
    b.g.down(b.at(10, 10, 'touch'))
    vi.advanceTimersByTime(200)
    b.g.up(b.at(10, 10, 'touch'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(b.cb.longPress).not.toHaveBeenCalled()
    expect(b.cb.click).toHaveBeenCalledTimes(1)

    const c = setup()
    c.g.down(c.at(10, 10, 'mouse'))
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    expect(c.cb.longPress).not.toHaveBeenCalled()
  })

  it('cancel / dispose 清掉定时器', () => {
    const { cb, g, at } = setup()
    g.down(at(10, 10, 'touch'))
    g.cancel()
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(cb.longPress).not.toHaveBeenCalled()
    g.down(at(10, 10, 'touch'))
    g.dispose()
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(cb.longPress).not.toHaveBeenCalled()
  })
})
