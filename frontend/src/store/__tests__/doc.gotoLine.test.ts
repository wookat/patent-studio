// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import type { DockHandle } from '@/store/layout'

/**
 * R48-01：gotoLine 先激活/打开「能消费该行的卡」再发 scrollRequest——否则命中行落在
 * 未激活（未挂载）的书卡上时请求永远 pending，点击静默无效。
 */
const DOC = '# 题\n\n## 摘要\nA1\n\n## 权利要求书\n1. C1\n2. C2\n\n## 说明书\nD1\nD2\n'
// 行布局：## 摘要=3 · A1=4 · ## 权利要求书=6 · 1.C1=7 · 2.C2=8 · ## 说明书=10 · D1=11/12

afterEach(() => {
  useStudio.setState({ dockHandle: null, scrollRequest: null, content: '', mobileTab: 'edit' })
})

function fakeDock(open: string[] = []) {
  const openPanel = vi.fn()
  const handle = { openPanel, panelIds: () => open, isPanelVisible: () => false } as unknown as DockHandle
  useStudio.setState({ dockHandle: handle })
  return openPanel
}

describe('gotoLine 先激活目标书卡（R48-01）', () => {
  it('命中权利要求书行 → openPanel("source:claims") + 发 scrollRequest', () => {
    const openPanel = fakeDock(['source:abstract', 'source:claims', 'source:description'])
    useStudio.setState({ content: DOC })
    useStudio.getState().gotoLine(7)
    expect(openPanel).toHaveBeenCalledWith('source:claims', undefined)
    expect(useStudio.getState().scrollRequest?.line).toBe(7)
  })

  it('命中说明书行 → source:description；头部行（不属于任何书）→ source:all 兜底', () => {
    const openPanel = fakeDock([])
    useStudio.setState({ content: DOC })
    useStudio.getState().gotoLine(11)
    expect(openPanel).toHaveBeenLastCalledWith('source:description', undefined)
    useStudio.getState().gotoLine(1)
    expect(openPanel).toHaveBeenLastCalledWith('source:all', undefined)
  })

  it('无 dock（移动壳 / 未挂载）：不开卡只发请求', () => {
    useStudio.setState({ content: DOC, dockHandle: null })
    useStudio.getState().gotoLine(7)
    expect(useStudio.getState().scrollRequest?.line).toBe(7)
  })
})
