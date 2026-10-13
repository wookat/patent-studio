// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import type { Diagnostic } from '@/lib/types'
import { useStudio } from '@/store'
import type { Term, TermCandidate } from '@/types/terms'
import { TermsPanel } from '../TermsPanel'
import { TermRow } from '../TermRow'
import { applyTermReplace, parseAliases, validateTerm } from '../termsModel'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
})

const CONTENT = '## 说明书\n\n所述处理单元连接存储器。\n处理模块输出结果。\n'
const TERMS: Term[] = [
  { name: '处理器', aliases: ['处理单元', '处理模块'], en: 'processor', definition: '执行指令的部件', first_line: 3 },
  { name: '存储器', aliases: [], en: null, definition: null, first_line: null },
]
const ISSUES: Diagnostic[] = [
  { id: 'terms.alias#1', severity: 'warning', source: 'lint', message: '「处理单元」是术语「处理器」的别名', line: 3, replace: { from: '处理单元', to: '处理器' } },
  { id: 'terms.alias#2', severity: 'warning', source: 'lint', message: '「处理模块」是术语「处理器」的别名', line: 4, replace: { from: '处理模块', to: '处理器' } },
]

beforeEach(() => {
  useStudio.setState({ pid: 'method', dialog: null, toasts: [], items: [], railTab: 'outline', outlineOpen: true, content: CONTENT })
  useStudio.getState().resetTerms()
  vi.spyOn(api, 'terms').mockResolvedValue({ terms: TERMS, version: 1 })
  vi.spyOn(api, 'putTerms').mockImplementation(async (_pid, terms) => ({ terms, version: 1 }))
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
  return res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)
const qa = (sel: string, el: ParentNode = document) => Array.from(el.querySelectorAll<HTMLElement>(sel))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const type = (input: HTMLInputElement | HTMLTextAreaElement, v: string) =>
  act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const submit = (form: Element) => act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

describe('termsModel', () => {
  it('parseAliases 支持中英标点分隔并去重；validateTerm 校验重名 / 冲突', () => {
    expect(parseAliases('a、b, c；a\nd')).toEqual(['a', 'b', 'c', 'd'])
    expect(validateTerm({ ...TERMS[1], name: '' }, [])).toContain('不能为空')
    expect(validateTerm({ name: 'x', aliases: ['x'], en: null, definition: null, first_line: null }, [])).toContain('别名不能与主名')
    expect(validateTerm({ name: '处理器', aliases: [], en: null, definition: null, first_line: null }, TERMS)).toContain('同名')
    expect(validateTerm({ name: '新', aliases: ['处理单元'], en: null, definition: null, first_line: null }, TERMS)).toContain('冲突')
    expect(validateTerm({ name: '新', aliases: ['别'], en: null, definition: null, first_line: null }, TERMS)).toBeNull()
  })
  it('applyTermReplace：编辑器未挂载时回落到 store.content 行替换', () => {
    expect(applyTermReplace(3, '处理单元', '处理器')).toBe(true)
    expect(useStudio.getState().content.split('\n')[2]).toBe('所述处理器连接存储器。')
    expect(applyTermReplace(3, '不存在', 'x')).toBe(false)
  })
})

describe('TermsPanel（Rail「术语」；09 §6.3）', () => {
  it('挂载 loadTerms → 卡片列表显示主名 / 别名 / 英文 / 定义 / 首现；axe 0 critical/serious', async () => {
    const el = await mount(<TermsPanel />)
    const rows = qa('[data-testid="term-row"]', el)
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('处理器')
    expect(rows[0].textContent).toContain('处理单元、处理模块')
    expect(rows[0].textContent).toContain('processor')
    expect(rows[0].textContent).toContain('执行指令的部件')
    expect(rows[0].textContent).toContain('全文')
    expect(rows[0].textContent).not.toMatch(/L\d+|第 \d+ 行/)
    expect(q('[data-testid="terms-panel"]', el)!.getAttribute('data-layout')).toBe('cards')
    expect(await violations(el)).toEqual([])
  })

  it('R74-01：GET /terms 422（terms.json 腐坏）→ 错误态 + 重试，不冒充空表', async () => {
    vi.spyOn(api, 'terms').mockRejectedValue(new ApiError(422, 'terms.json 无法读取：JSON 解析失败'))
    const el = await mount(<TermsPanel />)
    expect(q('[data-testid="terms-empty"]', el)).toBeNull()
    const err = q('[data-testid="terms-error"]', el)!
    expect(err.textContent).toContain('术语表加载失败')
    expect(err.textContent).toContain('terms.json 无法读取')
    // 重试：后端恢复后回正常列表
    vi.spyOn(api, 'terms').mockResolvedValue({ terms: TERMS, version: 1 })
    await click(q('button', err)!)
    expect(q('[data-testid="terms-error"]', el)).toBeNull()
    expect(qa('[data-testid="term-row"]', el)).toHaveLength(2)
  })

  it('新增：表单有 label，本地校验重名，保存走 putTerms', async () => {
    const el = await mount(<TermsPanel />)
    await click(q('[data-testid="terms-add"]', el)!)
    const form = q('[data-testid="term-editor"]', el)!
    expect(form.getAttribute('aria-label')).toBe('新增术语')
    const nameInput = q<HTMLInputElement>('[data-testid="term-name"]', form)!
    expect(el.querySelector(`label[for="${nameInput.id}"]`)).not.toBeNull()
    await type(nameInput, '处理器')
    await submit(form)
    expect(q('[data-testid="term-editor-error"]', el)!.textContent).toContain('同名')
    expect(api.putTerms).not.toHaveBeenCalled()
    await type(nameInput, '控制器')
    await type(q<HTMLInputElement>('[data-testid="term-aliases"]', form)!, '控制单元、控制模块')
    await type(q<HTMLInputElement>('[data-testid="term-en"]', form)!, 'controller')
    await type(q<HTMLInputElement>('[data-testid="term-first-line"]', form)!, '12')
    expect(await violations(el)).toEqual([])
    await submit(form)
    expect(api.putTerms).toHaveBeenCalledTimes(1)
    const saved = (api.putTerms as unknown as { mock: { calls: [string, Term[]][] } }).mock.calls[0][1]
    expect(saved.at(-1)).toEqual({ name: '控制器', aliases: ['控制单元', '控制模块'], en: 'controller', definition: null, first_line: 12 })
    expect(qa('[data-testid="term-row"]', el)).toHaveLength(3)
    expect(q('[data-testid="term-editor"]', el)).toBeNull()
  })

  it('批71：表单草稿卸载保命——新增表单输一半卸载重挂，编辑态与五字段原样恢复', async () => {
    await mount(<TermsPanel />)
    await click(q('[data-testid="terms-add"]', host)!)
    await type(q<HTMLInputElement>('[data-testid="term-name"]', host)!, '控制器')
    await type(q<HTMLInputElement>('[data-testid="term-aliases"]', host)!, '控制单元')
    await act(async () => root?.unmount())
    host.remove()
    /* 面板随侧栏换面板/抽屉关闭卸载：termDraft 存 store，重挂直接回到撰写态 */
    const el = await mount(<TermsPanel />)
    expect(q<HTMLInputElement>('[data-testid="term-name"]', el)!.value).toBe('控制器')
    expect(q<HTMLInputElement>('[data-testid="term-aliases"]', el)!.value).toBe('控制单元')
    /* 脏稿下点「编辑」另一词条 → DiscardDialog 拦；确认放弃才换目标 */
    await click(qa('[data-testid="term-edit"]', el)[0])
    expect(q('[data-testid="discard-dialog"]')).not.toBeNull()
    await click(q('[data-testid="discard-confirm"]')!)
    expect(q('[data-testid="term-editor"]', el)!.getAttribute('aria-label')).toBe('编辑术语 处理器')
  })

  it('编辑（改主名保留其余）与两步删除', async () => {
    const el = await mount(<TermsPanel />)
    await click(qa('[data-testid="term-edit"]', el)[1])
    const form = q('[data-testid="term-editor"]', el)!
    expect(form.getAttribute('aria-label')).toBe('编辑术语 存储器')
    await type(q<HTMLInputElement>('[data-testid="term-name"]', form)!, '存储装置')
    await submit(form)
    let names = useStudio.getState().terms.map((t) => t.name)
    expect(names).toEqual(['处理器', '存储装置'])

    await click(qa('[data-testid="term-delete"]', el)[0])
    expect(q('[data-testid="term-delete-confirm"]', el)).not.toBeNull()
    expect(useStudio.getState().terms).toHaveLength(2)
    await click(q('[data-testid="term-delete-confirm"]', el)!)
    names = useStudio.getState().terms.map((t) => t.name)
    expect(names).toEqual(['存储装置'])
  })

  it('候选抽取 → 采纳进术语表并保存 / 忽略移出', async () => {
    const cands: TermCandidate[] = [
      { name: '存储器', count: 3, lines: [3], source: 'freq' },
      { name: '输出结果', count: 2, lines: [4], source: 'figure-label' },
    ]
    vi.spyOn(api, 'extractTerms').mockResolvedValue({ candidates: cands, ai_used: false })
    const el = await mount(<TermsPanel />)
    await click(q('[data-testid="terms-extract"]', el)!)
    expect((api.extractTerms as unknown as { mock: { calls: [string, { ai: boolean }][] } }).mock.calls[0][1].ai).toBe(false)
    expect(qa('[data-testid="term-candidate"]', el)).toHaveLength(2)
    expect(qa('[data-testid="term-candidate"]', el)[1].textContent).toContain('附图标记')
    await click(qa('[data-testid="term-candidate-dismiss"]', el)[0])
    expect(qa('[data-testid="term-candidate"]', el)).toHaveLength(1)
    await click(q('[data-testid="term-candidate-adopt"]', el)!)
    expect(q('[data-testid="term-candidates"]', el)).toBeNull()
    expect(useStudio.getState().terms.map((t) => t.name)).toEqual(['处理器', '存储器', '输出结果'])
    expect(useStudio.getState().terms.at(-1)!.first_line).toBe(4)
    expect(api.putTerms).toHaveBeenCalledTimes(1)
  })

  it('一致性问题列表：来自 terms.* 诊断，逐条一键改为主名；主名行显示命中数', async () => {
    useStudio.setState({ items: ISSUES })
    const el = await mount(<TermsPanel />)
    expect(qa('[data-testid="terms-issue"]', el)).toHaveLength(2)
    expect(q('[data-testid="term-issue-count"]', el)!.textContent).toBe('2')
    expect(q('[data-testid="terms-unify"]', el)!.textContent).toContain('（2）')
    await click(qa('[data-testid="term-fix-button"]', el)[0])
    expect(useStudio.getState().content.split('\n')[2]).toBe('所述处理器连接存储器。')
    expect(await violations(el)).toEqual([])
  })

  it('一键统一：调 unifyTerms → CriticMarkup 写回 content（非静默改写）→ 跳审阅面板', async () => {
    useStudio.setState({ items: ISSUES })
    const critic = '## 说明书\n\n所述{~~处理单元~>处理器~~}连接存储器。\n{~~处理模块~>处理器~~}输出结果。\n'
    const spy = vi.spyOn(api, 'unifyTerms').mockResolvedValue({ critic_markdown: critic, count: 2, changed_lines: [3, 4] })
    const el = await mount(<TermsPanel />)
    await click(q('[data-testid="terms-unify"]', el)!)
    expect(spy.mock.calls[0][1]).toEqual({ content: CONTENT, names: undefined })
    expect(useStudio.getState().content).toBe(critic)
    expect(useStudio.getState().railTab).toBe('review')
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('审阅')
  })

  it('统一结果 0 处：不跳转', async () => {
    vi.spyOn(api, 'unifyTerms').mockResolvedValue({ critic_markdown: CONTENT, count: 0, changed_lines: [] })
    const el = await mount(<TermsPanel />)
    await click(q('[data-testid="terms-unify"]', el)!)
    expect(useStudio.getState().railTab).toBe('outline')
    expect(useStudio.getState().content).toBe(CONTENT)
  })

  it('TermRow 表格变体：五列 + 操作；axe 0 critical/serious', async () => {
    const el = await mount(
      <table>
        <thead>
          <tr>
            <th>主名</th>
            <th>别名</th>
            <th>英文</th>
            <th>定义</th>
            <th>首现</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <TermRow term={TERMS[0]} issueCount={1} variant="table" onEdit={() => {}} onDelete={() => {}} onGotoLine={() => {}} />
        </tbody>
      </table>,
    )
    expect(qa('td', el)).toHaveLength(6)
    expect(q('[data-testid="term-issue-count"]', el)!.textContent).toBe('1')
    expect(await violations(el)).toEqual([])
  })
})
