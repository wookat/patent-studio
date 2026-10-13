// @vitest-environment jsdom
import axe from 'axe-core'
import { act, forwardRef, useImperativeHandle, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookSwitcher } from '../BookSwitcher'
import { MobileBookEditor } from '../MobileBookEditor'
import { useStudio } from '@/store'
import type { Diagnostic } from '@/lib/types'

const { gone, putDoc } = vi.hoisted(() => ({
  gone: [] as number[],
  putDoc: vi.fn(async (..._a: unknown[]) => ({
    ok: true,
    backup: null,
    backups: [],
  })),
}))

/** CodeMirror 在 jsdom 里没有布局；这里换成受控 textarea，只验 MobileBookEditor 的切片 / 回写 / 行号换算接线 */
vi.mock('@/components/editor/Editor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/editor/Editor')>()
  const CodeMirrorEditor = forwardRef<
    { gotoLine(line: number): void },
    {
      value: string
      onChange: (v: string) => void
      diagnostics?: Diagnostic[]
      onCursor?: (c: { line: number; col: number }) => void
      placeholder?: string
    }
  >(function Fake({ value, onChange, diagnostics, onCursor, placeholder }, ref) {
    useImperativeHandle(ref, () => ({
      gotoLine(line: number) {
        gone.push(line)
      },
    }))
    return (
      <div>
        <textarea
          aria-label="源码"
          data-testid="fake-cm"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => onCursor?.({ line: 2, col: 1 })}
        />
        <ul data-testid="fake-diags">
          {(diagnostics ?? []).map((d) => (
            <li key={d.id + d.line}>{`${d.line}:${d.message}`}</li>
          ))}
        </ul>
      </div>
    )
  })
  return { ...mod, CodeMirrorEditor }
})

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return { ...mod, api: { ...mod.api, putDoc } }
})

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  gone.length = 0
  putDoc.mockClear()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: {
      'color-contrast': { enabled: false },
      'scrollable-region-focusable': { enabled: false },
      region: { enabled: false },
    },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const DOC = '# 题\n\n## 摘要\nA1\n\n## 权利要求书\n1. C1\n2. C2\n\n## 说明书\nD1\nD2\n'
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    content: DOC,
    saved: DOC,
    activeBook: 'all',
    saving: false,
    items: [],
    marks: [],
    scrollRequest: null,
  })
})

describe('BookSwitcher（08 §9）', () => {
  it('roving tabindex：只有选中项可 Tab 到；←/→/Home/End 切书并移焦', async () => {
    const el = await mount(<BookSwitcher />)
    const radios = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1])
    radios[0].focus()
    await act(async () => void key(radios[0], 'ArrowRight'))
    expect(useStudio.getState().activeBook).toBe('abstract')
    expect(document.activeElement?.getAttribute('data-value')).toBe('abstract')
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1])
    await act(async () => void key(radios[1], 'End'))
    expect(useStudio.getState().activeBook).toBe('description')
    await act(async () => void key(radios[3], 'ArrowRight'))
    expect(useStudio.getState().activeBook).toBe('all')
    await act(async () => void key(radios[0], 'ArrowLeft'))
    expect(useStudio.getState().activeBook).toBe('description')
    await act(async () => void key(radios[3], 'Home'))
    expect(useStudio.getState().activeBook).toBe('all')
    expect(el.querySelector('[data-testid="book-switcher-save"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('单书模式：保存按钮只在本书 dirty 时可用，点击走 PUT /docs/{book}', async () => {
    useStudio.setState({ activeBook: 'claims' })
    const el = await mount(<BookSwitcher />)
    const save = el.querySelector<HTMLButtonElement>('[data-testid="book-switcher-save"]')!
    expect(save.getAttribute('aria-label')).toBe('保存权利要求书')
    expect(save.disabled).toBe(true)
    await act(async () => useStudio.getState().setBookContent('description', 'D1 改\nD2'))
    expect(save.disabled).toBe(true)
    await act(async () => useStudio.getState().setBookContent('claims', '1. C1 改\n2. C2'))
    expect(save.disabled).toBe(false)
    await act(async () => save.click())
    /* 批78 契约：putDoc 带 base_sha（saved 书文 sha1，乐观并发）且哈希计算在异步微任务里 */
    await vi.waitFor(() => expect(putDoc).toHaveBeenCalledTimes(1))
    expect(putDoc.mock.calls[0]).toEqual(['p1', 'claims', { content: '1. C1 改\n2. C2\n', base_sha: expect.anything() }])
    expect(save.disabled).toBe(true)
    expect(useStudio.getState().saved).toContain('## 权利要求书\n1. C1 改\n2. C2\n')
    expect(useStudio.getState().saved).toContain('## 说明书\nD1\nD2')
    expect(await violations(el)).toEqual([])
  })
})

describe('MobileBookEditor（08 §9）', () => {
  it('只装本书正文；击键经 setBookContent 回写全文，其他书逐字节不动', async () => {
    const el = await mount(<MobileBookEditor book="claims" />)
    const ta = el.querySelector<HTMLTextAreaElement>('[data-testid="fake-cm"]')!
    expect(ta.value).toBe('1. C1\n2. C2\n\n')
    expect(el.querySelector('[data-testid="mobile-book-editor"]')?.getAttribute('data-file')).toBe('claims.md')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '1. C1 改\n2. C2\n\n')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useStudio.getState().content).toBe('# 题\n\n## 摘要\nA1\n\n## 权利要求书\n1. C1 改\n2. C2\n\n## 说明书\nD1\nD2\n')
    expect(await violations(el)).toEqual([])
  })

  it('诊断 / 跳行按全文行 ↔ 书相对行换算；跳到别的书时切 activeBook；光标上报换回全文行', async () => {
    const diag = (id: string, line: number): Diagnostic => ({
      id,
      line,
      message: id,
      severity: 'error',
      source: 'build',
    })
    useStudio.setState({ items: [diag('a', 4), diag('c', 8), diag('d', 12)] })
    const el = await mount(<MobileBookEditor book="claims" />)
    expect(el.querySelector('[data-testid="fake-diags"]')?.textContent).toBe('2:c')

    useStudio.setState({ activeBook: 'claims' })
    await act(async () => useStudio.getState().gotoLine(8))
    expect(gone).toEqual([2])
    expect(useStudio.getState().scrollRequest).toBeNull()
    expect(useStudio.getState().activeBook).toBe('claims')

    await act(async () => useStudio.getState().gotoLine(12))
    expect(useStudio.getState().activeBook).toBe('description')

    await act(async () => useStudio.getState().gotoLine(1))
    expect(useStudio.getState().activeBook).toBe('all')

    await act(async () => el.querySelector<HTMLTextAreaElement>('[data-testid="fake-cm"]')!.focus())
    expect(useStudio.getState().cursor.line).toBe(8)
  })

  it('content.md 缺该书标题时给出回到全文的出口', async () => {
    useStudio.setState({ content: '# 只有标题\n', saved: '# 只有标题\n' })
    const el = await mount(<MobileBookEditor book="abstract" />)
    expect(el.querySelector('[data-testid="mobile-book-missing"]')).not.toBeNull()
    useStudio.setState({ activeBook: 'abstract' })
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="mobile-book-missing"] button')!.click())
    expect(useStudio.getState().activeBook).toBe('all')
    expect(await violations(el)).toEqual([])
  })
})
