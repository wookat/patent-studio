// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import type { ProjectDetail } from '@/lib/types'
import type { Notification } from '@/types/notify'
import { useStudio } from '@/store'

const notif = (id: string, pid = 'method'): Notification => ({
  id,
  kind: 'system',
  title: '成员变更',
  body: '',
  href: '#/p/method',
  pid,
  actor: null,
  read: false,
  created_at: 1,
})

const project = (role: ProjectDetail['role']): ProjectDetail => ({
  id: 'method',
  title: '方法',
  mtime: 1,
  role,
  figs: [],
  settings: {} as ProjectDetail['settings'],
  has_settings_file: false,
  content: '',
  backups: [],
})

afterEach(() => {
  vi.restoreAllMocks()
  useStudio.setState({ notifications: [], dashUnread: [], unreadNotifications: [], project: null, pid: null })
})

describe('R61-01 成员变更通知 → 当前案 project 元重取（role 收口）', () => {
  it('当前案出现新通知 → refreshProjectMeta 拉新 role', async () => {
    useStudio.setState({ pid: 'method', project: project('reviewer'), notifications: [notif('n1')] })
    vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('n2'), notif('n1')], unread: 1, has_more: false })
    const proj = vi.spyOn(api, 'project').mockResolvedValue(project('viewer'))
    await useStudio.getState().loadNotifications()
    expect(proj).toHaveBeenCalledWith('method')
    expect(useStudio.getState().project?.role).toBe('viewer')
  })

  it('首次灌入（prev 为空）与无新条目不重取', async () => {
    useStudio.setState({ pid: 'method', project: project('reviewer'), notifications: [] })
    const proj = vi.spyOn(api, 'project')
    vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('n2')], unread: 1, has_more: false })
    await useStudio.getState().loadNotifications()
    expect(proj).not.toHaveBeenCalled()

    vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('n2')], unread: 0, has_more: false })
    await useStudio.getState().loadNotifications()
    expect(proj).not.toHaveBeenCalled()
  })

  it('他案新通知不重取当前案', async () => {
    useStudio.setState({ pid: 'method', project: project('reviewer'), notifications: [notif('n1')] })
    const proj = vi.spyOn(api, 'project')
    vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('n2', 'system-x'), notif('n1')], unread: 1, has_more: false })
    await useStudio.getState().loadNotifications()
    expect(proj).not.toHaveBeenCalled()
  })

  it('重取撞上 403（已被移出）→ 清 project 走错误态，不留旧 role affordance', async () => {
    useStudio.setState({ pid: 'method', project: project('editor'), notifications: [notif('n1')] })
    vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('n2'), notif('n1')], unread: 1, has_more: false })
    vi.spyOn(api, 'project').mockRejectedValue(new ApiError(403, '无权限', { kind: 'forbidden', message: '无权限', line: null, detail: null }))
    await useStudio.getState().loadNotifications()
    await vi.waitFor(() => expect(useStudio.getState().project).toBeNull())
    expect(useStudio.getState().projectError).toContain('无权限')
  })
})

