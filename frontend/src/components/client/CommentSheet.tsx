import { useEffect, useId, useState } from 'react'
import { CircleAlert, Send } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { useIsDesktop } from '@/hooks/useMisc'
import { GUEST_NAME_MAX, PUBLIC_COMMENT_BODY_MAX, type PublicComment } from '@/types/public-share'
import type { PublicAnchor } from './anchor'
import { CommentThreads } from './CommentThreads'

export interface CommentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 拖选 / 点块得到的锚点；为空 = 对整份文件提意见（锚到标题块） */
  anchor: PublicAnchor | null
  comments: PublicComment[]
  guestName: string
  onGuestName: (name: string) => void
  onSubmit: (body: string) => Promise<boolean>
}

/**
 * 「有意见」面板（S9 / S10f）：撰写区（姓名一次填、引文、正文、发送）+ 已提意见线程。
 * 375 从底部滑出（max-h 85dvh，控件 xl 44），1440 右侧抽屉（右栏已常驻线程列表，此处只留撰写区）。
 * 姓名空时禁用发送并聚焦姓名框。内容随 Sheet 挂载 / 卸载，每次打开从 props 重新初始化。
 */
export function CommentSheet({ open, onOpenChange, ...rest }: CommentSheetProps) {
  const desktop = useIsDesktop()
  // 草稿守卫（批67）：意见正文已输入时 Esc/外点隐式关先 DiscardDialog；发送成功与继续编辑直关
  const [dirty, setDirty] = useState(false)
  const [ask, setAsk] = useState(false)
  useBeforeUnload(() => open && dirty)
  const requestClose = () => (dirty ? setAsk(true) : onOpenChange(false))
  return (
    <>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onOpenChange(false) }} />
      <Sheet open={open} onOpenChange={(o) => { if (o) onOpenChange(true); else requestClose() }}>
        <SheetContent side={desktop ? 'right' : 'bottom'} data-density={desktop ? undefined : 'touch'} className="flex flex-col pb-[env(safe-area-inset-bottom)]" data-testid="client-comment-sheet">
          <SheetHeader>
            <SheetTitle className="text-lg">提出意见</SheetTitle>
            <SheetDescription>意见会连同引文发给代理师，不会改动文件本身。</SheetDescription>
          </SheetHeader>
          <Composer desktop={desktop} onClose={() => onOpenChange(false)} onDirty={setDirty} {...rest} />
        </SheetContent>
      </Sheet>
    </>
  )
}

type ComposerProps = Omit<CommentSheetProps, 'open' | 'onOpenChange'> & { desktop: boolean; onClose: () => void; onDirty: (dirty: boolean) => void }

function Composer({ desktop, onClose, onDirty, anchor, comments, guestName, onGuestName, onSubmit }: ComposerProps) {
  const uid = useId()
  const [body, setBody] = useState('')
  const [name, setName] = useState(guestName)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const size = desktop ? 'md' : 'xl'
  const dirty = body.trim().length > 0
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])

  const nameOk = name.trim().length > 0
  const canSend = nameOk && body.trim().length > 0 && !busy

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    setErr(null)
    if (name.trim() !== guestName) onGuestName(name.trim())
    const ok = await onSubmit(body.trim())
    setBusy(false)
    if (ok) onClose()
    else setErr('提交失败，请稍后再试')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <form
        className="flex flex-col gap-3 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
        data-testid="client-comment-form"
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
            placeholder="用于标注意见来自谁，只需填一次"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== guestName && onGuestName(name.trim())}
            data-testid="client-guest-name"
          />
        </Field>
        {anchor?.quote ? (
          <blockquote className="line-clamp-3 border-l-2 border-warn-dot bg-sunken px-2 py-1 text-xs text-fg-muted" data-testid="client-comment-quote">
            {anchor.quote}
          </blockquote>
        ) : (
          <p className="text-xs text-fg-muted" data-testid="client-comment-quote">对整份文件的意见（拖选文字可针对具体位置）</p>
        )}
        <Field id={`${uid}-body`}>
          <FieldLabel>意见内容</FieldLabel>
          <Textarea
            id={`${uid}-body`}
            size={size}
            rows={4}
            autoFocus={nameOk}
            maxLength={PUBLIC_COMMENT_BODY_MAX}
            value={body}
            placeholder="例如：权利要求 1 中「弹性件」应改为「弹簧」"
            onChange={(e) => setBody(e.target.value)}
            data-testid="client-comment-input"
          />
        </Field>
        {err && (
          <Alert variant="danger" data-testid="client-comment-error">
            <CircleAlert aria-hidden />
            {err}
          </Alert>
        )}
        <Button type="submit" size={desktop ? 'lg' : 'xl'} disabled={!canSend} loading={busy} loadingLabel="正在发送…" data-testid="client-comment-send">
          <Send aria-hidden />
          发送意见
        </Button>
      </form>

      {!desktop && (
        <section aria-labelledby={`${uid}-list`} className="border-t border-border">
          <h3 id={`${uid}-list`} className="px-4 pt-3 text-xs font-medium text-fg-muted">
            已提意见 <span className="tabular-nums">{comments.length}</span> 条
          </h3>
          <CommentThreads comments={comments} />
        </section>
      )}
    </div>
  )
}
