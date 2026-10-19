import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useStudio } from '@/store'
import { FieldError } from '@/components/workbench/WorkbenchPage'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { PlatformCase } from '@/workbench/types'

const KIND_OPTIONS: { value: PlatformCase['kind']; label: string }[] = [
  { value: 'invention', label: '发明' },
  { value: 'utility', label: '实用新型' },
  { value: 'design', label: '外观设计' },
]
const NONE = '__none__'
const selCls = 'w-full'

/**
 * Z11/Z12 机构工作台「登记新案」：POST /organizations/{id}/cases（初始 intake）
 * → 可选分派承办人（POST participants，role=agent）→ 生成 WorkItem(type='draft')。
 * 机构/成员列表沿用 /api/v1 现口；承办人下拉来自机构活跃成员（display_name 由后端联 principals 透出）。
 */
export function CaseIntakeDialog({ open, onClose, meId }: { open: boolean; onClose(): void; meId: string | null }) {
  const client = useQueryClient()
  const toast = useStudio((s) => s.toast)
  // 组件常驻挂载（open 只控显隐），机构/成员列表直接 useQuery——不挂 enabled 门，首开时数据通常已就绪
  const orgs = useQuery({ queryKey: workbenchKeys.organizations(), queryFn: ({ signal }) => workbenchApi.organizations(signal) })
  const [orgId, setOrgId] = useState<string | null>(null)
  const [caseKey, setCaseKey] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<PlatformCase['kind']>('invention')
  const [assignee, setAssignee] = useState<string>(NONE)
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const orgOptions = orgs.data ?? []
  const resolvedOrg = orgId ?? orgOptions[0]?.id ?? null
  const effectiveOrg = orgOptions.some((o) => o.id === resolvedOrg) ? resolvedOrg : null

  const memberships = useQuery({
    queryKey: workbenchKeys.memberships(effectiveOrg ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.memberships(effectiveOrg!, signal),
    enabled: !!effectiveOrg,
  })
  const members = useMemo(() => (memberships.data ?? []).filter((m) => m.status === 'active'), [memberships.data])
  const myRole = members.find((m) => m.principal_id === meId)?.role ?? null
  const canManage = myRole === 'owner' || myRole === 'admin'
  const memberLabel = (m: { principal_id: string; display_name?: string | null }) => m.display_name || `${m.principal_id.slice(0, 8)}…`

  const reset = () => {
    setOrgId(null)
    setCaseKey('')
    setTitle('')
    setKind('invention')
    setAssignee(NONE)
    setDeadline('')
    setError(null)
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const submit = async () => {
    if (!effectiveOrg || !caseKey.trim() || !title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await workbenchApi.createCase(effectiveOrg, {
        case_key: caseKey.trim(),
        title: title.trim(),
        kind,
      })
      const assigneeId = assignee === NONE ? null : assignee
      if (assigneeId) {
        try {
          await workbenchApi.addParticipant(created.id, assigneeId, 'agent')
        } catch (e) {
          // 案件已建：参与者失败不吞掉，明示后由管理者在成员面板补派
          toast(`案件已登记，但承办人分派失败：${e instanceof Error ? e.message : '请稍后重试'}`, 'error')
        }
      }
      await workbenchApi.createWorkItem(created.id, {
        type: 'draft',
        title: `撰写：${created.title}`,
        assignee_principal_id: assigneeId,
        deadline: deadline ? new Date(deadline).toISOString() : null,
      })
      void client.invalidateQueries({ queryKey: workbenchKeys.cases() })
      void client.invalidateQueries({ queryKey: workbenchKeys.workItems() })
      toast(assigneeId ? `已登记新案「${created.case_key}」并分派承办人` : `已登记新案「${created.case_key}」`, 'success')
      reset()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent size="md" data-testid="case-intake-dialog">
        <DialogHeader>
          <DialogTitle>登记新案</DialogTitle>
          <DialogDescription>新案进入「接案」状态，可指定承办人并生成「撰写」工作项；承办人在「我的待办」中看到并可开始处理。</DialogDescription>
        </DialogHeader>
        {orgs.error ? (
          <FieldError error={orgs.error} />
        ) : orgs.data && orgOptions.length === 0 ? (
          <EmptyState size="sm" icon={FolderPlus} title="没有可用机构" reason="登记新案需要机构成员身份；请先加入或创建机构。" data-testid="intake-no-org" />
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="intake-org">机构</Label>
              <Select value={effectiveOrg ?? ''} onValueChange={(v) => setOrgId(v)}>
                <SelectTrigger id="intake-org" aria-label="机构" className={selCls} data-testid="intake-org">
                  <SelectValue placeholder="选择机构" />
                </SelectTrigger>
                <SelectContent>
                  {orgOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="intake-key">案卷号</Label>
              <Input id="intake-key" value={caseKey} onChange={(e) => setCaseKey(e.target.value)} placeholder="如 ZL-2026-001" required data-testid="intake-key" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="intake-title">案名</Label>
              <Input id="intake-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 一种数据处理方法" required data-testid="intake-title" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="intake-kind">类型</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as PlatformCase['kind'])}>
                <SelectTrigger id="intake-kind" aria-label="类型" data-testid="intake-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="intake-assignee">承办人（可选）</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger id="intake-assignee" aria-label="承办人" data-testid="intake-assignee">
                  <SelectValue placeholder="暂不分配" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>暂不分配</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.principal_id} value={m.principal_id}>{memberLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignee !== NONE && <p className="text-xs text-fg-muted">承办人将以「代理人」角色加入案件参与者。</p>}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="intake-deadline">撰写期限（可选）</Label>
              <Input id="intake-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} data-testid="intake-deadline" />
            </div>
            {memberships.data && !canManage && (
              <p className="text-sm text-warn-fg" role="alert" data-testid="intake-not-manager">你在该机构不是管理员（owner/admin），登记新案会被服务端拒绝。</p>
            )}
            <FieldError error={error} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={busy}>取消</Button>
              <Button type="submit" loading={busy} disabled={!effectiveOrg || !caseKey.trim() || !title.trim() || !canManage} data-testid="intake-submit">登记并生成工作项</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
