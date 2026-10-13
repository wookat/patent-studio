// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

/**
 * W12 R10-06（docs/plan/27）：Sheet 内目标落在 `[data-esc-local]` 里时，Escape 只收局部编辑态，不关 Sheet；
 * 属性去掉后（无草稿）同一下 Escape 照常关 Sheet。Radix 的 Escape 监听在 document 捕获阶段，所以只能靠 onEscapeKeyDown 否决。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)

const escapeOn = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 0))
  })

function Case({ onEscape }: { onEscape?: (e: KeyboardEvent) => void }) {
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState<string | null>('12')
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent data-testid="el-content" onEscapeKeyDown={onEscape}>
        <SheetTitle>标题</SheetTitle>
        <SheetDescription>说明</SheetDescription>
        <input
          data-testid="el-input"
          value={draft ?? '15'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDraft(null)
          }}
          data-esc-local={draft != null || undefined}
        />
        <button type="button" data-testid="el-button">无编辑态</button>
      </SheetContent>
    </Sheet>
  )
}

describe('Sheet：Esc 只收最内层（W12 R10-06）', () => {
  it('输入有草稿（data-esc-local）→ 第一下 Esc 只放弃草稿、Sheet 仍开；属性随之消失 → 第二下 Esc 关 Sheet', async () => {
    const onEscape = vi.fn()
    await mount(<Case onEscape={onEscape} />)
    const input = q<HTMLInputElement>('[data-testid="el-input"]')!
    expect(input.value).toBe('12')
    expect(input.hasAttribute('data-esc-local')).toBe(true)
    input.focus()

    await escapeOn(input)
    expect(q('[data-testid="el-content"]')).not.toBeNull()
    expect(q('[data-testid="el-content"]')!.getAttribute('data-state')).toBe('open')
    expect(input.value).toBe('15')
    expect(input.hasAttribute('data-esc-local')).toBe(false)
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(onEscape.mock.calls[0][0].defaultPrevented).toBe(true)

    await escapeOn(input)
    expect(q('[data-testid="el-content"]')).toBeNull()
    expect(onEscape).toHaveBeenCalledTimes(2)
  })

  it('目标不在 data-esc-local 内（普通按钮）→ 一下 Esc 就关 Sheet（现状不变）', async () => {
    await mount(<Case />)
    const btn = q<HTMLButtonElement>('[data-testid="el-button"]')!
    btn.focus()
    await escapeOn(btn)
    expect(q('[data-testid="el-content"]')).toBeNull()
  })
})
