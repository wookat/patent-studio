// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import { useStudio } from '@/store'
import type { AiJob } from '@/types/ai'
import type { OaAnswer, OaItem } from '@/types/oa'
import { editorCommands } from '@/components/editor/commands'
import { OaPanel } from '@/components/oa/OaPanel'
import { findClaimLine, oaItemSummary, pointsFromText } from '@/components/oa/oaUtils'
import { OA_KIND_LABEL } from '@/types/oa'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
})

const CONTENT = ['# 一种传感器', '', '## 摘要', '摘要。', '', '## 权利要求书', '1. 一种传感器，包括壳体。', '2. 根据权利要求1所述的传感器，其特征在于，还包括探头。', '', '## 说明书', '### 技术领域', '正文。'].join('\n')

beforeEach(() => {
  useStudio.setState({
    pid: 'method',
    toasts: [],
    content: CONTENT,
    saved: CONTENT,
    settings: { ai_enabled: true } as never,
    project: null,
    projectLoading: false,
    railTab: 'outline',
    outlineOpen: true,
    mobileTab: 'edit',
  })
  useStudio.getState().resetAi()
  useStudio.getState().resetOa()
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
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel))
const click = (el: Element | null) => act(async () => (el as HTMLElement).click())

const ITEMS: OaItem[] = [
  { id: '1', claims: [1], kind: 'novelty', text: '关于权利要求1：权利要求1相对于对比文件1不具备新颖性，不符合专利法第22条第2款的规定。' },
  { id: '2', claims: [2], kind: 'inventiveness', text: '关于权利要求2：权利要求2相对于对比文件1与公知常识的结合不具备创造性，不符合专利法第22条第3款。' },
  { id: '3', claims: [], kind: 'formal', text: '说明书第[0012]段撰写形式不符合实施细则规定。' },
]

const ANSWER: OaAnswer = {
  item_id: '1',
  points: ['对比文件1未公开壳体为一体成型结构', '本申请通过一体成型壳体解决密封问题'],
  claim_edits: [{ claim: 1, critic_line: '1. 一种传感器，包括{~~壳体~>一体成型的壳体~~}{++，所述壳体密封连接++}。' }],
  amend_summary: '在权利要求1中补入壳体一体成型与密封连接的特征。',
}

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 'job_oa1',
  kind: 'oa_answer',
  pid: 'method',
  status: 'queued',
  progress: 0,
  message: '',
  result: null,
  error: null,
  created_at: 0,
  updated_at: 0,
  ...over,
})

