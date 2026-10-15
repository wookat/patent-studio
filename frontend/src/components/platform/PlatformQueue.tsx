import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { queryClient } from '@/lib/query'
import { mergeCaseRows } from '@/lib/platform'
import { projectHash } from '@/lib/hash'
import { useStudio } from '@/store'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import { ErrorPanel, QueueView } from '@/components/workbench/WorkbenchPage'

/**
 * B17 M6：dashboard「工作项」分段——平台工作队列并入案卷面板。
 * 打开工作项 = 解析 case → case_key → `#/p/<case_key>`（case_key=目录名时直达旧工作台）；
 * mergeCaseRows 去重保证一案双体只出现一次（队列按案件维度展示 case_key）。
 * 自带 QueryClientProvider——dashboard 测试裸挂载也能工作。
 */
export function PlatformQueue() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlatformQueueInner />
    </QueryClientProvider>
  )
}

function PlatformQueueInner() {
  const projects = useStudio((s) => s.projects)
  const cases = useQuery({ queryKey: workbenchKeys.cases(), queryFn: ({ signal }) => workbenchApi.cases(signal), retry: false })
  const items = useQuery({ queryKey: workbenchKeys.workItems(), queryFn: ({ signal }) => workbenchApi.workItems(signal), retry: false })
  const err = cases.error ?? items.error
  if (err) return <div className="p-4"><ErrorPanel error={err} onRetry={() => { void cases.refetch(); void items.refetch() }} /></div>
  if (cases.isLoading || items.isLoading) {
    return <div className="flex min-h-48 items-center justify-center text-fg-muted" role="status"><LoaderCircle className="mr-2 size-5 animate-spin" />正在加载平台工作项…</div>
  }
  // 一案双体去重：case_key 等于目录名的平台案折进目录行；目录里没有的 case_key 同样可点（未导入则旧路由 404→面板）
  const rows = mergeCaseRows(projects, cases.data ?? [])
  const keyById = new Map<string, string>()
  for (const r of rows) if (r.platformCase) keyById.set(r.platformCase.id, r.pid ?? r.platformCase.case_key)
  const open = (caseId: string) => {
    const pid = keyById.get(caseId)
    if (pid) window.location.hash = projectHash(pid)
  }
  return <div className="p-4" data-testid="dashboard-platform-queue"><QueueView cases={cases.data ?? []} items={items.data ?? []} onOpenCase={open} /></div>
}