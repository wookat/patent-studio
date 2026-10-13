// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { AppErrorBoundary, PanelErrorBoundary } from '../error-boundary'

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  host = null
  root = null
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)

function Bomb({ message = 'boom' }: { message?: string }): ReactElement {
  throw new Error(message)
}

// React 19 会把边界内抛出的错打到 console.error——拦截掉，避免测试日志刷屏
const silence = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('AppErrorBoundary（R22）', () => {
  it('子树抛错 → 兜底页（标题/消息/三个动作），不卸载整棵树', async () => {
    silence()
    const el = await mount(
      <AppErrorBoundary>
        <Bomb message="渲染测试错误" />
      </AppErrorBoundary>,
    )
    expect(q('[data-testid="app-error-boundary"]', el)).not.toBeNull()
    expect(el.textContent).toContain('界面出现异常')
    expect(el.textContent).toContain('渲染测试错误')
    expect(q('[data-testid="app-error-retry"]', el)).not.toBeNull()
    expect(q('[data-testid="app-error-dashboard"]', el)).not.toBeNull()
    expect(q('[data-testid="app-error-reload"]', el)).not.toBeNull()
  })

  it('重试：清错后重渲染（子树恢复健康则回到正常 UI）', async () => {
    silence()
    let shouldThrow = true
    const Probe = () => {
      if (shouldThrow) throw new Error('first-render')
      return <div data-testid="probe-ok">ok</div>
    }
    const el = await mount(
      <AppErrorBoundary>
        <Probe />
      </AppErrorBoundary>,
    )
    expect(q('[data-testid="app-error-boundary"]', el)).not.toBeNull()
    shouldThrow = false
    await act(async () => q<HTMLElement>('[data-testid="app-error-retry"]', el)!.click())
    expect(q('[data-testid="app-error-boundary"]', el)).toBeNull()
    expect(q('[data-testid="probe-ok"]', el)).not.toBeNull()
  })

  it('回面板：hash 归 #/ 且清错重渲染', async () => {
    silence()
    window.location.hash = '#/p/method'
    let shouldThrow = true
    const Probe = () => {
      if (shouldThrow) throw new Error('first-render')
      return <div data-testid="probe-ok">ok</div>
    }
    const el = await mount(
      <AppErrorBoundary>
        <Probe />
      </AppErrorBoundary>,
    )
    shouldThrow = false
    await act(async () => q<HTMLElement>('[data-testid="app-error-dashboard"]', el)!.click())
    expect(window.location.hash).toBe('#/')
    expect(q('[data-testid="app-error-boundary"]', el)).toBeNull()
    expect(q('[data-testid="probe-ok"]', el)).not.toBeNull()
  })

  it('无错时透传子树', async () => {
    const el = await mount(
      <AppErrorBoundary>
        <div data-testid="plain">正常</div>
      </AppErrorBoundary>,
    )
    expect(q('[data-testid="app-error-boundary"]', el)).toBeNull()
    expect(q('[data-testid="plain"]', el)).not.toBeNull()
  })
})

describe('PanelErrorBoundary（R115 批17 面板级边界）', () => {
  it('子树抛错 → 紧凑兜底（label/重试/关闭面板），兄弟树不受影响', async () => {
    silence()
    const onClose = vi.fn()
    const el = await mount(
      <div>
        <PanelErrorBoundary label="AI" onClose={onClose}>
          <Bomb message="面板测试错误" />
        </PanelErrorBoundary>
        <div data-testid="sibling">alive</div>
      </div>,
    )
    expect(q('[data-testid="panel-error-boundary"]', el)).not.toBeNull()
    expect(el.textContent).toContain('AI出现异常')
    expect(q('[data-testid="sibling"]', el)).not.toBeNull()
    await act(async () => q<HTMLElement>('[data-testid="panel-error-close"]', el)!.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('重试：清错后恢复健康；无 onClose 时无关闭钮', async () => {
    silence()
    let shouldThrow = true
    const Probe = () => {
      if (shouldThrow) throw new Error('first-render')
      return <div data-testid="probe-ok">ok</div>
    }
    const el = await mount(
      <PanelErrorBoundary label="历史">
        <Probe />
      </PanelErrorBoundary>,
    )
    expect(q('[data-testid="panel-error-boundary"]', el)).not.toBeNull()
    expect(q('[data-testid="panel-error-close"]', el)).toBeNull()
    shouldThrow = false
    await act(async () => q<HTMLElement>('[data-testid="panel-error-retry"]', el)!.click())
    expect(q('[data-testid="probe-ok"]', el)).not.toBeNull()
    expect(q('[data-testid="panel-error-boundary"]', el)).toBeNull()
  })
})
