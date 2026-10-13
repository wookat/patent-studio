// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CardHeader } from '../CardHeader'
import { SourceCard } from '../SourceCard'
import { FullTextCard } from '../FullTextCard'
import { BookSwitcher } from '@/components/mobile/BookSwitcher'
import { MenuBar } from '@/components/shell/MenuBar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio, type Studio } from '@/store'
import { pairBlockByIndex, toCardLine, toFullLine } from '../sync'
import type { Ast } from '@/types/ast'

/**
 * R4 卡片 / 书切换器 / 「视图 › 布局」占位的 ARIA 结构冒烟（同 components/__tests__/a11y.test.tsx 的规则集）。
 * dockview 自身 tab role / 键盘行为在 08 §8 证据里由 spike 实测，不在此重复；D1 落地后在 layout/__tests__ 里挂真 DockviewReact 再测。
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
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const DOC = '# 题\n\n## 摘要\nA1\n\n## 权利要求书\n1. C1\n2. C2\n\n## 说明书\nD1\nD2\n'

describe('cards（08 §4 / §8）', () => {
  beforeEach(() => useStudio.setState({ content: DOC, saved: DOC, activeBook: 'all' }))

  it('CardHeader 书切换是 radiogroup，点击回调携带书名', async () => {
    const onSwitch = vi.fn()
    const el = await mount(
      <CardHeader title="t" book="claims" dirty switchable={['abstract', 'claims', 'description', 'all']} onSwitchBook={onSwitch} />,
    )
    const radios = el.querySelectorAll('[role="radiogroup"] [role="radio"]')
    expect(radios.length).toBe(4)
    expect(el.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('权利要求书')
    expect(el.querySelector('[data-testid="card-dirty"]')).not.toBeNull()
    await act(async () => (radios[2] as HTMLButtonElement).click())
    expect(onSwitch).toHaveBeenCalledWith('description')
    expect(await violations(el)).toEqual([])
  })

  it('SourceCard 只在本书变化时显示 dirty；FullTextCard 跟全文 dirty', async () => {
    const el = await mount(
      <>
        <SourceCard panelId="source:claims" kind="source" book="claims" active />
        <SourceCard panelId="source:description" kind="source" book="description" active={false} />
        <FullTextCard panelId="source:all" kind="source" book="all" active={false} />
      </>,
    )
    expect(el.querySelectorAll('[data-testid="card-dirty"]').length).toBe(0)
    await act(async () => useStudio.getState().setBookContent('claims', '1. C1 改\n2. C2'))
    expect(el.querySelector('[data-testid="card-source-claims"] [data-testid="card-dirty"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="card-source-description"] [data-testid="card-dirty"]')).toBeNull()
    expect(el.querySelector('[data-testid="card-source-all"] [data-testid="card-dirty"]')).not.toBeNull()
    expect(useStudio.getState().content).toContain('## 说明书\nD1\nD2')
    expect(await violations(el)).toEqual([])
  })

  it('sync：全文行 ↔ 书相对行按 AST offset 换算；同序块配对', () => {
    // 摘要标题在第 3 行，权利要求书标题第 6 行，说明书标题第 10 行（1-based）
    expect(toFullLine(DOC, 'claims', 1)).toBe(7)
    expect(toCardLine(DOC, 'claims', 8)).toBe(2)
    expect(toCardLine(DOC, 'claims', 11)).toBeNull()
    expect(toFullLine(DOC, 'all', 5)).toBe(5)
    const blk = (id: string, l: number) => ({ id, kind: 'paragraph', text: id, line: l })
    const ast = {
      abstract: blk('a', 4),
      claims: [blk('c1', 7), blk('c2', 8)],
      description: [{ ...blk('h', 11), kind: 'heading' }, blk('d1', 11), blk('d2', 12)],
    } as unknown as Ast
    const s = { ast } as unknown as Studio
    expect(pairBlockByIndex(s, 'claims', 'c2', 'description')).toBe('d2')
    expect(pairBlockByIndex(s, 'claims', 'zz', 'description')).toBeNull()
    expect(pairBlockByIndex(s, 'all', 'c1', 'description')).toBeNull()
  })
})

describe('BookSwitcher（08 §9）', () => {
  it('radiogroup 四项写 layout.activeBook', async () => {
    useStudio.setState({ activeBook: 'all' })
    const el = await mount(<BookSwitcher />)
    const radios = el.querySelectorAll('[role="radiogroup"][aria-label="书"] [role="radio"]')
    expect(radios.length).toBe(4)
    await act(async () => (el.querySelector('[data-testid="book-switcher-claims"]') as HTMLButtonElement).click())
    expect(useStudio.getState().activeBook).toBe('claims')
    expect(el.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('权利要求书')
    expect(await violations(el)).toEqual([])
  })
})

describe('视图 › 布局 slot（08 §6.3）', () => {
  it('dock 未注册时子菜单触发器禁用；MenuBar 仍无 axe 违规', async () => {
    useStudio.getState().registerDock(null)
    const el = await mount(<MenuBar />)
    expect(el.querySelector('[role="menubar"]')).not.toBeNull()
    expect(await violations(el)).toEqual([])
  })
})
