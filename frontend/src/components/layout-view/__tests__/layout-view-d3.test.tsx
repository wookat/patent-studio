// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import goldenMethod from '../../../../../backend/tests/fixtures/ast_rich.json'
import content from '../../../../../backend/tests/fixtures/rich/content.md?raw'
import { paraLabel } from '@/components/block-model/model'
import { api, type BlockTemplate } from '@/lib/api'
import { useStudio } from '@/store'
import type { Ast, AstParagraph, AstTable } from '@/types/ast'
import { LayoutView, SlashMenu, numberCandidates, styleVars, toCritic } from '..'
import { toCriticBook } from '../mode/toCritic'
import { NumberMenu, useNumberMenu } from '../completion/NumberMenu'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const method = goldenMethod as unknown as Ast
const initial = useStudio.getInitialState()

/** 后端 critic.py 的 token 正则（行内、非贪婪）——前端产出必须逐个被它吃掉 */
const TOKEN = /\{\+\+(.*?)\+\+\}|\{--(.*?)--\}|\{~~(.*?)~>(.*?)~~\}|\{>>(.*?)<<\}|\{==(.*?)==\}/g
const stripToOld = (s: string) => s.replace(TOKEN, (_m, ins, del, oldS, _newS, _c, hi) => (ins != null ? '' : del != null ? del : oldS != null ? oldS : hi ?? ''))
const stripToNew = (s: string) => s.replace(TOKEN, (_m, ins, del, _oldS, newS, _c, hi) => (ins != null ? ins : del != null ? '' : newS != null ? newS : hi ?? ''))

