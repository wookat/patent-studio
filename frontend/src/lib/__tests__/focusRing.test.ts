import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import { FOCUS_RING, FOCUS_RING_INSET } from '@/lib/utils'

/**
 * W7 qa-05：Tailwind v4 里 `outline-none` 会把 `--tw-outline-style` 置为 none，而 `focus-visible:outline-2` 只写
 * `outline-style: var(--tw-outline-style)`，于是 Button（FOCUS_RING）聚焦时 outline 仍是 none——顶栏图标按钮 Tab 巡航无焦点环。
 * 共用焦点环类串必须显式带 `focus-visible:outline-solid`，让编译出的 :focus-visible 规则真正落 `outline-style: solid`。
 */
async function css(classes: string) {
  const c = await compile('@import "tailwindcss/utilities" layer(utilities);', {
    base: process.cwd(),
    loadStylesheet: async (id, base) => ({ path: id, base, content: '@tailwind utilities;' }),
  })
  return c.build(classes.split(/\s+/))
}

function focusVisibleRules(out: string) {
  return [...out.matchAll(/\.focus-visible\\:[^{]+:focus-visible \{([^}]*)\}/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
}

describe('FOCUS_RING 编译结果（qa-05）', () => {
  for (const [name, cls] of [
    ['FOCUS_RING', FOCUS_RING],
    ['FOCUS_RING_INSET', FOCUS_RING_INSET],
  ] as const) {
    it(`${name}：静态 outline none，:focus-visible 落 outline-style: solid（且排在 outline-2 之后）+ 2px`, async () => {
      const out = await css(cls)
      expect(out).toMatch(/\.outline-none \{[^}]*outline-style: none/)
      const rules = focusVisibleRules(out)
      const solid = rules.findIndex((r) => /outline-style: solid/.test(r))
      const width = rules.findIndex((r) => /outline-width: 2px/.test(r))
      expect(solid).toBeGreaterThan(width)
      expect(width).toBeGreaterThanOrEqual(0)
      expect(cls).toContain('focus-visible:outline-ring')
    })
  }

  it('对照：去掉 outline-solid 的旧类串，:focus-visible 只剩 var(--tw-outline-style)（被 outline-none 置 none）', async () => {
    const out = await css(FOCUS_RING.replace('focus-visible:outline-solid', ''))
    const rules = focusVisibleRules(out)
    expect(rules.some((r) => /outline-style: solid/.test(r))).toBe(false)
    expect(rules.some((r) => /outline-style: var\(--tw-outline-style\)/.test(r))).toBe(true)
  })
})
