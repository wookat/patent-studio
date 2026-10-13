import { describe, expect, it } from 'vitest'
import { MOBILE_NOTICE, mobileNotice } from '../LayoutMobile'

/** W9 ux-05：375 顶部提示与实际能力一致（可编辑 / 审阅 / 只读），不再说「阅读模式」却可键入 */
describe('mobileNotice', () => {
  it('可编辑 + 编辑模式：点正文直接输入', () => {
    const n = mobileNotice(true, false)
    expect(n).toContain('点正文直接输入')
    expect(n).toContain('PDF 为准')
    expect(n).not.toContain('阅读模式')
  })
  it('可编辑 + 审阅模式（reviewer）：改动记为修订建议', () => {
    const n = mobileNotice(true, true)
    expect(n).toContain('修订建议')
    expect(n).not.toContain('阅读模式')
  })
  it('只读：沿用阅读模式文案并标注只读', () => {
    expect(mobileNotice(false, false)).toBe(`${MOBILE_NOTICE} · 只读`)
    expect(mobileNotice(false, true)).toContain('只读')
  })
})
