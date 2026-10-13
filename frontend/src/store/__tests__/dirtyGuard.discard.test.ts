// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'

/**
 * W12-B1-R1：COLLAB=off 时「放弃修改」后回面板再开同一案，openProject 同 pid 早退不重新拉正文，
 * 被放弃的编辑会原样留在 content 里并再次显示「未保存」——放弃必须把 content 回到 saved。
 */
const initial = useStudio.getInitialState()

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(min-width: 1280px)' || q === '(min-width: 1024px)' }) as MediaQueryList)
  useStudio.setState({ ...initial, pid: 'method', collabStatus: 'off', saved: '# a', content: '# a\n新增', contentEditedAt: 123 }, false)
})

describe('DirtyGuard 放弃修改', () => {
  it('脏时 requestNavigation 进守卫；discard ⇒ content 回到 saved 且执行导航', async () => {
    let ran = 0
    const s = useStudio.getState()
    s.requestNavigation({ type: 'custom', label: '测试', run: async () => { ran++ } })
    expect(useStudio.getState().dirtyGuard.pending).not.toBeNull()
    expect(useStudio.getState().content).toBe('# a\n新增')

    await useStudio.getState().resolveNavigation('discard')
    const after = useStudio.getState()
    expect(after.dirtyGuard.pending).toBeNull()
    expect(after.content).toBe('# a')
    expect(after.contentEditedAt).toBe(0)
    expect(ran).toBe(1)
  })

  it('cancel 保留编辑、不导航', async () => {
    let ran = 0
    useStudio.getState().requestNavigation({ type: 'custom', label: '测试', run: async () => { ran++ } })
    await useStudio.getState().resolveNavigation('cancel')
    expect(useStudio.getState().content).toBe('# a\n新增')
    expect(ran).toBe(0)
  })

  it('协同在线（房间落盘）不进守卫：直接导航、content 不动', () => {
    useStudio.setState({ collabStatus: 'connected' })
    let ran = 0
    useStudio.getState().requestNavigation({ type: 'custom', label: '测试', run: async () => { ran++ } })
    expect(useStudio.getState().dirtyGuard.pending).toBeNull()
    expect(ran).toBe(1)
  })
})