const TEMPLATES: BlockTemplate[] = [
  { kind: 'paragraph', label: '段落', book: ['abstract', 'description'], markdown: '', cursor: { line: 1, col: 1 } },
  { kind: 'section', label: '一级标题', book: ['description'], markdown: '', cursor: { line: 1, col: 1 } },
  { kind: 'claim', label: '权项', book: ['claims'], markdown: '', cursor: { line: 1, col: 1 } },
  { kind: 'table', label: '表格', book: ['description'], markdown: '', cursor: { line: 1, col: 1 } },
  { kind: 'equation', label: '公式', book: ['description'], markdown: '', cursor: { line: 1, col: 1 } },
]

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // 桌面视口：工具条「插入」只在桌面格式工具条上（375 由底部 MobileLayoutToolbar 承担）
  window.matchMedia ??= (q: string) =>
    ({ matches: q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  useStudio.setState({ ...initial, pid: 'method', content, saved: content, ast: method, astContent: content, activeBlock: null, blockTemplates: TEMPLATES }, false)
  vi.spyOn(api, 'projects').mockResolvedValue([])
  vi.spyOn(api, 'getFigures').mockRejectedValue(new Error('offline'))
  vi.spyOn(api, 'styleCss').mockRejectedValue(new Error('offline'))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const block = (el: HTMLElement, id: string) => {
  for (const b of el.querySelectorAll<HTMLElement>('[data-block-id]')) if (b.dataset.blockId === id) return b
  throw new Error(`block ${id} not rendered`)
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

describe('D3 toCritic：审阅模式改动 → CriticMarkup（16 §4.5）', () => {
  it('无改动原样；替换 / 插入 / 删除 三种基本标记', () => {
    expect(toCritic('本发明涉及一种方法。', '本发明涉及一种方法。')).toBe('本发明涉及一种方法。')
    expect(toCritic('本发明涉及一种方法。', '本发明涉及一种装置。')).toBe('本发明涉及一种{~~方法~>装置~~}。')
    expect(toCritic('本发明涉及方法。', '本发明涉及一种方法。')).toBe('本发明涉及{++一种++}方法。')
    expect(toCritic('本发明涉及一种方法。', '本发明涉及方法。')).toBe('本发明涉及{--一种--}方法。')
    expect(toCritic('abc', 'abcd')).toBe('abc{++d++}')
    expect(toCritic('abcd', 'abc')).toBe('abc{--d--}')
  })

  it('多行块：只标改动行，标记不跨行；整行增删用 {++ ++} / {-- --}', () => {
    const oldMd = '第一行不变。\n第二行旧文。\n第三行不变。'
    const out = toCritic(oldMd, '第一行不变。\n第二行新文。\n第三行不变。\n新增第四行。')
    expect(out.split('\n')).toEqual(['第一行不变。', '第二行{~~旧~>新~~}文。', '第三行不变。', '{++新增第四行。++}'])
    for (const line of out.split('\n')) expect(line.replace(TOKEN, '')).not.toMatch(/[{}]/)
    expect(toCritic('a\nb\nc', 'a\nc')).toBe('a\n{--b--}\nc')
  })

  it('表格 / 公式 / 标题行：整块 {--旧--} 再 {++新++}，不做字符级 diff', () => {
    const oldT = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const newT = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |'
    expect(toCritic(oldT, newT).split('\n')).toEqual([...oldT.split('\n').map((l) => `{--${l}--}`), ...newT.split('\n').map((l) => `{++${l}++}`)])
    expect(toCritic('$$\nE=mc^2\n$$', '$$\nE=mc^3\n$$')).toBe('{--$$--}\n{--E=mc^2--}\n{--$$--}\n{++$$++}\n{++E=mc^3++}\n{++$$++}')
    expect(toCritic('# 技术领域', '# 背景技术')).toBe('{--# 技术领域--}\n{++# 背景技术++}')
  })

  it('旧文已有未决标记是边界：相邻 / 内部改动不嵌套，记号不裸露（w9qa-new-02）', () => {
    const o = '时间序{++审阅丙++}列预测'
    expect(toCritic(o, '时{++审阅丙++}列预测')).toBe('时{--间序--}{++审阅丙++}列预测')
    expect(toCritic(o, '时间序{++丙++}列预测')).toBe('时间序{++丙++}列预测')
    expect(toCritic(o, '时间序{++审阅丙丁++}列预测')).toBe('时间序{++审阅丙丁++}列预测')
    expect(toCritic(o, '时间序{++审阅丙++}列预X测')).toBe('时间序{++审阅丙++}列预{++X++}测')
    expect(toCritic('甲{--乙--}丙', '甲{--Z乙--}丙')).toBe('甲{--乙--}{++Z++}丙')
    expect(toCritic('甲{--乙--}丙', '甲{--乙--}丁')).toBe('甲{--乙--}{~~丙~>丁~~}')
    expect(toCritic('甲{--乙--}丙', '甲丙')).toBe('甲{--乙--}丙')
    expect(toCritic('甲{~~乙~>丁~~}丙', '甲{~~乙~>丁戊~~}丙')).toBe('甲{~~乙~>丁戊~~}丙')
    expect(toCritic('甲{~~乙~>丁~~}丙', '甲{~~乙~>~~}丙')).toBe('甲{--乙--}丙')
    expect(toCritic('甲{++乙++}丙', '甲丙')).toBe('甲丙')
    expect(toCritic('a\n甲{++乙++}丙', 'a')).toBe('a\n{--甲丙--}')
    for (const n of ['时{++审阅丙++}列预测', '时间序{++丙++}列预测', '甲{--Z乙--}丙']) {
      const out = toCritic(n.includes('审阅') ? o : '甲{--乙--}丙', n)
      expect(out.replace(TOKEN, '')).not.toMatch(/\{[+\-~>=]|[+\-~<=]\}/)
    }
  })

  it('产出能被后端 critic 正则逐 token 吃掉：接受 = 新文，拒绝 = 旧文', () => {
    const cases: [string, string][] = [
      ['本发明涉及一种方法。', '本发明涉及一种装置及系统。'],
      ['a\nb\nc', 'a\nB\nc\nd'],
      ['| a |\n| --- |\n| 1 |', '| a |\n| --- |\n| 2 |'],
      ['甲乙丙丁', '乙丙'],
      ['', '新段。'],
    ]
    for (const [o, n] of cases) {
      const out = toCritic(o, n)
      // 整行增删时换行符留在标记外（后端 TOKEN 无 DOTALL，标记不跨行），接受 / 拒绝后只可能多出空行
      const lines = (s: string) => s.split('\n').filter(Boolean)
      expect(lines(stripToNew(out))).toEqual(lines(n))
      expect(lines(stripToOld(out))).toEqual(lines(o))
      expect(out.replace(TOKEN, '')).not.toMatch(/\{[+\-~>=]|[+\-~<=]\}/)
    }
  })

  /** 审计 C14 / I-4 回归：审阅模式下选段加下标 / 加粗不得把 `_{` `}` `**` 拆成碎片插入（夹具里 `{++_{++}…{++}++}` 的生成路径） */
  it('行内格式片是原子：加下标 / 加粗 / 在格式片内续写 = 一条替换，标记内是完整行内语法', () => {
    expect(toCritic('告警假阳率均不超过预设显著性水平。', '告警假阳率均不_{超过预设显著性水平}。')).toBe('告警假阳率均不{~~超过预设显著性水平~>_{超过预设显著性水平}~~}。')
    expect(toCritic('部署于 Transformer 类模型', '部署于 **Transformer** 类模型')).toBe('部署于 {~~Transformer~>**Transformer**~~} 类模型')
    expect(toCritic('水 H_{2}O 分子', '水 H_{2}O_{2} 分子')).toBe('水 H_{2}O{++_{2}++} 分子')
    expect(toCritic('水 H_{2}O 分子', '水 H_{22}O 分子')).toBe('水 H{~~_{2}~>_{22}~~}O 分子')
    expect(toCritic('系数 x_t 与 y', '系数 x_{t+1} 与 y')).toBe('系数 x{~~_t~>_{t+1}~~} 与 y')
    expect(toCritic('<u>下划线</u>文', '<u>下划线甲</u>文')).toBe('{~~<u>下划线</u>~><u>下划线甲</u>~~}文')
    // 旧文既有标记里再加下标：仍不嵌套
    expect(toCritic('甲{++乙++}丙', '甲{++_{乙}++}丙')).toBe('甲{++_{乙}++}丙')
    for (const [o, n] of [
      ['告警假阳率均不超过预设显著性水平。', '告警假阳率均不_{超过预设显著性水平}。'],
      ['部署于 Transformer 类模型', '部署于 **Transformer** 类模型'],
      ['水 H_{2}O 分子', '水 H_{22}O 分子'],
    ] as const) {
      const out = toCritic(o, n)
      expect(stripToNew(out)).toBe(n)
      expect(stripToOld(out)).toBe(o)
      expect(out.replace(TOKEN, '')).not.toMatch(/\{[+\-~>=]|[+\-~<=]\}/)
    }
  })

  /** review-p2 回归：整书审阅写回（两块同时变 → bookDiff multi）不得因书里的 `#` 标题把全书标成删除 + 插入 */
  it('toCriticBook：按块对齐，只标改动块；标题与未动段落原样', () => {
    const book = '### 技术领域\n\n本发明涉及甲。\n\n### 背景技术\n\n现有技术乙。\n\n其二丙。'
    const next = '### 技术领域\n\n本发明涉及甲。审阅甲\n\n### 背景技术\n\n现有技乙。\n\n其二丙。'
    const out = toCriticBook(book, next)
    expect(out).toBe('### 技术领域\n\n本发明涉及甲。{++审阅甲++}\n\n### 背景技术\n\n现有技{--术--}乙。\n\n其二丙。')
    expect(stripToNew(out)).toBe(next)
    expect(stripToOld(out)).toBe(book)

    // 增删整块（含标题）：整块 {++ ++} / {-- --}，其余块不动
    const added = toCriticBook(book, `${book}\n\n### 发明内容\n\n新段。`)
    expect(added).toBe(`${book}\n\n{++### 发明内容++}\n\n{++新段。++}`)
    const removed = toCriticBook(book, '### 技术领域\n\n本发明涉及甲。\n\n其二丙。')
    expect(stripToOld(removed)).toBe(book)
    expect(removed).toContain('{--### 背景技术--}')
    expect(removed).toContain('{--现有技术乙。--}')
    expect(removed.startsWith('### 技术领域\n\n本发明涉及甲。')).toBe(true)
  })
})

describe('D3 style.css 注入与回退', () => {
  it('200 → <style> 注入；501 / 失败 → 无 <style>（用 layout-view.css 默认）；styleCssVersion +1 重取', async () => {
    const spy = vi.spyOn(api, 'styleCss').mockResolvedValue(':root{--ps-page-w:20cm}')
    const el = await mount(<LayoutView mode="readonly" books={['claims']} />)
    await flush()
    expect(el.querySelector('[data-testid="ps-style-css"]')?.textContent).toBe(':root{--ps-page-w:20cm}')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('method')

    spy.mockRejectedValue(Object.assign(new Error('not implemented'), { status: 501 }))
    await act(async () => useStudio.getState().bumpStyleCss())
    await flush()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(el.querySelector('[data-testid="ps-style-css"]')).toBeNull()
  })

  it('settings.style 覆盖 → 内联 --ps-* 变量（改字号立即生效，不等保存）', () => {
    expect(styleVars(undefined)).toEqual({})
    expect(styleVars({ sizes: { body: 12 }, page: { margin_left_mm: 30 }, fonts: { body_cjk: '宋体' }, paragraph: { line_spacing: 1.5 } })).toEqual({
      '--ps-size-body': '12pt',
      '--ps-margin-l': '30mm',
      '--ps-font-body-cjk': "'宋体'",
      '--ps-line-height': '1.5',
    })
  })
})

describe('D3 纸面：part 类映射 + AST 编号（16 §4.1）', () => {
  it('四张纸（摘要 / 权利要求书 / 说明书 / 说明书附图）+ 页眉书名 + A4 变量', async () => {
    const el = await mount(<LayoutView mode="edit" />)
    const papers = Array.from(el.querySelectorAll<HTMLElement>('.ps-paper'))
    expect(papers.map((p) => p.dataset.part)).toEqual(['abstract', 'claims', 'description', 'figures'])
    expect(papers.map((p) => p.querySelector('.ps-header')?.textContent)).toEqual(['说明书摘要', '权利要求书', '说明书', '说明书附图'])
    expect(el.querySelector('[data-testid="ps-pages"]')).not.toBeNull()
    expect(el.querySelector<HTMLElement>('[data-testid="layout-view"]')?.dataset.mode).toBe('edit')
  })

  it('块 → part 类；段号 / 图号 / 式号 只来自 AST（前端不重排号）', async () => {
    const el = await mount(<LayoutView mode="readonly" />)
    const paras = method.description.filter((b): b is AstParagraph => b.kind === 'paragraph')
    const bodyParas = paras.filter((p) => p.role !== 'table-caption')
    const captions = paras.filter((p) => p.role === 'table-caption')
    const tables = method.description.filter((b): b is AstTable => b.kind === 'table')
    const sections = method.description.filter((b) => b.kind === 'section' || b.kind === 'subsection')
    const eqs = method.description.filter((b) => b.kind === 'equation')

    expect(el.querySelectorAll('.ps-paper-abstract .ps-abstract')).toHaveLength(method.abstract.paragraphs.length)
    expect(el.querySelectorAll('.ps-paper-claims .ps-claim')).toHaveLength(method.claims.length)
    expect(el.querySelectorAll('.ps-paper-description .ps-desc-h')).toHaveLength(sections.length)
    expect(el.querySelectorAll('.ps-paper-description .ps-body')).toHaveLength(bodyParas.length)
    expect(el.querySelectorAll('.ps-paper-description .ps-caption')).toHaveLength(captions.length + tables.filter((t) => t.caption_after).length)
    expect(el.querySelectorAll('.ps-paper-description .ps-table')).toHaveLength(tables.length)
    expect(el.querySelectorAll('.ps-paper-description .ps-eq')).toHaveLength(eqs.length)
    expect(el.querySelectorAll('.ps-paper-figures .ps-figure')).toHaveLength(method.figures.length)
    expect(el.querySelectorAll('.ps-title').length).toBeGreaterThanOrEqual(2)

    // 段号徽标：正文段 + 表 + 表题，文本 = paraLabel(AST.para_no)，只读生成物
    const descNos = Array.from(el.querySelectorAll<HTMLElement>('.ps-paper-description .ps-para-no'))
    const expected = [
      ...paras.flatMap((p) => (p.para_no == null ? [] : [p.para_no])),
      ...tables.flatMap((t) => [t.para_no, ...(t.caption_after ? [t.caption_after.para_no] : []), ...(t.note ? [t.note.para_no] : [])]),
    ]
      .sort((a, b) => a - b)
      .map(paraLabel)
    expect(descNos.map((n) => n.textContent?.replace('生成段号 ', '')).sort()).toEqual(expected.sort())
    for (const n of descNos) {
      expect(n.getAttribute('contenteditable')).toBe('false')
      expect(n.dataset.generated).toBe('true')
    }
    // 式号 = AST label，原样；图号 = figures[].num
    const eqLabels = Array.from(el.querySelectorAll('.ps-eq .ps-eq-label')).map((e) => e.textContent?.trim())
    expect(eqLabels).toEqual(eqs.map((e) => (e.kind === 'equation' ? e.label : null)))
    expect(Array.from(el.querySelectorAll<HTMLElement>('.ps-figure')).map((f) => f.dataset.blockId)).toEqual(method.figures.map((f) => f.id))
    // 目标块能被键盘漫游定位（data-block-id 保留）
    expect(block(el, 'claims/1').classList.contains('ps-claim')).toBe(true)
  })

  it('axe：完整版面 0 serious / critical', async () => {
    const el = await mount(<LayoutView mode="edit" slots={{ modeIndicator: <span>编辑</span> }} />)
    await flush()
    expect(await violations(el)).toEqual([])
  })
})

describe('D3 `/` 插入菜单 + 编号补全', () => {
  it('SlashMenu：listbox / option、不嵌套 button、↑↓ 循环 + aria-activedescendant、Enter 选中、Esc 关闭、IME 组合中不响应', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const items = TEMPLATES.filter((t) => t.book.includes('description'))
    const el = await mount(<SlashMenu open autoFocus anchor={null} items={items} onSelect={onSelect} onClose={onClose} />)
    const list = el.querySelector<HTMLElement>('[role="listbox"]')!
    const opts = list.querySelectorAll('[role="option"]')
    expect(opts).toHaveLength(4)
    expect(list.querySelectorAll('[role="option"] button')).toHaveLength(0)
    expect(document.activeElement).toBe(list)
    expect(list.getAttribute('aria-activedescendant')).toBe(opts[0].id)

    await key(list, 'ArrowDown', { isComposing: true })
    expect(list.getAttribute('aria-activedescendant')).toBe(opts[0].id)
    await key(list, 'ArrowDown')
    expect(list.getAttribute('aria-activedescendant')).toBe(opts[1].id)
    expect(opts[1].getAttribute('aria-selected')).toBe('true')
    await key(list, 'ArrowUp')
    await key(list, 'ArrowUp')
    expect(list.getAttribute('aria-activedescendant')).toBe(opts[3].id)
    await key(list, 'Enter')
    expect(onSelect).toHaveBeenCalledWith('equation')
    await key(list, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await violations(el)).toEqual([])
  })

  it('SlashMenu error 态：禁用信息行如实报原因 + 重试伪项可键盘选中；不谎报「没有可插入块类型」', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const el = await mount(<SlashMenu open autoFocus anchor={null} items={[]} error="连接失败" onSelect={onSelect} onClose={onClose} />)
    const list = el.querySelector<HTMLElement>('[role="listbox"]')!
    const opts = list.querySelectorAll<HTMLElement>('[role="option"]')
    expect(opts).toHaveLength(2)
    expect(opts[0].dataset.kind).toBe('__template-error')
    expect(opts[0].textContent).toContain('块模板加载失败：连接失败')
    expect(opts[0].getAttribute('aria-disabled')).toBe('true')
    expect(opts[1].dataset.kind).toBe('__template-retry')
    // 禁用行 Enter 不触发 onSelect；重试行 Enter/点击均触发
    await key(list, 'Enter')
    expect(onSelect).not.toHaveBeenCalled()
    await key(list, 'ArrowDown')
    await key(list, 'Enter')
    expect(onSelect).toHaveBeenCalledWith('__template-retry')
    expect(await violations(el)).toEqual([])
  })

  it('工具条「插入」→ 按当前书过滤的模板（说明书末项「附图…」）；选中只调 insertBlock（前端不拼 Markdown）', async () => {
    const insert = vi.spyOn(api, 'insertBlock').mockResolvedValue({ content: content + '\n', block_id: 'description/技术领域/p0002', ast: method } as never)
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    // 先选中说明书第一段 → 插入锚点 = after_block_id
    const first = method.description.find((b) => b.kind === 'paragraph')!
    await act(async () => block(el, first.id).click())
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="layout-insert"]')!.click())
    const list = el.querySelector<HTMLElement>('[data-testid="slash-menu"]')!
    expect(Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).map((o) => o.dataset.kind)).toEqual(['paragraph', 'section', 'table', 'equation', 'figure-book'])
    await act(async () => list.querySelector<HTMLElement>('[data-kind="section"]')!.click())
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toBe('method')
    expect(insert.mock.calls[0][1]).toMatchObject({ kind: 'section', after_block_id: first.id })
    expect(insert.mock.calls[0][1]).not.toHaveProperty('markdown')
    expect(el.querySelector('[data-testid="slash-menu"]')).toBeNull()
  })

  it('批66 弹层 blur 延迟一拍判焦点：瞬态失焦不误关，真离开才关（D-B66-2）', async () => {
    const el = await mount(<LayoutView mode="edit" books={['description']} />)
    const list = () => el.querySelector<HTMLElement>('[data-testid="slash-menu"]')
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="layout-insert"]')!.click())
    expect(list()).not.toBeNull()
    // 瞬态 blur（宿主重渲染 / StrictMode 重挂的 relatedTarget=null 形态）：同一拍内焦点回列表 → 不关
    await act(async () => {
      list()!.blur()
      list()!.focus()
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(list()).not.toBeNull()
    // 真离开：焦点落到列表外，一拍后仍未回来 → 关
    await act(async () => list()!.blur())
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(list()).toBeNull()
  })

  it('只读模式：没有「插入」按钮，双击不进编辑，输入键只提示', async () => {
    const toast = vi.fn()
    useStudio.setState({ toast } as never, false)
    const el = await mount(<LayoutView mode="readonly" books={['description']} />)
    expect(el.querySelector('[data-testid="layout-insert"]')).toBeNull()
    const first = method.description.find((b) => b.kind === 'paragraph')!
    const b = block(el, first.id)
    await act(async () => b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(el.querySelector('[data-testid="block-editor"]')).toBeNull()
    expect(useStudio.getState().editingBlockId).toBeNull()
    b.focus()
    await key(b, 'a')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('只读'), 'info')
  })

  it('编号补全：候选只来自 AST；无候选不渲染；选中回传候选', async () => {
    const onSelect = vi.fn()
    function Harness({ kind }: { kind: '图' | '表' | '式' }) {
      const items = numberCandidates(method, kind)
      const nav = useNumberMenu(items, onSelect, () => {})
      return <NumberMenu open items={items} anchor={{ x: 10, y: 20 }} nav={nav} onSelect={onSelect} onClose={() => {}} />
    }
    const el = await mount(<Harness kind="表" />)
    const list = el.querySelector<HTMLElement>('[data-testid="number-menu"]')!
    expect(Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.textContent)).toEqual(['表1', '表2'])
    expect(list.style.left).toBe('10px')
    await act(async () => list.querySelectorAll<HTMLElement>('[role="option"]')[1].click())
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: '表', label: '表2' }))
    await act(async () => root!.unmount())
    root = null
    const empty = { ...method, figures: [] } as Ast
    expect(numberCandidates(empty, '图')).toEqual([])
    const el2 = await mount(
      (() => {
        function H() {
          const items = numberCandidates(empty, '图')
          const nav = useNumberMenu(items, onSelect, () => {})
          return <NumberMenu open items={items} anchor={null} nav={nav} onSelect={onSelect} onClose={() => {}} />
        }
        return <H />
      })(),
    )
    expect(el2.querySelector('[data-testid="number-menu"]')).toBeNull()
  })
})