describe('R115-批21 通知翻页（before_id 游标）', () => {
  it('loadMoreNotifications：before_id=末位 id，追加去重，has_more 回写', async () => {
    useStudio.setState({ notifications: [notif('n1'), notif('n2')], notifyHasMore: true })
    const spy = vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('n2'), notif('n3')], unread: 2, has_more: false })
    await useStudio.getState().loadMoreNotifications()
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ before_id: 'n2' }))
    expect(useStudio.getState().notifications.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    expect(useStudio.getState().notifyHasMore).toBe(false)
    expect(useStudio.getState().notifyMoreLoading).toBe(false)
  })

  it('空列表不发请求；失败落 notifyError', async () => {
    useStudio.setState({ notifications: [] })
    const spy = vi.spyOn(api, 'notifications').mockResolvedValue({ items: [], unread: 0, has_more: false })
    await useStudio.getState().loadMoreNotifications()
    expect(spy).not.toHaveBeenCalled()
    useStudio.setState({ notifications: [notif('n1')] })
    vi.spyOn(api, 'notifications').mockRejectedValue(new Error('boom'))
    await useStudio.getState().loadMoreNotifications()
    expect(useStudio.getState().notifyError).toBe('boom')
    expect(useStudio.getState().notifications).toHaveLength(1)
  })

  it('轮询刷第一页时保留已翻到的尾页（同 id 换新数据）', async () => {
    useStudio.setState({ notifications: [notif('n1'), notif('n2'), notif('n3')] })
    vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('n0'), { ...notif('n1'), title: '新标题' }], unread: 0, has_more: true })
    await useStudio.getState().loadNotifications()
    const ids = useStudio.getState().notifications.map((n) => n.id)
    expect(ids).toEqual(['n0', 'n1', 'n2', 'n3'])
    expect(useStudio.getState().notifications[1].title).toBe('新标题')
  })

  it('R115-批32：loadDashUnread 进 dashUnread 分仓——不污染收件箱有序列表与游标', async () => {
    /* 仪表盘 unread:200 并入 notifications 会把老未读塞尾部，loadMore 的 at(-1) 跳过整段区间 */
    useStudio.setState({ notifications: [notif('m1'), notif('m2'), notif('m3')], notifyHasMore: true })
    const spy = vi.spyOn(api, 'notifications').mockResolvedValue({ items: [notif('u1'), notif('u2')], unread: 2, has_more: false })
    await useStudio.getState().loadDashUnread()
    expect(spy).toHaveBeenCalledWith({ unread: true, limit: 200 })
    const s = useStudio.getState()
    expect(s.dashUnread.map((n) => n.id)).toEqual(['u1', 'u2'])
    expect(s.unreadCount).toBe(2)
    expect(s.notifications.map((n) => n.id)).toEqual(['m1', 'm2', 'm3'])
    expect(s.notifyHasMore).toBe(true)
  })

  it('R115-批32：markRead / markAllRead 同步 dashUnread / unreadNotifications', async () => {
    useStudio.setState({ notifications: [notif('n1')], dashUnread: [notif('u1'), notif('u2')], unreadNotifications: [notif('u1')], unreadCount: 2 })
    vi.spyOn(api, 'readNotification').mockResolvedValue({ ...notif('u1'), read: true })
    await useStudio.getState().markRead('u1')
    expect(useStudio.getState().dashUnread.map((n) => n.id)).toEqual(['u2'])
    expect(useStudio.getState().unreadNotifications).toEqual([])
    vi.spyOn(api, 'readAllNotifications').mockResolvedValue({ updated: 2 })
    await useStudio.getState().markAllRead()
    expect(useStudio.getState().dashUnread).toEqual([])
    expect(useStudio.getState().notifications[0].read).toBe(true)
  })

  it('R115-批33：未读流独立仓——loadUnread/loadMoreUnread 不触 all 流', async () => {
    /* 批32 同族第二站：未读翻页曾并入 all 流尾部，切回全部后 at(-1) 游标跳区间 */
    useStudio.setState({ notifications: [notif('m1'), notif('m2')], notifyHasMore: true })
    const spy = vi.spyOn(api, 'notifications')
      .mockResolvedValueOnce({ items: [notif('u1'), notif('u2')], unread: 2, has_more: true })
      .mockResolvedValueOnce({ items: [notif('u2'), notif('u3')], unread: 3, has_more: false })
    await useStudio.getState().loadUnreadNotifications()
    expect(spy).toHaveBeenNthCalledWith(1, { unread: true, limit: 100 })
    let s = useStudio.getState()
    expect(s.unreadNotifications.map((n) => n.id)).toEqual(['u1', 'u2'])
    expect(s.unreadHasMore).toBe(true)
    expect(s.notifications.map((n) => n.id)).toEqual(['m1', 'm2'])
    await useStudio.getState().loadMoreUnread()
    expect(spy).toHaveBeenNthCalledWith(2, expect.objectContaining({ before_id: 'u2', unread: true }))
    s = useStudio.getState()
    expect(s.unreadNotifications.map((n) => n.id)).toEqual(['u1', 'u2', 'u3'])
    expect(s.unreadHasMore).toBe(false)
    expect(s.unreadCount).toBe(3)
    expect(s.notifications.map((n) => n.id)).toEqual(['m1', 'm2'])
  })
})
