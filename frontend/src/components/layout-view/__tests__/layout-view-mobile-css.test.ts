import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolvePath(process.cwd(), 'src/components/layout-view/layout-view.css'), 'utf8')

/** 取出以 `.ps-layout-mobile` 开头的规则块（不含 @media 内的桌面规则） */
function mobileRules(): string[] {
  return [...css.matchAll(/^\.ps-layout-mobile[^{]*\{[^}]*\}/gm)].map((m) => m[0])
}
function rule(selector: string) {
  return css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`, 'm'))?.[0] ?? ''
}

describe('layout-view.css 移动纸面（06 §3 8pt 间距）', () => {
  it('.ps-layout-mobile 下页边 / 纸面 / 段距 / 权利要求 / 公式全部走 --pad-page-m / --gap-*-m token，不再有手写 px 间距', () => {
    const rules = mobileRules()
    expect(rules.length).toBeGreaterThan(5)
    const spacingDecl = /(?:^|\s)(?:margin|padding|gap|margin-top|margin-bottom)\s*:[^;]*\d+px/
    const offenders = rules.filter((r) => spacingDecl.test(r))
    expect(offenders, offenders.join('\n')).toEqual([])
    expect(rule('.ps-layout-mobile .ps-layout-body')).toContain('padding: var(--pad-page-m) var(--pad-page-m) var(--gap-section-m)')
    expect(rule('.ps-layout-mobile .ps-pages')).toContain('gap: var(--gap-card-m)')
    const paper = rule('.ps-layout-mobile .ps-paper')
    expect(paper).toContain('--ps-gap-body: var(--gap-group-m)')
    expect(paper).toContain('--ps-gap-claim: var(--gap-group-m)')
    expect(paper).toContain('--ps-gap-claim-inner: var(--gap-inline-m)')
    expect(paper).toMatch(/padding: calc\(var\(--pad-page-m\) \+ var\(--pad-page-m\)\) var\(--pad-page-m\) var\(--gap-section-m\)/)
    // 段间距走 .ps-body margin-bottom: var(--ps-gap-body)（桌面同一条规则），移动只重绑变量，不另写 .ps-p + .ps-p（那会盖掉权项内 4 的分段距）
    expect(rule('.ps-layout-mobile .ps-p + .ps-p')).toBe('')
    expect(rule('.ps-abstract,\n.ps-body')).toContain('margin-bottom: var(--ps-gap-body)')
    const kind = rule('.ps-layout-mobile .ps-claim-kind')
    expect(kind).toContain('margin: 0 0 var(--gap-inline-m)')
    expect(kind).toContain('font-size: var(--ps-size-para-no)')
  })

  it('桌面纸面规则不受影响：.ps-paper 仍按 --ps-page-w / --ps-margin-* 排版，权项内分段仍走 --ps-gap-claim-inner', () => {
    const paper = rule('.ps-paper')
    expect(paper).toContain('width: var(--ps-page-w)')
    expect(paper).toContain('padding: var(--ps-margin-t) var(--ps-margin-r) var(--ps-margin-b) var(--ps-margin-l)')
    expect(rule('.ps-claim .ps-p + .ps-p')).toContain('margin-top: var(--ps-gap-claim-inner)')
  })
})
