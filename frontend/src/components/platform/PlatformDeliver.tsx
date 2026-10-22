import type { ReactNode } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Package, Stethoscope } from 'lucide-react'
import { queryClient } from '@/lib/query'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { PlatformCase } from '@/workbench/types'
import { HealthPanel, ReleasesPanel } from '@/components/workbench/WorkbenchPage'
import { SideCard } from '@/components/deliver/DeliverSide'

/**
 * B17 M3：递交页并入平台能力。
 * 调用方（DeliverPage）先用 `getPlatformCase(pid)` 判定平台案再挂载本卡——纯旧案不渲染。
 * 卡片自带 QueryClientProvider：嵌套 provider 遮蔽外层，保证页面测试裸挂载（无 Provider）下也能安全工作。
 */
const withClient = (node: ReactNode) => <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>

function ReleasesBody({ caseItem }: { caseItem: PlatformCase }) {
  const releases = useQuery({ queryKey: workbenchKeys.releases(caseItem.id), queryFn: ({ signal }) => workbenchApi.releases(caseItem.id, signal) })
  const documents = useQuery({ queryKey: workbenchKeys.documents(caseItem.id), queryFn: ({ signal }) => workbenchApi.documents(caseItem.id, signal) })
  const figures = useQuery({ queryKey: workbenchKeys.figures(caseItem.id), queryFn: ({ signal }) => workbenchApi.figures(caseItem.id, signal) })
  return (
    <SideCard title="发布包（平台）" icon={<Package aria-hidden />} data-testid="deliver-platform-releases">
      <ReleasesPanel caseId={caseItem.id} releases={releases} documents={documents.data} figures={figures.data} />
    </SideCard>
  )
}

/** 发布包卡：复用 workbench ReleasesPanel——新建发布 → 组包三书+附图 → 封存 → 构建 DOCX 下载。 */
export function PlatformReleasesCard({ caseItem }: { caseItem: PlatformCase }) {
  return withClient(<ReleasesBody caseItem={caseItem} />)
}

function PreflightBody({ caseId }: { caseId: string }) {
  return (
    <SideCard title="平台体检" icon={<Stethoscope aria-hidden />} data-testid="deliver-platform-preflight">
      <p className="mb-2 text-xs text-fg-muted">对平台库中三书最新修订跑同一套 kernel 规则——诊断参考，不参与递交就绪判定。</p>
      <HealthPanel caseId={caseId} />
    </SideCard>
  )
}

/** 平台体检卡：/api/v1/cases/{id}/preflight（三书 current revisions → kernel preflight），与旧 /api/check 双源并列。 */
export function PlatformPreflightCard({ caseId }: { caseId: string }) {
  return withClient(<PreflightBody caseId={caseId} />)
}
