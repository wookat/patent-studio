import { describe, expect, it } from 'vitest'
import { OWNER_GONE, ownerDisplayName } from '@/components/dashboard/OwnerPicker'
import { AVATAR_COLOR_HEX, avatarColorFor } from '@/types/account'
import { PEER_COLORS, PEER_COLOR_BY_NAME, colorFor, labelText, userColor } from '../colors'
import { collabUserFor } from '../provider'

describe('userColor：全站头像色单源（W11-5）', () => {
  it('账户选了预设色 ⇒ 用它；未选 / 非法 ⇒ 按显示名哈希；无名 ⇒ 按邮箱', () => {
    const u = { display_name: '王五', email: 'w@x.com', avatar_color: 'teal' }
    expect(userColor(u)).toBe(PEER_COLOR_BY_NAME.teal)
    expect(userColor({ ...u, avatar_color: '' })).toBe(colorFor('王五'))
    expect(userColor({ ...u, avatar_color: 'not-a-color' })).toBe(colorFor('王五'))
    expect(userColor({ display_name: '  ', email: 'w@x.com' })).toBe(colorFor('w@x.com'))
    expect(userColor(null)).toBe(PEER_COLORS[0])
  })

  it('账户页派生色名 ↔ userColor 回退同一哈希（顶栏 / 台账 / 账户页同色）', () => {
    for (const name of ['王五', 'Alice', ' 张三 ', 'z@x.com']) {
      expect(AVATAR_COLOR_HEX[avatarColorFor(name)]).toBe(userColor({ display_name: name, email: 'e@x' }))
    }
  })

  it('collabUserFor：协同光标广播色 = userColor（有预设色时不再按名哈希）', () => {
    expect(collabUserFor({ display_name: '王五', email: 'w@x.com', avatar_color: 'red' }).color).toBe(PEER_COLOR_BY_NAME.red)
    expect(collabUserFor({ display_name: '王五', email: 'w@x.com', avatar_color: '' }).color).toBe(colorFor('王五'))
  })

  it('黄 / 青底用深字，其余白字', () => {
    expect(labelText(PEER_COLOR_BY_NAME.yellow)).toBe('#0b1220')
    expect(labelText(PEER_COLOR_BY_NAME.teal)).toBe('#0b1220')
    expect(labelText(PEER_COLOR_BY_NAME.blue)).toBe('#ffffff')
  })
})

describe('ownerDisplayName：责任人不露 id', () => {
  it('有账号 ⇒ 姓名 / 邮箱；指了但账号已删 ⇒ 「已离开的成员」；未指 ⇒ 「未指派」', () => {
    const uid = '00000000-0000-4000-8000-000000000001'
    expect(ownerDisplayName(uid, { user_id: uid, email: 'w@x.com', display_name: '王五', avatar_color: '' })).toBe('王五')
    expect(ownerDisplayName(uid, { user_id: uid, email: 'w@x.com', display_name: '', avatar_color: '' })).toBe('w@x.com')
    expect(ownerDisplayName(uid, null)).toBe(OWNER_GONE)
    expect(ownerDisplayName(uid, null)).not.toContain(uid)
    expect(ownerDisplayName(null, null)).toBe('未指派')
  })
})
