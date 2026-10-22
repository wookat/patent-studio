// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { CheckPanel } from '../CheckPanel'
import { ConsoleFooter } from '@/components/console/ConsolePanel'
import { BuildMenuItems } from '@/components/shell/BuildMenuItems'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown'

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
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    user: null,
    lintItems: [],
    lintRun: { report: { diagnostics: [] } as never, ms: 1, error: null, at: 1 },
    checkAllRun: null,
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllEnvs()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

describe('T3 开发维护项默认不出现在办案界面（dev 构建或超管可见）', () => {
  it('非 dev（DEV 关 + 非超管）：CheckPanel 不渲染仓库回归、控制台底脚无清除构建缓存、构建菜单无该项', async () => {
    vi.stubEnv('DEV', '')
    const el = await mount(
      <>
        <CheckPanel />
        <ConsoleFooter />
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>构建</DropdownMenuTrigger>
          <DropdownMenuContent>
            <BuildMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    )
    expect(el.querySelector('[data-testid="check-all-section"]')).toBeNull()
    expect(el.querySelector('[data-testid="lint-section"]')).toBeTruthy()
    expect(el.querySelector('[data-testid="console-clear-cache"]')).toBeNull()
    // DropdownMenuContent 走 portal 到 document.body
    expect(document.querySelector('[data-testid="build-clear"]')).toBeNull()
    expect(document.querySelector('[data-testid="build-now"]')).toBeTruthy()
  })

  it('超管（非 dev 构建）：维护项仍可见', async () => {
    vi.stubEnv('DEV', '')
    useStudio.setState({ user: { is_superuser: true } as never })
    const el = await mount(<CheckPanel />)
    expect(el.querySelector('[data-testid="check-all-section"]')).toBeTruthy()
  })
})
