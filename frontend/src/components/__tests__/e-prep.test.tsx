// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import { useStudio } from '@/store'
import { Rail } from '@/components/shell/Rail'
import { ConsoleTabs } from '@/components/console/ConsoleTabs'
import { ConsoleBody } from '@/components/console/ConsolePanel'
import { AiPanel } from '@/components/ai/AiPanel'
import { TermsPanel } from '@/components/terms/TermsPanel'
import { ConvertDialog } from '@/components/convert/ConvertDialog'
import { deriveReplaceFix } from '@/components/console/fixParser'
import { findRule } from '@/components/console/consoleUtils'

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
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

const notImplemented = (unit: string) => new ApiError(501, `${unit} 尚未实现`)

beforeEach(() => {
  useStudio.setState({ pid: 'method', dialog: null, toasts: [], items: [], railTab: 'outline', outlineOpen: true, sideOutlineCollapsed: false })
  useStudio.getState().resetAi()
  useStudio.getState().resetTerms()
  useStudio.getState().resetConvert()
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

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)
const click = (el: Element) => act(async () => (el as HTMLElement).click())

describe('轨道 E prep：Rail「AI 助手」「术语」tab（09 §6）', () => {
  it('W6：Rail 无 AI tab（AI 走顶栏伴随栏）；「术语」是 role=tab、有 aria-label，点击 toggleCompanion(terms)；axe 无违规', async () => {
    const el = await mount(<Rail />)
    expect(q('[data-testid="rail-ai"]', el)).toBeNull()
    const terms = q('[data-testid="rail-terms"]', el)!
    expect(terms.getAttribute('role')).toBe('tab')
    expect(terms.getAttribute('aria-label')).toBe('术语')
    expect(terms.getAttribute('aria-selected')).toBe('false')
    await click(terms)
    expect(useStudio.getState().companion).toBe('terms')
    expect(q('[data-testid="rail-terms"]', el)!.getAttribute('aria-selected')).toBe('true')
    await click(terms)
    expect(useStudio.getState().companion).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('terms.* 诊断计入「术语」角标与 aria-label', async () => {
    useStudio.setState({
      items: [
        { id: 'terms.alias', severity: 'warning', source: 'lint', message: '别名', line: 3, replace: { from: '处理单元', to: '处理器' } },
        { id: 'terms.alias', severity: 'warning', source: 'lint', message: '别名', line: 9, replace: { from: '感测器', to: '传感器' } },
      ],
    })
    const el = await mount(<Rail />)
    expect(q('[data-testid="rail-terms"]', el)!.getAttribute('aria-label')).toBe('术语，2 处别名待统一')
  })
})

describe('轨道 E prep：控制台「OA 答复」tab', () => {
  it('tab 存在且 aria-controls 指向 tabpanel；切到 oa 渲染 OaPanel（粘贴框 + 拆条）', async () => {
    const el = await mount(<><ConsoleTabs /><ConsoleBody /></>)
    const tab = q('[data-testid="console-tab-oa"]', el)!
    expect(tab.getAttribute('role')).toBe('tab')
    expect(tab.getAttribute('aria-controls')).toBe('console-tabpanel')
    await click(tab)
    expect(useStudio.getState().consoleTab).toBe('oa')
    expect(q('[data-testid="oa-panel"]', el)).not.toBeNull()
    expect(q<HTMLTextAreaElement>('#oa-text', el)).not.toBeNull()
    expect(q('[data-testid="oa-parse"]', el)!.hasAttribute('disabled')).toBe(true)
    expect(await violations(el)).toEqual([])
  })

  it('拆条遇 501 → oaUnavailable，占位文案', async () => {
    vi.spyOn(api, 'oaParse').mockRejectedValue(notImplemented('E3-convert-oa'))
    useStudio.setState({ consoleTab: 'oa' })
    const el = await mount(<ConsoleBody />)
    await act(async () => useStudio.getState().setOaText('1. 关于权利要求1…'))
    await click(q('[data-testid="oa-parse"]', el)!)
    expect(useStudio.getState().oaUnavailable).toBe(true)
    expect(q('[data-testid="oa-unavailable"]', el)).not.toBeNull()
  })
})

describe('轨道 E prep：AiPanel / TermsPanel 501 占位', () => {
  it('AiPanel：开关默认关、状态 501 → 占位；axe 无违规', async () => {
    vi.spyOn(api, 'aiStatus').mockRejectedValue(notImplemented('E1-ai-client'))
    useStudio.setState({ settings: { abstract_figure: null, spec_figures: [], sub_except: [], abstract_limit: 300, style: {} } })
    const el = await mount(<AiPanel />)
    const sw = q('[data-testid="ai-enabled-switch"]', el)!
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(useStudio.getState().aiUnavailable).toBe(true)
    expect(q('[data-testid="ai-status"]', el)!.textContent).toContain('501')
    expect(await violations(el)).toEqual([])
  })

  it('TermsPanel：loadTerms 501 → termsUnavailable 占位', async () => {
    vi.spyOn(api, 'terms').mockRejectedValue(notImplemented('E2-terms'))
    const el = await mount(<TermsPanel />)
    expect(useStudio.getState().termsUnavailable).toBe(true)
    expect(q('[data-testid="terms-panel"]', el)!.textContent).toContain('501')
  })
})

describe('轨道 E prep：ConvertDialog（ui.dialog=convert）', () => {
  it('打开渲染标题与支持格式；关闭 resetConvert；axe 无违规', async () => {
    const el = await mount(<ConvertDialog />)
    await act(async () => useStudio.getState().openDialog('convert'))
    const dlg = q('[data-testid="convert-dialog"]')!
    expect(dlg.textContent).toContain('论文 / 技术交底书转专利')
    expect(dlg.textContent).toContain('.docx / .pdf / .md / .txt')
    expect(await violations(document.body)).toEqual([])
    await click(q('[data-testid="convert-close"]')!)
    expect(useStudio.getState().dialog).toBeNull()
    expect(el).toBeDefined()
  })
})

describe('轨道 E prep：Diagnostic.replace → 一键修复', () => {
  it('结构化 replace 优先于 fix 文本解析；terms.alias 有规则说明', () => {
    expect(deriveReplaceFix({ id: 'terms.alias', message: 'x', fix: undefined, replace: { from: '处理单元', to: '处理器' } })).toEqual({ from: '处理单元', to: '处理器' })
    expect(deriveReplaceFix({ id: 'terms.alias', message: 'x', fix: undefined, replace: { from: 'a', to: 'a' } })).toBeNull()
    expect(findRule('terms.alias')?.name).toContain('术语统一')
  })
})
