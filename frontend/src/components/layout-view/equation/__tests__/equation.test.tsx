// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { equationLine } from '@/components/block-model/edit/serialize'
import { EQUATION_SYNTAX_HELP, EquationEditor, MATHML_DEBOUNCE_MS, fromLatex, hasErrors, lintEquation, looksLikeLatex } from '..'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const messages = (s: string) => lintEquation(s).map((i) => `${i.level}:${i.message}`)

describe('公式子集校验（omml.py 线性语法；后端仍是唯一权威）', () => {
  it('EQUATION_SYNTAX_HELP 列出 omml.py 子集：下标 / 分式 / 根式 / 求和 / 定界符', () => {
    expect(EQUATION_SYNTAX_HELP.join(' ')).toMatch(/x_t.*a\/b.*√x.*Σ_\{i∈S\}.*\( \)/)
  })

  it('合法子集：无提示', () => {
    for (const s of ['ŷ_t = (1−w_t)·f_e(x_t) + w_t·f_cov(x_t, z_t)', 'a/b', '√(a+b)', 'Σ_{i∈S} x_i', 'L = ‖y − ŷ‖_2', 'S_检索 ∪ S_基线', 'x_{i,j}', '']) {
      expect(lintEquation(s), s).toEqual([])
    }
  })

  it('错误（阻止提交）：换行、含 $$', () => {
    expect(messages('a/b\nc')).toEqual(['error:公式必须单行（$$…$$ 独立成行）'])
    expect(messages('$$a$$')).toEqual(['error:源码不能含 $$'])
    expect(hasErrors(lintEquation('$$a$$'))).toBe(true)
    expect(hasErrors(lintEquation('a/'))).toBe(false)
  })

  it('提醒（可提交）：括号、LaTeX、上标、空分式 / 根式、悬空下标', () => {
    expect(messages('(a+b')).toEqual(['warn:括号不配对：( ) [ ] { } 需成对'])
    expect(messages('a)')).toEqual(['warn:括号不配对：( ) [ ] { } 需成对'])
    expect(messages('\\frac{a}{b}')).toContain('warn:内核是线性语法，不支持 LaTeX 命令（可用「转为线性」）')
    expect(messages('x^2')).toEqual(['warn:不支持上标 ^（内核只做下标 _）'])
    expect(messages('a / b')).toEqual([])
    expect(messages('(/b)')).toEqual(['warn:分式 / 两侧需有内容，如 a/b 或 (a+b)/(c)'])
    expect(messages('a/')).toEqual(['warn:分式 / 两侧需有内容，如 a/b 或 (a+b)/(c)'])
    expect(messages('√')).toEqual(['warn:根式 √ 后需有内容，如 √x 或 √(a+b)'])
    expect(messages('x_ + y')).toEqual(['warn:下标 _ 后需紧跟字母数字或 {…}，如 x_t、Σ_{i∈S}'])
  })
})

describe('LaTeX → 线性语法（best-effort 文本替换，非解析器）', () => {
  it('frac / sqrt / sum / 希腊字母 / 运算符 / 定界符', () => {
    expect(fromLatex('\\frac{a}{b}')).toBe('(a)/(b)')
    expect(fromLatex('\\frac{\\alpha + 1}{\\sqrt{x}}')).toBe('(α + 1)/(√(x))')
    expect(fromLatex('\\sum_{i \\in S} x_i \\cdot y_i')).toBe('Σ_{i ∈ S} x_i · y_i')
    expect(fromLatex('\\left( a \\right) \\leq b \\neq c \\to d')).toBe('( a ) ≤ b ≠ c → d')
    expect(fromLatex('a\\,b\\;c')).toBe('a b c')
    expect(looksLikeLatex('\\frac{a}{b}')).toBe(true)
    expect(looksLikeLatex('a/b')).toBe(false)
  })

  it('不平衡的 { } 原样保留，结果不再报 LaTeX 提示才算干净', () => {
    expect(fromLatex('\\frac{a}{b')).toBe('\\frac{a}{b')
    expect(lintEquation(fromLatex('\\frac{a}{b}'))).toEqual([])
  })
})

