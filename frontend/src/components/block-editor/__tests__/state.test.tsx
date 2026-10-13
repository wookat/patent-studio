// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { closeBlockEditor, getBlockEditorRequest, openBlockEditor, useBlockEditorRequest, useHostOwnership } from '../state'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Host({ name }: { name: string }) {
  const owned = useHostOwnership()
  const req = useBlockEditorRequest()
  return <div data-host={name} data-owned={owned ? '1' : '0'} data-block={req?.blockId ?? ''} />
}

const roots: Root[] = []
function mount(el: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(el))
  return { host, root }
}
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()))
  document.body.innerHTML = ''
  closeBlockEditor()
})

const owners = () => [...document.querySelectorAll<HTMLElement>('[data-host]')].filter((e) => e.dataset.owned === '1').map((e) => e.dataset.host)

describe('BlockEditor 宿主所有权', () => {
  it('StrictMode（挂载→卸载→重挂）后宿主仍持有所有权', () => {
    mount(
      <StrictMode>
        <Host name="pdf" />
      </StrictMode>,
    )
    expect(owners()).toEqual(['pdf'])
  })

  it('多宿主只有最先挂载的一个渲染；它卸载后下一个接管', () => {
    const a = mount(<Host name="a" />)
    mount(<Host name="b" />)
    expect(owners()).toEqual(['a'])
    act(() => a.root.unmount())
    expect(owners()).toEqual(['b'])
  })

  it('open / close 请求同步到所有宿主', () => {
    mount(<Host name="a" />)
    act(() => openBlockEditor({ blockId: 'description/技术领域/p0001', source: 'pdf', anchor: { x: 10, y: 20 } }))
    expect(getBlockEditorRequest()?.blockId).toBe('description/技术领域/p0001')
    expect(document.querySelector<HTMLElement>('[data-host="a"]')!.dataset.block).toBe('description/技术领域/p0001')
    act(() => closeBlockEditor())
    expect(getBlockEditorRequest()).toBeNull()
    expect(document.querySelector<HTMLElement>('[data-host="a"]')!.dataset.block).toBe('')
  })
})
