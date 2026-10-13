// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import { useStudio } from '@/store'
import { GUEST_NAME_KEY } from '@/store/publicShare'
import type { PublicComment, PublicShareMeta } from '@/types/public-share'
import { ClientReviewPage } from '../ClientReviewPage'
import { anchorForBlock, anchorForQuote } from '../anchor'
import { fmtDateTime } from '@/lib/format'

vi.mock('react-pdf', () => ({
  Document: ({ children }: { children?: React.ReactNode }) => <div data-testid="mock-pdf-document">{children}</div>,
  Page: ({ pageNumber }: { pageNumber: number }) => <div data-testid="mock-pdf-page">{pageNumber}</div>,
  pdfjs: { GlobalWorkerOptions: {} },
}))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // PDF 字节走 fetch；jsdom 下相对 URL 直接失败 ⇒ 组件显示「加载失败」提示，不影响页面其他部分
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('no network in test'))))
})

const meta: PublicShareMeta = {
  org_name: '明远知识产权',
  title: '一种控制方法',
  case_no: 'MY-2026-018',
  status: 'drafting',
  version: 3,
  sha: 'abc123',
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

const existing: PublicComment = {
  id: 'cm_1',
  anchor: { block_id: 'claims/2', line: 11, quote: '滑窗计算' },
  body: '滑窗长度需写明',
  author: { id: null, name: '李客户' },
  created_at: Math.floor(Date.now() / 1000) - 600,
  updated_at: Math.floor(Date.now() / 1000) - 600,
  resolved: false,
  replies: [],
  guest: true,
}

const kindError = (status: number, kind: string, msg: string) => new ApiError(status, msg, { kind } as never)

beforeEach(() => {
  desktop = true
  localStorage.clear()
  useStudio.getState().resetPublic()
  useStudio.setState({ toasts: [], guestName: '' })
  vi.spyOn(api, 'publicMeta').mockResolvedValue(meta)
  vi.spyOn(api, 'publicAst').mockResolvedValue(SYNTH_AST)
  vi.spyOn(api, 'publicComments').mockResolvedValue([existing])
  vi.spyOn(api, 'publicLayoutCss').mockResolvedValue('')
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  // openPublic：meta → ast/comments/css 两拍
  await act(async () => {})
  await act(async () => {})
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)
const qa = (sel: string, el: ParentNode = document) => Array.from(el.querySelectorAll<HTMLElement>(sel))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const submit = (form: Element) => act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

describe('anchor / format', () => {
  it('anchorForBlock：title / 摘要 / 权项 / 说明书 → 全文 1-based 行 + 引文 + book；未知 id ⇒ null', () => {
    expect(anchorForBlock(SYNTH_AST, 'title')).toMatchObject({ block_id: 'title', line: 1, book: 'abstract' })
    expect(anchorForBlock(SYNTH_AST, 'abstract/p1')).toMatchObject({ line: 3 + 2, book: 'abstract' })
    expect(anchorForBlock(SYNTH_AST, 'claims/2')).toMatchObject({ line: 7 + 4, book: 'claims', quote: expect.stringContaining('滑窗') })
    expect(anchorForBlock(SYNTH_AST, 'description/背景技术/p0002')).toMatchObject({ line: 18 + 8, book: 'description' })
    expect(anchorForBlock(SYNTH_AST, 'nope')).toBeNull()
  })

  it('anchorForQuote：按引文在三书里定位；找不到锚到 title；引文截 120 字', () => {
    expect(anchorForQuote(SYNTH_AST, '漂移 分数按滑窗计算')).toMatchObject({ block_id: 'claims/2', line: 11 })
    expect(anchorForQuote(SYNTH_AST, '本发明涉及时间序列')).toMatchObject({ block_id: 'description/技术领域/p0001', line: 22 })
    const miss = anchorForQuote(SYNTH_AST, '第 2 页 / 共 5 页')
    expect(miss.block_id).toBe('title')
    expect(anchorForQuote(SYNTH_AST, 'x'.repeat(300)).quote).toHaveLength(120)
  })

  it('fmtDateTime：Unix 秒 → YYYY-MM-DD HH:mm；空 ⇒ 空串', () => {
    expect(fmtDateTime(null)).toBe('')
    expect(fmtDateTime(Date.UTC(2026, 8, 6, 4, 5) / 1000)).toMatch(/^2026-09-0\d \d{2}:\d{2}$/)
  })
})

describe('ClientReviewPage `#/c/<token>`（21 §4.5）', () => {
  it('正常态：44 顶栏（机构 · 案名 · vN）、Segmented 默认 PDF、动作条「确认定稿 / 有意见」、水印；无源码入口、无下载；axe 无 serious/critical', async () => {
    const el = await mount(<ClientReviewPage token="tok-1" />)
    expect(q('[data-testid="page-client"]', el)).not.toBeNull()
    expect(q('[data-testid="client-token"]', el)!.textContent).toBe('tok-1')
    expect(q('[data-testid="client-org"]', el)!.textContent).toBe('明远知识产权')
    expect(q('[data-testid="client-title"]', el)!.textContent).toBe('一种控制方法')
    expect(q('[data-testid="client-version"]', el)!.textContent).toBe('v3')
    expect(q('[data-testid="client-header"]', el)!.className).toContain('h-mobile-topbar')

    const pdfTab = q('[data-testid="client-view-pdf"]', el)!
    expect(pdfTab.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-testid="client-main"]', el)!.dataset.view).toBe('pdf')
    expect(q('[data-testid="client-pdf"]', el)).not.toBeNull()

    expect(q('[data-testid="client-confirm"]', el)!.textContent).toContain('确认定稿')
    expect(q('[data-testid="client-comment"]', el)!.textContent).toContain('有意见')
    // W11 K3：桌面右栏已有「N 条 · N 待处理」，动作条按钮与工具条不再重复计数；右栏不再有第二个提意见按钮
    expect(q('[data-testid="client-comment"]', el)!.textContent).not.toContain('(1)')
    expect(q('[data-testid="client-doctb"]', el)!.textContent).not.toContain('批注 1')
    expect(q('[data-testid="client-side-comment"]', el)).toBeNull()
    expect(q('[data-testid="client-side"]', el)!.textContent).toContain('1 条')
    // W11 K4：右栏信息块不再重复顶栏的机构 / 案号 / 版本
    expect(q('[data-testid="client-side-meta"]', el)!.textContent).not.toContain('明远知识产权')
    expect(q('[data-testid="client-actionbar"]', el)!.className).toContain('safe-area-inset-bottom')
    // W7 qa-03：水印是空的 role=presentation 图层（文字只在 SVG mask 里），DOM 无文本，颜色走 token
    const wm = q('[data-testid="client-watermark"]', el)!
    expect(wm.textContent).toBe('')
    expect(wm.childElementCount).toBe(0)
    expect(wm.getAttribute('role')).toBe('presentation')
    expect(wm.hasAttribute('aria-hidden')).toBe(false)
    expect(wm.dataset.text).toBe('审阅版 · 明远知识产权 · v3 · 仅供确认，请勿外传')
    const mask = wm.style.getPropertyValue('--client-watermark')
    expect(mask.startsWith('url("data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(mask)).toContain('审阅版 · 明远知识产权 · v3')
    expect(decodeURIComponent(mask)).toContain('rotate(-30')
    expect(mask).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(wm.className).toContain('bg-fg-subtle/40')
    expect(wm.className).toContain('[mask-image:var(--client-watermark)]')
    expect(wm.className).toContain('pointer-events-none')

    // 无源码入口 / 无下载（allow_download=false）
    expect(el.textContent).not.toContain('源码')
    expect(q('[data-testid="client-view-source"]', el)).toBeNull()
    expect(q('[data-testid="client-download"]', el)).toBeNull()
    expect(qa('.cm-editor', el)).toHaveLength(0)

    expect(await violations(el)).toEqual([])
  })

  it('切「版面」：只读版面（摘要 / 权项 / 说明书），点权项块出「有意见」气泡；无编辑器', async () => {
    const el = await mount(<ClientReviewPage token="tok-1" />)
    await click(q('[data-testid="client-view-layout"]', el)!)
    expect(q('[data-testid="client-main"]', el)!.dataset.view).toBe('layout')
    const layout = await vi.waitFor(() => {
      const l = q('[data-testid="client-layout"]', el)
      if (!l) throw new Error('client-layout 未落树') // ClientLayoutView 是 lazy：等动态 import + Suspense
      return l
    })
    expect(layout.textContent).toContain('权利要求')
    expect(layout.textContent).toContain('滑窗计算')
    expect(qa('[contenteditable="true"]', el)).toHaveLength(0)

    const claim = q('[data-block-id="claims/2"]', el)!
    expect(claim).not.toBeNull()
    await click(claim)
    expect(q('[data-testid="client-selection-comment"]', el)).not.toBeNull()
    await click(q('[data-testid="client-selection-comment"]', el)!)
    expect(q('[data-testid="client-comment-sheet"]')).not.toBeNull()
    expect(q('[data-testid="client-comment-quote"]')!.textContent).toContain('滑窗')
  })

  it('W9：客户版面把行内记号渲染成 strong / em / u / sub / sup（不露 `**` / `<u>` / `_{}`），sub_except 白名单生效', async () => {
    const p1 = SYNTH_AST.description[1]
    if (p1.kind !== 'paragraph') throw new Error('fixture')
    const inlineAst = {
      ...SYNTH_AST,
      description: [SYNTH_AST.description[0], { ...p1, text: '水H_{2}O与**粗体<u>下划</u>**、*斜体*、m/s^2、变量x_t。' }, ...SYNTH_AST.description.slice(2)],
    }
    vi.spyOn(api, 'publicAst').mockResolvedValue(inlineAst)
    vi.spyOn(api, 'publicMeta').mockResolvedValue({ ...meta, sub_except: ['x_t'] })
    const el = await mount(<ClientReviewPage token="tok-1" />)
    await click(q('[data-testid="client-view-layout"]', el)!)
    const para = await vi.waitFor(() => {
      const p = q('[data-block-id="description/技术领域/p0001"]', el)
      if (!p) throw new Error('layout 段落未落树') // ClientLayoutView 是 lazy
      return p
    })
    expect(para.innerHTML).toContain('H<sub>2</sub>O')
    expect(para.innerHTML).toContain('<strong>粗体</strong><strong><u>下划</u></strong>')
    expect(para.innerHTML).toContain('<em>斜体</em>')
    expect(para.innerHTML).toContain('m/s<sup>2</sup>')
    expect(para.textContent).toContain('x_t')
    expect(para.innerHTML).not.toContain('<sub>t</sub>')
    expect(para.textContent).not.toMatch(/\*|<u>|_\{|\^2/)
  })

  it('批注：姓名一次填并存 localStorage，提交带锚点 + guest_name，列表出现 row-<id>', async () => {
    const created: PublicComment = { ...existing, id: 'cm_2', body: '权利要求 1 缺少「其特征在于」', author: { id: null, name: '张客户' } }
    const add = vi.spyOn(api, 'addPublicComment').mockResolvedValue(created)
    const el = await mount(<ClientReviewPage token="tok-1" />)
    await click(q('[data-testid="client-comment"]', el)!)
    expect(q('[data-testid="row-cm_1"]')).not.toBeNull()

    const send = q<HTMLButtonElement>('[data-testid="client-comment-send"]')!
    expect(send.disabled).toBe(true)
    await type(q<HTMLInputElement>('[data-testid="client-guest-name"]')!, '张客户')
    await type(q<HTMLTextAreaElement>('[data-testid="client-comment-input"]')!, created.body)
    expect(send.disabled).toBe(false)
    await submit(q('[data-testid="client-comment-form"]')!)

    expect(localStorage.getItem(GUEST_NAME_KEY)).toBe('张客户')
    expect(add).toHaveBeenCalledWith('tok-1', {
      anchor: { block_id: 'title', line: 1, quote: '', book: 'abstract' },
      body: created.body,
      guest_name: '张客户',
    })
    expect(useStudio.getState().publicComments.map((c) => c.id)).toEqual(['cm_1', 'cm_2'])
    expect(q('[data-testid="client-comment-sheet"]')).toBeNull()
    expect(useStudio.getState().toasts.at(-1)?.text).toBe('意见已发送给代理师')

    // 再次打开：姓名已预填
    await click(q('[data-testid="client-comment"]', el)!)
    expect(q<HTMLInputElement>('[data-testid="client-guest-name"]')!.value).toBe('张客户')
    expect(q('[data-testid="row-cm_2"]')).not.toBeNull()
  })

  it('确认定稿：对话框 → POST confirm → 动作条显示「已于 … 确认 v3」，确认按钮消失', async () => {
    localStorage.setItem(GUEST_NAME_KEY, '张客户')
    useStudio.setState({ guestName: '张客户' })
    const confirmed_at = Math.floor(Date.now() / 1000)
    const confirm = vi.spyOn(api, 'publicConfirm').mockResolvedValue({ version: 3, sha: 'abc123', name: '张客户', note: '同意', confirmed_at })
    const el = await mount(<ClientReviewPage token="tok-1" />)
    await click(q('[data-testid="client-confirm"]', el)!)
    const dlg = q('[data-testid="client-confirm-dialog"]')!
    expect(dlg.textContent).toContain('确认定稿 v3')
    expect(q<HTMLInputElement>('[data-testid="client-confirm-name"]')!.value).toBe('张客户')
    await type(q<HTMLTextAreaElement>('[data-testid="client-confirm-note"]')!, '同意')
    await click(q('[data-testid="client-confirm-submit"]')!)

    expect(confirm).toHaveBeenCalledWith('tok-1', { name: '张客户', note: '同意' })
    expect(q('[data-testid="client-confirm-dialog"]')).toBeNull()
    const done = q('[data-testid="client-confirmed"]', el)!
    expect(done.textContent).toContain('张客户')
    expect(done.textContent).toContain(`已于 ${fmtDateTime(confirmed_at)} 确认 v3`)
    expect(q('[data-testid="client-confirm"]', el)).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('已确认旧版（confirmation.version < version）：仍可确认本版；scope=read：无批注 / 确认，只显示阅读提示', async () => {
    vi.spyOn(api, 'publicMeta').mockResolvedValue({ ...meta, confirmation: { version: 2, sha: 'old', name: '张客户', note: null, confirmed_at: 1 } })
    let el = await mount(<ClientReviewPage token="tok-1" />)
    expect(q('[data-testid="client-confirmed-old"]', el)!.textContent).toContain('v2 已于')
    expect(q('[data-testid="client-confirm"]', el)).not.toBeNull()
    await act(async () => root?.unmount())
    host.remove()

    vi.spyOn(api, 'publicMeta').mockResolvedValue({ ...meta, scope: 'read' })
    const comments = vi.spyOn(api, 'publicComments')
    comments.mockClear()
    el = await mount(<ClientReviewPage token="tok-1" />)
    expect(comments).not.toHaveBeenCalled()
    expect(q('[data-testid="client-readonly-hint"]', el)).not.toBeNull()
    expect(q('[data-testid="client-confirm"]', el)).toBeNull()
    expect(q('[data-testid="client-comment"]', el)).toBeNull()
    /* 批57：只读链接的空态不再提示「拖选批注」（OBS-P1）——reason 不渲染 */
    expect(q('[data-testid="client-comments-empty"]', el)).not.toBeNull()
    expect(q('[data-slot="empty-state-reason"]', el)).toBeNull()
  })

  it('允许下载时顶栏出现下载按钮，指向 /api/public/<token>/pdf', async () => {
    vi.spyOn(api, 'publicMeta').mockResolvedValue({ ...meta, allow_download: true })
    const el = await mount(<ClientReviewPage token="tok-1" />)
    const dl = q<HTMLAnchorElement>('[data-testid="client-download"]', el)!
    expect(dl.getAttribute('href')).toBe(api.publicPdfUrl('tok-1'))
    expect(dl.hasAttribute('download')).toBe(true)
  })

  it('W9 domain-02：pending_revisions=0 ⇒ 无提示；>0 且 baseline=original ⇒ 「只显示已确定的正文」；baseline=final ⇒ 「已按接受显示」；axe 无 serious/critical', async () => {
    vi.spyOn(api, 'publicMeta').mockResolvedValue(meta)
    let el = await mount(<ClientReviewPage token="tok-1" />)
    expect(q('[data-testid="client-pending-notice"]', el)).toBeNull()
    await act(async () => root?.unmount())
    host.remove()

    vi.spyOn(api, 'publicMeta').mockResolvedValue({ ...meta, pending_revisions: 2 })
    el = await mount(<ClientReviewPage token="tok-2" />)
    let notice = q('[data-testid="client-pending-notice"]', el)!
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.getAttribute('data-baseline')).toBe('original')
    expect(notice.textContent).toContain('2 处修改建议待处理')
    expect(notice.textContent).toContain('只显示已确定的正文')
    expect(await violations(el)).toEqual([])
    await act(async () => root?.unmount())
    host.remove()

    vi.spyOn(api, 'publicMeta').mockResolvedValue({ ...meta, baseline: 'final', pending_revisions: 3 })
    el = await mount(<ClientReviewPage token="tok-3" />)
    notice = q('[data-testid="client-pending-notice"]', el)!
    expect(notice.getAttribute('data-baseline')).toBe('final')
    expect(notice.textContent).toContain('含 3 处')
    expect(notice.textContent).toContain('已按接受显示')
  })

  it('过期 / 撤销 410 ⇒ 「链接已过期，请联系代理师」；无动作条；axe 无 serious/critical', async () => {
    vi.spyOn(api, 'publicMeta').mockRejectedValue(kindError(410, 'share.expired', '审阅链接已过期'))
    const el = await mount(<ClientReviewPage token="tok-dead" />)
    const ex = q('[data-testid="client-expired"]', el)!
    expect(ex.textContent).toContain('链接已过期，请联系代理师')
    expect(q('[data-testid="client-actionbar"]', el)).toBeNull()
    expect(q('[data-testid="client-viewbar"]', el)).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('W7 ux-07：404 not_found ⇒ 「链接失效」态（client-invalid），无重试 / 动作条；meta 只探一次；axe 无 serious/critical', async () => {
    const metaSpy = vi.spyOn(api, 'publicMeta').mockRejectedValue(kindError(404, 'not_found', '审阅链接不存在'))
    const el = await mount(<ClientReviewPage token="tok-gone" />)
    const inv = q('[data-testid="client-invalid"]', el)!
    expect(inv.textContent).toContain('链接失效')
    expect(inv.textContent).toContain('代理师')
    expect(q('[data-testid="client-error"]', el)).toBeNull()
    expect(q('[data-testid="client-expired"]', el)).toBeNull()
    expect(q('[data-testid="client-retry"]', el)).toBeNull()
    expect(q('[data-testid="client-actionbar"]', el)).toBeNull()
    expect(metaSpy).toHaveBeenCalledTimes(1)
    expect(await violations(el)).toEqual([])
  })

  it('W12 R7-02：token 探针只给测试用，对读屏隐藏（hidden）——失效链接页 axe region 0（此前 sr-only 令牌是地标外的孤立文本）', async () => {
    vi.spyOn(api, 'publicMeta').mockRejectedValue(kindError(404, 'not_found', '审阅链接不存在'))
    const el = await mount(<ClientReviewPage token="tok-gone" />)
    const tok = q('[data-testid="client-token"]', el)!
    expect(tok.textContent).toBe('tok-gone')
    expect(tok.hasAttribute('hidden')).toBe(true)
    expect(tok.className).not.toContain('sr-only')
    const res = await axe.run(el, { runOnly: { type: 'rule', values: ['region'] } })
    expect(res.violations.map((v) => v.nodes.map((n) => n.target.join(' ')))).toEqual([])
  })

  it('W12 R9-01：有效 token 正常态 <main> 是顶层地标（「文稿」），不再嵌在 section 里——axe landmark-main-is-top-level / one-main 0；选区宿主 client-main 仍在 main 内', async () => {
    const el = await mount(<ClientReviewPage token="tok-1" />)
    const mains = qa('main', el)
    expect(mains).toHaveLength(1)
    expect(mains[0].getAttribute('aria-label')).toBe('文稿')
    expect(mains[0].closest('section, aside, nav, header, footer, [role]')).toBeNull()
    const host = q('[data-testid="client-main"]', el)!
    expect(host.tagName).toBe('DIV')
    expect(host.dataset.view).toBe('pdf')
    expect(mains[0].contains(host)).toBe(true)
    const res = await axe.run(el, { runOnly: { type: 'rule', values: ['landmark-main-is-top-level', 'landmark-one-main', 'landmark-no-duplicate-main', 'landmark-unique'] } })
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  it('W7 qa-10：StrictMode 式双挂载（open → reset → open 同 token）只发一次 meta，页面仍正常渲染', async () => {
    const metaSpy = vi.spyOn(api, 'publicMeta').mockResolvedValue(meta)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <TooltipProvider>
          <ClientReviewPage token="tok-1" />
        </TooltipProvider>,
      )
      // 模拟 StrictMode：效应 → 清理 → 效应，同步连续发生
      const s = useStudio.getState()
      void s.openPublic('tok-1')
      s.resetPublic()
      void s.openPublic('tok-1')
    })
    await act(async () => {})
    await act(async () => {})
    expect(metaSpy).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="client-title"]', host)!.textContent).toBe('一种控制方法')
    expect(useStudio.getState().publicLoading).toBe(false)
  })

  it('501 ⇒ EmptyState「功能开发中」；其他错误 ⇒ 「无法打开审阅链接」+ 重试可恢复', async () => {
    vi.spyOn(api, 'publicMeta').mockRejectedValueOnce(new ApiError(501, '尚未实现'))
    let el = await mount(<ClientReviewPage token="tok-1" />)
    expect(q('[data-testid="client-unavailable"]', el)!.textContent).toContain('功能开发中')
    await act(async () => root?.unmount())
    host.remove()

    vi.spyOn(api, 'publicMeta').mockRejectedValueOnce(new ApiError(500, '服务器打盹')).mockResolvedValue(meta)
    el = await mount(<ClientReviewPage token="tok-1" />)
    expect(q('[data-testid="client-error"]', el)!.textContent).toContain('服务器打盹')
    await click(q('[data-testid="client-retry"]', el)!)
    await act(async () => {})
    expect(q('[data-testid="client-error"]', el)).toBeNull()
    expect(q('[data-testid="client-title"]', el)!.textContent).toBe('一种控制方法')
  })

  it('375 移动：动作条按钮 lg 撑满，批注面板从底部滑出', async () => {
    desktop = false
    const el = await mount(<ClientReviewPage token="tok-1" />)
    expect(q('[data-testid="client-confirm"]', el)!.className).toContain('flex-1')
    await click(q('[data-testid="client-comment"]', el)!)
    const sheet = q('[data-testid="client-comment-sheet"]')!
    expect(sheet.getAttribute('data-side') ?? sheet.className).toMatch(/bottom/)
  })

  it('375 移动（W8 §2/§3）：顶栏 44 + 图标 md，Segmented md 居中，信息行 12/muted，页边 16，动作条 64 lg', async () => {
    desktop = false
    const el = await mount(<ClientReviewPage token="tok-1" />)
    const header = q('[data-testid="client-header"]', el)!
    expect(header.className).toContain('h-mobile-topbar')
    expect(header.className).toContain('px-page-m')
    expect(q('[data-testid="client-comments-toggle"]', el)!.dataset.size).toBe('icon-md')

    const viewbar = q('[data-testid="client-viewbar"]', el)!
    expect(viewbar.className).toContain('justify-center')
    expect(viewbar.className).toContain('py-3')
    const seg = q('[role="radiogroup"]', viewbar)!
    expect(seg.className).toContain('h-md-control')
    expect(seg.className).not.toContain('h-touch')
    expect(q('[data-testid="client-view-pdf"]', viewbar)!.className).toContain('touch-hit')

    const doctb = q('[data-testid="client-doctb"]', el)!
    expect(doctb.className).toContain('text-xs')
    expect(doctb.className).toContain('text-fg-muted')
    expect(doctb.className).toContain('whitespace-nowrap')
    expect(doctb.className).toContain('px-page-m')
    expect(doctb.className).not.toContain('h-pdftb')

    expect(q('[data-testid="client-pdf"]', el)!.className).toContain('p-page-m')

    const bar = q('[data-testid="client-actionbar"]', el)!
    expect(bar.className).toContain('safe-area-inset-bottom')
    expect(bar.firstElementChild!.className).toContain('h-action-bar')
    expect(bar.firstElementChild!.className).toContain('px-page-m')
    expect(bar.firstElementChild!.className).toContain('gap-group-m')
    const comment = q('[data-testid="client-comment"]', el)!
    const confirm = q('[data-testid="client-confirm"]', el)!
    expect(comment.dataset.size).toBe('lg')
    expect(confirm.dataset.size).toBe('lg')
    expect(comment.className).toContain('flex-1')
    expect(comment.dataset.variant).toBe('secondary')
    expect(confirm.dataset.variant).toBe('primary')
    for (const b of [comment, confirm]) expect(b.className).toContain('touch-hit')
  })

  it('1440 桌面：顶栏 56、Segmented 在顶栏、动作条 lg（视觉不变）', async () => {
    desktop = true
    const el = await mount(<ClientReviewPage token="tok-1" />)
    const header = q('[data-testid="client-header"]', el)!
    expect(header.className).toContain('md:h-14')
    expect(q('[role="radiogroup"]', header)).not.toBeNull()
    expect(q('[data-testid="client-doctb"]', el)!.className).toContain('h-pdftb')
    expect(q('[data-testid="client-pdf"]', el)!.className).toContain('md:px-5')
    expect(q('[data-testid="client-confirm"]', el)!.dataset.size).toBe('lg')
    expect(q('[data-testid="client-comment"]', el)!.dataset.variant).toBe('secondary')
  })
})
