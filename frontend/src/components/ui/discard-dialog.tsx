import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface DiscardDialogProps {
  open: boolean
  /** 继续编辑（Esc / 遮罩 / 「继续编辑」同路） */
  onStay(): void
  onDiscard(): void
}

/**
 * 表单弹窗误关守卫：Esc / 遮罩 / 取消在有未保存修改时先弹此确认（role=alertdialog，与 DeleteAttachmentDialog 同惯例）。
 * 各弹窗用法：`requestClose = () => (dirty ? setAsk(true) : close())`，隐式关（onOpenChange）与显式取消同走此路。
 */
export function DiscardDialog({ open, onStay, onDiscard }: DiscardDialogProps) {
  const stayRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onStay()}>
      <DialogContent
        role="alertdialog"
        size="sm"
        data-slot="DiscardDialog"
        data-testid="discard-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          stayRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>当前表单有未保存的修改，关闭后将丢失。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="danger" onClick={onDiscard} data-testid="discard-confirm">
            放弃修改
          </Button>
          <Button ref={stayRef} variant="outline" onClick={onStay} data-testid="discard-stay">
            继续编辑
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
