// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import goldenMethod from '../../../../../backend/tests/golden/ast_method.json'
import content from '../../../../../examples/method/content.md?raw'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import type { Ast } from '@/types/ast'
import { BlockEditorHost } from '../BlockEditorHost'
import { closeBlockEditor, openBlockEditor } from '../state'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
const method = goldenMethod as unknown as Ast
const initial = useStudio.getInitialState()
let root: Root | null = null
let host: HTMLElement
let desktop = true

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
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
  desktop = true
  useStudio.setState({ ...initial, pid: 'method', content, saved: content, ast: method, astContent: content, projectLoading: false }, false)
  vi.spyOn(api, 'projects').mockResolvedValue([])
})
afterEach(async () => {
  await act(async () => root?.unmount())
  closeBlockEditor()
  host?.remove()
})

/**
 * 打开即可键入（05 §3.18）：焦点必须在 ProseMirror 正文里，而不是卡片内首个 <button>（「取消」）——后者是 W7 ux-01 / qa-04 的真实复现：
 * PopoverContent 的自动聚焦接管了 BlockEditor 挂载时已经做好的 v.focus()。焦点不在编辑器里时 blur 即提交关闭，Enter 会触发取消。
 */
it('桌面卡片：打开后焦点在 ProseMirror 正文（不是「取消」按钮），头部显示 书 · 段落 语义定位（不露源码行号）', async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<BlockEditorHost />))
  const first = method.description.find((b) => b.kind === 'paragraph')!
  await act(async () => openBlockEditor({ blockId: first.id, source: 'pdf', anchor: { x: 100, y: 100 } }))
  await act(async () => {})
  expect(document.querySelector('[data-testid="block-editor-host"]')).not.toBeNull()
  const editor = document.querySelector<HTMLElement>('[data-testid="block-editor"]')!
  const pm = editor.querySelector<HTMLElement>('.ProseMirror[role="textbox"]')!
  expect(pm).not.toBeNull()
  expect(document.activeElement).toBe(pm)
  expect(document.activeElement?.textContent).not.toBe('取消')
  const where = document.querySelector('[data-testid="block-editor-where"]')?.textContent ?? ''
  expect(where).toContain('说明书 · 段落 [0001]')
  expect(where).not.toMatch(/L\d+|第 \d+ 行/)
})

it('桌面卡片：Tab 在内嵌编辑器内循环（末尾 Tab 回到首个；头部按钮不进 Tab 序）', async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<BlockEditorHost />))
  const first = method.description.find((b) => b.kind === 'paragraph')!
  await act(async () => openBlockEditor({ blockId: first.id, source: 'pdf', anchor: { x: 100, y: 100 } }))
  const editor = document.querySelector<HTMLElement>('[data-testid="block-editor"]')!
  const buttons = [...editor.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
  const last = buttons[buttons.length - 1]
  await act(async () => last.focus())
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  await act(async () => last.dispatchEvent(tab))
  // jsdom 不把 contenteditable 视为可聚焦，只断言默认 Tab 被拦下、卡片仍在
  expect(tab.defaultPrevented).toBe(true)
  expect(document.querySelector('[data-testid="block-editor-host"]')).not.toBeNull()
  expect(document.querySelector('[data-testid="block-editor-locate"]')?.getAttribute('tabindex')).toBe('-1')
})

/** ux-02：桌面卡片按选块包围盒落位——右侧够宽锚右侧（顶对齐行），1280 / 1024 收窄时宽度随可用空间，右侧不足则落到块下方 */
it('placeCard：1440 锚右侧 440 宽；1280 右侧收窄；1024 右侧不足 320 → 落到块下方并收窄到视口内', async () => {
  const { placeCard, CARD_MAX_W, CARD_MIN_W, CARD_GAP, CARD_PAD } = await import('../BlockEditorHost')
  // PDF 页 620 宽，左起 300；被点行在 y=300 高 16
  const anchor = { x: 500, y: 300, rect: { left: 300, top: 300, width: 620, height: 16 } }
  const wide = placeCard(anchor, { width: 1440, height: 900 })
  expect(wide).toMatchObject({ side: 'right', width: CARD_MAX_W, left: 300 + 620 + CARD_GAP, top: 300 })
  const mid = placeCard(anchor, { width: 1280, height: 800 })
  expect(mid.side).toBe('right')
  expect(mid.width).toBe(1280 - CARD_PAD - (300 + 620 + CARD_GAP))
  expect(mid.width).toBeGreaterThanOrEqual(CARD_MIN_W)
  expect(mid.left + mid.width).toBeLessThanOrEqual(1280 - CARD_PAD)
  const narrow = placeCard({ ...anchor, rect: { left: 200, top: 300, width: 620, height: 16 } }, { width: 1024, height: 768 })
  expect(narrow.side).toBe('bottom')
  expect(narrow.top).toBe(300 + 16 + CARD_GAP)
  expect(narrow.width).toBe(CARD_MAX_W)
  expect(narrow.left).toBeGreaterThanOrEqual(CARD_PAD)
  expect(narrow.left + narrow.width).toBeLessThanOrEqual(1024 - CARD_PAD)
})

