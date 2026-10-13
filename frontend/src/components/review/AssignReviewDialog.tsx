import { useEffect, useId, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { useStudio } from '@/store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'

export interface AssignReviewDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

/**
 * 「指派审阅」Dialog（R-REV-06）：成员 + 到期日 → api.reviewAssign（POST /projects/{pid}/review-assign）。
 * 成功：toast + 若后端建了期限则提示；501：内联「功能开发中」提示（notify-audit-backend 单元实现）。
 */
export function AssignReviewDialog({ open, onOpenChange }: AssignReviewDialogProps) {
  const pid = useStudio((s) => s.pid)
  const members = useStudio((s) => s.members)
  const me = useStudio((s) => s.user)
  const loadMembers = useStudio((s) => s.loadMembers)
  const assignReview = useStudio((s) => s.assignReview)
  const unavailable = useStudio((s) => s.reviewAssignUnavailable)
  const toast = useStudio((s) => s.toast)
  const uid = useId()
  const [userId, setUserId] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)

  const dirty = userId !== '' || due !== ''
  useBeforeUnload(() => open && dirty)
  const requestClose = () => {
    if (busy) return
    if (dirty) setAsk(true)
    else onOpenChange(false)
  }

  useEffect(() => {
    if (open && pid && members.length === 0) void loadMembers(pid)
  }, [open, pid, members.length, loadMembers])

  const candidates = members.filter((m) => m.user_id !== me?.id)

  const submit = async () => {
    if (!pid || !userId) return
    setBusy(true)
    const r = await assignReview(pid, userId, due || null)
    setBusy(false)
    if (!r) return
    const who = members.find((m) => m.user_id === userId)
    toast(`已指派 ${who?.display_name || who?.email || '成员'} 审阅${r.deadline_id ? '，并已加入期限' : ''}`, 'success')
    onOpenChange(false)
    setUserId('')
    setDue('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) requestClose(); else onOpenChange(o) }}>
      <DialogContent size="sm" data-testid="assign-dialog">
        <DialogHeader>
          <DialogTitle>指派审阅</DialogTitle>
          <DialogDescription>被指派人会收到站内通知；填写到期日会同时生成一条审阅期限。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {unavailable && (
            <Alert data-testid="assign-unavailable">
              <UserCheck aria-hidden />
              <AlertDescription>{NOT_IMPLEMENTED_TITLE}：指派接口尚未上线（后端返回 501）。</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <Label htmlFor={`${uid}-user`}>审阅人</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id={`${uid}-user`} data-testid="assign-user" aria-label="审阅人">
                <SelectValue placeholder={candidates.length === 0 ? '本案暂无其他成员' : '选择成员'} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id} data-testid={`assign-user-${m.user_id}`}>
                    {m.display_name || m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {candidates.length === 0 && <p className="text-xs text-fg-muted">先在「协作」里邀请成员，再来指派。</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-due`}>到期日（可选）</Label>
            <Input id={`${uid}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="assign-due" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestClose}>取消</Button>
            <Button type="submit" disabled={busy || !userId || unavailable} data-testid="assign-submit">指派</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onOpenChange(false) }} />
    </Dialog>
  )
}
