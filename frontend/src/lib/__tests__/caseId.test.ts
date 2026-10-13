import { describe, expect, it } from 'vitest'
import { fallbackCaseId, isValidCaseId, slugCaseId, suggestCaseId } from '../caseId'

describe('caseId：案卷标识自动生成（与后端 ID_RE 同一字符集）', () => {
  it('slugCaseId：非法字符折成 -、连续 - 合并、首尾 - 去掉、截断后不留尾 -', () => {
    expect(slugCaseId(' P2026/0042 (甲方) ')).toBe('P2026-0042-甲方')
    expect(slugCaseId('a  b__c--d')).toBe('a-b__c-d')
    expect(slugCaseId('!!!')).toBe('')
    expect(slugCaseId('一种时间序列预测模型部署期的方法', 8)).toBe('一种时间序列预测')
    expect(slugCaseId('abc-def', 4)).toBe('abc')
  })

  it('fallbackCaseId：案卷-YYYYMMDD-HHmm', () => {
    expect(fallbackCaseId(new Date(2026, 8, 3, 8, 5))).toBe('案卷-20260903-0805')
  })

  it('suggestCaseId：案号 > 名称前 24 字 > 日期兜底；撞名追加 -2 / -3', () => {
    expect(suggestCaseId({ caseNo: 'P2026-0042', title: '新案' })).toBe('P2026-0042')
    expect(suggestCaseId({ title: '一种时间序列预测模型部署期的方法及装置与系统实现细节' })).toBe('一种时间序列预测模型部署期的方法及装置与系统实现')
    expect(suggestCaseId({ now: new Date(2026, 0, 1, 0, 0) })).toBe('案卷-20260101-0000')
    expect(suggestCaseId({ title: '新案', existing: ['新案'] })).toBe('新案-2')
    expect(suggestCaseId({ title: '新案', existing: ['新案', '新案-2'] })).toBe('新案-3')
  })

  it('suggestCaseId：撞名时总长仍 ≤ 64', () => {
    const long = 'x'.repeat(70)
    const base = slugCaseId(long)
    expect(base).toHaveLength(64)
    const next = suggestCaseId({ caseNo: long, existing: [base] })
    expect(next.length).toBeLessThanOrEqual(64)
    expect(next.endsWith('-2')).toBe(true)
  })

  it('isValidCaseId：与后端 ID_RE 一致', () => {
    expect(isValidCaseId('P2026-0042_甲方')).toBe(true)
    expect(isValidCaseId('')).toBe(false)
    expect(isValidCaseId('bad id!')).toBe(false)
    expect(isValidCaseId('.')).toBe(false)
    expect(isValidCaseId('..')).toBe(false)
    expect(isValidCaseId('x'.repeat(65))).toBe(false)
  })
})
