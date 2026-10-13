// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio, type DockHandle } from '@/store'
import type { BuildOutcome } from '@/lib/types'
import type { PdfBlockIndex } from '@/lib/pdfIndex'
import { installPdfIndex, resetPdfIndex } from '../pdfFocus'
import { PdfSelectionBar } from '../PdfSelectionBar'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const URL_A = '/api/p/1/build/out.pdf'
let root: Root | null = null
let host: HTMLElement

/** 假索引：第 1 页 = 摘要（abstract/p1） */
const index: PdfBlockIndex = {
  kind: 'struct',
  byBlock: new Map(),
  byMcid: new Map(),
  bookOfPage: (page) => (page === 1 ? 'abstract' : 'description'),
  pageSize: () => ({ width: 595, height: 842 }),
  locate: () => ({ blockId: 'abstract/p1', line: 3 }),
}

function fakeDock(open: string[]): DockHandle & { openPanel: ReturnType<typeof vi.fn> } {
  return {
    openPanel: vi.fn(),
    panelIds: () => open,
    isPanelVisible: () => true,
  } as unknown as DockHandle & { openPanel: ReturnType<typeof vi.fn> }
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  installPdfIndex(URL_A, index)
  useStudio.setState({
    pid: 'p1',
    lastOk: { ok: true } as unknown as BuildOutcome,
    stale: false,
    lastOkEditAt: 100,
    contentEditedAt: 50,
    focus: null,
    editorView: 'source',
    activePanelId: 'pdf',
    activeBook: 'description',
    dockHandle: null,
    mobileTab: 'preview',
  } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  resetPdfIndex()
  useStudio.setState({ dockHandle: null })
  vi.restoreAllMocks()
})

async function mount(onClose = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(<PdfSelectionBar sel={{ x: 0, y: 0, text: '一种数据处理方法', hit: { page: 1, text: '一种数据处理方法' } }} url={URL_A} onClose={onClose} />),
  )
  return onClose
}

const click = (sel: string) => act(async () => host.querySelector<HTMLButtonElement>(sel)!.click())

