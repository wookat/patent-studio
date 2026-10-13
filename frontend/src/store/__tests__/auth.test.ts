// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { ProjectDetail, User } from '@/lib/types'
import { useStudio } from '@/store'

const user = (id: string, role: ProjectDetail['role']): { u: User; p: ProjectDetail } => ({
  u: { id, email: `${id}@x.test`, display_name: id, is_superuser: false },
  p: {
    id: 'method',
    title: '方法',
    mtime: 1,
    role,
    figs: [],
    settings: {} as ProjectDetail['settings'],
    has_settings_file: false,
    content: `# ${id}\n`,
    backups: [],
  },
})

afterEach(() => {
  vi.restoreAllMocks()
  useStudio.getState().closeWorkspace()
})

describe('auth · logout 清工作区', () => {
  it('登出后 pid/project/content 清空，同 pid 再登录会重新拉详情并拿到新用户的角色 / 内容', async () => {
    const a = user('alice', 'owner')
    const b = user('bob', 'viewer')
    vi.spyOn(api, 'project').mockResolvedValueOnce(a.p).mockResolvedValueOnce(b.p)
    vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    useStudio.setState({ user: a.u, authStatus: 'authed' })
    await useStudio.getState().openProject('method')
    expect(useStudio.getState().project?.role).toBe('owner')
    expect(useStudio.getState().content).toBe('# alice\n')
    useStudio.getState().setPageInfo({ page: 3, total: 22 })

    await useStudio.getState().logout()
    const s = useStudio.getState()
    expect(s.authStatus).toBe('anon')
    expect(s.user).toBeNull()
    expect(s.pid).toBeNull()
    expect(s.project).toBeNull()
    expect(s.content).toBe('')
    expect(s.projects).toEqual([])
    expect(s.pageInfo).toBeNull()

    useStudio.setState({ user: b.u, authStatus: 'authed' })
    await useStudio.getState().openProject('method')
    expect(api.project).toHaveBeenCalledTimes(2)
    expect(useStudio.getState().project?.role).toBe('viewer')
    expect(useStudio.getState().content).toBe('# bob\n')
  })
})

describe('R115-批25 · 会话边界清场', () => {
  it('logout 清空账号/机构面：通知、PAT、期限、台账表、标签、机构设置/审计', async () => {
    vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    useStudio.setState({
      user: { id: 'u1', email: 'a@x', display_name: 'A', role: 'owner' } as never,
      authStatus: 'authed',
      notifications: [{ id: 'n1' } as never], unreadCount: 3, notifyHasMore: true,
      pats: [{ id: 'p1' } as never], newPat: { token: 'x' } as never,
      templates: [{ id: 't1' } as never], tags: [{ id: 'g1' } as never], dashSelected: ['m1'],
      dashStatuses: ['pending'] as never, dashTags: ['发明'], dashOwners: ['u2'], dashFocus: 'due' as never,
      dashQuery: '张三', dashScope: 'mine' as never, caseFormPid: 'm1', caseFormField: 'case_no',
      orgSettings: { require_approval: true } as never,
      orgAiUsage: { rows: [{}] } as never, orgHolidays: 'ok' as never,
      deadlines: [{ id: 'd1' } as never],
    })

    await useStudio.getState().logout()
    const s = useStudio.getState()
    expect(s.deadlines).toEqual([])
    expect(s.notifications).toEqual([])
    expect(s.unreadCount).toBe(0)
    expect(s.notifyHasMore).toBe(false)
    expect(s.pats).toEqual([])
    expect(s.newPat).toBeNull()
    expect(s.templates).toEqual([])
    expect(s.tags).toEqual([])
    expect(s.dashSelected).toEqual([])
    // R115-批27：dash 筛选/范围/未决表单属账号域，同机换号不得继承
    expect(s.dashStatuses).toEqual([])
    expect(s.dashTags).toEqual([])
    expect(s.dashOwners).toEqual([])
    expect(s.dashFocus).toBeNull()
    expect(s.dashQuery).toBe('')
    expect(s.dashScope).toBe('all')
    expect(s.caseFormPid).toBeNull()
    expect(s.caseFormField).toBeNull()
    expect(s.orgSettings).toBeNull()
    expect(s.orgAiUsage).toBeNull()
    expect(s.orgHolidays).toBe('unknown')
  })

  it('expireSession 同样清账号面且额外清 projects；工作区 pid/content 保留以便 returnPid', () => {
    useStudio.setState({
      user: { id: 'u1' } as never,
      authStatus: 'authed',
      pid: 'method', content: '# 未保存工作', project: { id: 'method' } as never,
      projects: [{ id: 'm1', title: '甲案' } as never], tags: [{ id: 'g1' } as never],
      notifications: [{ id: 'n1' } as never], unreadCount: 2,
    })
    useStudio.getState().expireSession()
    const s = useStudio.getState()
    expect(s.authStatus).toBe('anon')
    expect(s.pid).toBe('method')          // workspace 保留
    expect(s.content).toBe('# 未保存工作')
    expect(s.projects).toEqual([])        // ⌘K/登录页不露上一账号案名
    expect(s.tags).toEqual([])
    expect(s.notifications).toEqual([])
    expect(s.members).toEqual([])
  })

  it('closeWorkspace 清案域 MCP 审计；账号域 pats 保留', () => {
    useStudio.setState({
      pid: 'method',
      pats: [{ id: 'p1' } as never],
    })
    useStudio.getState().closeWorkspace()
    const s = useStudio.getState()
    expect(s.pats).toEqual([{ id: 'p1' }])
  })
})