async function typeText(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function parsed() {
  vi.spyOn(api, 'oaParse').mockResolvedValue({ items: ITEMS, warnings: ['第 3 条未识别涉及的权利要求'] })
  await mount(<OaPanel />)
  await typeText(q<HTMLTextAreaElement>('#oa-text')!, '1. …\n2. …\n3. …')
  await click(q('[data-testid="oa-parse"]'))
}

describe('oaUtils', () => {
  it('findClaimLine 只在「权利要求书」内按 N. 定位（1-based）', () => {
    expect(findClaimLine(CONTENT, 1)).toBe(7)
    expect(findClaimLine(CONTENT, 2)).toBe(8)
    expect(findClaimLine(CONTENT, 3)).toBeNull()
    expect(findClaimLine('## 说明书\n1. 不是权项', 1)).toBeNull()
  })
  it('oaItemSummary / pointsFromText', () => {
    expect(oaItemSummary({ id: 'x', claims: [], kind: 'other', text: 'a\n b  c' }, 3)).toBe('a b…')
    expect(pointsFromText('- 一\n\n• 二\n三 ')).toEqual(['一', '二', '三'])
  })
})

describe('OaPanel · 粘贴 / 上传 → 拆条 → 列表', () => {
  it('无 pid 时输入与按钮禁用', async () => {
    useStudio.setState({ pid: null })
    await mount(<OaPanel />)
    expect(q<HTMLTextAreaElement>('#oa-text')!.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="oa-parse"]')!.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="oa-upload"]')!.disabled).toBe(true)
  })

  it('拆条后：列表 role=listbox、3 个 option、类型 / 权项 / 警告；首条激活；输入区折叠；axe 无违规', async () => {
    await parsed()
    const list = q('[data-testid="oa-items"]')!
    expect(list.getAttribute('role')).toBe('listbox')
    expect(qa('[role="option"]').length).toBe(3)
    expect(q('[data-testid="oa-item-1"]')!.getAttribute('aria-selected')).toBe('true')
    expect(q('[data-testid="oa-item-1"]')!.textContent).toContain(OA_KIND_LABEL.novelty)
    expect(q('[data-testid="oa-item-3"]')!.textContent).toContain(OA_KIND_LABEL.formal)
    expect(q('[data-testid="oa-item-2"]')!.textContent).toContain('权利要求 2')
    expect(q('[data-testid="oa-warnings"]')!.textContent).toContain('第 3 条')
    expect(q('[data-testid="oa-input-toggle"]')!.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-testid="oa-input-toggle"]')!.textContent).toContain('已拆 3 条')
    // W7 qa-06：正文折叠钮 375 实测 18 高 → touch 密度下 min-h-touch
    expect(q('[data-testid="oa-input-toggle"]')!.className).toContain('in-data-[density=touch]:min-h-touch')
    expect(q('[data-testid="oa-detail-text"]')!.textContent).toContain('不具备新颖性')
    expect(await violations(q('[data-testid="oa-panel"]')!)).toEqual([])
  })

  it('点击 / 键盘 ↓ 切换激活条目，详情跟随', async () => {
    await parsed()
    await click(q('[data-testid="oa-item-2"]'))
    expect(useStudio.getState().oaActiveItemId).toBe('2')
    expect(q('[data-testid="oa-detail-text"]')!.textContent).toContain('创造性')
    await act(async () => {
      q('[data-testid="oa-items"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(useStudio.getState().oaActiveItemId).toBe('3')
    await act(async () => {
      q('[data-testid="oa-items"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(useStudio.getState().oaActiveItemId).toBe('1')
  })

  it('上传 .txt 读入正文；docx 提示改为粘贴', async () => {
    await mount(<OaPanel />)
    const input = q<HTMLInputElement>('[data-testid="oa-file-input"]')!
    Object.defineProperty(input, 'files', { value: [new File(['1. 通知书正文'], 'oa.txt')], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(useStudio.getState().oaText).toBe('1. 通知书正文')
    Object.defineProperty(input, 'files', { value: [new File(['PK'], 'oa.docx')], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(useStudio.getState().toasts.some((t) => t.text.includes('.txt / .md'))).toBe(true)
  })

  it('拆条 501 ⇒ oa-unavailable 提示', async () => {
    vi.spyOn(api, 'oaParse').mockRejectedValue(new ApiError(501, 'E3 尚未实现'))
    await mount(<OaPanel />)
    await typeText(q<HTMLTextAreaElement>('#oa-text')!, '1. x')
    await click(q('[data-testid="oa-parse"]'))
    expect(q('[data-testid="oa-unavailable"]')).not.toBeNull()
  })
})

describe('OaPanel · 挂载恢复拆条工作集（D-OA-1）', () => {
  it('items.json 有存量时挂载即重建：列表 + 答复回填，不再只剩轮次计数', async () => {
    vi.spyOn(api, 'oaItems').mockResolvedValue({ items: ITEMS, warnings: ['第 3 条未识别涉及的权利要求'], answers: [ANSWER] })
    await mount(<OaPanel />)
    expect(qa('[role="option"]').length).toBe(3)
    expect(useStudio.getState().oaActiveItemId).toBe('1')
    expect(useStudio.getState().oaAnswers['1']?.amend_summary).toBe(ANSWER.amend_summary)
    expect(q('[data-testid="oa-detail"]')!.textContent).toContain('答复要点')
    expect(q('[data-testid="oa-warnings"]')!.textContent).toContain('第 3 条')
  })

  it('存量为空时保持空列表态（不造假条目）', async () => {
    vi.spyOn(api, 'oaItems').mockResolvedValue({ items: [], warnings: [], answers: [] })
    await mount(<OaPanel />)
    expect(qa('[role="option"]').length).toBe(0)
    expect(q('[data-testid="oa-text"]')).not.toBeNull()
  })

  it('只读角色：拆条 / 上传 / 生成 / 要点编辑全禁（后端 403 前的 UI 收口，批16 同族）', async () => {
    useStudio.setState({ project: { id: 'method', role: 'viewer' } as never, projectLoading: false })
    vi.spyOn(api, 'oaItems').mockResolvedValue({ items: ITEMS, warnings: [], answers: [ANSWER] })
    await mount(<OaPanel />)
    for (const t of ['oa-parse', 'oa-upload', 'oa-generate-all', 'oa-points-edit']) {
      expect(q<HTMLButtonElement>(`[data-testid="${t}"]`)!.disabled).toBe(true)
    }
    expect(q<HTMLTextAreaElement>('[data-testid="oa-text"]')!.disabled).toBe(true)
  })
})

describe('OaPanel · 生成答复 → 编辑要点 → 权项 CriticMarkup 写入 → 导出', () => {
  it('AI 开关关闭时生成按钮禁用并给出去开启的入口', async () => {
    useStudio.setState({ settings: { ai_enabled: false } as never })
    await parsed()
    expect(q<HTMLButtonElement>('[data-testid="oa-generate-all"]')!.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="oa-generate-one"]')!.disabled).toBe(true)
    await click(q('[data-testid="oa-ai-hint"]'))
    expect(useStudio.getState().railTab).toBe('ai')
  })

  it('「生成本条」只传该条 id；「生成全部」不传；job 进度条 → done 后 answers 落入 oaAnswers 并渲染答复卡', async () => {
    const answer = vi.spyOn(api, 'oaAnswer').mockResolvedValue(job())
    vi.spyOn(api, 'aiJob').mockResolvedValue(job({ status: 'running', progress: 0.3 }))
    await parsed()
    expect(q<HTMLButtonElement>('[data-testid="oa-export"]')!.hasAttribute('disabled')).toBe(true)

    await click(q('[data-testid="oa-generate-one"]'))
    expect(answer).toHaveBeenLastCalledWith('method', ['1'])
    await act(async () => useStudio.getState().upsertJob(job({ status: 'running', progress: 0.3, message: '生成第 1 条' })))
    expect(q('[data-testid="oa-progress"] [role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('30')
    expect(q<HTMLButtonElement>('[data-testid="oa-generate-all"]')!.disabled).toBe(true)

    await act(async () => useStudio.getState().upsertJob(job({ status: 'done', progress: 1, result: { answers: [ANSWER] } })))
    expect(useStudio.getState().oaAnswers['1']?.points.length).toBe(2)
    expect(q('[data-testid="oa-points"]')!.textContent).toContain('一体成型壳体解决密封问题')
    expect(q('[data-testid="oa-amend-summary"]')!.textContent).toContain('补入')
    expect(q('[data-testid="oa-critic-line"]')!.textContent).toContain('一体成型的壳体')
    expect(q('[data-testid="oa-item-1-status"]')!.textContent).toContain('已答复')
    const exp = q<HTMLAnchorElement>('[data-testid="oa-export"]')!
    expect(exp.tagName).toBe('A')
    expect(exp.getAttribute('href')).toBe(api.oaExportUrl('method'))
    expect(exp.hasAttribute('download')).toBe(true)
    expect(await violations(q('[data-testid="oa-panel"]')!)).toEqual([])

    useStudio.setState({ oaJobId: null })
    await click(q('[data-testid="oa-generate-all"]'))
    expect(answer).toHaveBeenLastCalledWith('method', null)
  })

  it('编辑要点：每行一条，保存 PUT …/oa/answers/{item_id} 后写回 oaAnswers（保留 applied）；取消不改', async () => {
    const put = vi.spyOn(api, 'oaUpdateAnswer').mockImplementation(async (_pid, itemId, points) => ({ ...ANSWER, item_id: itemId, points }))
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([{ ...ANSWER, applied: true }]))
    // W7 qa-06：h-6（24）紧凑钮在 touch 密度下升到 h-touch
    expect(q('[data-testid="oa-points-edit"]')!.className).toContain('in-data-[density=touch]:h-touch')
    expect(q('[data-testid="oa-goto-claim-1"]')!.className).toContain('in-data-[density=touch]:h-touch')
    await click(q('[data-testid="oa-points-edit"]'))
    const ta = q<HTMLTextAreaElement>('[data-testid="oa-points-textarea"]')!
    expect(ta.value).toBe(ANSWER.points.join('\n'))
    await typeText(ta, '要点甲\n\n要点乙\n要点丙')
    await click(q('[data-testid="oa-points-save"]'))
    expect(put).toHaveBeenCalledWith('method', '1', ['要点甲', '要点乙', '要点丙'])
    expect(useStudio.getState().oaAnswers['1'].points).toEqual(['要点甲', '要点乙', '要点丙'])
    expect(useStudio.getState().oaAnswers['1'].applied).toBe(true)
    expect(q('[data-testid="oa-points"]')!.textContent).toContain('要点丙')

    await click(q('[data-testid="oa-points-edit"]'))
    await typeText(q<HTMLTextAreaElement>('[data-testid="oa-points-textarea"]')!, '改掉')
    await click(q('[data-testid="oa-points-cancel"]'))
    expect(useStudio.getState().oaAnswers['1'].points).toEqual(['要点甲', '要点乙', '要点丙'])
  })

  it('写入权项：editorCommands.replaceLine(权项所在行, "", critic_line) → markOaApplied → 「去审阅」切 review；源码不被直接改写', async () => {
    const replace = vi.spyOn(editorCommands, 'replaceLine').mockReturnValue(true)
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([ANSWER]))
    await click(q('[data-testid="oa-apply-edits"]'))
    expect(replace).toHaveBeenCalledWith(7, '', ANSWER.claim_edits[0].critic_line)
    expect(useStudio.getState().oaAnswers['1'].applied).toBe(true)
    expect(useStudio.getState().content).toBe(CONTENT)
    expect(useStudio.getState().scrollRequest?.line).toBe(7)
    expect(q('[data-testid="oa-applied-badge"]')).not.toBeNull()
    expect(q('[data-testid="oa-item-1-status"]')!.textContent).toContain('已写入')
    expect(q('[data-testid="oa-apply-edits"]')).toBeNull()
    await click(q('[data-testid="oa-review"]'))
    expect(useStudio.getState().railTab).toBe('review')
  })

  it('编辑器未挂载（replaceLine=false）⇒ toast 提示，不标记 applied', async () => {
    vi.spyOn(editorCommands, 'replaceLine').mockReturnValue(false)
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([ANSWER]))
    await click(q('[data-testid="oa-apply-edits"]'))
    expect(useStudio.getState().oaAnswers['1'].applied).toBeUndefined()
    expect(useStudio.getState().toasts.some((t) => t.text.includes('编辑器未显示'))).toBe(true)
  })

  it('权项在源码中不存在 ⇒ 跳过并 toast', async () => {
    const replace = vi.spyOn(editorCommands, 'replaceLine').mockReturnValue(true)
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([{ ...ANSWER, claim_edits: [{ claim: 9, critic_line: '9. x' }] }]))
    await click(q('[data-testid="oa-apply-edits"]'))
    expect(replace).not.toHaveBeenCalled()
    expect(useStudio.getState().toasts.some((t) => t.text.includes('未找到权利要求 9'))).toBe(true)
  })

  it('「定位」权项 → gotoLine', async () => {
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([ANSWER]))
    await click(q('[data-testid="oa-goto-claim-1"]'))
    expect(useStudio.getState().scrollRequest?.line).toBe(7)
  })

  it('窄容器单列：详情有「返回列表」按钮（@2xl 隐藏）', async () => {
    await parsed()
    await click(q('[data-testid="oa-item-2"]'))
    const back = q('[data-testid="oa-back"]')!
    expect(back.className).toContain('@lg:hidden')
    await click(back)
    expect(q('[data-testid="oa-items"]')!.className).not.toContain('hidden')
  })

  it('批54：要点编辑脏态点「列表」→ DiscardDialog 拦截；确认放弃后回列表；继续编辑留下', async () => {
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([ANSWER]))
    await click(q('[data-testid="oa-points-edit"]'))
    await typeText(q<HTMLTextAreaElement>('[data-testid="oa-points-textarea"]')!, '改掉')
    await click(q('[data-testid="oa-back"]'))
    expect(q('[data-testid="discard-dialog"]')).not.toBeNull()
    // 继续编辑：留下，仍在编辑态、仍在详情
    await click(q('[data-testid="discard-stay"]'))
    expect(q('[data-testid="oa-points-textarea"]')).not.toBeNull()
    expect(q('[data-testid="oa-detail"]')).not.toBeNull()
    // 再点列表 → 放弃 → 回列表
    await click(q('[data-testid="oa-back"]'))
    await click(q('[data-testid="discard-confirm"]'))
    expect(q('[data-testid="oa-items"]')!.className).not.toContain('hidden')
    // 未保存：服务端要点仍是原值
    expect(useStudio.getState().oaAnswers['1'].points).toEqual(ANSWER.points)
  })

  it('批56：要点编辑脏态切换条目 → DiscardDialog 拦截；放弃后换条；继续编辑留下', async () => {
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([ANSWER]))
    await click(q('[data-testid="oa-points-edit"]'))
    await typeText(q<HTMLTextAreaElement>('[data-testid="oa-points-textarea"]')!, '改掉')
    // 脏态下点第二条 → 拦截，仍在第 1 条
    await click(q('[data-testid="oa-item-2"]'))
    expect(q('[data-testid="discard-dialog"]')).not.toBeNull()
    expect(useStudio.getState().oaActiveItemId).toBe('1')
    // 继续编辑：留下，仍在编辑态、仍在第 1 条
    await click(q('[data-testid="discard-stay"]'))
    expect(q('[data-testid="oa-points-textarea"]')).not.toBeNull()
    expect(useStudio.getState().oaActiveItemId).toBe('1')
    // 再点 → 放弃 → 切到第 2 条；未保存：服务端要点仍是原值
    await click(q('[data-testid="oa-item-2"]'))
    await click(q('[data-testid="discard-confirm"]'))
    expect(useStudio.getState().oaActiveItemId).toBe('2')
    expect(useStudio.getState().oaAnswers['1'].points).toEqual(ANSWER.points)
    // 批71：明示放弃后 store 草稿已清——切回第 1 条是新稿而非恢复残稿
    await click(q('[data-testid="oa-item-1"]'))
    await click(q('[data-testid="oa-points-edit"]'))
    expect(q<HTMLTextAreaElement>('[data-testid="oa-points-textarea"]')!.value).toBe(ANSWER.points.join('\n'))
  })

  it('批71：要点编辑态/草稿卸载保命——面板卸载重挂后仍处编辑态、文本原样恢复', async () => {
    await parsed()
    await act(async () => useStudio.getState().setOaAnswers([ANSWER]))
    await click(q('[data-testid="oa-points-edit"]'))
    await typeText(q<HTMLTextAreaElement>('[data-testid="oa-points-textarea"]')!, '半程草稿')
    await act(async () => root?.unmount())
    host.remove()
    /* 控制台页签切换/关控制台都卸载 OaPanel：store 草稿（按 itemId 认领）接管，重挂同条目直接恢复 */
    await mount(<OaPanel />)
    expect(q<HTMLTextAreaElement>('[data-testid="oa-points-textarea"]')!.value).toBe('半程草稿')
    expect(q('[data-testid="oa-detail"]')).not.toBeNull()
  })
})

describe('OaPanel · Z23 逐条证据链状态与导出提示', () => {
  it('status 字段驱动 待答/已答复/已交付 徽标；未答复条数提示显示在导出行', async () => {
    const items: OaItem[] = [
      { ...ITEMS[0], status: 'delivered', round_id: '1' },
      { ...ITEMS[1], status: 'answered', round_id: '1' },
      { ...ITEMS[2] },
    ]
    vi.spyOn(api, 'oaItems').mockResolvedValue({ items, warnings: [], answers: [ANSWER, { ...ANSWER, item_id: '2' }] })
    await mount(<OaPanel />)
    expect(q('[data-testid="oa-item-1-status"]')!.textContent).toBe('已交付')
    expect(q('[data-testid="oa-item-2-status"]')!.textContent).toBe('已答复')
    expect(q('[data-testid="oa-item-3-status"]')!.textContent).toBe('待答')
    expect(q('[data-testid="oa-unanswered"]')!.textContent).toContain('1 条未答复')
  })

  it('旧后端缺 status 字段时按本地答复推断（向后兼容）', async () => {
    vi.spyOn(api, 'oaItems').mockResolvedValue({ items: ITEMS, warnings: [], answers: [ANSWER] })
    await mount(<OaPanel />)
    expect(q('[data-testid="oa-item-1-status"]')!.textContent).toBe('已答复')
    expect(q('[data-testid="oa-item-2-status"]')!.textContent).toBe('待答')
    expect(q('[data-testid="oa-unanswered"]')!.textContent).toContain('2 条未答复')
  })
})
