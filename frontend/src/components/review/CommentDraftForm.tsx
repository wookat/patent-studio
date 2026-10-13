import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COMMENT_BODY_MAX } from '@/lib/types'
import { LABEL_COMMENT } from '@/lib/copy'
import { MentionTextarea } from './MentionTextarea'

export interface CommentDraft {
  line: number
  quote: string
  body: string
}

export interface CommentDraftFormProps {
  draft: CommentDraft
  setDraft: (d: CommentDraft | null) => void
  /** 锚点块显示名（blockLabel(ast, blockId) 已在调用方算好） */
  blockName: string
  /** 锚点块 id 是否解析成功（'' → 显示未锚定警告并禁提交） */
  anchored: boolean
  busy: boolean
  ctlSize: 'xs' | 'md'
  desktop: boolean
  /** Esc / 取消：先过脏态守卫再 cancelDraft */
  onCancel: () => void
  onSubmit: () => void
  /** 未锚定提示文案 */
  unanchoredTip: string
}

/** 批注草稿表单（引用块 / @ 提及 / Ctrl+Enter 提交；Esc 与取消走脏态守卫） */
export function CommentDraftForm({ draft, setDraft, blockName, anchored, busy, ctlSize, desktop, onCancel, onSubmit, unanchoredTip }: CommentDraftFormProps) {
  return (
    <form
      className={cn('mb-2 flex flex-col gap-1.5 rounded-md border border-border bg-sunken p-2', desktop ? 'mx-3' : 'mx-sheet-m')}
      data-testid="review-draft"
      data-esc-local
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        onCancel()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <p className="text-2xs text-fg-muted">
        批注位置：<b className="text-fg">{blockName}</b>
      </p>
      {!anchored && (
        <p role="alert" className="text-2xs text-warn-fg" data-testid="review-draft-unanchored">
          {unanchoredTip}
        </p>
      )}
      {draft.quote && (
        <blockquote className="truncate border-l-2 border-warn-dot pl-1.5 text-xs text-fg-muted" title={draft.quote}>
          {draft.quote}
        </blockquote>
      )}
      <MentionTextarea
        autoFocus
        rows={2}
        maxLength={COMMENT_BODY_MAX}
        value={draft.body}
        onValueChange={(body) => setDraft({ ...draft, body })}
        placeholder={`${LABEL_COMMENT}（@ 提及成员，Ctrl+Enter 提交）`}
        aria-label={LABEL_COMMENT}
        data-testid="review-draft-body"
        onSubmit={onSubmit}
      />
      <div className="flex justify-end gap-1">
        <Button type="button" size={ctlSize} variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size={ctlSize} variant="secondary" disabled={busy || !draft.body.trim() || !anchored} data-testid="review-draft-submit">
          提交
        </Button>
      </div>
    </form>
  )
}
