import { describe, expect, it } from 'vitest'
import {
  proposalStatusText,
  proposalStatusTone,
  workItemStatusText,
  workItemStatusTone,
  workItemTypeText,
} from '../labels'

describe('workbench 枚举中文映射（原型属性防护）', () => {
  it('正常枚举走映射', () => {
    expect(workItemTypeText('review')).toBe('复核')
    expect(workItemStatusText('in_progress')).toBe('进行中')
    expect(proposalStatusText('submitted')).toBe('待决')
  })

  it('未知普通值兜底「未知类型/未知状态」、tone 归 neutral', () => {
    expect(workItemTypeText('bogus-kind')).toBe('未知类型')
    expect(workItemStatusText('bogus')).toBe('未知状态')
    expect(workItemStatusTone('bogus')).toBe('neutral')
    expect(proposalStatusText('bogus')).toBe('未知状态')
    expect(proposalStatusTone('bogus')).toBe('neutral')
  })

  it('原型属性 constructor/toString 不命中函数、不误判为已知状态', () => {
    // Record<string,string> 直接索引会拿到 Function/'function ...'，in 也会把原型属性当合法
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(workItemTypeText(key)).toBe('未知类型')
      expect(workItemStatusText(key)).toBe('未知状态')
      expect(workItemStatusTone(key)).toBe('neutral')
      expect(proposalStatusText(key)).toBe('未知状态')
      expect(proposalStatusTone(key)).toBe('neutral')
    }
  })
})
