import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AttachmentItem } from '@/types/attachments'

export interface DeleteAttachmentDialogProps {
  item: AttachmentItem | null
  busy: boolean
  onConfirm(): void
  onClose(): void
}

/** attachments/ 删除二次确认（15 §4.3；与 R2 DeleteFigureDialog 同一样式）。role=alertdialog，Esc / 遮罩 = 取消。 */
export function DeleteAttachmentDialog({ item, busy, onConfirm, onClose }: DeleteAttachmentDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        role="alertdialog"
        data-slot="DeleteAttachmentDialog"
        data-testid="attachment-delete-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          confirmRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>删除附件 {item?.name ?? ''}？</DialogTitle>
          <DialogDescription>将从本案附件中移除该文件；此操作不可撤销。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="attachment-delete-cancel">
            取消
          </Button>
          <Button ref={confirmRef} variant="danger" onClick={onConfirm} disabled={busy} data-testid="attachment-delete-confirm">
            {busy && <Loader2 className="animate-spin" />}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
