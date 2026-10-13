// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import { useStudio } from '@/store'
import type { AiJob } from '@/types/ai'
import { ConvertDialog } from '@/components/convert/ConvertDialog'
import { classifyDiffLine, diffStats, fileExt, validateConvertFile } from '@/components/convert/convertUtils'
import { fmtBytes } from '@/lib/format'

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

beforeEach(() => {
  useStudio.setState({ pid: 'method', dialog: 'convert', toasts: [], content: '# T\n', saved: '# T\n' })
  useStudio.getState().resetAi()
  useStudio.getState().resetConvert()
  useStudio.getState().resetHistory()
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
const click = (el: Element | null) => act(async () => (el as HTMLElement).click())
const dialog = () => q('[data-testid="convert-dialog"]')!
const view = () => dialog().getAttribute('data-view')

const mdFile = (name = 'paper.md', text = '# 一种传感器\n\n本文提出……') => new File([text], name, { type: 'text/markdown' })

async function pickFile(file: File) {
  const input = q<HTMLInputElement>('[data-testid="convert-file-input"]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // 文本类预览是 file.text() 异步读取
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function toTargetStep(file = mdFile()) {
  await pickFile(file)
  await click(q('[data-testid="convert-next"]'))
  await click(q('[data-testid="convert-skip"]'))
  expect(view()).toBe('target')
}

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 'job_c1',
  kind: 'convert',
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

describe('convertUtils', () => {
  it('扩展名 / 校验 / 体积 / diff 行分类', () => {
    expect(fileExt('A.Paper.DOCX')).toBe('docx')
    expect(fileExt('noext')).toBe('')
    expect(validateConvertFile(new File(['x'], 'a.pdf'))).toBeNull()
    expect(validateConvertFile(new File(['x'], 'a.doc'))).toMatch(/不支持的格式「.doc」/)
    expect(validateConvertFile(new File([], 'a.md'))).toBe('文件为空')
    expect(validateConvertFile(new File([new Uint8Array(21 * 1024 * 1024)], 'a.docx'))).toMatch(/文件过大：上限 20 MB/)
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
    expect(classifyDiffLine('+++ b/content.md')).toBe('meta')
    expect(classifyDiffLine('@@ -1 +1 @@')).toBe('hunk')
    expect(classifyDiffLine('+新增')).toBe('add')
    expect(classifyDiffLine('-删除')).toBe('del')
    expect(diffStats('--- a\n+++ b\n@@\n+x\n+y\n-z\n c')).toEqual({ added: 2, deleted: 1 })
  })
})

describe('ConvertDialog · 向导 ①②③', () => {
  it('① 选文件：未选时「下一步」禁用；不支持的格式报错；md 文件显示元信息 + 抽取预览；axe 无违规', async () => {
    await mount(<ConvertDialog />)
    expect(view()).toBe('pick')
    expect(q('[data-testid="convert-dropzone"]')).not.toBeNull()
    expect(q<HTMLButtonElement>('[data-testid="convert-next"]')!.disabled).toBe(true)

    await pickFile(new File(['x'], 'a.doc'))
    expect(q('[data-testid="convert-file-error"]')!.textContent).toMatch(/不支持的格式/)
    expect(useStudio.getState().convertFile).toBeNull()

    await pickFile(mdFile())
    expect(useStudio.getState().convertFile?.name).toBe('paper.md')
    expect(q('[data-testid="convert-file-info"]')!.textContent).toContain('paper.md')
    expect(q('[data-testid="convert-preview"]')!.textContent).toContain('一种传感器')
    expect(q<HTMLButtonElement>('[data-testid="convert-next"]')!.disabled).toBe(false)
    expect(await violations(dialog())).toEqual([])

    await click(q('[data-testid="convert-file-remove"]'))
    expect(useStudio.getState().convertFile).toBeNull()
    expect(q('[data-testid="convert-dropzone"]')).not.toBeNull()
  })

  it('docx 只显示元信息（抽取在后台），不出现前端预览', async () => {
    await mount(<ConvertDialog />)
    await pickFile(new File(['PK'], 'thesis.docx'))
    expect(q('[data-testid="convert-file-info"]')!.textContent).toContain('后台任务抽取')
    expect(q('[data-testid="convert-preview"]')).toBeNull()
  })

  it('② 问卷：6 个字段写入 questionnaire，可「上一步」；「跳过问卷」直达 ③', async () => {
    await mount(<ConvertDialog />)
    await pickFile(mdFile())
    await click(q('[data-testid="convert-next"]'))
    expect(view()).toBe('questionnaire')
    expect(useStudio.getState().convertStep).toBe('questionnaire')
    expect(document.querySelectorAll('[data-testid^="convert-q-"]').length).toBe(6)
    const ta = q<HTMLTextAreaElement>('[data-testid="convert-q-problem"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '功耗高')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useStudio.getState().questionnaire.problem).toBe('功耗高')
    expect(await violations(dialog())).toEqual([])

    await click(q('[data-testid="convert-back"]'))
    expect(view()).toBe('pick')
    await click(q('[data-testid="convert-next"]'))
    await click(q('[data-testid="convert-skip"]'))
    expect(view()).toBe('target')
  })

  it('③ 目标 + 明示外发：默认新案卷；未勾选知悉时「开始生成」禁用且不调用 api.convert；勾选后调用并进入 running', async () => {
    const convert = vi.spyOn(api, 'convert').mockResolvedValue(job())
    vi.spyOn(api, 'aiJob').mockResolvedValue(job())
    await mount(<ConvertDialog />)
    await toTargetStep()
    expect(q('[data-testid="convert-ack-row"]')!.textContent).toContain('发送到 AI 中转站')
    expect(q<HTMLInputElement>('[data-testid="convert-target-new"]')!.checked).toBe(true)
    const start = q<HTMLButtonElement>('[data-testid="convert-start"]')!
    expect(start.disabled).toBe(true)
    expect(await violations(dialog())).toEqual([])

    await click(q('[data-testid="convert-target-draft"]'))
    expect(useStudio.getState().convertTarget).toEqual({ pid: 'method' })
    await click(q('[data-testid="convert-ack"]'))
    expect(useStudio.getState().convertAiAck).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="convert-start"]')!.disabled).toBe(false)

    await click(q('[data-testid="convert-start"]'))
    expect(convert).toHaveBeenCalledTimes(1)
    expect(convert.mock.calls[0][2]).toEqual({ pid: 'method' })
    expect(convert.mock.calls[0][3]).toBe(true)
    expect(view()).toBe('running')
    expect(q('[role="progressbar"]')).not.toBeNull()
  })

  it('来源为案卷附件（文件树「转为专利」）：① 显示附件卡且可下一步；POST 带 attachment_pid + attachment 不带 file', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(job()), { status: 202 }))
    vi.spyOn(api, 'aiJob').mockResolvedValue(job())
    useStudio.getState().setConvertAttachment({ pid: 'method', name: '现有技术.pdf', size: 2048 })
    await mount(<ConvertDialog />)
    const info = q('[data-testid="convert-attachment-info"]')!
    expect(info.textContent).toContain('现有技术.pdf')
    expect(info.textContent).toContain('本案附件')
    expect(info.textContent).not.toContain('attachments/')
    expect(q('[data-testid="convert-file-info"]')).toBeNull()
    expect(q<HTMLButtonElement>('[data-testid="convert-next"]')!.disabled).toBe(false)
    await click(q('[data-testid="convert-next"]'))
    await click(q('[data-testid="convert-skip"]'))
    await click(q('[data-testid="convert-ack"]'))
    await click(q('[data-testid="convert-start"]'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const fd = fetchMock.mock.calls[0][1]?.body as FormData
    expect(fd.get('file')).toBeNull()
    expect(fd.get('attachment_pid')).toBe('method')
    expect(fd.get('attachment')).toBe('现有技术.pdf')
    expect(view()).toBe('running')
    // 「移除」回到空选择；选本地文件会清掉附件来源
    useStudio.getState().resetConvert()
    useStudio.getState().setConvertAttachment({ pid: 'method', name: 'a.md', size: 1 })
    useStudio.getState().setConvertFile(mdFile())
    expect(useStudio.getState().convertAttachment).toBeNull()
  })

  it('后端 501 ⇒ 显示「尚未落地」提示，不崩', async () => {
    vi.spyOn(api, 'convert').mockRejectedValue(new ApiError(501, 'E3 尚未实现'))
    await mount(<ConvertDialog />)
    await toTargetStep()
    await click(q('[data-testid="convert-ack"]'))
    await click(q('[data-testid="convert-start"]'))
    expect(useStudio.getState().convertUnavailable).toBe(true)
    expect(q('[data-testid="convert-unavailable"]')).not.toBeNull()
    expect(view()).toBe('error')
  })
})

describe('ConvertDialog · 后台进度 → 结果 / diff / 采纳 / 丢弃', () => {
  async function runToDone(target: 'new' | 'draft', result: Record<string, unknown>) {
    vi.spyOn(api, 'convert').mockResolvedValue(job())
    vi.spyOn(api, 'aiJob').mockResolvedValue(job({ status: 'running', progress: 0.5 }))
    await mount(<ConvertDialog />)
    await toTargetStep()
    if (target === 'draft') await click(q('[data-testid="convert-target-draft"]'))
    await click(q('[data-testid="convert-ack"]'))
    await click(q('[data-testid="convert-start"]'))
    expect(view()).toBe('running')

    await act(async () => useStudio.getState().upsertJob(job({ status: 'running', progress: 0.4, message: '正在抽取文本' })))
    expect(q('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('40')
    expect(q('[data-testid="convert-job-message"]')!.textContent).toContain('正在抽取文本')

    await act(async () => useStudio.getState().upsertJob(job({ status: 'done', progress: 1, result })))
    expect(view()).toBe('done')
  }

  const report = { warnings: ['摘要 312 字，超 300'], terms: [{ name: '传感器', aliases: ['感测器'] }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }

  it('目标=当前案卷草稿：done 后显示报告 + 复用 history diff；「采纳」走 restoreVersion 并关闭；工作区在采纳前不变', async () => {
    const historyDiff = vi.spyOn(api, 'historyDiff').mockResolvedValue({ a: 'abc1234def', b: 'work', diff: '--- a\n+++ b\n@@ -1 +1 @@\n-# T\n+# 一种传感器' })
    const restore = vi.spyOn(api, 'restoreVersion').mockResolvedValue({ ok: true, content: '# 一种传感器\n', sha_new: 'ffff', changed: true })
    await runToDone('draft', { draft_sha: 'abc1234def', report })

    expect(q('[data-testid="convert-report"]')!.textContent).toContain('版本 abc1234')
    expect(q('[data-testid="convert-warnings"]')!.textContent).toContain('超 300')
    expect(q('[data-testid="convert-terms"]')!.textContent).toContain('传感器')
    expect(q('[data-testid="convert-usage"]')!.textContent).toContain('150')
    await act(async () => {
      await Promise.resolve()
    })
    expect(historyDiff).toHaveBeenCalledWith('method', 'abc1234def', 'work')
    expect(q('[data-testid="convert-diff-body"]')!.textContent).toContain('+# 一种传感器')
    expect(useStudio.getState().content).toBe('# T\n')
    expect(await violations(dialog())).toEqual([])

    await click(q('[data-testid="convert-adopt"]'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(restore).toHaveBeenCalledWith('method', 'abc1234def')
    expect(useStudio.getState().content).toBe('# 一种传感器\n')
    expect(useStudio.getState().dialog).toBeNull()
    expect(useStudio.getState().convertStep).toBe('pick')
  })

  it('「丢弃」只关闭并重置，不调用 restoreVersion，工作区不变', async () => {
    vi.spyOn(api, 'historyDiff').mockResolvedValue({ a: 'abc', b: 'work', diff: '' })
    const restore = vi.spyOn(api, 'restoreVersion')
    await runToDone('draft', { draft_sha: 'abc', report })
    await click(q('[data-testid="convert-discard"]'))
    expect(restore).not.toHaveBeenCalled()
    expect(useStudio.getState().content).toBe('# T\n')
    expect(useStudio.getState().dialog).toBeNull()
    expect(useStudio.getState().convertJobId).toBeNull()
  })

  it('目标=新案卷：done 后显示「打开新案卷」，点击经 requestNavigation 打开 new_pid', async () => {
    vi.spyOn(api, 'project').mockRejectedValue(new ApiError(404, 'x'))
    await runToDone('new', { new_pid: 'sensor-2026', report })
    expect(q('[data-testid="convert-report"]')!.textContent).toContain('新案卷「sensor-2026」')
    expect(q('[data-testid="convert-diff"]')).toBeNull()
    await click(q('[data-testid="convert-open-new"]'))
    expect(useStudio.getState().dialog).toBeNull()
    expect(useStudio.getState().pid).toBe('sensor-2026')
  })

  it('任务 error ⇒ 错误视图 + 「重新选择文件」回到 ①', async () => {
    vi.spyOn(api, 'convert').mockResolvedValue(job())
    vi.spyOn(api, 'aiJob').mockResolvedValue(job())
    await mount(<ConvertDialog />)
    await toTargetStep()
    await click(q('[data-testid="convert-ack"]'))
    await click(q('[data-testid="convert-start"]'))
    await act(async () => useStudio.getState().upsertJob(job({ status: 'error', error: { kind: 'parse', message: 'parse_ast 未通过' } })))
    expect(view()).toBe('error')
    expect(q('[data-testid="convert-step-error"]')!.textContent).toContain('parse_ast 未通过')
    await click(q('[data-testid="convert-retry"]'))
    expect(view()).toBe('pick')
  })

  it('运行中关闭：对话框关闭、toast 提示后台继续', async () => {
    vi.spyOn(api, 'convert').mockResolvedValue(job())
    vi.spyOn(api, 'aiJob').mockResolvedValue(job())
    await mount(<ConvertDialog />)
    await toTargetStep()
    await click(q('[data-testid="convert-ack"]'))
    await click(q('[data-testid="convert-start"]'))
    await click(q('[data-testid="convert-close"]'))
    expect(useStudio.getState().dialog).toBeNull()
    expect(useStudio.getState().toasts.some((t) => t.text.includes('后台'))).toBe(true)
  })
})

describe('ConvertDialog · 关闭焦点还给菜单栏「文件」', () => {
  it('存在 [data-testid=menu-file] 时关闭后焦点落在它上', async () => {
    const menu = document.createElement('button')
    menu.setAttribute('data-testid', 'menu-file')
    document.body.appendChild(menu)
    try {
      await mount(<ConvertDialog />)
      await click(q('[data-testid="convert-close"]'))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(document.activeElement).toBe(menu)
    } finally {
      menu.remove()
    }
  })
})
