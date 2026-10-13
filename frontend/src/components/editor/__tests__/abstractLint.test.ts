import { describe, expect, it } from 'vitest'
import { abstractNearThreshold } from '@/lib/abstractLimit'
import { ABSTRACT_LIMIT_ID, ABSTRACT_NEAR_LIMIT_ID, abstractDiagnostic } from '../abstractLint'

const doc = (n: number) => `# 标题\n\n## 摘要\n\n${'甲'.repeat(n)}\n\n## 权利要求书\n\n1.一种方法。\n`

describe('abstractDiagnostic', () => {
  it('阈值：300 → 285', () => {
    expect(abstractNearThreshold(300)).toBe(285)
    expect(abstractNearThreshold(100)).toBe(95)
  })

  it('远低于上限：无诊断', () => {
    expect(abstractDiagnostic(doc(200), 300)).toBeNull()
    expect(abstractDiagnostic(doc(284), 300)).toBeNull()
  })

  it('接近上限（285–300）：warning abstract.near_limit，定位到摘要正文行', () => {
    for (const n of [285, 295, 300]) {
      const d = abstractDiagnostic(doc(n), 300)
      expect(d?.id).toBe(ABSTRACT_NEAR_LIMIT_ID)
      expect(d?.severity).toBe('warning')
      expect(d?.source).toBe('client')
      expect(d?.line).toBe(5)
      expect(d?.message).toContain(`当前 ${n} 字`)
    }
  })

  it('超限（>300）：error abstract.limit，与后端 lint 同 id', () => {
    const d = abstractDiagnostic(doc(301), 300)
    expect(d?.id).toBe(ABSTRACT_LIMIT_ID)
    expect(d?.severity).toBe('error')
  })

  it('标记符不计入字数：{++…++} 包裹的摘要按接受后文本计数', () => {
    // 200 字正文包进插入标记：原文本计数 208 仍低于 285；真正验证点：raw 计数会让 {--…--} 删除侧也入账
    const marked = `# 标题\n\n## 摘要\n\n{++${'甲'.repeat(200)}++}\n\n## 权利要求书\n\n1.一种方法。\n`
    expect(abstractDiagnostic(marked, 300)).toBeNull()
    // 接受后 200 字无诊断；raw 计数 400 → 误报超限（OBS-VIT-4）
    const withDel = `# 标题\n\n## 摘要\n\n{++${'甲'.repeat(200)}++}{--${'乙'.repeat(200)}--}\n\n## 权利要求书\n\n1.一种方法。\n`
    expect(abstractDiagnostic(withDel, 300)).toBeNull()
  })
})
