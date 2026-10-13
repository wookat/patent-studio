// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { FormulaDialog } from '@/components/block-model/dialogs/FormulaDialog'
import { AssignReviewDialog } from '@/components/review/AssignReviewDialog'
import { ConfirmDialog } from '@/components/client/ConfirmDialog'
import { ShellDialogs } from '@/components/shell/ShellDialogs'
import { EquationEditor } from '@/components/layout-view/equation/EquationEditor'
import { LayoutCommentDrawer } from '@/components/layout-view/mobile/LayoutMobile'
import { CommentSheet } from '@/components/client/CommentSheet'
import { PdfLongPressSheet } from '@/components/mobile/PdfLongPressSheet'
import { PDF_LONG_PRESS_EVENT, type PdfLongPressDetail } from '@/components/preview/pdfLongPress'
import type { Member } from '@/lib/types'

/**
 * 未保存草稿守卫（R115 批8）：输入型对话框在脏态下经 Esc / 遮罩 / 取消关闭时先弹「放弃未保存的修改？」。
 * 覆盖三种接线形态：自带 ask 态（FormulaDialog）、store 脏态（AssignReviewDialog）、子表单 onDirty 上提（ConfirmDialog / RenameForm）。
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
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}

const setInput = async (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!
  await act(async () => {
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const dlg = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)
const discard = () => document.querySelector('[data-testid="discard-dialog"]')
const btnByText = (scope: Element | Document, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!

const member = (id: string): Member => ({
  user_id: id,
  email: `${id}@t.dev`,
  display_name: `成员${id}`,
  role: 'agent',
})

describe('未保存草稿守卫', () => {
  it('公式对话框：改过源码点取消 → 询问；继续编辑保留输入；放弃修改才关', async () => {
    const onClose = vi.fn()
    await mount(<FormulaDialog open initial="" onSubmit={vi.fn()} onClose={onClose} />)
    await setInput(dlg('formula-dialog')!.querySelector<HTMLTextAreaElement>('[data-testid="formula-source"]')!, 'x = 1')
    await click(btnByText(dlg('formula-dialog')!, '取消'))
    expect(discard()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    await click(discard()!.querySelector('[data-testid="discard-stay"]'))
    expect(discard()).toBeNull()
    expect(dlg('formula-dialog')!.querySelector<HTMLTextAreaElement>('[data-testid="formula-source"]')!.value).toBe('x = 1')

    await click(btnByText(dlg('formula-dialog')!, '取消'))
    await click(discard()!.querySelector('[data-testid="discard-confirm"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('公式对话框：未改动 → 取消直关不询问', async () => {
    const onClose = vi.fn()
    await mount(<FormulaDialog open initial="" onSubmit={vi.fn()} onClose={onClose} />)
    await click(btnByText(dlg('formula-dialog')!, '取消'))
    expect(discard()).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('指派审阅：填了到期日点取消 → 询问（store 成员生效）', async () => {
    useStudio.setState({ pid: 'p1', members: [member('u1')], user: { id: 'me', email: 'me@t.dev', display_name: '我', is_superuser: false } })
    const onOpenChange = vi.fn()
    await mount(<AssignReviewDialog open onOpenChange={onOpenChange} />)
    await setInput(dlg('assign-dialog')!.querySelector<HTMLInputElement>('[data-testid="assign-due"]')!, '2026-10-01')
    await click(btnByText(dlg('assign-dialog')!, '取消'))
    expect(discard()).not.toBeNull()
    await click(discard()!.querySelector('[data-testid="discard-confirm"]'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('批67 公式编辑器(sheet)：改过源码点取消 → 询问；放弃才关；未改动直关', async () => {
    const onClose = vi.fn()
    await mount(<EquationEditor open variant="sheet" anchor={null} initial={{ source: 'x', label: '' }} onSubmit={vi.fn()} onClose={onClose} />)
    const ta = dlg('equation-editor')!.querySelector<HTMLTextAreaElement>('textarea')!
    await setInput(ta, 'x+1')
    await click(btnByText(dlg('equation-editor')!, '取消'))
    expect(discard()).not.toBeNull()
    await click(discard()!.querySelector('[data-testid="discard-stay"]'))
    expect(discard()).toBeNull()
    expect(dlg('equation-editor')!.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('x+1')
    await click(btnByText(dlg('equation-editor')!, '取消'))
    await click(discard()!.querySelector('[data-testid="discard-confirm"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('批67 版面批注抽屉：输入后取消 → 询问；放弃才关', async () => {
    const onClose = vi.fn()
    await mount(<LayoutCommentDrawer target={{ blockId: 'b1', line: 1, quote: '引文' }} onClose={onClose} />)
    const ta = dlg('layout-comment-drawer')!.querySelector<HTMLTextAreaElement>('textarea')!
    await setInput(ta, '批注草稿')
    await click(btnByText(dlg('layout-comment-drawer')!, '取消'))
    expect(discard()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await click(discard()!.querySelector('[data-testid="discard-confirm"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('批67 客户意见抽屉：输入正文后 Esc → 询问；发送成功直关不询问', async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn(async () => true)
    await mount(<CommentSheet open onOpenChange={onOpenChange} anchor={null} comments={[]} guestName="" onGuestName={vi.fn()} onSubmit={onSubmit} />)
    await setInput(dlg('client-comment-sheet')!.querySelector<HTMLInputElement>('[data-testid="client-guest-name"]')!, '张三')
    await setInput(dlg('client-comment-sheet')!.querySelector<HTMLTextAreaElement>('[data-testid="client-comment-input"]')!, '意见草稿')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(discard()).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await click(discard()!.querySelector('[data-testid="discard-stay"]'))
    expect(discard()).toBeNull()
    // 发送成功（数据已提交）直关，不询问
    await click(dlg('client-comment-sheet')!.querySelector('[data-testid="client-comment-send"]'))
    await act(async () => Promise.resolve())
    expect(onSubmit).toHaveBeenCalledWith('意见草稿')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('批67 PDF长按批注表单：输入后取消 → 询问', async () => {
    useStudio.setState({ pdfLongPress: { book: 'description', blockId: 'b1', line: 1, page: 1 }, ast: null, content: '', pid: 'p1' } as never)
    await mount(<PdfLongPressSheet />)
    await click(dlg('pdf-long-press-sheet')!.querySelector('[data-testid="plp-comment"]'))
    const ta = dlg('pdf-long-press-sheet')!.querySelector<HTMLTextAreaElement>('[data-testid="plp-comment-body"]')!
    await setInput(ta, '长按批注草稿')
    await click(dlg('pdf-long-press-sheet')!.querySelector('[data-testid="plp-comment-actions"] button')!)
    expect(discard()).not.toBeNull()
    expect(useStudio.getState().pdfLongPress).not.toBeNull()
    await click(discard()!.querySelector('[data-testid="discard-confirm"]'))
    expect(useStudio.getState().pdfLongPress).toBeNull()
  })

  it('批68 PDF长按换目标：批注草稿脏态 → 新长按先询问；放弃才换锚回菜单', async () => {
    useStudio.setState({ pdfLongPress: { book: 'description', blockId: 'b1', line: 1, page: 1 }, ast: null, content: '', pid: 'p1' } as never)
    await mount(<PdfLongPressSheet />)
    await click(dlg('pdf-long-press-sheet')!.querySelector('[data-testid="plp-comment"]'))
    await setInput(dlg('pdf-long-press-sheet')!.querySelector<HTMLTextAreaElement>('[data-testid="plp-comment-body"]')!, '草稿')
    const fire = (detail: PdfLongPressDetail) =>
      act(async () => window.dispatchEvent(new CustomEvent<PdfLongPressDetail>(PDF_LONG_PRESS_EVENT, { detail })))
    // 新长按到达 → 询问而非直接换锚
    await fire({ blockId: 'b2', book: 'description', page: 2, line: 5, x: 0, y: 0, text: '' })
    expect(discard()).not.toBeNull()
    expect(useStudio.getState().pdfLongPress?.blockId).toBe('b1')
    // 继续编辑：目标与草稿都保留
    await click(discard()!.querySelector('[data-testid="discard-stay"]'))
    expect(dlg('pdf-long-press-sheet')!.querySelector<HTMLTextAreaElement>('[data-testid="plp-comment-body"]')!.value).toBe('草稿')
    // 放弃：换新目标并回菜单步
    await fire({ blockId: 'b2', book: 'description', page: 2, line: 5, x: 0, y: 0, text: '' })
    await click(discard()!.querySelector('[data-testid="discard-confirm"]'))
    expect(useStudio.getState().pdfLongPress?.blockId).toBe('b2')
    expect(dlg('pdf-long-press-sheet')!.querySelector('[data-testid="plp-comment-body"]')).toBeNull()
  })

  it('批68 PDF长按换目标：批注未输入 → 新长按直换锚不询问', async () => {
    useStudio.setState({ pdfLongPress: { book: 'description', blockId: 'b1', line: 1, page: 1 }, ast: null, content: '', pid: 'p1' } as never)
    await mount(<PdfLongPressSheet />)
    await click(dlg('pdf-long-press-sheet')!.querySelector('[data-testid="plp-comment"]'))
    await act(async () =>
      window.dispatchEvent(new CustomEvent<PdfLongPressDetail>(PDF_LONG_PRESS_EVENT, { detail: { blockId: 'b3', book: 'claims', page: 4, line: 1, x: 0, y: 0, text: '' } })),
    )
    expect(discard()).toBeNull()
    expect(useStudio.getState().pdfLongPress?.blockId).toBe('b3')
  })

  it('客户确认：填了备注点「再看看」→ 询问（子表单 onDirty 上提）；提交成功直关不询问', async () => {
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn(async () => true)
    await mount(<ConfirmDialog open onOpenChange={onOpenChange} version={3} guestName="张客户" onGuestName={vi.fn()} onConfirm={onConfirm} />)
    await setInput(dlg('client-confirm-dialog')!.querySelector<HTMLTextAreaElement>('[data-testid="client-confirm-note"]')!, '同意此版')
    await click(btnByText(dlg('client-confirm-dialog')!, '再看看'))
    expect(discard()).not.toBeNull()
    await click(discard()!.querySelector('[data-testid="discard-stay"]'))
    expect(discard()).toBeNull()
    // 提交成功（数据已保存）不应弹放弃询问
    await click(dlg('client-confirm-dialog')!.querySelector('[data-testid="client-confirm-submit"]'))
    await act(async () => Promise.resolve())
    expect(onConfirm).toHaveBeenCalledWith('同意此版')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('重命名案卷：改了名称点取消 → 询问；放弃修改回 null 且内容不动', async () => {
    useStudio.setState({ dialog: 'rename', project: { id: 'p1', title: '旧案名' } as never, saving: false })
    await mount(<ShellDialogs />)
    await setInput(dlg('rename-dialog')!.querySelector<HTMLInputElement>('#rename-title')!, '新案名')
    await click(btnByText(dlg('rename-dialog')!, '取消'))
    expect(discard()).not.toBeNull()
    await click(discard()!.querySelector('[data-testid="discard-confirm"]'))
    expect(useStudio.getState().dialog).toBeNull()
  })
})
