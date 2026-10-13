// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import type { BuildOutcome } from '@/lib/types'
import { useStudio } from '@/store'
import { MobileConsole } from '@/components/mobile/MobileConsole'
import { ConsoleSummary } from '../ConsoleSummary'

/**
 * W11 第四批：构建失败的默认展示是人话摘要，实现日志（traceback / soffice 命令）只在「原始日志」里。
 *  - ConsoleSummary：PDF 阶段失败 → 「DOCX 400 ms · PDF 转换失败」，按 timings 判断阶段，不解析错误原文
 *  - MobileConsole「输出」：标题 = 后端人话 message；原始日志 <details> 默认折叠
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})
beforeEach(() => {
  useStudio.setState(initial, true)
  useStudio.setState({ pid: 'p1', content: SYNTH_MD, ast: SYNTH_AST } as never)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const RAW = "soffice exit 1\nError: source file could not be loaded\nTraceback (most recent call last):\n  File \"lo.py\", line 100"
const pdfFail: BuildOutcome = {
  status: 'error',
  build_id: 'b1',
  seq: 1,
  timings: { docx_ms: 400, total_ms: 3200 },
  summary: null,
  error: { kind: 'build', message: 'PDF 转换失败：LibreOffice 未能完成转换，DOCX 已生成', line: null, detail: RAW },
  pdf_url: null,
  docx_url: '/api/projects/p1/builds/b1/out.docx',
  diagnostics: [],
}
const abstractFail: BuildOutcome = {
  ...pdfFail,
  timings: { total_ms: 120 },
  error: { kind: 'abstract_limit', message: '摘要超过 300 字（当前 374 字），请精简摘要正文', line: 5, detail: 'AssertionError: 摘要超过300字：374' },
}

describe('ConsoleSummary 构建失败横幅', () => {
  it('PDF 阶段失败 → DOCX 耗时 · PDF 转换失败；不出现 soffice / traceback', async () => {
    useStudio.setState({ phase: 'error', outcome: pdfFail } as never)
    const el = await mount(<ConsoleSummary />)
    const text = el.querySelector('[data-testid="console-summary"]')!.textContent!
    expect(text).toContain('构建失败')
    expect(text).toContain('DOCX 400 ms · PDF 转换失败')
    expect(text).not.toMatch(/soffice|Traceback|LibreOffice/)
  })
  it('DOCX 阶段失败 → 「DOCX 失败」，无 PDF 字段', async () => {
    useStudio.setState({ phase: 'error', outcome: abstractFail } as never)
    const el = await mount(<ConsoleSummary />)
    const text = el.querySelector('[data-testid="console-summary"]')!.textContent!
    expect(text).toContain('DOCX 失败')
    expect(text).not.toMatch(/PDF|AssertionError/)
  })
})

describe('MobileConsole「输出」错误块', () => {
  it('标题是人话 message；AssertionError / soffice 只在默认折叠的「原始日志」里；abstract 错误有语义定位按钮', async () => {
    useStudio.setState({ phase: 'error', outcome: abstractFail } as never)
    const el = await mount(<MobileConsole />)
    await act(async () => el.querySelector<HTMLElement>('[data-testid="mobile-console-tab-output"]')!.click())
    const alert = el.querySelector('[data-testid="mobile-console-build-error"]')!
    expect(alert.textContent).toContain('摘要超过 300 字')
    const raw = alert.querySelector<HTMLDetailsElement>('[data-testid="mobile-console-build-raw"]')!
    expect(raw.open).toBe(false)
    expect(raw.textContent).toContain('AssertionError')
    expect(alert.querySelector('pre')!.closest('details')).toBe(raw)
    expect(alert.textContent).toMatch(/在源码中定位到摘要/)
    expect(alert.textContent!.replace(raw.textContent!, '')).not.toMatch(/第 \d+ 行|content\.md|AssertionError/)
  })
  it('PDF 阶段失败：message 人话，原始日志里才有 soffice 命令输出', async () => {
    useStudio.setState({ phase: 'error', outcome: pdfFail } as never)
    const el = await mount(<MobileConsole />)
    await act(async () => el.querySelector<HTMLElement>('[data-testid="mobile-console-tab-output"]')!.click())
    const alert = el.querySelector('[data-testid="mobile-console-build-error"]')!
    const outside = alert.textContent!.replace(alert.querySelector('details')!.textContent!, '')
    expect(outside).toContain('PDF 转换失败')
    expect(outside).not.toMatch(/soffice|Traceback/)
    expect(alert.querySelector('details')!.textContent).toContain('soffice exit 1')
  })
})
