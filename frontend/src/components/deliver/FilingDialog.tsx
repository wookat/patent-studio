import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Input } from '@/components/ui/input'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { Label } from '@/components/ui/label'
import { todayISO } from '@/lib/caseForm'
import { APPLICATION_NO_RE, type FilingIn } from '@/types/deliver'
import { useStudio } from '@/store'

export interface FilingDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** 预填：case.dates.filed / application_no（再次打开时不用重输） */
  initial?: Partial<FilingIn>
  /** 批74：草稿键（pid）——同键重开恢复 store 草稿 */
  draftKey?: string | null
  onSubmit(input: FilingIn): Promise<boolean>
}

/**
 * 「标记为已递交」对话框（17 §2.4）：申请日（默认今天）+ 申请号 → deliver.fileCase
 * （PUT /case {dates} → POST /case/status filed）。申请号只做格式校验（8–12 位 + '.' + 校验位），不联网核验。
 * 借鉴飞书审批「确认提交」：一次对话框把不可逆动作需要的两个字段收齐，不拆两步。
 * Esc / 遮罩 / 取消 在脏态先问「放弃修改？」——表单随 open 重挂，关了输入就丢。
 */
export function FilingDialog({ open, onOpenChange, initial, draftKey, onSubmit }: FilingDialogProps) {
  const [dirty, setDirty] = useState(false)
  const [ask, setAsk] = useState(false)
  const setFilingDraft = useStudio((s) => s.setFilingDraft)
  useBeforeUnload(() => open && dirty)
  /* 关闭路径统一清稿——显式关（放弃/非脏取消/提交后父级关）都清；宿主卸载不经过这里，草稿留存 */
  const closeAndClear = (o: boolean) => {
    if (!o) setFilingDraft(null)
    onOpenChange(o)
  }
  const requestClose = () => (dirty ? setAsk(true) : closeAndClear(false))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent data-slot="FilingDialog" data-testid="filing-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>标记为已递交</DialogTitle>
          <DialogDescription>填写申请日与申请号后，案件状态改为「已递交」，并记入案件历史。</DialogDescription>
        </DialogHeader>
        {open && <FilingForm initial={initial} draftKey={draftKey} onSubmit={onSubmit} onCancel={requestClose} onDirtyChange={setDirty} />}
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); closeAndClear(false) }} />
    </Dialog>
  )
}

function FilingForm({ initial, draftKey, onSubmit, onCancel, onDirtyChange }: Pick<FilingDialogProps, 'initial' | 'draftKey' | 'onSubmit'> & { onCancel(): void; onDirtyChange(dirty: boolean): void }) {
  const uid = useId()
  /* 批74：草稿上提 store——递交页随路由卸载不丢；同键重开恢复，提交成功/放弃显式清 */
  const draft = useStudio((s) => s.filingDraft)
  const setFilingDraft = useStudio((s) => s.setFilingDraft)
  const resume = draft && draftKey && draft.key === draftKey ? draft : null
  const [filed, setFiledState] = useState(resume?.filed ?? (initial?.filed || todayISO()))
  const [no, setNoState] = useState(resume?.application_no ?? initial?.application_no ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = `${uid}-error`
  const setFiled = (v: string) => {
    setFiledState(v)
    if (draftKey) setFilingDraft({ key: draftKey, filed: v, application_no: no })
  }
  const setNo = (v: string) => {
    setNoState(v)
    if (draftKey) setFilingDraft({ key: draftKey, filed, application_no: v })
  }

  const dirty = filed !== (initial?.filed || todayISO()) || no !== (initial?.application_no ?? '')
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const application_no = no.trim()
    if (!filed) return setError('请填写申请日')
    if (!APPLICATION_NO_RE.test(application_no)) return setError('申请号格式应为 4 位年份 + 类别 + 7 位流水 + 校验位，如 202610123456.7')
    setError(null)
    setBusy(true)
    try {
      const ok = await onSubmit({ filed, application_no })
      if (ok) setFilingDraft(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void submit(e)} aria-describedby={error ? errorId : undefined} data-testid="filing-form">
      <div className="space-y-1">
        <Label htmlFor={`${uid}-filed`}>申请日</Label>
        <Input id={`${uid}-filed`} type="date" required autoFocus value={filed} onChange={(e) => setFiled(e.target.value)} data-testid="filing-date" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${uid}-no`}>申请号</Label>
        <Input
          id={`${uid}-no`}
          inputMode="decimal"
          placeholder="202410123456.7"
          required
          value={no}
          onChange={(e) => setNo(e.target.value)}
          aria-invalid={error ? true : undefined}
          data-testid="filing-no"
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger-fg" data-testid="filing-error">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          取消
        </Button>
        <Button type="submit" disabled={busy} data-testid="filing-submit">
          {busy ? '提交中…' : '确认已递交'}
        </Button>
      </DialogFooter>
    </form>
  )
}
