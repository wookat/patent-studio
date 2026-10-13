/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse, wcagContrast } from 'culori'
import { CASE_STATUSES } from '@/types/case'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/**
 * W5 spec §3.5 ②：index.css 所有「文字 / 背景」配对（含 .dark）对比度 ≥ 4.5:1（WCAG AA 正文）。
 * 只解析 :root 与 .dark 两块声明，var() 引用递归解析（dark 缺省回落到 :root）。
 */

function block(selector: string): Record<string, string> {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g')
  const out: Record<string, string> = {}
  for (const m of css.matchAll(re)) {
    for (const line of m[1].split(/;\s*/)) {
      const mm = line.match(/(--[\w-]+)\s*:\s*(.+)$/s)
      if (mm) out[mm[1].trim()] = mm[2].trim()
    }
  }
  return out
}

const light = block(':root')
const dark = { ...light, ...block('.dark') }

function resolveVar(vars: Record<string, string>, name: string, depth = 0): string {
  if (depth > 10) throw new Error(`var 引用过深：${name}`)
  const raw = vars[name]
  if (!raw) throw new Error(`index.css 缺少 ${name}`)
  return raw.replace(/var\((--[\w-]+)\)/g, (_, v: string) => resolveVar(vars, v, depth + 1))
}

function contrast(vars: Record<string, string>, fg: string, bg: string): number {
  const f = parse(resolveVar(vars, fg))
  const b = parse(resolveVar(vars, bg))
  if (!f || !b) throw new Error(`无法解析颜色 ${fg} / ${bg}`)
  return wcagContrast(f, b)
}

/** [文字, 背景] */
const PAIRS: [string, string][] = [
  ['--foreground', '--background'],
  ['--paper-fg', '--paper'],
  ['--fg', '--bg-app'],
  ['--fg', '--bg-panel'],
  ['--fg', '--bg-sunken'],
  ['--fg', '--bg-elevated'],
  ['--fg-muted', '--bg-app'],
  ['--fg-muted', '--bg-panel'],
  ['--fg-muted', '--bg-sunken'],
  ['--fg-inverse', '--bg-inverse'],
  ['--link', '--bg-panel'],
  ['--heat-1-fg', '--heat-1-bg'],
  ['--heat-2-fg', '--heat-2-bg'],
  ...['info', 'ok', 'warn', 'danger', 'violet', 'teal', 'orange'].map((f): [string, string] => [`--${f}-fg`, `--${f}-bg`]),
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--muted'],
  ['--card-foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--accent-foreground', '--accent'],
  ['--primary-foreground', '--primary'],
  ['--primary-text', '--primary-soft'],
  ['--destructive-foreground', '--destructive'],
  ['--destructive', '--destructive-soft'],
  ['--warning-foreground', '--warning-soft'],
  ['--success-foreground', '--success'],
  ['--info', '--info-soft'],
  ...CASE_STATUSES.map((s): [string, string] => [`--st-${s}-fg`, `--st-${s}-bg`]),
]

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('index.css 对比度（%s）', (_name, vars) => {
  it.each(PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(vars, fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('index.css token 完整性', () => {
  it('十档状态色 --st-*-bg/fg/dot 在 :root 定义且 .dark 可解析；7 语义族 fg/bg/dot 两套独立取值', () => {
    for (const s of CASE_STATUSES) for (const k of ['bg', 'fg', 'dot']) {
      expect(light[`--st-${s}-${k}`], `light --st-${s}-${k}`).toBeTruthy()
      expect(parse(resolveVar(dark, `--st-${s}-${k}`)), `dark --st-${s}-${k}`).toBeTruthy()
    }
    for (const f of ['info', 'ok', 'warn', 'danger', 'violet', 'teal', 'orange']) for (const k of ['bg', 'fg', 'dot']) {
      expect(light[`--${f}-${k}`], `light --${f}-${k}`).toBeTruthy()
      expect(block('.dark')[`--${f}-${k}`], `dark --${f}-${k}`).toBeTruthy()
    }
  })
  it('原始灰阶 12 阶 + 四层面亮暗独立 + 纸面恒白', () => {
    for (let i = 0; i <= 11; i++) expect(light[`--g${i}`], `--g${i}`).toMatch(/^oklch\(/)
    for (const k of ['--bg-app', '--bg-panel', '--bg-sunken', '--bg-elevated']) {
      expect(light[k], k).toBeTruthy()
      expect(block('.dark')[k], `dark ${k}`).toMatch(/^oklch\(/)
    }
    expect(resolveVar(light, '--paper')).toBe('oklch(1 0 0)')
    expect(resolveVar(dark, '--paper')).toBe('oklch(1 0 0)')
  })
  it('禁 9 / 10px 字号；控件档无 40px', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(body.match(/--fs-[\w-]+:\s*(?:9|10)px/g) ?? []).toEqual([])
    expect(body.match(/--h-(?:xs|sm|md|lg|touch):\s*40px/g) ?? []).toEqual([])
    expect(light['--h-xs']).toBe('24px'); expect(light['--h-sm']).toBe('28px'); expect(light['--h-md']).toBe('32px'); expect(light['--h-lg']).toBe('36px'); expect(light['--h-touch']).toBe('44px')
  })
  it('CompanionPanel / 壳尺寸 token', () => {
    expect(light['--w-companion']).toBe('360px'); expect(light['--w-companion-min']).toBe('320px'); expect(light['--w-companion-max']).toBe('480px')
    expect(light['--w-side']).toBe('240px'); expect(light['--w-rail']).toBe('40px'); expect(light['--h-topbar']).toBe('40px'); expect(light['--h-statusbar']).toBe('24px')
  })
  it('dark variant 使用 &:where(.dark, .dark *)', () => {
    expect(css).toContain('@custom-variant dark (&:where(.dark, .dark *));')
  })
  it('原始层 / 语义层颜色全部 OKLCH（无 hex / rgb / hsl）', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    expect(body.match(/\b(rgb|hsl)a?\(/g) ?? []).toEqual([])
  })
})
