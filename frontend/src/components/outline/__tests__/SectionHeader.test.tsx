// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import axe from 'axe-core'
import { parse, wcagContrast } from 'culori'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SectionHeader, TreeRow } from '../TreeRow'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

/**
 * ux-03（前半）：侧栏 SectionHeader 对比度。
 * 真实 Chrome 1440 / 1024 × 亮暗 getComputedStyle 实测（W7）：文字 span 与 button 的 color 都等于外层 `text-fg-muted`
 * （亮 oklch(0.52 0.018 255)=#626a73 on bg-app #f8f9fa = 5.20:1；暗 #9399a0 on #0f1113 = 6.58:1），button 无 UA 色覆盖，
 * hover 只会切到更深的 fg-strong，axe-core 4.13 对 SideSplit 区域 color-contrast 违规 / incomplete 均为 0。
 * 本测试守住这条结构：颜色只由外层容器一处决定（button / span 不带自己的静态文字色），且 token 配对 ≥ 4.5:1。
 */

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const css = readFileSync(resolvePath(process.cwd(), 'src/index.css'), 'utf8')
function vars(selector: string): Record<string, string> {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g')
  const out: Record<string, string> = {}
  for (const m of css.matchAll(re)) for (const line of m[1].split(/;\s*/)) {
    const mm = line.match(/(--[\w-]+)\s*:\s*(.+)$/s)
    if (mm) out[mm[1].trim()] = mm[2].trim()
  }
  return out
}
const light = vars(':root')
const dark = { ...light, ...vars('.dark') }
const resolve = (v: Record<string, string>, name: string, depth = 0): string => {
  const raw = v[name]
  if (!raw || depth > 10) throw new Error(`index.css 缺少 ${name}`)
  return raw.replace(/var\((--[\w-]+)\)/g, (_, n: string) => resolve(v, n, depth + 1))
}
const ratio = (v: Record<string, string>, fg: string, bg: string) => wcagContrast(parse(resolve(v, fg))!, parse(resolve(v, bg))!)

const STATIC_TEXT_COLOR = /(^|\s)text-fg-[\w-]+/ // 不含 hover:/focus-visible: 变体

describe('SectionHeader（ux-03 前半：对比度结构）', () => {
  it('文字色只由外层 text-fg-muted + bg-app 决定；button / 标题 span 不带自己的静态文字色', async () => {
    const el = await mount(<SectionHeader title="案卷文件" collapsed={false} onToggle={() => {}} controls="x" testId="side-files-header" />)
    const wrap = el.querySelector<HTMLElement>('[data-testid="side-files-header"]')!
    const btn = wrap.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    const span = btn.querySelector<HTMLElement>('span.truncate')!
    expect(wrap.className).toMatch(/\btext-fg-muted\b/)
    expect(wrap.className).toMatch(/\bbg-app\b/)
    expect(btn.className).not.toMatch(STATIC_TEXT_COLOR)
    expect(btn.className).toMatch(/\bhover:text-fg-strong\b/)
    expect(span.className).not.toMatch(STATIC_TEXT_COLOR)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe('x')
  })

  it('token 配对：fg-muted / fg-strong on bg-app 亮暗均 ≥ 4.5:1（hover 态只会更深）', () => {
    for (const v of [light, dark]) {
      expect(ratio(v, '--fg-muted', '--bg-app')).toBeGreaterThanOrEqual(4.5)
      expect(ratio(v, '--fg-strong', '--bg-app')).toBeGreaterThanOrEqual(ratio(v, '--fg-muted', '--bg-app'))
    }
  })

  it('TreeRow 选中行（bg-selected）的 11px tag / count 用 fg-muted：暗色 fg-subtle on bg-selected 仅 3.86:1（axe serious）', async () => {
    for (const v of [light, dark]) {
      expect(ratio(v, '--fg-muted', '--bg-selected')).toBeGreaterThanOrEqual(4.5)
      expect(ratio(v, '--fg-subtle', '--bg-hover')).toBeGreaterThanOrEqual(4.5)
    }
    expect(ratio(dark, '--fg-subtle', '--bg-selected')).toBeLessThan(4.5)
    const el = await mount(
      <div role="tree">
        <TreeRow id="a" current tag="图1 · 2 次" count={3} testId="cur">fig1</TreeRow>
        <TreeRow id="b" tag="图2" count={1} testId="rest">fig2</TreeRow>
      </div>,
    )
    const tags = (id: string) => Array.from(el.querySelectorAll(`[data-testid="${id}"] > span`)).slice(-2).map((s) => s.className)
    expect(tags('cur')).toHaveLength(2)
    for (const c of tags('cur')) expect(c).toMatch(/\btext-fg-muted\b/)
    for (const c of tags('rest')) expect(c).toMatch(/\btext-fg-subtle\b/)
  })

  it('TreeRow 宽度不够时：目录行（有 count）名字不缩、计数截断；叶子行名字截断；圆点说明并入整行 title', async () => {
    const el = await mount(
      <div role="tree">
        <TreeRow id="dir" count="附图 6 · 资源 6" title="figs/" testId="dir">附图</TreeRow>
        <TreeRow id="leaf" tag="图1 · 引用 2" testId="leaf">fig1.svg</TreeRow>
        <TreeRow id="marked" mark="存在前向引用" markTone="warning" title="权利要求书 · 4 项" testId="marked">权利要求书</TreeRow>
        <TreeRow id="marked-only" mark="超 300 字" testId="marked-only">摘要</TreeRow>
      </div>,
    )
    const name = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"] > span.truncate`)!
    expect(name('dir').className).toMatch(/\bshrink-0\b/)
    expect(name('dir').className).not.toMatch(/\bflex-1\b/)
    expect(name('leaf').className).toMatch(/\bflex-1\b/)
    const count = el.querySelector<HTMLElement>('[data-testid="dir"] > span:last-child')!
    expect(count.textContent).toBe('附图 6 · 资源 6')
    expect(count.className).toMatch(/\btruncate\b/)
    expect(el.querySelector('[data-testid="marked"]')!.getAttribute('title')).toBe('权利要求书 · 4 项\n存在前向引用')
    expect(el.querySelector('[data-testid="marked-only"]')!.getAttribute('title')).toBe('超 300 字')
    expect(el.querySelector('[data-testid="marked"] [data-testid="row-mark"]')!.getAttribute('data-tone')).toBe('warning')
  })

  it('axe（结构规则）serious / critical 为 0', async () => {
    const el = await mount(
      <div>
        <SectionHeader title="案卷文件" collapsed={false} onToggle={() => {}} controls="a" testId="h1" />
        <div id="a" />
        <SectionHeader title="文档大纲" collapsed onToggle={() => {}} controls="b" testId="h2" />
        <div id="b" />
      </div>,
    )
    const res = await axe.run(el, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
  })
})
