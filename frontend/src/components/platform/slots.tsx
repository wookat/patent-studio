import { FileStack, GitPullRequest } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { registerCompanionBody, registerRailItem } from '@/lib/slots'
import { RAIL_ACTIVE, RAIL_BTN } from '@/components/shell/Rail'
import { cn } from '@/lib/utils'
import { useStudio, type CompanionId } from '@/store'
import { MaterialsCompanionBody, ProposalsCompanionBody } from './PlatformCompanion'

/**
 * B17 M4：platform 单元槽位——伴随栏正文（proposals / materials）+ Rail 入口。
 * 与 timeline/notify/ai 单元同法：DesktopShell / MobileShell 副作用引入本文件即完成注册，
 * 不改 CompanionHost / Rail 结构。pid 缺失时按钮置灰；案未迁移时正文由 PlatformCompanionScope 落空态。
 */
function PlatformRailButton({ id, label, icon, testId }: { id: CompanionId; label: string; icon: React.ReactNode; testId: string }) {
  const companion = useStudio((s) => s.companion)
  const toggleCompanion = useStudio((s) => s.toggleCompanion)
  const pid = useStudio((s) => s.pid)
  const active = companion === id
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn(RAIL_BTN, active && RAIL_ACTIVE)}
      onClick={() => toggleCompanion(id)}
      disabled={!pid}
      data-testid={testId}
      data-companion={id}
    >
      {icon}
      <span className="select-none text-[9px] leading-none text-current" aria-hidden>{label.slice(0, 2)}</span>
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}（平台案件）</TooltipContent>
    </Tooltip>
  )
}

registerCompanionBody('proposals', ProposalsCompanionBody)
registerCompanionBody('materials', MaterialsCompanionBody)
registerRailItem({ id: 'platform-proposals', render: () => <PlatformRailButton id="proposals" label="提案" icon={<GitPullRequest aria-hidden />} testId="rail-proposals" /> }, 20)
registerRailItem({ id: 'platform-materials', render: () => <PlatformRailButton id="materials" label="资料" icon={<FileStack aria-hidden />} testId="rail-materials" /> }, 21)
