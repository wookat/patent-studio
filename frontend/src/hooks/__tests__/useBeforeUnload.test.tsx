// @vitest-environment jsdom
import { act, useRef, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useBeforeUnload } from '../useBeforeUnload'

/**
 * 表单草稿关页签守卫：active() 真期间 beforeunload 被拦截（dispatchEvent 返 false），假放行；
 * active 走最新闭包（ref 型脏态同适用）；卸载即撤监听。
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
})
async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const fireUnload = () => window.dispatchEvent(new Event('beforeunload', { cancelable: true })) === false

function Host({ dirty }: { dirty: boolean }) {
  useBeforeUnload(() => dirty)
  return null
}

describe('useBeforeUnload', () => {
  it('脏态拦截 / 干净放行 / 卸载撤监听', async () => {
    await mount(<Host dirty={false} />)
    expect(fireUnload()).toBe(false)
    await act(async () => root!.render(<Host dirty={true} />))
    expect(fireUnload()).toBe(true)
    await act(async () => root!.render(<Host dirty={false} />))
    expect(fireUnload()).toBe(false)
  })

  it('ref 型脏态读最新闭包（非响应式 set 同样生效）', async () => {
    const btn = { current: null as HTMLButtonElement | null }
    function RefHost() {
      const dirty = useRef(false)
      useBeforeUnload(() => dirty.current)
      return <button ref={btn} onClick={() => (dirty.current = true)}>x</button>
    }
    await mount(<RefHost />)
    expect(fireUnload()).toBe(false)
    btn.current!.click()
    expect(fireUnload()).toBe(true)
  })
})
