import { useStudio } from '@/store'
import type { CaseStatus } from '@/types/case'

/**
 * 当前案的状态与改状态权限（13 §5.3 / §4 ACL：状态需 agent+ 或机构管理员）。
 * 读详情字段 project.case.status 与 project.role（列表行才是 my_role）；无 case 摘要（后端旧版）时 status=null。
 * 桌面 TopBar 徽章与移动端 ProjectMenu「状态 ▸」子菜单共用。
 */
export function useCaseStatus(): { pid: string | null; status: CaseStatus | null; canEdit: boolean } {
  const pid = useStudio((s) => s.pid)
  const status = useStudio((s) => s.project?.case?.status ?? null)
  const role = useStudio((s) => s.project?.role)
  const authOff = useStudio((s) => s.authStatus === 'off')
  const superuser = useStudio((s) => s.user?.is_superuser ?? false)
  return { pid, status, canEdit: authOff || superuser || role === 'agent' || role === 'owner' }
}
