// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'

/**
 * R62-01：custom 导航动作的 run() 失败（如 viewer 点「恢复此版本」→ 403）此前是裸 unhandled rejection，
 * 零 UI 反馈。runNavigation 统一 catch → toast error。
 */
const initial = useStudio.getInitialState()

beforeEach(() => {
  useStudio.setState({ ...initial, pid: 'method', collabStatus: 'off', saved: '# a', content: '# a' }, false)
})

describe('runNavigation custom 失败兜底', () => {
  it('run() 抛错 → toast error，不裸抛', async () => {
    useStudio.getState().requestNavigation({
      type: 'custom',
      label: '恢复版本 abc1234',
      run: async () => { throw new Error('无权限') },
    })
    await vi.waitFor(() => expect(useStudio.getState().toasts.length).toBe(1))
    const t = useStudio.getState().toasts[0]
    expect(t.kind).toBe('error')
    expect(t.text).toContain('恢复版本 abc1234')
    expect(t.text).toContain('无权限')
  })

  it('run() 成功 → 无 toast', async () => {
    let ran = 0
    useStudio.getState().requestNavigation({ type: 'custom', label: '测试', run: async () => { ran++ } })
    await vi.waitFor(() => expect(ran).toBe(1))
    expect(useStudio.getState().toasts.length).toBe(0)
  })
})
