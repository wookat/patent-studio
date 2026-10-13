// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MobileConsole } from '@/components/mobile/MobileConsole'
import { CheckPanel } from '@/components/problems/CheckPanel'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'

/**
 * qa-06 余项（handoff §7c）：data-density=touch 下 Checkbox / Switch 的伪元素热区必须 ≥ 44。
 * jsdom 无布局，这里按 Tailwind v4 尺度（1 = 4px）从 class 反推几何：
 * `after:` 绝对定位的 inset 以 **padding box** 为基准（border 不计入），
 * 原缺陷正是漏算 border：checkbox 16 − 2×1 + 2×14 = 42，switch 20 − 2×2 + 2×12 = 40。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // useIsDesktop（CheckPanel / MobileConsole 触控分档）：jsdom 无 matchMedia，按 375 视口返回 false
  window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  host.dataset.density = 'touch'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const PX = 4
const TOUCH_INSET_RE = /in-data-\[density=touch\]:after:-inset-([\d.]+)/

/** 由 class 反推 touch 密度下的伪元素热区（宽 × 高，px） */
function touchHotZone(cls: string): { w: number; h: number; inset: number } {
  const size = cls.match(/\bsize-([\d.]+)\b/)?.[1]
  const w = Number(cls.match(/\bw-([\d.]+)\b/)?.[1] ?? size) * PX
  const h = Number(cls.match(/\bh-([\d.]+)\b/)?.[1] ?? size) * PX
  const border = /\bborder-2\b/.test(cls) ? 2 : /\bborder\b/.test(cls) ? 1 : 0
  const inset = Number(cls.match(TOUCH_INSET_RE)?.[1] ?? 0) * PX
  expect(cls).toContain('in-data-[density=touch]:after:absolute')
  expect(cls).toContain("in-data-[density=touch]:after:content-['']")
  return { w: w - 2 * border + 2 * inset, h: h - 2 * border + 2 * inset, inset }
}

describe('qa-06：触控密度伪元素热区 ≥ 44（视觉尺寸档不变）', () => {
  it('Checkbox：视觉 16（size-4 + border 1）；热区 ≥ 44×44', async () => {
    const el = await mount(<Checkbox aria-label="附带权利要求" data-testid="cb" />)
    const cb = el.querySelector<HTMLElement>('[data-testid="cb"]')!
    expect(cb.className).toContain('size-4')
    expect(cb.className).toMatch(/\brelative\b/)
    const zone = touchHotZone(cb.className)
    expect(zone.w).toBeGreaterThanOrEqual(44)
    expect(zone.h).toBeGreaterThanOrEqual(44)
  })

  it('Switch：视觉 36×20（w-9 h-5 + border 2）；热区 ≥ 44 高', async () => {
    const el = await mount(<Switch aria-label="外发" data-testid="sw" />)
    const sw = el.querySelector<HTMLElement>('[data-testid="sw"]')!
    expect(sw.className).toContain('h-5')
    expect(sw.className).toContain('w-9')
    expect(sw.className).toMatch(/\brelative\b/)
    const zone = touchHotZone(sw.className)
    expect(zone.w).toBeGreaterThanOrEqual(44)
    expect(zone.h).toBeGreaterThanOrEqual(44)
  })

  it('回归守卫：把 border 漏算的旧 inset（checkbox 3.5 / switch 3）会被判定 < 44', () => {
    const oldCheckbox = "in-data-[density=touch]:after:absolute in-data-[density=touch]:after:-inset-3.5 in-data-[density=touch]:after:content-[''] relative size-4 border"
    const oldSwitch = "in-data-[density=touch]:after:absolute in-data-[density=touch]:after:-inset-3 in-data-[density=touch]:after:content-[''] relative h-5 w-9 border-2"
    expect(touchHotZone(oldCheckbox).h).toBe(42)
    expect(touchHotZone(oldSwitch).h).toBe(40)
  })

  it('MobileConsole 问题 / 输出 / 任务 Segmented 用 md（视觉 36，选项 touch-hit 命中 44；W8 不再 xl 44）', async () => {
    const el = await mount(<MobileConsole />)
    const seg = el.querySelector<HTMLElement>('[data-testid="mobile-console-kind"]')!
    expect(seg.className).toContain('h-md-control')
    expect(seg.className).not.toContain('h-touch')
    for (const item of el.querySelectorAll<HTMLElement>('[data-slot="segmented-item"]')) expect(item.className).toContain('touch-hit')
    expect(el.querySelectorAll('[data-testid^="mobile-console-tab-"]')).toHaveLength(3)
  })

  it('CheckPanel 仓库回归折叠钮（375 实测 170×36）touch 密度 min-h-touch', async () => {
    const el = await mount(<CheckPanel />)
    const btn = el.querySelector<HTMLElement>('[data-testid="check-all-section"] button[aria-expanded]')!
    expect(btn.className).toContain('in-data-[density=touch]:min-h-touch')
  })
})
