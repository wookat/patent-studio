// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useStudio } from '@/store'
import { FilingDialog } from '../FilingDialog'

/**
 * 批74：递交「标记为已递交」表单草稿上提 store（filingDraft{key,filed,application_no}）——
 * 递交页随 hash 路由卸载时输入不丢；同键重开恢复、异键不串稿；提交成功/显式放弃清稿。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  useStudio.setState({ filingDraft: null })
})
async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function typeInput(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T | null

describe('<FilingDialog> 批74 草稿 hoist', () => {
  it('卸载→同键重开草稿原样恢复；异键不串稿按 initial 重种', async () => {
    const onOpenChange = () => {}
    await mount(<FilingDialog open draftKey="p1" initial={{ filed: '2026-01-01' }} onOpenChange={onOpenChange} onSubmit={async () => true} />)
    await typeInput(q<HTMLInputElement>('[data-testid="filing-no"]')!, '202610123456.7')
    expect(useStudio.getState().filingDraft).toMatchObject({ key: 'p1', application_no: '202610123456.7', filed: '2026-01-01' })
    /* 递交页随路由卸载（open 翻 false 也会重挂表单） */
    await act(async () => root?.unmount())
    root = null
    host?.remove()
    await mount(<FilingDialog open draftKey="p1" initial={{ filed: '2026-01-01' }} onOpenChange={onOpenChange} onSubmit={async () => true} />)
    expect(q<HTMLInputElement>('[data-testid="filing-no"]')!.value).toBe('202610123456.7')
    expect(q<HTMLInputElement>('[data-testid="filing-date"]')!.value).toBe('2026-01-01')
    /* 异案打开不串稿 */
    await act(async () => root?.unmount())
    root = null
    host?.remove()
    await mount(<FilingDialog open draftKey="p2" initial={{ filed: '2026-02-02', application_no: '202411111111.1' }} onOpenChange={onOpenChange} onSubmit={async () => true} />)
    expect(q<HTMLInputElement>('[data-testid="filing-no"]')!.value).toBe('202411111111.1')
    expect(q<HTMLInputElement>('[data-testid="filing-date"]')!.value).toBe('2026-02-02')
  })

  it('提交成功清稿（父级 setFilingOpen 关不经 onOpenChange，清稿在 submit 内）', async () => {
    await mount(<FilingDialog open draftKey="p1" initial={{}} onOpenChange={() => {}} onSubmit={async () => true} />)
    await typeInput(q<HTMLInputElement>('[data-testid="filing-no"]')!, '202610123456.7')
    expect(useStudio.getState().filingDraft?.application_no).toBe('202610123456.7')
    await act(async () => q<HTMLButtonElement>('[data-testid="filing-submit"]')!.click())
    expect(useStudio.getState().filingDraft).toBeNull()
  })
})
