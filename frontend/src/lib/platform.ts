import { useQuery } from '@tanstack/react-query'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { ProjectSummary } from '@/lib/types'
import type { PlatformCase } from '@/workbench/types'

/**
 * 目录案卷到当前主体可访问机构案件的解析。
 * 案号只用于寻找唯一候选：重名阻断，加载失败保留错误，后续读写使用案件 UUID。
 */

/**
 * pid → PlatformCase；无匹配返回 null。
 * 重名案件没有可靠的目录绑定，必须拒绝解析，不能靠更新时间猜测身份。
 */
export function resolveCaseByPid(cases: readonly PlatformCase[] | undefined | null, pid: string | null | undefined): PlatformCase | null {
  if (!pid || !cases) return null
  const matches = resolveCasesByPid(cases, pid)
  if (matches.length > 1) throw new AmbiguousCaseError()
  return matches[0] ?? null
}

export class AmbiguousCaseError extends Error {
  constructor() {
    super('发现多个同案号案件，请从机构工作台按案件身份打开；当前面板已停止读写。')
    this.name = 'AmbiguousCaseError'
  }
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
  /** 已确定身份的案件；身份不明确时为空，不把其他机构的数据并入目录行。 */
  platformCases: PlatformCase[]
}

/**
 * 唯一同案号候选合并为一行。重名案件按独立 UUID 展示，不猜测目录归属。
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
    const unique = matched.length === 1 ? matched[0] : null
    if (unique) folded.add(unique.id)
    rows.push({ pid: p.id, project: p, platformCase: unique, platformCases: unique ? [unique] : [] })
  }
  for (const c of cases ?? []) {
    if (folded.has(c.id)) continue
    rows.push({ pid: null, project: null, platformCase: c, platformCases: [c] })
  }
  return rows
}

/** Z29：pid → 平台案精确作用域查询（GET /cases/by-key/{pid}，不拉全库；跨机构同名全部返回） */
export const listCasesByKey = (pid: string, signal?: AbortSignal) => workbenchApi.casesByKey(pid, signal)

/** 未匹配返回 null；服务错误与身份冲突由调用方明确呈现。 */
export async function getPlatformCase(pid: string | null | undefined, signal?: AbortSignal): Promise<PlatformCase | null> {
  if (!pid) return null
  return resolveCaseByPid(await listCasesByKey(pid, signal), pid)
}

const ALL_CASES_PAGE = 200
/**
 * 阶段6收口：跨案聚合（提案收件箱）确需全量可见案——/cases/page 逐页取尽，
 * 不发无参数 /api/v1/cases；total 驱动循环，任何截断都会暴露而不是默默丢案。
 */
export async function listAllCases(signal?: AbortSignal): Promise<PlatformCase[]> {
  const out: PlatformCase[] = []
  for (let offset = 0; ; offset += ALL_CASES_PAGE) {
    const page = await workbenchApi.casesPage({ limit: ALL_CASES_PAGE, offset }, signal)
    out.push(...page.items)
    if (out.length >= page.total || page.items.length === 0) return out
  }
}

/** React：当前主体可见平台案列表（与 WorkbenchPage 共缓存，不自建 key） */
export function usePlatformCases() {
  return useQuery({ queryKey: workbenchKeys.cases(), queryFn: ({ signal }) => listAllCases(signal) })
}

/**
 * React hook：pid → PlatformCase。
 * `data === undefined` 加载中 / 未启用；`data === null` 已确定是纯旧案。
 * 401（/api/v1 fail-closed）保持 error 状态，由调用方自行决定显示形态（方案约定：隐藏新面入口，不空态污染）。
 */
export function usePlatformCase(pid: string | null | undefined) {
  return useQuery({
    queryKey: workbenchKeys.caseByKey(pid ?? ''),
    queryFn: ({ signal }) => workbenchApi.casesByKey(pid!, signal),
    enabled: !!pid,
    select: (cs) => resolveCaseByPid(cs, pid ?? null),
  })
}