it('placeCard：已知卡片高度时底边夹回视口；下方不够高则翻到行上方', async () => {
  const { placeCard, CARD_PAD, CARD_GAP } = await import('../BlockEditorHost')
  const low = placeCard({ x: 500, y: 800, rect: { left: 400, top: 800, width: 620, height: 16 } }, { width: 1440, height: 900 }, 500)
  expect(low.side).toBe('right')
  expect(low.top + 500).toBeLessThanOrEqual(900 - CARD_PAD)
  const flipped = placeCard({ x: 500, y: 600, rect: { left: 200, top: 600, width: 620, height: 16 } }, { width: 1024, height: 768 }, 400)
  expect(flipped.side).toBe('top')
  expect(flipped.top).toBe(600 - CARD_GAP - 400)
  // 只有点击点（无 rect）的旧调用方仍可落位
  expect(placeCard({ x: 100, y: 100 }, { width: 1440, height: 900 }).side).toBe('right')
})

it('375 底部 Sheet（W8 §3）：内容区 16 / 顶 8，ProseMirror min-h 120 + 内边距 12，动作 md 一行、提交 primary', async () => {
  desktop = false
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<BlockEditorHost />))
  const first = method.description.find((b) => b.kind === 'paragraph')!
  await act(async () => openBlockEditor({ blockId: first.id, source: 'pdf', anchor: { x: 100, y: 100 } }))
  await act(async () => {})
  const sheet = document.querySelector<HTMLElement>('[data-testid="block-editor-host"]')!
  expect(sheet.dataset.side ?? sheet.getAttribute('data-side')).toBe('bottom')
  const body = sheet.querySelector<HTMLElement>('[data-testid="block-editor-sheet-body"]')!
  for (const c of ['px-sheet-m', 'pt-sheet-top-m', 'pb-sheet-m']) expect(body.className).toContain(c)
  const pm = sheet.querySelector<HTMLElement>('[data-testid="block-editor-pm"]')!
  expect(pm.className).toContain('min-h-30')
  expect(pm.className).toContain('p-3')
  expect(pm.className).not.toContain('px-2')
  // qa-02：编辑器宿主显式 text-fg（语义前景随主题），不继承 .ps-paper 的纸面黑字落到深色 bg-background 上
  expect(pm.className).toMatch(/\btext-fg\b/)
  const actions = sheet.querySelector<HTMLElement>('[data-testid="block-editor-actions"]')!
  expect(actions.className).toContain('gap-group-m')
  const buttons = [...actions.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons).toHaveLength(2)
  for (const b of buttons) {
    expect(b.dataset.size).toBe('md')
    expect(b.className).toContain('touch-hit')
  }
  const submit = sheet.querySelector<HTMLButtonElement>('[data-testid="block-editor-submit"]')!
  expect(submit.dataset.variant).toBe('default')
  expect(submit.className).toContain('bg-primary')
})

it('桌面卡片：编辑区 px-2 py-1、动作 sm（soft 提交）——W8 未动桌面', async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<BlockEditorHost />))
  const first = method.description.find((b) => b.kind === 'paragraph')!
  await act(async () => openBlockEditor({ blockId: first.id, source: 'pdf', anchor: { x: 100, y: 100 } }))
  await act(async () => {})
  const pm = document.querySelector<HTMLElement>('[data-testid="block-editor-pm"]')!
  expect(pm.className).toContain('px-2')
  expect(pm.className).not.toContain('min-h-30')
  const submit = document.querySelector<HTMLButtonElement>('[data-testid="block-editor-submit"]')!
  expect(submit.dataset.size).toBe('sm')
  expect(submit.dataset.variant).toBe('soft')
})

it('桌面卡片渲染到 body（逃出 dockview 面板 transform）并带 data-side；宽度 ≤ 440', async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<BlockEditorHost />))
  const first = method.description.find((b) => b.kind === 'paragraph')!
  await act(async () => openBlockEditor({ blockId: first.id, source: 'pdf', anchor: { x: 300, y: 300, rect: { left: 100, top: 300, width: 400, height: 16 } } }))
  await act(async () => {})
  const el = document.querySelector<HTMLElement>('[data-testid="block-editor-host"]')!
  expect(el.parentElement).toBe(document.body)
  expect(el.dataset.side).toBe('right')
  const card = el.querySelector<HTMLElement>('[data-slot="popover-content"]')!
  expect(card.style.width).toBe('440px')
})
