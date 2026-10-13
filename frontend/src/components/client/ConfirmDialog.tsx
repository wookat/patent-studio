import { useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { GUEST_NAME_MAX, PUBLIC_CONFIRM_NOTE_MAX } from '@/types/public-share'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: number
  guestName: string
  onGuestName: (name: string) => void
  onConfirm: (note?: string) => Promise<boolean>
}

/**
 * 「确认定稿」对话框（21 §4.5；S9）：确认对象 vN、姓名（一次填）、可选备注；成功后由页面显示「已于 … 确认 vN」。
 * 表单随 Dialog 挂载 / 卸载，每次打开从 props 重新初始化；375 控件全 44。
 */
export function ConfirmDialog({ open, onOpenChange, version, ...rest }: ConfirmDialogProps) {
  const dirtyRef = useRef(false)
  const [ask, setAsk] = useState(false)
  useBeforeUnload(() => open && dirtyRef.current)
  const requestClose = () => (dirtyRef.current ? setAsk(true) : onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent size="sm" className="max-sm:grid-rows-[auto_minmax(0,1fr)]" data-testid="client-confirm-dialog">
        <DialogHeader>
          <DialogTitle>确认定稿 v{version}</DialogTitle>
          <DialogDescription>确认后代理师将按本版进入递交流程；如仍有修改意见，请先点「有意见」。</DialogDescription>
        </DialogHeader>
        <ConfirmForm version={version} onClose={() => onOpenChange(false)} onRequestClose={requestClose} onDirty={(d) => (dirtyRef.current = d)} {...rest} />
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onOpenChange(false) }} />
    </Dialog>
  )
}

type FormProps = Omit<ConfirmDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void; onRequestClose: () => void; onDirty: (dirty: boolean) => void }

function ConfirmForm({ version, guestName, onGuestName, onConfirm, onClose, onRequestClose, onDirty }: FormProps) {
  const uid = useId()
  const desktop = useIsDesktop()
  const [name, setName] = useState(guestName)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const size = desktop ? 'md' : 'xl'

  const nameOk = name.trim().length > 0

  useEffect(() => {
    onDirty(name !== guestName || note !== '')
  }, [name, note, guestName, onDirty])

  const submit = async () => {
    if (!nameOk || busy) return
    setBusy(true)
    setErr(null)
    if (name.trim() !== guestName) onGuestName(name.trim())
    const ok = await onConfirm(note.trim() || undefined)
    setBusy(false)
    if (ok) onClose()
    else setErr('确认失败，请稍后再试或联系代理师')
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Field id={`${uid}-name`}>
        <FieldLabel>您的姓名</FieldLabel>
        <Input
          id={`${uid}-name`}
          size={size}
          value={name}
          autoFocus={!nameOk}
          autoComplete="name"
          maxLength={GUEST_NAME_MAX}
          placeholder="确认记录将署此姓名"
          onChange={(e) => setName(e.target.value)}
          data-testid="client-confirm-name"
        />
      </Field>
      <Field id={`${uid}-note`}>
        <FieldLabel>备注（可选）</FieldLabel>
        <Textarea id={`${uid}-note`} size={size} rows={3} maxLength={PUBLIC_CONFIRM_NOTE_MAX} value={note} placeholder="例如：同意按此版提交" onChange={(e) => setNote(e.target.value)} data-testid="client-confirm-note" />
      </Field>
      {err && (
        <Alert variant="danger" data-testid="client-confirm-error">
          <CircleAlert aria-hidden />
          {err}
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" size={size} onClick={onRequestClose}>
          再看看
        </Button>
        <Button type="submit" size={size} disabled={!nameOk || busy} loading={busy} loadingLabel="正在确认…" data-testid="client-confirm-submit">
          <CheckCircle2 aria-hidden />
          确认定稿 v{version}
        </Button>
      </DialogFooter>
    </form>
  )
}
