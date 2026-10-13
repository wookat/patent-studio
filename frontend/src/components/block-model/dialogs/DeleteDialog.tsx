import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { blockSource, useStudio } from '@/store'
import { blockSummary, deleteWarning, findBlock } from './lookup'
import { keepEscapeLocal } from './state'

interface Props {
  open: boolean
  blockId: string | null
  onClose(): void
  onCloseAutoFocus?(e: Event): void
}

/** 删除二次确认（06 §5.5）：显示块类型 + 首行截断，法定章节 / 被引用权项额外警告；确认后 deleteBlock(id)。 */
export function DeleteDialog({ open, blockId, onClose, onCloseAutoFocus }: Props) {
  const ast = useStudio((s) => s.ast)
  const content = useStudio((s) => s.content)
  const pending = useStudio((s) => s.blockPending)
  const deleteBlock = useStudio((s) => s.deleteBlock)

  const block = ast && blockId ? findBlock(ast, blockId) : null
  const summary = block ? blockSummary(block, ast && blockId ? blockSource(ast, content, blockId) : null) : null
  const warning = ast && block ? deleteWarning(ast, block) : null

  const confirm = async () => {
    if (!blockId || pending) return
    const ok = await deleteBlock(blockId)
    if (ok) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="delete-dialog" onCloseAutoFocus={onCloseAutoFocus} onKeyDown={keepEscapeLocal}>
        <DialogHeader>
          <DialogTitle>删除{summary?.kind ?? '块'}？</DialogTitle>
          <DialogDescription>
            {summary ? (
              <>
                将从源码中删去该{summary.kind}所在的行区间。
                {summary.excerpt && (
                  <>
                    {' '}
                    首行：<q className="font-medium text-fg">{summary.excerpt}</q>
                  </>
                )}
              </>
            ) : (
              '该块已不在当前结构中。'
            )}
          </DialogDescription>
        </DialogHeader>
        {warning && (
          <p className="flex items-start gap-2 rounded-sm bg-warn-bg px-3 py-2 text-sm" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{warning}</span>
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} autoFocus data-testid="delete-cancel">
            取消
          </Button>
          <Button type="button" variant="danger" onClick={confirm} disabled={!block || pending} data-testid="delete-confirm">
            {pending ? '删除中…' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
