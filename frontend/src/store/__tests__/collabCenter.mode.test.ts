// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import type { ProjectDetail, Role } from '@/lib/types'
import { selectEditorMode, useStudio } from '@/store'
import { modeStorageKey, readEditorMode, writeEditorMode } from '@/store/collabCenter'

/**
 * W9 审阅 bug 前端侧：editorMode 按案子持久化到 localStorage `ps:mode:<pid>`；reviewer 固定 review；readonly 不持久化；
 * 切案 / 刷新（openProject → resetCollabCenter）后恢复该案的可编辑模式。
 */
const initial = useStudio.getInitialState()
const detail = (id: string, role: Role | null): ProjectDetail =>
  ({ id, title: id, role, settings: null, figs: [], backups: [], content: '# a\n' }) as unknown as ProjectDetail

beforeEach(() => {
  localStorage.clear()
  useStudio.setState({ ...initial }, false)
  vi.spyOn(api, 'projects').mockResolvedValue([])
  vi.spyOn(api, 'members').mockResolvedValue([])
  vi.spyOn(api, 'shareLinks').mockResolvedValue([])
  vi.spyOn(api, 'invites').mockRejectedValue(new ApiError(501, 'x'))
  vi.spyOn(api, 'access').mockRejectedValue(new ApiError(501, 'x'))
  vi.spyOn(api, 'collabSettings').mockRejectedValue(new ApiError(501, 'x'))
  vi.spyOn(api, 'project').mockImplementation(async (id) => detail(id, 'editor'))
})
afterEach(() => vi.restoreAllMocks())

describe('editorMode 持久化', () => {
  it('setEditorMode 写 ps:mode:<pid>；readonly 不写；无 pid 不写', () => {
    useStudio.setState({ pid: 'method' })
    useStudio.getState().setEditorMode('review')
    expect(localStorage.getItem(modeStorageKey('method'))).toBe('review')
    useStudio.getState().setEditorMode('readonly')
    expect(localStorage.getItem(modeStorageKey('method'))).toBe('review')
    useStudio.getState().setEditorMode('edit')
    expect(localStorage.getItem(modeStorageKey('method'))).toBe('edit')
    useStudio.setState({ pid: null })
    useStudio.getState().setEditorMode('review')
    expect(localStorage.getItem('ps:mode:null')).toBeNull()
    expect(readEditorMode(null)).toBe('edit')
    expect(readEditorMode('nope')).toBe('edit')
    writeEditorMode('x', 'readonly')
    expect(localStorage.getItem(modeStorageKey('x'))).toBeNull()
  })

  it('切案：method=review、system=edit 各自恢复；刷新（同 pid 重开）也恢复', async () => {
    localStorage.setItem(modeStorageKey('method'), 'review')
    await useStudio.getState().openProject('method')
    expect(useStudio.getState().editorMode).toBe('review')
    expect(selectEditorMode(useStudio.getState())).toBe('review')

    await useStudio.getState().openProject('system')
    expect(useStudio.getState().editorMode).toBe('edit')
    useStudio.getState().setEditorMode('review')
    useStudio.getState().setEditorMode('edit')
    expect(localStorage.getItem(modeStorageKey('system'))).toBe('edit')

    await useStudio.getState().openProject('method')
    expect(useStudio.getState().editorMode).toBe('review')

    useStudio.setState({ ...initial }, false)
    await useStudio.getState().openProject('method')
    expect(useStudio.getState().editorMode).toBe('review')
  })

  it('reviewer 固定 review（不受存储影响）；viewer / 协同只读 ⇒ readonly 且不覆盖存储', async () => {
    localStorage.setItem(modeStorageKey('method'), 'edit')
    vi.spyOn(api, 'project').mockImplementation(async (id) => detail(id, 'reviewer'))
    await useStudio.getState().openProject('method')
    expect(selectEditorMode(useStudio.getState())).toBe('review')
    expect(localStorage.getItem(modeStorageKey('method'))).toBe('edit')

    useStudio.setState({ project: detail('method', 'editor'), collabReadonly: true })
    expect(selectEditorMode(useStudio.getState())).toBe('readonly')
    useStudio.getState().setEditorMode('readonly')
    expect(localStorage.getItem(modeStorageKey('method'))).toBe('edit')
    useStudio.setState({ collabReadonly: false })
    expect(selectEditorMode(useStudio.getState())).toBe('readonly')
    useStudio.getState().resetCollabCenter()
    expect(selectEditorMode(useStudio.getState())).toBe('edit')
  })
})
