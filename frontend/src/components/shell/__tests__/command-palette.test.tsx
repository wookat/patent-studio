// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { useStudio } from '@/store'
import { DESKTOP_QUERY } from '@/hooks/useMisc'
import type { ProjectSummary } from '@/lib/types'

/** R115 批15 ⌘K 命令面板：打开 / 案卷过滤导航 / 面板动作 / 未开案时无「当前案卷」组 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let mmDesktop = true

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // DESKTOP_QUERY 命中与否决定 palette 的 dockview 面板组（桌面才渲染）
  window.matchMedia ??= (q: string) => ({ matches: q === DESKTOP_QUERY ? mmDesktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // 案卷为空时 palette 会拉取 loadProjects——本文件统一 stub，不发 fetch
  useStudio.setState({ loadProjects: async () => {} })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  useStudio.setState({ dialog: null, projects: [], pid: null, companion: null })
  mmDesktop = true
  window.location.hash = '#/'
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const row = (id: string, title: string): ProjectSummary => ({ id, title, mtime: 1_700_000_000 })

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const items = () => [...document.querySelectorAll<HTMLElement>('[cmdk-item]')].filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')

describe('CommandPalette', () => {
  it('dialog=palette 时渲染，分组与案卷项齐全', async () => {
    useStudio.setState({
      dialog: 'palette',
      pid: 'method',
      projects: [row('method', '一种时间序列预测方法'), row('device', '测试装置')],
    })
    await mount(<CommandPalette />)
    expect(q('[data-slot="command"]')).toBeTruthy()
    expect(q('[data-testid="palette-case-method"]')!.textContent).toContain('一种时间序列预测方法')
    expect(q('[data-testid="palette-case-device"]')).toBeTruthy()
    expect(q('[data-testid="palette-panel-ai"]')).toBeTruthy()
    expect(q('[data-testid="palette-build"]')).toBeTruthy()
    expect(q('[data-testid="palette-create"]')).toBeTruthy()
    expect(q('[data-testid="palette-dashboard"]')).toBeTruthy()
    // OBS-V1：三视图切换命令入 palette
    expect(q('[data-testid="palette-view-source"]')!.textContent).toContain('切换到源码')
    expect(q('[data-testid="palette-view-layout"]')!.textContent).toContain('切换到版面')
    expect(q('[data-testid="palette-view-pdf"]')!.textContent).toContain('切换到PDF')
    // axe：listbox/option 语义（批53 历史面板同类规则的前置钉）
    // data-testid 传在 Dialog 根（无 DOM）；axe 锚 role=dialog 的 portal 内容
    const res = await axe.run(document.querySelector('[role="dialog"]')!, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    })
    expect(res.violations.map((v) => v.id)).toEqual([])
  })

  it('视图切换项：点击「切换到版面视图」→ editorView=layout 且对话框关闭', async () => {
    useStudio.setState({ dialog: 'palette', pid: 'method', projects: [row('method', '方法')], editorView: 'source' })
    await mount(<CommandPalette />)
    await act(async () => q<HTMLElement>('[data-testid="palette-view-layout"]')!.click())
    expect(useStudio.getState().editorView).toBe('layout')
    expect(useStudio.getState().dialog).toBeNull()
  })

  it('未开案时不渲染「当前案卷」组（无面板/构建项）', async () => {
    useStudio.setState({ dialog: 'palette', pid: null, projects: [row('method', '方法')] })
    await mount(<CommandPalette />)
    expect(q('[data-testid="palette-case-method"]')).toBeTruthy()
    expect(q('[data-testid="palette-panel-ai"]')).toBeNull()
    expect(q('[data-testid="palette-build"]')).toBeNull()
  })

  it('选择案卷 → hash 跳转且对话框关闭', async () => {
    useStudio.setState({ dialog: 'palette', pid: null, projects: [row('method', '方法'), row('device', '装置')] })
    await mount(<CommandPalette />)
    await act(async () => q<HTMLElement>('[data-testid="palette-case-device"]')!.click())
    expect(window.location.hash).toBe('#/p/device')
    expect(useStudio.getState().dialog).toBeNull()
  })

  it('cmdk 输入过滤案卷', async () => {
    useStudio.setState({ dialog: 'palette', pid: null, projects: [row('method', '方法'), row('device', '装置')] })
    await mount(<CommandPalette />)
    const input = q<HTMLInputElement>('[data-slot="command-input"]')!
    // 受控 input：绕过 React value tracker 让原生 input 事件触发 onChange（React 测试常规手法）
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, '装置')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {})
    const visible = items().filter((el) => el.dataset.testid?.startsWith('palette-case'))
    expect(visible.map((el) => el.dataset.testid)).toEqual(['palette-case-device'])
  })

  it('打开面板项 → openCompanion 并关闭对话框', async () => {
    useStudio.setState({ dialog: 'palette', pid: 'method', projects: [] })
    await mount(<CommandPalette />)
    await act(async () => q<HTMLElement>('[data-testid="palette-panel-history"]')!.click())
    expect(useStudio.getState().companion).toBe('history')
    expect(useStudio.getState().dialog).toBeNull()
  })

  it('移动端（非桌面）不渲染 dockview 面板项与键盘语，构建/递交仍在', async () => {
    mmDesktop = false
    useStudio.setState({ dialog: 'palette', pid: 'method', projects: [] })
    await mount(<CommandPalette />)
    expect(q('[data-testid="palette-panel-ai"]')).toBeNull()
    expect(q('[data-testid="palette-panel-history"]')).toBeNull()
    expect(q('[data-testid="palette-build"]')).toBeTruthy()
    expect(q('[data-testid="palette-deliver"]')).toBeTruthy()
    // 快捷键速查与 kbd 提示同为桌面限定（触屏无键盘，MoreSheet 帮助组同口径）
    expect(q('[data-testid="palette-shortcuts"]')).toBeNull()
    expect(document.querySelectorAll('[data-slot="command-shortcut"]')).toHaveLength(0)
  })

  it('超管才见机构管理项', async () => {
    useStudio.setState({ dialog: 'palette', pid: null, projects: [], user: { id: 'u', name: 'U', email: 'u@x', is_superuser: true } as never })
    await mount(<CommandPalette />)
    expect(q('[data-testid="palette-admin"]')).toBeTruthy()
  })
})
