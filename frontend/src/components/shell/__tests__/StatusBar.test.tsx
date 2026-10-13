// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useStudio } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StatusBar } from '../StatusBar'

/**
 * W11 R4 页码单源：构建失败后屏上留着的 PDF 是旧产物，状态栏不得再显示「第 x / y 页」或「y 页」；
 * 构建恢复 ok 后页码回来。
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

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <TooltipProvider>
        <StatusBar />
      </TooltipProvider>,
    ),
  )
  return host
}

const setState = (patch: Partial<ReturnType<typeof useStudio.getState>>) =>
  act(async () => useStudio.setState(patch))

describe('StatusBar 页码单源', () => {
  it('构建 ok 显示「第 x / y 页」；构建失败后不显示任何页数；恢复后页码回来', async () => {
    useStudio.setState({ pid: 'p1', pageInfo: { page: 1, total: 5 }, phase: 'ok' })
    const el = await mount()
    expect(el.querySelector('[data-testid="status-page"]')?.textContent).toContain('1 / 5')
    expect(el.querySelector('[data-testid="status-pages"]')).toBeNull()

    await setState({ phase: 'error' })
    expect(el.querySelector('[data-testid="status-page"]')).toBeNull()
    expect(el.querySelector('[data-testid="status-pages"]')).toBeNull()

    await setState({ phase: 'ok' })
    expect(el.querySelector('[data-testid="status-page"]')?.textContent).toContain('1 / 5')
  })
})

describe('StatusBar 协同在线', () => {
  it('点击「N 人在线」打开协同中心成员页（批8：对齐体检/构建 Seg 的可点惯例）', async () => {
    useStudio.setState({ pid: 'p1', collabStatus: 'connected', collabUnavailable: false, peers: [], authStatus: 'anon', user: null, collabCenterOpen: false })
    const el = await mount()
    const seg = el.querySelector<HTMLElement>('[data-testid="status-online"]')!
    expect(seg.textContent).toContain('人在线')
    expect(seg.getAttribute('title')).toContain('点击打开协同中心')
    await act(async () => seg.click())
    expect(useStudio.getState().collabCenterOpen).toBe(true)
    expect(useStudio.getState().collabCenterTab).toBe('members')
  })
})

describe('StatusBar 光标所在书', () => {
  it('光标在空书的 `## 权利要求书` 标题行（大纲无该书节点）→ 显示权利要求书，不算成前一本书', async () => {
    const content = '# 一种方法\n\n## 摘要\n\n摘要正文。\n\n## 权利要求书\n\n## 说明书\n\n### 技术领域\n\n正文。\n'
    useStudio.setState({
      pid: 'p1',
      content,
      editorView: 'source',
      activePanelId: 'source:claims',
      cursor: { line: 7, col: 1 },
      outline: [
        { id: 'abstract', kind: 'abstract', label: '摘要', line: 3 },
        { id: 'description', kind: 'description', label: '说明书', line: 9, children: [{ id: 'description/技术领域', kind: 'section', label: '技术领域', line: 11 }] },
      ],
    })
    const el = await mount()
    const seg = el.querySelector('[data-testid="status-cursor"]')
    expect(seg?.getAttribute('title')).toBe('光标所在：权利要求书')
    expect(seg?.textContent).toContain('权利要求书')
    expect(seg?.textContent).not.toContain('摘要')

    await setState({ cursor: { line: 13, col: 1 } })
    expect(el.querySelector('[data-testid="status-cursor"]')?.getAttribute('title')).toBe('光标所在：说明书 › 技术领域')
  })
})