describe('EquationEditor', () => {
  let root: Root | null = null
  let host: HTMLElement

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    Element.prototype.scrollIntoView ??= () => {}
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.releasePointerCapture ??= () => {}
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    host?.remove()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function mount(el: ReactElement) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(el))
    return host
  }

  const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))
  const click = (el: Element | null) => act(async () => (el as HTMLElement).click())
  const testid = <T extends HTMLElement = HTMLElement>(id: string, scope: ParentNode = document) => scope.querySelector<T>(`[data-testid="${id}"]`)
  const setInput = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, 'value')?.set
      setter?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })

  async function violations(el: Element) {
    const res = await axe.run(el, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
    })
    return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  }

  it('popover：防抖后 POST /api/mathml 预览；符号面板插到光标；编号原文（含全角括号）；提交 { source, label } 并关闭', async () => {
    const mathml = vi.spyOn(api, 'mathml').mockResolvedValue({ mathml: '<math><mi>x</mi></math>' })
    const onSubmit = vi.fn().mockReturnValue(true)
    const onClose = vi.fn()
    const anchor = document.createElement('span')
    document.body.appendChild(anchor)
    await mount(<EquationEditor open variant="popover" anchor={anchor} initial={{ source: '', label: '' }} onSubmit={onSubmit} onClose={onClose} />)
    const dlg = testid('equation-editor')!
    expect(dlg.dataset.variant).toBe('popover')
    expect(dlg.getAttribute('role')).toBe('dialog')
    expect(document.getElementById(dlg.getAttribute('aria-describedby')!)?.textContent).toContain('Σ_{i∈S} 求和')
    expect(dlg.style.position).toBe('fixed')
    const ta = testid<HTMLTextAreaElement>('eq-source', dlg)!
    expect(ta.getAttribute('aria-describedby')).toBe(dlg.getAttribute('aria-describedby'))
    expect(testid<HTMLButtonElement>('eq-submit', dlg)!.disabled).toBe(true)

    await setInput(ta, 'a/b')
    expect(mathml).not.toHaveBeenCalled()
    await sleep(MATHML_DEBOUNCE_MS + 50)
    expect(mathml).toHaveBeenCalledTimes(1)
    expect(mathml.mock.calls[0][0]).toBe('a/b')
    expect(mathml.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
    expect(testid('eq-preview', dlg)!.querySelector('math mi')?.textContent).toBe('x')

    ta.setSelectionRange(3, 3)
    await click(dlg.querySelector('[data-testid="eq-symbols"] button[aria-label="根式"]'))
    expect(ta.value).toBe('a/b√()')
    expect(ta.selectionStart).toBe(5)

    await setInput(testid<HTMLInputElement>('eq-label', dlg)!, '（5）')
    expect(testid('eq-preview', dlg)!.textContent).toContain('（5）')
    await click(testid('eq-submit', dlg))
    expect(onSubmit).toHaveBeenCalledWith({ source: 'a/b√()', label: '（5）' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(equationLine('a/b√()', '（5）')).toBe('$$a/b√()$$ （5）')
  })

  it('R67-05：onSubmit 返 false（写回失败/冲突）→ 保持打开、已输内容不丢', async () => {
    vi.spyOn(api, 'mathml').mockResolvedValue({ mathml: '<math><mi>x</mi></math>' })
    const onSubmit = vi.fn().mockResolvedValue(false)
    const onClose = vi.fn()
    await mount(<EquationEditor open variant="popover" anchor={null} initial={{ source: 'x_t', label: '（1）' }} onSubmit={onSubmit} onClose={onClose} />)
    const dlg = testid('equation-editor')!
    const ta = testid<HTMLTextAreaElement>('eq-source', dlg)!
    await click(testid('eq-submit', dlg))
    await sleep(0)
    expect(onSubmit).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(testid('equation-editor')).not.toBeNull()
    expect(ta.value).toBe('x_t')
    // 拒后可重试：修成成功后允许关
    onSubmit.mockResolvedValue(true)
    await click(testid('eq-submit', dlg))
    await sleep(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('popover：错误（含 $$）阻止提交并 aria-invalid；LaTeX 输入出现「转为线性」；Esc 关闭；快速连续输入只发最后一次请求', async () => {
    const mathml = vi.spyOn(api, 'mathml').mockResolvedValue({ mathml: '<math><mi>y</mi></math>' })
    const onClose = vi.fn()
    const anchor = document.createElement('span')
    document.body.appendChild(anchor)
    await mount(<EquationEditor open variant="popover" anchor={anchor} initial={{ source: 'x_t', label: '（1）' }} onSubmit={() => true} onClose={onClose} />)
    const dlg = testid('equation-editor')!
    const ta = testid<HTMLTextAreaElement>('eq-source', dlg)!
    expect(ta.value).toBe('x_t')
    expect(testid('eq-submit', dlg)!.textContent).toBe('保存公式')

    await setInput(ta, '$$a$$')
    expect(ta.getAttribute('aria-invalid')).toBe('true')
    expect(testid<HTMLButtonElement>('eq-submit', dlg)!.disabled).toBe(true)
    expect(testid('eq-issues', dlg)!.textContent).toContain('不能含 $$')

    await setInput(ta, '\\frac{a}{b}')
    await click(testid('eq-from-latex', dlg))
    expect(ta.value).toBe('(a)/(b)')
    expect(testid('eq-from-latex', dlg)).toBeNull()
    expect(testid<HTMLButtonElement>('eq-submit', dlg)!.disabled).toBe(false)
    await sleep(MATHML_DEBOUNCE_MS + 50)
    expect(mathml).toHaveBeenCalledTimes(1)
    expect(mathml.mock.calls[0][0]).toBe('(a)/(b)')

    // 批67：源码已改动 → Esc 先弹 DiscardDialog，放弃才关
    await act(async () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(onClose).not.toHaveBeenCalled()
    const ask = document.querySelector('[data-testid="discard-dialog"]')!
    expect(ask).not.toBeNull()
    await act(async () => ask.querySelector<HTMLElement>('[data-testid="discard-confirm"]')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('预览失败：显示后端 message，不阻止提交', async () => {
    vi.spyOn(api, 'mathml').mockRejectedValue(new Error('unsupported token'))
    await mount(<EquationEditor open variant="popover" anchor={null} initial={{ source: 'a⊗b', label: '' }} onSubmit={() => true} onClose={() => {}} />)
    await sleep(MATHML_DEBOUNCE_MS + 50)
    expect(testid('eq-preview-status')!.textContent).toBe('预览失败：unsupported token')
    expect(testid('math-source')!.textContent).toBe('a⊗b')
    expect(testid<HTMLButtonElement>('eq-submit')!.disabled).toBe(false)
  })

  it('open=false 不渲染；anchor=null 就地渲染（不 portal）', async () => {
    const el = await mount(<EquationEditor open={false} variant="popover" anchor={null} initial={{ source: '', label: '' }} onSubmit={() => true} onClose={() => {}} />)
    expect(testid('equation-editor')).toBeNull()
    await act(async () => root!.unmount())
    root = null
    const el2 = await mount(<EquationEditor open variant="popover" anchor={null} initial={{ source: 'a', label: '' }} onSubmit={() => true} onClose={() => {}} />)
    expect(el2.contains(testid('equation-editor'))).toBe(true)
    expect(el).not.toBe(el2)
  })

  it('sheet（375）：底部抽屉 + 符号 / 编号 / 按钮 ≥44px（h-touch）；axe 0 serious/critical', async () => {
    vi.spyOn(api, 'mathml').mockResolvedValue({ mathml: '<math><mi>x</mi></math>' })
    await mount(<EquationEditor open variant="sheet" anchor={null} initial={{ source: 'a/b', label: '（2）' }} onSubmit={() => true} onClose={() => {}} />)
    const dlg = testid('equation-editor')!
    expect(dlg.dataset.variant).toBe('sheet')
    expect(dlg.getAttribute('role')).toBe('dialog')
    expect(dlg.dataset.side ?? dlg.className).toMatch(/bottom/)
    for (const b of dlg.querySelectorAll<HTMLButtonElement>('[data-testid="eq-symbols"] button')) expect(b.className).toContain('h-touch')
    expect(testid('eq-label', dlg)!.className).toContain('h-touch')
    expect(testid('eq-submit', dlg)!.className).toContain('h-touch')
    await sleep(MATHML_DEBOUNCE_MS + 50)
    expect(await violations(document.body)).toEqual([])
  })

  it('popover：axe 0 serious/critical', async () => {
    vi.spyOn(api, 'mathml').mockResolvedValue({ mathml: '<math><mi>x</mi></math>' })
    const anchor = document.createElement('button')
    anchor.textContent = '公式'
    document.body.appendChild(anchor)
    await mount(<EquationEditor open variant="popover" anchor={anchor} initial={{ source: 'a/b', label: '（2）' }} onSubmit={() => true} onClose={() => {}} />)
    await sleep(MATHML_DEBOUNCE_MS + 50)
    expect(await violations(document.body)).toEqual([])
  })
})
