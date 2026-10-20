// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import { useStudio } from '@/store'
import type { Confirmation, PublicComment, PublicShareLink, PublicShareMeta } from '@/types/public-share'
import { GUEST_NAME_KEY } from './publicShare'

const meta: PublicShareMeta = {
  org_name: '明远知识产权',
  title: '一种控制方法',
  case_no: 'MY-2026-018',
  status: 'drafting',
  version: 3,
  sha: 'abc123',
  content_sha: 'd'.repeat(64),
  scope: 'confirm',
  baseline: 'original',
  pending_revisions: 0,
  sub_except: [],
  allow_download: false,
  allow_copy: true,
  allow_comment: true,
  expires_at: null,
  confirmation: null,
  pdf_ready: true,
}

const link: PublicShareLink = {
  token: 'tok-pub-1',
  pid: 'method',
  scope: 'confirm',
  baseline: 'original',
  allow_download: false,
  expires_at: null,
  revoked: false,
  created_by: { id: 'u-owner', display_name: '王所有' },
  created_at: 1_757_000_000,
  visits: 2,
  last_visit_at: 1_757_000_600,
}

const comment: PublicComment = {
  id: 'cm_1',
  anchor: { block_id: 'claims/1', line: 9, quote: '采集运行期指标' },
  body: '「采集」改为「获取」',
  author: { id: null, name: '张客户' },
  created_at: 1_757_001_000,
  updated_at: 1_757_001_000,
  resolved: false,
  replies: [],
  guest: true,
}

const kindError = (status: number, kind: string, msg: string) => new ApiError(status, msg, { kind } as never)

beforeEach(() => {
  localStorage.clear()
  useStudio.getState().resetPublic()
  useStudio.setState({ publicLinks: [], publicLinksUnavailable: false, publicLinksError: null, toasts: [], guestName: '' })
  vi.spyOn(api, 'publicLayoutCss').mockResolvedValue(':root{--ps-font:serif}')
})
afterEach(() => {
  useStudio.getState().resetPublic()
  vi.restoreAllMocks()
})

describe('publicShare · 链接管理（协作者中心）', () => {
  it('loadPublicLinks：拉列表；501 ⇒ publicLinksUnavailable，不 toast', async () => {
    vi.spyOn(api, 'publicLinks').mockResolvedValueOnce([link])
    await useStudio.getState().loadPublicLinks('method')
    expect(useStudio.getState().publicLinks).toEqual([link])
    expect(useStudio.getState().publicLinksLoading).toBe(false)

    vi.spyOn(api, 'publicLinks').mockRejectedValueOnce(new ApiError(501, '尚未实现'))
    await useStudio.getState().loadPublicLinks('method')
    expect(useStudio.getState().publicLinksUnavailable).toBe(true)
    expect(useStudio.getState().toasts).toHaveLength(0)

    vi.spyOn(api, 'publicLinks').mockRejectedValueOnce(new ApiError(500, '服务器开小差'))
    await useStudio.getState().loadPublicLinks('method')
    expect(useStudio.getState().publicLinksError).toBe('服务器开小差')
    expect(useStudio.getState().toasts).toHaveLength(0)
  })

  it('createPublicLink 置顶新链接并返回；revokePublicLink 标记 revoked；普通错误 toast', async () => {
    useStudio.setState({ publicLinks: [link] })
    const fresh = { ...link, token: 'tok-pub-2', scope: 'comment' as const, expires_at: 1_760_000_000 }
    const create = vi.spyOn(api, 'createPublicLink').mockResolvedValue(fresh)
    const got = await useStudio.getState().createPublicLink('method', { scope: 'comment', ttl_days: 7, allow_download: false })
    expect(create).toHaveBeenCalledWith('method', { scope: 'comment', ttl_days: 7, allow_download: false })
    expect(got).toEqual(fresh)
    expect(useStudio.getState().publicLinks.map((l) => l.token)).toEqual(['tok-pub-2', 'tok-pub-1'])

    vi.spyOn(api, 'revokePublicLink').mockResolvedValue(undefined)
    expect(await useStudio.getState().revokePublicLink('method', 'tok-pub-1')).toBe(true)
    expect(useStudio.getState().publicLinks.find((l) => l.token === 'tok-pub-1')?.revoked).toBe(true)

    vi.spyOn(api, 'revokePublicLink').mockRejectedValue(new ApiError(403, '无权限'))
    expect(await useStudio.getState().revokePublicLink('method', 'tok-pub-2')).toBe(false)
    expect(useStudio.getState().toasts.at(-1)?.text).toBe('无权限')
    expect(useStudio.getState().publicLinks.find((l) => l.token === 'tok-pub-2')?.revoked).toBe(false)
  })
})

