import { useEffect, useState } from 'react'
import { MathML } from '@/components/block-model/blocks'
import { Button } from '@/components/ui/button'
import { BottomDrawer } from '@/components/ui/sheet'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Textarea } from '@/components/ui/textarea'
import { useStudio } from '@/store'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import type { AstEquation } from '@/types/ast'
import { LABEL_COMMENT, MSG_COMMENT_FAIL } from '@/lib/copy'

/** 375 顶部提示（W9 ux-05：与实际能力一致）：只读 / 可编辑 / 审阅模式（键入即修订建议）三种 */
export const MOBILE_NOTICE = '移动阅读模式，版面以 PDF 为准'
export function mobileNotice(editable: boolean, review: boolean): string {
  if (!editable) return `${MOBILE_NOTICE} · 只读`
  if (review) return '点正文直接输入，改动记为修订建议 · 版面以 PDF 为准'
  return '点正文直接输入 · 版面以 PDF 为准'
}

/** 375 长按块 → 批注（21 §5.6 R-LAY-05）：anchor 走现有 comments 契约 {block_id, line, quote} */
export interface CommentDraftTarget {
  blockId: string
  line: number
  quote: string
}

export function LayoutCommentDrawer({ target, onClose, onDirty }: { target: CommentDraftTarget; onClose(): void; onDirty?(dirty: boolean): void }) {
  const pid = useStudio((s) => s.pid)
  const addComment = useStudio((s) => s.addComment)
  const toast = useStudio((s) => s.toast)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  // 草稿守卫（批67/68）：抽屉隐式关/取消在脏态先 DiscardDialog；脏态经 onDirty 上提宿主守卫换锚
  const dirty = body.trim().length > 0
  const [ask, setAsk] = useState(false)
  useBeforeUnload(() => dirty)
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])
  const requestClose = () => (dirty ? setAsk(true) : onClose())

  const submit = async () => {
    if (!pid || !body.trim()) return
    setBusy(true)
    const c = await addComment(pid, { block_id: target.blockId, line: target.line, quote: target.quote }, body.trim()).catch(() => null)
    setBusy(false)
    if (c) {
      toast('批注已添加', 'success')
      onClose()
    } else toast(MSG_COMMENT_FAIL, 'error')
  }

  return (
    <>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
      <BottomDrawer open onOpenChange={(o) => !o && requestClose()} title="添加批注" snap="half" data-testid="layout-comment-drawer">
      <div className="flex flex-col gap-3 px-4 pb-4">
        <blockquote className="line-clamp-3 border-l-2 border-border-strong pl-2 text-sm text-fg-muted">{target.quote}</blockquote>
        <Textarea
          autoFocus
          rows={3}
          value={body}
          placeholder={LABEL_COMMENT}
          aria-label={LABEL_COMMENT}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={requestClose}>
            取消
          </Button>
          <Button disabled={busy || !body.trim() || !pid} onClick={() => void submit()} data-testid="layout-comment-submit">
            添加批注
          </Button>
        </div>
      </div>
      </BottomDrawer>
    </>
  )
}

/** 375 只读时点开公式：底部 Sheet 放大显示（可横向滚动）+ 源码 */
export function EquationSheet({ block, onClose }: { block: AstEquation; onClose(): void }) {
  return (
    <BottomDrawer open onOpenChange={(o) => !o && onClose()} title={`公式${block.label ? ` ${block.label}` : ''}`} snap="half" data-testid="layout-equation-sheet">
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="ps-eq-sheet-math overflow-x-auto py-2 text-lg" role="math" aria-label={block.source}>
          <MathML mathml={block.mathml} source={block.source} />
        </div>
        <pre className="overflow-x-auto rounded-sm bg-sunken p-2 font-mono text-xs text-fg-muted">{block.source}</pre>
      </div>
    </BottomDrawer>
  )
}
