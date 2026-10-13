// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canMutateComment, commentSource } from '../comments'
import type { Comment } from '@/lib/types'

/** R64-01/04：批注写操作前端门控 + 客户徽标来源判定（与后端 _comment_perm / source 契约同口径） */

const comment = (o: Partial<Comment> = {}): Comment => ({
  id: 'c1',
  anchor: { block_id: 'claims/1', line: 9, quote: 'q' },
  body: '批注',
  author: { id: 'owner-uid', name: '管理员' },
  created_at: 0,
  updated_at: 0,
  resolved: false,
  replies: [],
  ...o,
})

const state = (role: string | null, userId = 'viewer-uid', superuser = false) => ({
  user: { id: userId, is_superuser: superuser },
  project: { role },
})

describe('canMutateComment（R64-01）', () => {
  const c = comment()
  it('viewer 对他人批注：resolve/delete 全禁', () => {
    const s = state('viewer')
    expect(canMutateComment(s, c, 'reviewer')).toBe(false)
    expect(canMutateComment(s, c, 'editor')).toBe(false)
  })
  it('reviewer 可 resolve 他人批注，不可删', () => {
    const s = state('reviewer')
    expect(canMutateComment(s, c, 'reviewer')).toBe(true)
    expect(canMutateComment(s, c, 'editor')).toBe(false)
  })
  it('editor/owner 对他人批注全可', () => {
    for (const role of ['editor', 'agent', 'owner']) {
      const s = state(role)
      expect(canMutateComment(s, c, 'reviewer')).toBe(true)
      expect(canMutateComment(s, c, 'editor')).toBe(true)
    }
  })
  it('作者本人豁免角色门槛（viewer 也能管自己的批注）', () => {
    const own = comment({ author: { id: 'viewer-uid', name: '我' } })
    const s = state('viewer')
    expect(canMutateComment(s, own, 'editor')).toBe(true)
    expect(canMutateComment(s, own, 'reviewer')).toBe(true)
  })
  it('客户批注（author.id=null）只能角色管——viewer 连「自己名义」也不行', () => {
    const client = comment({ author: { id: null, name: '客户甲' }, source: 'client' })
    const s = state('viewer')
    expect(canMutateComment(s, client, 'editor')).toBe(false)
    expect(canMutateComment(s, client, 'reviewer')).toBe(false)
    expect(canMutateComment(state('reviewer'), client, 'reviewer')).toBe(true)
  })
  it('AUTH off / superuser / role 未取到 ⇒ 按可写', () => {
    expect(canMutateComment({ user: null, project: null }, c, 'editor')).toBe(true)
    expect(canMutateComment(state(null, 'x', true), c, 'editor')).toBe(true)
    expect(canMutateComment(state(null), c, 'editor')).toBe(true)
  })
})

describe('commentSource（R64-04）', () => {
  it('API 透 source=client → 客户徽标（此前只认 guest 字段，永远不渲）', () => {
    expect(commentSource(comment({ source: 'client', author: { id: null, name: '客户甲' } }))).toBe('client')
  })
  it('author.id=ai 或 source=ai → ai；普通成员 → human', () => {
    expect(commentSource(comment({ author: { id: 'ai', name: 'AI' } }))).toBe('ai')
    expect(commentSource(comment({ source: 'ai' }))).toBe('ai')
    expect(commentSource(comment())).toBe('human')
    expect(commentSource(comment({ source: 'human' }))).toBe('human')
  })
})