describe('publicShare · 匿名审阅页', () => {
  it('openPublic：meta → ast / comments / css 并行；默认视图 pdf', async () => {
    vi.spyOn(api, 'publicMeta').mockResolvedValue(meta)
    vi.spyOn(api, 'publicAst').mockResolvedValue(SYNTH_AST)
    vi.spyOn(api, 'publicComments').mockResolvedValue([comment])
    await useStudio.getState().openPublic('tok-pub-1')
    const s = useStudio.getState()
    expect(s.publicToken).toBe('tok-pub-1')
    expect(s.publicMeta).toEqual(meta)
    expect(s.publicAst).toBe(SYNTH_AST)
    expect(s.publicComments).toEqual([comment])
    expect(s.publicCss).toContain('--ps-font')
    expect(s.publicView).toBe('pdf')
    expect(s.publicLoading).toBe(false)
    expect(s.publicExpired).toBe(false)
  })

  it('scope=read 不拉 comments；layout-css 失败降级为 null 不报错', async () => {
    vi.spyOn(api, 'publicMeta').mockResolvedValue({ ...meta, scope: 'read' })
    vi.spyOn(api, 'publicAst').mockResolvedValue(SYNTH_AST)
    const comments = vi.spyOn(api, 'publicComments')
    vi.spyOn(api, 'publicLayoutCss').mockRejectedValue(new ApiError(501, '无'))
    await useStudio.getState().openPublic('tok-pub-1')
    expect(comments).not.toHaveBeenCalled()
    expect(useStudio.getState().publicCss).toBeNull()
    expect(useStudio.getState().publicError).toBeNull()
  })

  it('410 share.expired / share.revoked ⇒ publicExpired；501 ⇒ publicUnavailable；其他 ⇒ publicError', async () => {
    vi.spyOn(api, 'publicMeta').mockRejectedValueOnce(kindError(410, 'share.expired', '审阅链接已过期'))
    await useStudio.getState().openPublic('tok-x')
    expect(useStudio.getState().publicExpired).toBe(true)
    expect(useStudio.getState().publicUnavailable).toBe(false)

    vi.spyOn(api, 'publicMeta').mockRejectedValueOnce(kindError(410, 'share.revoked', '审阅链接已撤销'))
    await useStudio.getState().openPublic('tok-x')
    expect(useStudio.getState().publicExpired).toBe(true)

    vi.spyOn(api, 'publicMeta').mockRejectedValueOnce(new ApiError(501, '尚未实现'))
    await useStudio.getState().openPublic('tok-x')
    expect(useStudio.getState().publicExpired).toBe(false)
    expect(useStudio.getState().publicUnavailable).toBe(true)

    vi.spyOn(api, 'publicMeta').mockRejectedValueOnce(new ApiError(500, '服务器打盹'))
    await useStudio.getState().openPublic('tok-x')
    expect(useStudio.getState().publicUnavailable).toBe(false)
    expect(useStudio.getState().publicInvalid).toBe(false)
    expect(useStudio.getState().publicError).toBe('服务器打盹')
    expect(useStudio.getState().publicMeta).toBeNull()
  })

  it('W7 ux-07：404 not_found ⇒ publicInvalid（链接失效），不算过期 / 不可用 / 通用错误；再次 open 有效 token 清掉', async () => {
    vi.spyOn(api, 'publicMeta').mockRejectedValueOnce(kindError(404, 'not_found', '审阅链接不存在'))
    await useStudio.getState().openPublic('tok-gone')
    const s = useStudio.getState()
    expect(s.publicInvalid).toBe(true)
    expect(s.publicExpired).toBe(false)
    expect(s.publicUnavailable).toBe(false)
    expect(s.publicError).toBe('审阅链接不存在')
    expect(s.publicLoading).toBe(false)
    expect(s.toasts).toHaveLength(0)

    vi.spyOn(api, 'publicMeta').mockResolvedValue(meta)
    vi.spyOn(api, 'publicAst').mockResolvedValue(SYNTH_AST)
    vi.spyOn(api, 'publicComments').mockResolvedValue([])
    await useStudio.getState().openPublic('tok-ok')
    expect(useStudio.getState().publicInvalid).toBe(false)
    expect(useStudio.getState().publicMeta).toEqual(meta)

    // 审阅中链接被删：确认 / 批注 404 ⇒ 也切 publicInvalid，不 toast
    useStudio.getState().setGuestName('张客户')
    vi.spyOn(api, 'publicConfirm').mockRejectedValue(kindError(404, 'not_found', '审阅链接不存在'))
    expect(await useStudio.getState().confirmPublic()).toBe(false)
    expect(useStudio.getState().publicInvalid).toBe(true)
    expect(useStudio.getState().toasts).toHaveLength(0)
  })

  it('W7 qa-10：同 token 并发 openPublic（StrictMode 双效应 / open→reset→open）只发一次 meta；404 也只出现一次', async () => {
    const metaSpy = vi.spyOn(api, 'publicMeta').mockResolvedValue(meta)
    vi.spyOn(api, 'publicAst').mockResolvedValue(SYNTH_AST)
    vi.spyOn(api, 'publicComments').mockResolvedValue([])
    const st = useStudio.getState()
    const p1 = st.openPublic('tok-1')
    st.resetPublic()
    const p2 = st.openPublic('tok-1')
    await Promise.all([p1, p2])
    expect(metaSpy).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().publicToken).toBe('tok-1')
    expect(useStudio.getState().publicMeta).toEqual(meta)
    expect(useStudio.getState().publicLoading).toBe(false)

    // 结算后再 open ⇒ 重新请求（不是永久缓存）
    await useStudio.getState().openPublic('tok-1')
    expect(metaSpy).toHaveBeenCalledTimes(2)

    // reset 后落地的结果不写回（已离开页面）
    useStudio.getState().resetPublic()
    metaSpy.mockClear().mockRejectedValue(kindError(404, 'not_found', '审阅链接不存在'))
    const q1 = useStudio.getState().openPublic('tok-bad')
    const q2 = useStudio.getState().openPublic('tok-bad')
    await Promise.all([q1, q2])
    expect(metaSpy).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().publicInvalid).toBe(true)

    const late = useStudio.getState().openPublic('tok-bad')
    useStudio.getState().resetPublic()
    await late
    expect(useStudio.getState().publicInvalid).toBe(false)
    expect(useStudio.getState().publicToken).toBeNull()
    expect(useStudio.getState().publicLoading).toBe(false)
  })

  it('setGuestName 写 localStorage；addPublicComment 带 guest_name 并追加；confirmPublic 写回 meta.confirmation', async () => {
    vi.spyOn(api, 'publicMeta').mockResolvedValue(meta)
    vi.spyOn(api, 'publicAst').mockResolvedValue(SYNTH_AST)
    vi.spyOn(api, 'publicComments').mockResolvedValue([])
    await useStudio.getState().openPublic('tok-pub-1')

    useStudio.getState().setGuestName('张客户')
    expect(localStorage.getItem(GUEST_NAME_KEY)).toBe('张客户')

    const add = vi.spyOn(api, 'addPublicComment').mockResolvedValue(comment)
    expect(await useStudio.getState().addPublicComment({ anchor: comment.anchor, body: comment.body })).toBe(true)
    expect(add).toHaveBeenCalledWith('tok-pub-1', { anchor: comment.anchor, body: comment.body, guest_name: '张客户' })
    expect(useStudio.getState().publicComments).toEqual([comment])

    const confirmation: Confirmation = { version: 3, sha: 'abc123', content_sha: meta.content_sha, name: '张客户', note: null, confirmed_at: 1_757_002_000 }
    const confirm = vi.spyOn(api, 'publicConfirm').mockResolvedValue(confirmation)
    expect(await useStudio.getState().confirmPublic()).toBe(true)
    expect(confirm).toHaveBeenCalledWith('tok-pub-1', { name: '张客户', note: undefined, expected_version: 3, expected_sha: 'abc123', expected_content_sha: meta.content_sha })
    expect(useStudio.getState().publicMeta?.confirmation).toEqual(confirmation)

    vi.spyOn(api, 'publicConfirm').mockRejectedValue(kindError(410, 'share.expired', '审阅链接已过期'))
    expect(await useStudio.getState().confirmPublic()).toBe(false)
    expect(useStudio.getState().publicExpired).toBe(true)
  })

  it('resetPublic 清空审阅态但保留 guestName', () => {
    useStudio.setState({ publicToken: 't', publicMeta: meta, publicAst: SYNTH_AST, publicView: 'layout', guestName: '张客户' })
    useStudio.getState().resetPublic()
    const s = useStudio.getState()
    expect(s.publicToken).toBeNull()
    expect(s.publicMeta).toBeNull()
    expect(s.publicAst).toBeNull()
    expect(s.publicView).toBe('pdf')
    expect(s.guestName).toBe('张客户')
  })

  it('版本冲突不自动升级到客户没读过的新版本，也不写入确认', async () => {
    useStudio.setState({ publicToken: 't', publicMeta: meta, publicAst: SYNTH_AST, guestName: '张客户' })
    vi.spyOn(api, 'publicConfirm').mockRejectedValue(kindError(409, 'conflict', '审阅版本已更新，请重新打开并阅读后再确认。'))
    expect(await useStudio.getState().confirmPublic()).toBe(false)
    expect(useStudio.getState().publicMeta).toEqual(meta)
    expect(useStudio.getState().publicMeta?.confirmation).toBeNull()
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('重新打开并阅读')
  })
})
