// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '@/components/ai/AiPanel'
import { MembersSection } from '@/components/collab-center/MembersSection'
import { BookSwitcher } from '../BookSwitcher'
import { MobilePreview } from '../MobilePreview'
import { MobileTopBar } from '../MobileTopBar'
import { NavDrawer } from '../NavDrawer'
import { PdfLongPressSheet } from '../PdfLongPressSheet'
import { CheckPanel } from '@/components/problems/CheckPanel'
import { ReviewBody } from '@/components/review/ReviewBody'
import { TreeRow } from '@/components/outline/TreeRow'
import { useStudio } from '@/store'
import type { Member, ProjectDetail } from '@/lib/types'

vi.mock('@/components/preview/PdfPreview', () => ({ PdfPreview: () => <div data-testid="pdf-preview" /> }))
vi.mock('@/components/layout-view', () => ({ LayoutView: () => <div data-testid="layout-view" /> }))

/**
 * W8-mobile 单元 workbench-sheets（06-w8 §3 / §5）：class / size 断言。
 * 触控密度下视觉分档：xs 28 / sm 32 / md 36 / lg 44；<44 的可点控件带 touch-hit（::after 命中 ≥44）。
 * 间距只用 8pt token 工具类（px-page-m / gap-group-m / p-card-m / px-sheet-m / pt-sheet-top-m / gap-section-m）。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = false

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  window.matchMedia = (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  desktop = false
  useStudio.setState({
    pid: 'p1',
    project: { id: 'p1', name: '一种方法', role: 'owner' } as unknown as ProjectDetail,
    mobileTab: 'edit',
    activeBook: 'claims',
    agentTab: 'chat',
    companion: null,
    mobileNav: { open: true, tab: 'outline' },
    mobilePreviewKind: 'pdf',
    pdfLongPress: null,
    commentDraft: null,
    replyBodies: {},
    // 复核10：authed+无 caseContext → 核验中门禁；本地文件模式 ctx 显式放行
    caseContext: { pid: 'p1', case_no: null, binding: 'unavailable', case_id: null, organization: null, file_role: 'owner', auth: 'off', capabilities: ['content_write'], content_sha: 'a'.repeat(64), revision: null, ai_enabled: true },
  } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  host.dataset.density = 'touch'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}
const q = <T extends HTMLElement = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)
const all = (sel: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(sel))
const expectCompactHit = (el: HTMLElement | null, tier: 'sm' | 'md') => {
  expect(el).not.toBeNull()
  expect(el!.className).toMatch(new RegExp(`\\b(h|size)-${tier}-control\\b`))
  expect(el!.className).toContain('touch-hit')
  expect(el!.className).not.toMatch(/\b(h|size)-touch\b/)
}

describe('工作台移动壳', () => {
  it('顶栏 44（h-mobile-topbar）页边 16 gap 8；‹ 与 ≡ 之间凑到 12（ml-1，两枚 sm 钮的 44 热区不重叠，docs/plan/28）；返回 / 导航 sm、构建 md，均 touch-hit', async () => {
    const el = await mount(<MobileTopBar />)
    const bar = q('[data-testid="header"]', el)!
    expect(bar.className).toContain('h-mobile-topbar')
    expect(bar.className).toContain('px-page-m')
    expect(bar.className).toContain('gap-group-m')
    expect(q('[data-testid="open-nav"]', el)!.className).toMatch(/(^|\s)ml-1(\s|$)/)
    expect(q('[data-testid="back-to-dashboard"]', el)!.className).not.toMatch(/(^|\s)m[lr]-/)
    expectCompactHit(q('[data-testid="back-to-dashboard"]', el), 'sm')
    expectCompactHit(q('[data-testid="open-nav"]', el), 'sm')
    expectCompactHit(q('[data-testid="mobile-build"]', el), 'md')
    // 未登录：无 👥，构建不需额外间隙
    expect(q('[data-testid="mobile-collab"]', el)).toBeNull()
    expect(q('[data-testid="mobile-build"]', el)!.className).not.toMatch(/(^|\s)ml-/)
    // 登录：👥（sm）↔ 构建（md）需 10 = 8 + ml-0.5
    await act(async () => useStudio.setState({ authStatus: 'authed' } as never))
    expect(q('[data-testid="mobile-collab"]', el)).not.toBeNull()
    expect(q('[data-testid="mobile-build"]', el)!.className).toMatch(/(^|\s)ml-0\.5(\s|$)/)
  })

  it('书切换：Segmented md（36）套 ScrollRow（纵向出血收到 4，不盖上一行 ViewSwitch 热区，docs/plan/28）；四项 touch-hit；保存 icon-md', async () => {
    const el = await mount(<BookSwitcher />)
    const row = q('[data-slot="scroll-row"]', el)!
    expect(row).not.toBeNull()
    expect(row.className).toContain('overflow-x-auto')
    expect(row.className).toMatch(/(^|\s)-my-1(\s|$)/)
    expect(row.className).toMatch(/(^|\s)py-1(\s|$)/)
    expect(row.className).not.toMatch(/(^|\s)-?[mp]y-2(\s|$)/)
    const seg = q('[data-slot="segmented"]', row) ?? q('[role="radiogroup"]', row) ?? row.firstElementChild
    expect(seg!.className).toContain('h-md-control')
    expect(seg!.className).not.toContain('h-touch')
    const items = all('[data-slot="segmented-item"]', row)
    expect(items).toHaveLength(4)
    for (const it of items) expect(it.className).toContain('touch-hit')
    expectCompactHit(q('[data-testid="book-save"]', el) ?? q('button[aria-label^="保存"]', el), 'md')
  })

  it('预览工具条 44 页边 16；内容切换 Segmented md；图标按钮 icon-md', async () => {
    useStudio.setState({ mobileTab: 'preview', lastOk: { build_id: 'b1' } } as never)
    const el = await mount(<MobilePreview />)
    const tb = q('[data-testid="mpv-toolbar"]', el)!
    expect(tb.className).toContain('h-mobile-topbar')
    expect(tb.className).toContain('px-page-m')
    const seg = q('[data-testid="mpv-kind"]', el)!
    expect(seg.className).toContain('h-md-control')
    expect(seg.className).not.toContain('h-touch')
    for (const b of all('[data-testid="mpv-toolbar"] [data-slot="button"]', el)) expectCompactHit(b, 'md')
  })

  it('预览 PDF 第二行 = PdfToolbar 移动控件（44 行，页码 lg，适宽 / ± / 查找 md touch-hit）；不重复构建 / 控制台；适宽下 ± 切回百分比', async () => {
    useStudio.setState({ mobileTab: 'preview', lastOk: { build_id: 'b1' }, zoomFit: 'width', zoom: 1, effectiveZoom: 0.6 } as never)
    const el = await mount(<MobilePreview />)
    const row = q('[data-slot="PdfToolbar"][data-variant="mobile"] [data-testid="pdf-toolbar-right"]', el)!
    expect(row).not.toBeNull()
    expect(row.className).toContain('h-touch')
    expect(row.className).toContain('px-page-m')
    expect(row.className).toContain('gap-group-m')
    expect(q('[data-testid="page-input"]', row)!.className).toContain('h-lg-control')
    for (const id of ['fit-width', 'zoom-out', 'zoom-in', 'pdf-find-toggle']) expectCompactHit(q(`[data-testid="${id}"]`, row), 'md')
    expect(q('[data-testid="mobile-build"]', el)).toBeNull()
    expect(q('[data-testid="console-toggle"]', el)).toBeNull()
    expect(all('[role="radiogroup"]', el)).toHaveLength(1)
    await act(async () => q('[data-testid="zoom-in"]', row)!.click())
    expect(useStudio.getState().zoomFit).toBeNull()
    expect(useStudio.getState().zoom).toBeCloseTo(0.7)
  })

  it('NavDrawer：Tab 条 ScrollRow（面板头 44，不裁切）；关闭 icon-md；头部页边 16', async () => {
    const el = await mount(<NavDrawer />)
    const row = q('[data-testid="nav-tabs-row"]') ?? q('[data-testid="nav-tabs-row"]', el)
    expect(row).not.toBeNull()
    expect(row!.getAttribute('role')).toBe('tablist')
    expect(row!.className).toContain('overflow-x-auto')
    for (const t of all('[role="tab"]', row!)) {
      expect(t.className).toContain('h-panel-header')
      expect(t.className).not.toContain('h-touch')
    }
    expectCompactHit(q('button[aria-label="关闭导航"]'), 'md')
    expect(q('[data-slot="sheet-header"]')!.className).toContain('pl-page-m')
    // R58-01：portal 脱出 MobileShell density 祖先，移动 Sheet 须自带 data-density=touch 让 touch-hit 生效
    expect(q('[data-testid="nav-drawer"]')!.getAttribute('data-density')).toBe('touch')
  })
})

describe('AI Sheet', () => {
  it('状态行单行 nowrap；四 Tab md；快捷动作 sm chip 一行 ScrollRow（disabled 只变前景，不留灰块）；附带上下文一行；发送 icon-md', async () => {
    useStudio.setState({ aiRuntime: { enabled: true, provider: 'mock', reachable: true }, aiEnabled: true, selection: null } as never)
    const el = await mount(<AiPanel />)
    const status = q('[data-testid="ai-status"]', el)!
    expect(status.firstElementChild!.className).toContain('whitespace-nowrap')
    expect(q('[data-testid="ai-enabled-row"]', status)!.className).toContain('ml-auto')
    const list = q('[data-slot="tabs-list"]', el)!
    expect(list.getAttribute('data-size')).toBe('md')
    for (const t of all('[data-slot="tabs-trigger"]', list)) expect(t.className).toContain('touch-hit')
    const quick = q('[data-testid="ai-quick-row"]', el)!
    expect(quick.getAttribute('data-slot')).toBe('scroll-row')
    expect(quick.className).toContain('overflow-x-auto')
    expect(quick.className).not.toContain('flex-wrap')
    const chips = all('[data-slot="button"]', quick)
    expect(chips.length).toBeGreaterThanOrEqual(4)
    for (const c of chips) {
      expectCompactHit(c, 'sm')
      expect(c.className).toContain('rounded-full')
      expect(c.className).toContain('disabled:bg-transparent')
    }
    const packs = q('[data-testid="ai-context-packs"]', el)!
    expect(packs.className).toContain('whitespace-nowrap')
    expect(packs.className).not.toContain('flex-wrap')
    expect(all('[data-slot="checkbox"]', packs).length).toBeGreaterThanOrEqual(3)
    expectCompactHit(q('[data-testid="ai-chat-send"]', el) ?? q('button[aria-label*="发送"]', el), 'md')
  })
})

describe('审阅 Sheet', () => {
  it('两 section gap-section-m（24）+ 标题 text-sm/font-medium；CriticHint 触控行高 leading-7（不用任意值）；指派 / 添加批注 md 等宽', async () => {
    useStudio.setState({ marks: [], comments: [], reviewDrawerOpen: true, project: { id: 'p1', role: 'owner' } as never })
    const el = await mount(<ReviewBody pid="p1" />)
    const sections = q('[data-testid="review-sections"]', el)!
    expect(sections.className).toContain('gap-section-m')
    expect(sections.className).toContain('pb-sheet-m')
    const headings = all('h3, h4, [data-slot="review-heading"]', sections).filter((h) => /修订|批注/.test(h.textContent ?? ''))
    expect(headings.length).toBeGreaterThanOrEqual(1)
    for (const h of headings) {
      expect(h.className).toContain('text-sm')
      expect(h.className).toContain('font-medium')
    }
    const hint = q('[data-testid="critic-hint"]', el)!
    expect(hint.getAttribute('data-density')).toBe('touch')
    expect(hint.className).toContain('leading-7')
    expect(hint.className).not.toMatch(/leading-\[/)
    expect(hint.textContent).not.toMatch(/\{\+\+|\{--|~~/)
    const actions = all('[data-testid="review-assign"], [data-testid="review-add-comment"], [data-testid="review-new-comment"]', el)
    for (const a of actions) expectCompactHit(a, 'md')
    if (actions.length) expect(actions[0].parentElement!.className).toContain('[&>*]:flex-1')
  })
})

describe('问题 Sheet', () => {
  it('运行当前案检查 md 占满不右浮；诊断 / 折叠行 min-h 44；check_all 折叠行 nowrap 与按钮分行', async () => {
    const el = await mount(<CheckPanel />)
    const panel = q('[data-testid="check-panel"]', el)!
    expect(panel.className).toContain('gap-section-m')
    expect(panel.className).toContain('px-sheet-m')
    const run = all('[data-slot="button"]', panel).find((b) => /当前案/.test(b.textContent ?? ''))!
    expect(run).toBeDefined()
    expect(run.className).toContain('h-md-control')
    expect(run.className).toContain('w-full')
    expect(run.className).not.toContain('ml-auto')
    const header = q('[data-testid="check-all-header"]', el)!
    expect(header.className).toContain('flex-col')
    const toggle = q('[data-testid="check-all-toggle"]', el)!
    expect(toggle.className).toContain('whitespace-nowrap')
    expect(toggle.className).toContain('in-data-[density=touch]:min-h-touch')
  })
})

describe('协作者 Sheet', () => {
  const members: Member[] = [
    { user_id: 'u1', email: 'o@x.io', name: '甲', role: 'owner' },
    { user_id: 'u2', email: 'e@x.io', name: '乙', role: 'editor' },
  ] as unknown as Member[]
  it('邀请表单 Input lg + Select lg + 邀请按钮 lg（ux-07 同行等高 44；grow 不够宽换行占满）；成员行 48；间距 8pt token', async () => {
    const el = await mount(
      <MembersSection
        pid="p1"
        members={members}
        invites={[]}
        onlineIds={new Set()}
        canManage
        onInvite={() => {}}
        onSetMemberRole={() => {}}
        onRemoveMember={() => {}}
        onSetInviteRole={() => {}}
        onRevokeInvite={() => {}}
        meId="u1"
      />,
    )
    const wrap = q('[data-testid="collab-members"]', el)!
    expect(wrap.className).toContain('px-sheet-m')
    expect(wrap.className).toContain('gap-cards-m')
    const form = q('[data-testid="collab-invite-form"]', el)!
    expect(form.className).toContain('p-card-m')
    expect(form.className).toContain('gap-group-m')
    expect(q('[data-testid="collab-invite-email"]', el)!.className).toContain('h-lg-control')
    expect(q('[data-testid="collab-invite-role"]', el)!.getAttribute('data-size')).toBe('lg')
    const row = q('[data-testid="collab-invite-controls"]', el)!
    expect(row.className).toContain('flex-wrap')
    const btn = q('[data-testid="collab-invite-submit"]', el)!
    expect(btn.className).toContain('h-lg-control')
    expect(btn.className).not.toContain('h-md-control')
    expect(btn.className).toContain('grow')
    for (const r of all('[data-user-id]', el)) expect(r.className).toContain('min-h-row-mobile')
  })

  it('在线成员头像「跳到所在行」视觉 xs 28 但 touch-hit 命中 ≥44', async () => {
    const el = await mount(
      <MembersSection
        pid="p1"
        members={members}
        invites={[]}
        onlineIds={new Set(['u2'])}
        peers={[{ id: 1, name: '乙', color: '#ec4899', line: 12, readonly: false }]}
        onGoto={() => {}}
        canManage={false}
        onInvite={() => {}}
        onSetMemberRole={() => {}}
        onRemoveMember={() => {}}
        onSetInviteRole={() => {}}
        onRevokeInvite={() => {}}
        meId="u1"
      />,
    )
    const b = q('[data-testid="collab-goto-peer"]', el)!
    expect(b).not.toBeNull()
    expect(b.className).toContain('size-xs-control')
    expect(b.className).toContain('touch-hit')
  })
})

describe('AI 输入框', () => {
  it('移动紧凑态 Textarea size=lg（min-h 44 档），不再借 xl + 额外 min-h', async () => {
    useStudio.setState({ aiRuntime: { enabled: true, provider: 'mock', reachable: true }, aiEnabled: true, selection: null } as never)
    const el = await mount(<AiPanel />)
    const ta = q('[data-testid="ai-chat-input"]', el)!
    expect(ta.getAttribute('data-size')).toBe('lg')
    expect(ta.className).toContain('min-h-lg-control')
    expect(ta.className).not.toContain('text-lg')
  })
})

describe('长按 Sheet', () => {
  it('菜单行 48；批注表单 Sheet 内边距 16 / 顶 8；取消 / 添加批注 md', async () => {
    useStudio.setState({ pdfLongPress: { book: 'claims', blockId: 'claims/1', line: 3, page: 1 } } as never)
    await mount(<PdfLongPressSheet />)
    const menu = q('[data-testid="pdf-long-press-menu"]')!
    expect(menu.className).toContain('pb-sheet-m')
    expect(menu.className).toContain('pt-sheet-top-m')
    for (const b of all('[role="menuitem"]', menu)) expect(b.className).toContain('min-h-row-mobile')
    await act(async () => q('[data-testid="plp-comment"]')!.click())
    const form = q('[data-testid="pdf-long-press-comment"]')!
    expect(form.className).toContain('px-sheet-m')
    expect(form.className).toContain('gap-group-m')
    for (const b of all('[data-testid="plp-comment-actions"] [data-slot="button"]')) expectCompactHit(b, 'md')
  })
})

describe('NavDrawer 大纲树', () => {
  it('树行折叠 chevron（视觉 16）带 touch-hit，命中区 ≥44', async () => {
    await mount(
      <TreeRow id="t" collapsed={false} onToggle={() => {}}>
        节
      </TreeRow>,
    )
    const chevron = q('button[aria-label="折叠"]')!
    expect(chevron.className).toContain('size-4')
    expect(chevron.className).toContain('touch-hit')
  })
})
