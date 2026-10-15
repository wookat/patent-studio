import { useQuery } from '@tanstack/react-query'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { ProjectSummary } from '@/lib/types'
import type { PlatformCase } from '@/workbench/types'

/**
 * B17 M1 桥接层：旧案卷（pid = `PATENT_PROJECTS_DIR` 下目录名，文件真源）
 * 与新平台案件（PG `cases.case_key`）之间的纯前端解析。
 *
 * 映射契约：importer 缺省以**目录名为 case_key**（backend/src/patent_studio/cli.py L80：
 * `args.case_key or plan.source_dir.rsplit("/", 1)[-1]`），故 `case_key === pid` 即同一案。
 * pid 是 hash 路由 decodeURIComponent 后的目录名，case_key 是字面串——两侧都是原名，精确相等即可。
 *
 * 后端零新增：`GET /api/v1/cases` 已返回当前主体可见案件全集（机构成员 ∪ 案件参与者 ∪ 创建者），
 * 前端按 case_key 过滤；该案不在任何可见机构 / 未回灌 ⇒ 一律 null，调用方走「纯旧案」分支。
 */

/**
 * pid → PlatformCase；无匹配返回 null。
 * 跨机构重名（不同 org 同 case_key）时取列表首位——`GET /api/v1/cases` 后端按
 * `updated_at DESC, case_key` 排序（api/routes.py list_cases），首位即最近活动的案。
 */
export function resolveCaseByPid(cases: readonly PlatformCase[] | undefined | null, pid: string | null | undefined): PlatformCase | null {
  if (!pid || !cases) return null
  return cases.find((c) => c.case_key === pid) ?? null
}

/** 同一 pid 命中的全部平台案（跨机构重名时 >1）；无命中 ⇒ [] */
export function resolveCasesByPid(cases: readonly PlatformCase[] | undefined | null, pid: string | null | undefined): PlatformCase[] {
  if (!pid || !cases) return []
  return cases.filter((c) => c.case_key === pid)
}

export interface MergedCaseRow {
  /** 旧目录案 pid；纯平台案（无对应目录）⇒ null */
  pid: string | null
  /** 旧目录案摘要；纯平台案 ⇒ null */
  project: ProjectSummary | null
  /** 主匹配平台案（`resolveCaseByPid` 结果）；纯目录案 / 未回灌 ⇒ null */
  platformCase: PlatformCase | null
  /** 同 case_key 的全部平台案；无 ⇒ [] */
  platformCases: PlatformCase[]
}

/**
 * 一案双体去重：目录案件与 PG 案件 case_key 相同 ⇒ 折进同一行（`platformCase` 挂上），
 * 绝不出现两张卡。无目录对应的平台案追加为 platform-only 行（`pid/project` 为 null）。
 * 行序：目录案保持 `projects` 原序；platform-only 行按 cases 原序（updated_at desc）缀后。
 */
export function mergeCaseRows(
  projects: readonly ProjectSummary[] | undefined | null,
  cases: readonly PlatformCase[] | undefined | null,
): MergedCaseRow[] {
  const rows: MergedCaseRow[] = []
  const folded = new Set<string>()
  for (const p of projects ?? []) {
    const matched = resolveCasesByPid(cases, p.id)
    for (const c of matched) folded.add(c.id)
    rows.push({ pid: p.id, project: p, platformCase: matched[0] ?? null, platformCases: matched })
  }
  for (const c of cases ?? []) {
    if (folded.has(c.id)) continue
    rows.push({ pid: null, project: null, platformCase: c, platformCases: [c] })
  }
  return rows
}

/** GET /api/v1/cases 直取（给非 React 上下文；React 侧统一走 usePlatformCases 复用 react-query 缓存） */
export const listPlatformCases = (signal?: AbortSignal) => workbenchApi.cases(signal)

/** pid → 平台案（异步一次性版）：拉全量后按 case_key 命中；未命中 / 401 / 无 pid ⇒ null */
export async function getPlatformCase(pid: string | null | undefined, signal?: AbortSignal): Promise<PlatformCase | null> {
  if (!pid) return null
  try {
    return resolveCaseByPid(await listPlatformCases(signal), pid)
  } catch {
    return null // 未登录 / /api/v1 fail-closed ⇒ 视为纯旧案，不抛给调用方
  }
}

/** React：当前主体可见平台案列表（与 WorkbenchPage 共缓存，不自建 key） */
export function usePlatformCases() {
  return useQuery({ queryKey: workbenchKeys.cases(), queryFn: ({ signal }) => workbenchApi.cases(signal) })
}

/**
 * React hook：pid → PlatformCase。
 * `data === undefined` 加载中 / 未启用；`data === null` 已确定是纯旧案。
 * 401（/api/v1 fail-closed）保持 error 状态，由调用方自行决定显示形态（方案约定：隐藏新面入口，不空态污染）。
 */
export function usePlatformCase(pid: string | null | undefined) {
  return useQuery({
    queryKey: workbenchKeys.cases(),
    queryFn: ({ signal }) => workbenchApi.cases(signal),
    enabled: !!pid,
    select: (cs) => resolveCaseByPid(cs, pid ?? null),
  })
}
