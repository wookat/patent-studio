// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { CriticMark } from '@/lib/types'
import { useStudio } from '@/store'
import { markIntact, shiftMarks } from '../review'

/**
 * W7 qa-01：后端 /critic 回来之前连续「接受插入 → 拒绝删除」同一行两条标记，第二次必须按平移后的列切，
 * 不能把正文切成 `QA7-INSERT-002 {--QA7QA7-KEEP-002`。
 */
const LINE = '{++QA7-INSERT-002++} {--QA7-KEEP-002--} 尾巴'
const ins: CriticMark = {
  id: '1:0', kind: 'ins', line: 1, from: 0, to: '{++QA7-INSERT-002++}'.length, a: '', b: 'QA7-INSERT-002',
  final: 'QA7-INSERT-002', original: '',
}
const delFrom = LINE.indexOf('{--')
const del: CriticMark = {
  id: `1:${delFrom}`, kind: 'del', line: 1, from: delFrom, to: delFrom + '{--QA7-KEEP-002--}'.length,
  a: 'QA7-KEEP-002', b: '', final: '', original: 'QA7-KEEP-002',
}

describe('shiftMarks / markIntact', () => {
  it('接受左侧插入后，右侧删除标记列偏移左移 6（去掉 {++ ++}）', () => {
    const [moved] = shiftMarks([del], [ins], 'final')
    expect(moved.from).toBe(del.from - 6)
    expect(moved.to).toBe(del.to - 6)
    expect(moved.id).toBe(del.id)
    expect(markIntact('QA7-INSERT-002 {--QA7-KEEP-002--} 尾巴', moved)).toBe(true)
  })

  it('拒绝左侧插入（整段删掉）后右侧标记左移 to-from；不同行不动；相交的丢弃', () => {
    const [moved] = shiftMarks([del], [ins], 'original')
    expect(moved.from).toBe(del.from - ins.to)
    const other: CriticMark = { ...del, id: '2:0', line: 2 }
    expect(shiftMarks([other], [ins], 'final')[0]).toBe(other)
    const overlap: CriticMark = { ...del, id: '1:3', from: 3, to: 30 }
    expect(shiftMarks([overlap], [ins], 'final')).toEqual([])
  })

  it('markIntact：列对得上才算完整；正文被改过就 false', () => {
    expect(markIntact(LINE, ins)).toBe(true)
    expect(markIntact(LINE, del)).toBe(true)
    expect(markIntact('X' + LINE, del)).toBe(false)
    expect(markIntact('', del)).toBe(false)
  })
})

describe('store：/critic 未返回时快速 accept(ins) → reject(del)', () => {
  const initial = useStudio.getInitialState()
  const content = `${LINE}\n第二行`

  beforeEach(() => {
    vi.useFakeTimers()
    useStudio.setState({ ...initial, pid: 'method', content, saved: content, marks: [ins, del] }, false)
    vi.spyOn(api, 'critic').mockImplementation(() => new Promise(() => {})) // 永不返回：模拟慢往返
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('两次操作后正文收敛为 `QA7-INSERT-002 QA7-KEEP-002 尾巴`，marks 清空', () => {
    const s = useStudio.getState()
    s.acceptMark(ins.id)
    expect(useStudio.getState().content.split('\n')[0]).toBe('QA7-INSERT-002 {--QA7-KEEP-002--} 尾巴')
    expect(useStudio.getState().marks.map((m) => [m.from, m.to])).toEqual([[del.from - 6, del.to - 6]])
    useStudio.getState().rejectMark(del.id)
    expect(useStudio.getState().content).toBe('QA7-INSERT-002 QA7-KEEP-002 尾巴\n第二行')
    expect(useStudio.getState().marks).toEqual([])
  })

  it('反向：先拒绝删除再接受插入同样收敛', () => {
    useStudio.getState().rejectMark(del.id)
    useStudio.getState().acceptMark(ins.id)
    expect(useStudio.getState().content).toBe('QA7-INSERT-002 QA7-KEEP-002 尾巴\n第二行')
  })

  it('正文已被别处改动（mark 列对不上）：不切错，丢弃并立刻重取 /critic', () => {
    useStudio.setState({ content: `改了 ${LINE}\n第二行` })
    useStudio.getState().acceptMark(ins.id)
    expect(useStudio.getState().content).toBe(`改了 ${LINE}\n第二行`)
    expect(useStudio.getState().marks.map((m) => m.id)).toEqual([del.id])
    expect(api.critic).toHaveBeenCalledTimes(1)
  })

  it('往返期间正文又变了：过期的 /critic 结果不落地', async () => {
    vi.restoreAllMocks()
    let resolve!: (v: { marks: CriticMark[] }) => void
    vi.spyOn(api, 'critic').mockImplementation(() => new Promise((r) => { resolve = r }))
    const p = useStudio.getState().loadMarks('method')
    useStudio.getState().setContent('别的正文 {++x++}')
    resolve({ marks: [ins] })
    expect(await p).toBeNull()
    expect(useStudio.getState().marks).toEqual([ins, del])
  })
})