describe('PdfSelectionBar「在源码打开 / 在版面打开」跨书（W5 走查 domain-02）', () => {
  it('dock：当前源码卡片是 description，选中摘要文字 → 打开 source:abstract（同 tab 组）并 setFocus(abstract/p1)，关闭浮条', async () => {
    const dock = fakeDock(['source:description', 'pdf', 'outline'])
    useStudio.setState({ dockHandle: dock })
    const onClose = await mount()
    expect(host.querySelector<HTMLButtonElement>('[data-testid="pdf-sel-source"]')!.disabled).toBe(false)
    await click('[data-testid="pdf-sel-source"]')
    expect(dock.openPanel).toHaveBeenCalledWith('source:abstract', { position: { referencePanel: 'source:description', direction: 'within' } })
    expect(useStudio.getState().focus).toMatchObject({ book: 'abstract', blockId: 'abstract/p1', line: 3, page: 1, source: 'pdf' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dock：「在版面打开」→ layout:abstract；已开则只激活', async () => {
    const dock = fakeDock(['layout:abstract', 'pdf'])
    useStudio.setState({ dockHandle: dock })
    await mount()
    await click('[data-testid="pdf-sel-layout"]')
    expect(dock.openPanel).toHaveBeenCalledWith('layout:abstract', undefined)
    expect(useStudio.getState().editorView).toBe('layout')
    expect(useStudio.getState().focus?.book).toBe('abstract')
  })

  it('无 dock（375 / 窄桌面）：activeBook 从 claims 切到 abstract，编辑 Tab', async () => {
    useStudio.setState({ activeBook: 'claims' })
    await mount()
    await click('[data-testid="pdf-sel-source"]')
    const s = useStudio.getState()
    expect(s.activeBook).toBe('abstract')
    expect(s.mobileTab).toBe('edit')
    expect(s.focus?.blockId).toBe('abstract/p1')
  })
})

describe('批67 批注草稿守卫', () => {
  const discard = () => document.querySelector('[data-testid="discard-dialog"]')
  const typeDraft = async (v: string) => {
    const ta = host.querySelector<HTMLTextAreaElement>('.pdf-sel-bar textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(ta, v)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const keyEsc = async () => {
    const bar = host.querySelector<HTMLElement>('.pdf-sel-bar')!
    await act(async () => bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  }

  it('已输入批注 Esc → 询问；放弃才关；未输入 Esc 直关', async () => {
    const onClose = await mount()
    await click('[data-testid="pdf-sel-comment"]')
    await typeDraft('批注草稿')
    await keyEsc()
    expect(discard()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    // 继续编辑：稿件还在
    await act(async () => discard()!.querySelector<HTMLElement>('[data-testid="discard-stay"]')!.click())
    expect(host.querySelector<HTMLTextAreaElement>('.pdf-sel-bar textarea')!.value).toBe('批注草稿')
    // Esc → 放弃 → onClose
    await keyEsc()
    await act(async () => discard()!.querySelector<HTMLElement>('[data-testid="discard-confirm"]')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('已输入批注点取消 → 询问收起；放弃后收起批注框但浮条不关', async () => {
    const onClose = await mount()
    await click('[data-testid="pdf-sel-comment"]')
    await typeDraft('草稿')
    const cancel = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '取消')!
    await act(async () => cancel.click())
    expect(discard()).not.toBeNull()
    await act(async () => discard()!.querySelector<HTMLElement>('[data-testid="discard-confirm"]')!.click())
    // 批注框收起、浮条仍在
    expect(host.querySelector('.pdf-sel-bar textarea')).toBeNull()
    expect(host.querySelector('[data-testid="pdf-sel-comment"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('批注框空内容点取消 → 直接收起不询问', async () => {
    await mount()
    await click('[data-testid="pdf-sel-comment"]')
    const cancel = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '取消')!
    await act(async () => cancel.click())
    expect(discard()).toBeNull()
    expect(host.querySelector('.pdf-sel-bar textarea')).toBeNull()
  })

  it('批68 已输入批注点「定位源码」→ 询问；放弃后才执行跳转并关浮条', async () => {
    const dock = fakeDock(['source:description', 'pdf'])
    useStudio.setState({ dockHandle: dock })
    const onClose = await mount()
    await click('[data-testid="pdf-sel-comment"]')
    await typeDraft('草稿')
    await click('[data-testid="pdf-sel-source"]')
    expect(discard()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(useStudio.getState().focus).toBeNull()
    // 继续编辑：不跳转、稿件保留
    await act(async () => discard()!.querySelector<HTMLElement>('[data-testid="discard-stay"]')!.click())
    expect(useStudio.getState().focus).toBeNull()
    expect(host.querySelector<HTMLTextAreaElement>('.pdf-sel-bar textarea')!.value).toBe('草稿')
    // 放弃：执行原意图——定位 + 关浮条
    await click('[data-testid="pdf-sel-source"]')
    await act(async () => discard()!.querySelector<HTMLElement>('[data-testid="discard-confirm"]')!.click())
    expect(useStudio.getState().focus).toMatchObject({ book: 'abstract', blockId: 'abstract/p1', source: 'pdf' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('批68 onDirty：打开批注并输入后向宿主上报脏态，卸载复位', async () => {
    const onDirty = vi.fn()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () =>
      root!.render(<PdfSelectionBar sel={{ x: 0, y: 0, text: '一种数据处理方法', hit: { page: 1, text: '一种数据处理方法' } }} url={URL_A} onClose={vi.fn()} onDirty={onDirty} />),
    )
    await click('[data-testid="pdf-sel-comment"]')
    await typeDraft('草稿')
    expect(onDirty).toHaveBeenLastCalledWith(true)
    await act(async () => root?.unmount())
    root = null
    expect(onDirty).toHaveBeenLastCalledWith(false)
  })
})
