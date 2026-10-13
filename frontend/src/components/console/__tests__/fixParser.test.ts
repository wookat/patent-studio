import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@/lib/types'
import { applyReplaceFix, canApplyFix, deriveReplaceFix, formatDiagnostics, parseReplaceFix } from '../fixParser'

describe('parseReplaceFix', () => {
  it('解析「把 X 改为 Y」各种写法', () => {
    expect(parseReplaceFix('把「权利要求7」改为「权利要求5」')).toEqual({ from: '权利要求7', to: '权利要求5' })
    expect(parseReplaceFix('将“图5”替换为“图4”')).toEqual({ from: '图5', to: '图4' })
    expect(parseReplaceFix('把 图5 改为 图4')).toEqual({ from: '图5', to: '图4' })
    expect(parseReplaceFix('「图5」→「图4」')).toEqual({ from: '图5', to: '图4' })
  })
  it('原则性建议解析不到 → null（只能作为建议展示）', () => {
    expect(parseReplaceFix('从属权利要求只能引用编号比自身小、且已存在的权利要求')).toBeNull()
    expect(parseReplaceFix('精简摘要正文，或在排版设置中调整摘要字数上限')).toBeNull()
    expect(parseReplaceFix(undefined)).toBeNull()
    expect(parseReplaceFix('')).toBeNull()
  })
})

describe('deriveReplaceFix', () => {
  const principle = '从属权利要求只能引用编号比自身小、且已存在的权利要求'
  it('claims.forward_ref#N 单一引用 → 改为权利要求 N-1', () => {
    expect(deriveReplaceFix({ id: 'claims.forward_ref#6', message: '权利要求 6 向前引用了在后的权利要求（权利要求7）', fix: principle })).toEqual({ from: '权利要求7', to: '权利要求5' })
    expect(deriveReplaceFix({ id: 'claims.forward_ref#2', message: '权利要求 2 引用了不存在的权利要求（权利要求9）', fix: principle })).toEqual({ from: '权利要求9', to: '权利要求1' })
    expect(deriveReplaceFix({ id: 'claims.forward_ref#3', message: '权利要求 3 引用了自身（权利要求 3）', fix: principle })).toEqual({ from: '权利要求 3', to: '权利要求2' })
  })
  it('第 1 项 / 区间引用 / 其他规则 → null（不猜）', () => {
    expect(deriveReplaceFix({ id: 'claims.forward_ref#1', message: '权利要求 1 引用了自身（权利要求1）', fix: principle })).toBeNull()
    expect(deriveReplaceFix({ id: 'claims.forward_ref#6', message: '权利要求 6 向前引用了在后的权利要求（权利要求7至9）', fix: principle })).toBeNull()
    expect(deriveReplaceFix({ id: 'claims.independent_first', message: '第 1 项权利要求引用了其他权利要求（权利要求2）', fix: principle })).toBeNull()
  })
  it('fix 本身可解析时优先用 fix', () => {
    expect(deriveReplaceFix({ id: 'claims.forward_ref#6', message: '（权利要求7）', fix: '把「权利要求7」改为「权利要求4」' })).toEqual({ from: '权利要求7', to: '权利要求4' })
  })
})

describe('applyReplaceFix / canApplyFix', () => {
  const content = '# 标题\n\n6.根据权利要求7所述的方法\n'
  it('仅替换指定行内首个匹配', () => {
    expect(applyReplaceFix(content, 3, { from: '权利要求7', to: '权利要求5' })).toEqual({
      content: '# 标题\n\n6.根据权利要求5所述的方法\n',
      line: 3,
    })
  })
  it('该行不含 X / 行号越界 → null，不改内容', () => {
    expect(applyReplaceFix(content, 1, { from: '权利要求7', to: '权利要求5' })).toBeNull()
    expect(applyReplaceFix(content, 99, { from: '权利要求7', to: '权利要求5' })).toBeNull()
  })
  it('canApplyFix：fix 可解析 + 行已知 + 行内含 X', () => {
    const base: Diagnostic = { id: 'claims.forward_ref#6', severity: 'error', source: 'lint', message: 'm', line: 3 }
    expect(canApplyFix({ ...base, fix: '把「权利要求7」改为「权利要求5」' }, content)).toEqual({ from: '权利要求7', to: '权利要求5' })
    expect(canApplyFix({ ...base, fix: '从属权利要求只能引用编号比自身小、且已存在的权利要求' }, content)).toBeNull()
    expect(canApplyFix({ ...base, message: '权利要求 6 向前引用了在后的权利要求（权利要求7）', fix: '从属权利要求只能引用编号比自身小' }, content)).toEqual({ from: '权利要求7', to: '权利要求5' })
    expect(canApplyFix({ ...base, line: null, fix: '把「权利要求7」改为「权利要求5」' }, content)).toBeNull()
  })
})

describe('formatDiagnostics', () => {
  it('输出 [severity] message (loc · section) + 建议 / detail 缩进', () => {
    const out = formatDiagnostics([
      { id: 'a', severity: 'error', source: 'lint', message: '错', line: 30, section: '权利要求书', fix: '建议A', detail: 'l1\nl2' },
      { id: 'b', severity: 'info', source: 'client', message: '提示', line: null },
    ])
    expect(out).toBe('[error] 错 (content.md:30 · 权利要求书)\n  建议：建议A\n  l1\n  l2\n[info] 提示 (client)')
  })
})
