import { describe, expect, it } from 'vitest'
import { mergeCaseRows, resolveCaseByPid, resolveCasesByPid } from '../platform'
import type { ProjectSummary } from '@/lib/types'
import type { PlatformCase } from '@/workbench/types'

const pc = (id: string, key: string, org = 'o1', title = `案件${id}`): PlatformCase =>
  ({ id, organization_id: org, case_key: key, title, kind: 'invention', status: 'drafting' }) as PlatformCase

const proj = (id: string): ProjectSummary => ({ id, title: `案卷${id}`, mtime: 1 }) as ProjectSummary

describe('platform 桥接：pid(目录名) ↔ case_key', () => {
  it('resolveCaseByPid：case_key 精确相等即命中', () => {
    const cases = [pc('c1', 'method'), pc('c2', 'system')]
    expect(resolveCaseByPid(cases, 'method')?.id).toBe('c1')
    expect(resolveCaseByPid(cases, 'system')?.id).toBe('c2')
  })

  it('resolveCaseByPid：未回灌/无权限/空入参 ⇒ null（纯旧案分支）', () => {
    const cases = [pc('c1', 'method')]
    expect(resolveCaseByPid(cases, 'nonexist')).toBeNull()
    expect(resolveCaseByPid([], 'method')).toBeNull()
    expect(resolveCaseByPid(undefined, 'method')).toBeNull()
    expect(resolveCaseByPid(null, 'method')).toBeNull()
    expect(resolveCaseByPid(cases, null)).toBeNull()
    expect(resolveCaseByPid(cases, undefined)).toBeNull()
    expect(resolveCaseByPid(cases, '')).toBeNull()
  })

  it('resolveCaseByPid：大小写敏感——部分匹配/大小写差异不命中', () => {
    const cases = [pc('c1', 'Method')]
    expect(resolveCaseByPid(cases, 'method')).toBeNull()
    expect(resolveCaseByPid(cases, 'Meth')).toBeNull()
    expect(resolveCaseByPid(cases, 'Method-X')).toBeNull()
  })

  it('resolveCaseByPid：跨机构重名取列表首位（后端 updated_at desc ⇒ 最近活动）', () => {
    const cases = [pc('c-new', 'method', 'oA'), pc('c-old', 'method', 'oB')]
    expect(resolveCaseByPid(cases, 'method')?.id).toBe('c-new')
    // resolveCasesByPid 返回全部命中，主匹配是其首位
    const all = resolveCasesByPid(cases, 'method')
    expect(all.map((c) => c.id)).toEqual(['c-new', 'c-old'])
  })

  it('resolveCaseByPid：目录名含非 ASCII/空格同样按字面相等', () => {
    const cases = [pc('c1', '案卷 一号'), pc('c2', '案卷一号')]
    expect(resolveCaseByPid(cases, '案卷 一号')?.id).toBe('c1')
    expect(resolveCaseByPid(cases, '案卷一号')?.id).toBe('c2')
  })

  it('mergeCaseRows：一案双体折叠成单行，platform-only 追加在后', () => {
    const projects = [proj('method'), proj('legacy-only')]
    const cases = [pc('c1', 'method'), pc('c2', 'pg-only')]
    const rows = mergeCaseRows(projects, cases)
    expect(rows).toHaveLength(3)
    // 双体行：pid 与 platformCase 都有
    expect(rows[0].pid).toBe('method')
    expect(rows[0].platformCase?.id).toBe('c1')
    // 纯目录案：platformCase null
    expect(rows[1].pid).toBe('legacy-only')
    expect(rows[1].platformCase).toBeNull()
    expect(rows[1].platformCases).toEqual([])
    // 纯平台案：pid/project 为 null，作为独立行出现一次
    expect(rows[2].pid).toBeNull()
    expect(rows[2].project).toBeNull()
    expect(rows[2].platformCase?.id).toBe('c2')
    // case_key=method 的平台案不得再以独立行出现（去重核心）
    expect(rows.filter((r) => r.platformCase?.id === 'c1')).toHaveLength(1)
  })

  it('mergeCaseRows：重名平台案全折叠进目录行（platformCases 保留全部供消费方甄别）', () => {
    const projects = [proj('method')]
    const cases = [pc('cA', 'method', 'oA'), pc('cB', 'method', 'oB')]
    const rows = mergeCaseRows(projects, cases)
    expect(rows).toHaveLength(1)
    expect(rows[0].platformCase?.id).toBe('cA')
    expect(rows[0].platformCases.map((c) => c.id)).toEqual(['cA', 'cB'])
  })

  it('mergeCaseRows：目录行保持 projects 原序；空入参安全', () => {
    const projects = [proj('b'), proj('a'), proj('c')]
    const rows = mergeCaseRows(projects, [pc('c1', 'a')])
    expect(rows.map((r) => r.pid)).toEqual(['b', 'a', 'c'])
    expect(rows[1].platformCase?.id).toBe('c1')
    expect(mergeCaseRows(null, null)).toEqual([])
    expect(mergeCaseRows(undefined, [pc('c1', 'x')]).map((r) => r.platformCase?.id)).toEqual(['c1'])
  })
})