describe('D3 模式：编辑直写 / 审阅经 toCritic / 只读', () => {
  const first = () => method.description.find((b) => b.kind === 'paragraph')!

  /** W9：整书编辑器直接输入（无弹窗 / 无提交键）；失焦即落盘 → saveBook → bookDiff 单块 → patchBlock */
  async function editAndSubmit(mode: 'edit' | 'review', append: string) {
    const patch = vi.spyOn(api, 'patchBlock').mockResolvedValue({ content, block_id: first().id, ast: method } as never)
    const el = await mount(<LayoutView mode={mode} books={['description']} />)
    expect(el.querySelector('[data-testid="block-editor"]')).toBeNull()
    const tb = el.querySelector<HTMLElement>('[data-testid="ps-book-description"] [role="textbox"]')!
    expect(tb.getAttribute('contenteditable')).toBe('true')
    const p = block(el, first().id)
    expect(tb.contains(p)).toBe(true)
    await act(async () => {
      const tn = p.appendChild(document.createTextNode(append))
      document.getSelection()!.collapse(tn, append.length)
      document.dispatchEvent(new Event('selectionchange'))
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => tb.dispatchEvent(new FocusEvent('blur')))
    await flush()
    await flush()
    expect(patch).toHaveBeenCalledTimes(1)
    return patch.mock.calls[0]
  }

  it('edit：patchBlock 收到原样 Markdown', async () => {
    const [pid, id, body] = await editAndSubmit('edit', '追加文字')
    expect(pid).toBe('method')
    expect(id).toBe(first().id)
    const md = (body as { markdown: string }).markdown
    expect(md.endsWith('追加文字')).toBe(true)
    expect(md).not.toContain('{++')
  })

  it('review：patchBlock 收到 toCritic 后的 CriticMarkup（原文保留，改动为建议）', async () => {
    const [, , body] = await editAndSubmit('review', '追加文字')
    const md = (body as { markdown: string }).markdown
    expect(md).toMatch(/\{\+\+追加文字\+\+\}$/)
    expect(stripToOld(md)).toBe(first().kind === 'paragraph' ? (first() as AstParagraph).text : '')
  })

  /** ux-01 回归：Backspace 删掉粗体字后 storedMarks 残留 strong，原地点击再 Ctrl+B 会把粗体「关掉」；mousedown 必须清 storedMarks */
  it('mousedown 清 storedMarks：Ctrl+B 后原地点击再输入 → 不加粗；不点击 → 加粗', async () => {
    vi.spyOn(api, 'patchBlock').mockResolvedValue({ content, block_id: first().id, ast: method } as never)
    const typeAt = async (tb: HTMLElement, p: HTMLElement, text: string) => {
      await act(async () => {
        const tn = p.appendChild(document.createTextNode(text))
        document.getSelection()!.collapse(tn, text.length)
        document.dispatchEvent(new Event('selectionchange'))
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(tb.textContent).toContain(text)
    }
    const setup = async () => {
      const el = await mount(<LayoutView mode="edit" books={['description']} />)
      const tb = el.querySelector<HTMLElement>('[data-testid="ps-book-description"] [role="textbox"]')!
      const p = block(el, first().id)
      await act(async () => {
        document.getSelection()!.collapse(p.lastChild!, p.lastChild!.textContent!.length)
        document.dispatchEvent(new Event('selectionchange'))
        await new Promise((r) => setTimeout(r, 0))
      })
      await act(async () => {
        tb.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true }))
      })
      return { tb, p }
    }
    const a = await setup()
    await typeAt(a.tb, a.p, '甲')
    expect(a.p.querySelector('strong')?.textContent).toBe('甲')

    const b = await setup()
    // jsdom 无 elementFromPoint（ProseMirror 自身 mousedown → posAtCoords 需要）
    document.elementFromPoint = () => null
    await act(async () => {
      b.p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      await new Promise((r) => setTimeout(r, 0))
    })
    await typeAt(b.tb, b.p, '乙')
    expect(b.p.querySelector('strong')).toBeNull()
    expect(b.tb.textContent).toContain('乙')
  })

  it('模式指示槽 + data-mode；readonly 时 aria-readonly 落在 contenteditable 上而非容器', async () => {
    const el = await mount(<LayoutView mode="readonly" books={['description']} slots={{ modeIndicator: <span data-testid="mi">只读</span> }} />)
    expect(el.querySelector('[data-testid="mi"]')?.textContent).toBe('只读')
    expect(el.querySelector('[data-testid="layout-view"]')?.getAttribute('aria-readonly')).toBeNull()
    expect(el.querySelectorAll('[contenteditable="true"]')).toHaveLength(0)
  })
})
