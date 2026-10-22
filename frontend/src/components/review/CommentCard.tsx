import { useRef, useState } from 'react'
import { Check, CornerDownRight, Crosshair, RotateCcw, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useStudio, selectAiEnabled } from '@/store'
import { canMutateComment, commentSource } from '@/store/comments'
import { COMMENT_BODY_MAX, type Comment } from '@/lib/types'
import { FOCUS_RING, cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { fmtMdTime } from '@/lib/format'
import { MentionTextarea } from './MentionTextarea'
import { Markdown } from '@/components/ai/Markdown'
import { gotoAiProposals } from '@/components/ai/aiModel'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'

export interface CommentCardProps {
  pid: string | null
  comment: Comment
  active: boolean
  atCursor: boolean
  desktop: boolean
  busy: boolean
  onLocate(c: Comment): void
  run(fn: () => Promise<unknown>, fail: string): Promise<void>
}

const SOURCE_BADGE: Record<ReturnType<typeof commentSource>, { label: string; tone: BadgeTone; testId: string } | null> = {
  human: null,
  ai: { label: 'AI', tone: 'violet', testId: 'comment-ai-badge' },
  client: { label: '客户', tone: 'info', testId: 'comment-client-badge' },
}

/**
 * 批注卡（线程，W6 05 §3.10）：头像 / 作者 / 来源 Badge / 时间 / 行号锚点 / 引文 / 正文 / 回复列表；
 * 当前线程 = primary 左描边；已解决折叠为一行（点击展开）。
 * 操作：定位（setFocus review）、回复（可 @）、解决 ↔ 重新打开（soft，不做 primary）、删除。375 时每个控件 44px。
 */
export function CommentCard({ pid, comment: c, active, atCursor, desktop, busy, onLocate, run }: CommentCardProps) {
  const replyComment = useStudio((s) => s.replyComment)
  const resolveComment = useStudio((s) => s.resolveComment)
  const deleteComment = useStudio((s) => s.deleteComment)
  /** 与后端 _comment_perm 同口径：作者或角色 ≥ need；不满足直接禁按钮（不再裸发 403） */
  const canResolve = useStudio((s) => canMutateComment(s, c, 'reviewer'))
  const canDelete = useStudio((s) => canMutateComment(s, c, 'editor'))
  const commentToProposal = useStudio((s) => s.commentToProposal)
  const focusProposal = useStudio((s) => s.focusProposal)
  // 这条批注已生成的提案（既有 source.comment_id 关联，不建新模型）→ 「查看建议」回链
  const linkedProposalId = useStudio((s) => s.proposals.find((p) => p.source?.kind === 'comment' && p.source.comment_id === c.id)?.id ?? null)
  const toast = useStudio((s) => s.toast)
  const aiEnabled = useStudio(selectAiEnabled)
  // 批70：回复表单存 store——宿主（Tab/Drawer/Rail）卸载不再静默丢稿；key 在 = 开着
  const replying = useStudio((s) => c.id in s.replyBodies)
  const replyBody = useStudio((s) => s.replyBodies[c.id] ?? '')
  const setReplyBody = useStudio((s) => s.setReplyBody)
  const [expanded, setExpanded] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const replyBtn = useRef<HTMLButtonElement>(null)
  const ctlSize = desktop ? 'xs' : 'md'
  const iconSize = desktop ? 'icon-xs' : 'icon-md'
  const src = SOURCE_BADGE[commentSource(c)]
  const collapsed = c.resolved && !expanded && !active

  // 批69：回复草稿脏态守卫——已输入时取消先弹 DiscardDialog，不再静默丢稿
  const [askDiscard, setAskDiscard] = useState(false)
  useBeforeUnload(() => !!replyBody.trim())

  /** 取消 = 退出回复编辑并把焦点还给「回复」；Esc 在表单内同此，宿主 Sheet 由 data-esc-local 留住（docs/plan/31） */
  const doCancelReply = () => {
    setReplyBody(c.id, null)
    requestAnimationFrame(() => replyBtn.current?.focus())
  }
  const cancelReply = () => (replyBody.trim() ? setAskDiscard(true) : doCancelReply())

  const submitReply = () => {
    if (!pid || !replyBody.trim()) return
    void run(async () => {
      await replyComment(pid, c.id, replyBody.trim())
      setReplyBody(c.id, null)
    }, '回复失败')
  }

  return (
    <li
      data-testid="review-comment"
      data-comment-id={c.id}
      data-resolved={c.resolved ? '' : undefined}
      data-collapsed={collapsed ? '' : undefined}
      className={cn(
        'flex flex-col gap-1 rounded-md border border-l-2 bg-panel p-2 transition-colors motion-reduce:transition-none',
        active
          ? 'border-border border-l-primary ring-1 ring-primary/40'
          : atCursor
            ? 'border-border border-l-border-strong bg-sunken'
            : 'border-border border-l-transparent hover:bg-sunken',
        c.resolved && !active && 'border-l-ok-dot',
        collapsed && 'py-1',
      )}
    >
      <button
        type="button"
        className={cn('flex w-full flex-col gap-1 rounded-sm text-left', FOCUS_RING, !desktop && 'min-h-touch justify-center')}
        aria-current={active ? 'true' : undefined}
        aria-expanded={c.resolved ? !collapsed : undefined}
        title={collapsed ? '展开已解决线程' : '定位到批注处'}
        onClick={() => {
          if (collapsed) setExpanded(true)
          else onLocate(c)
        }}
        data-testid="review-locate"
      >
        <span className="flex w-full items-center gap-1.5 text-2xs text-fg-muted">
          <Avatar size="sm" name={c.author.name} className="size-5 text-2xs" />
          <span className="truncate text-xs font-medium text-fg-strong" title={c.author.name}>{c.author.name}</span>
          {src && (
            <Badge tone={src.tone} className="h-4 shrink-0 px-1.5 text-2xs" title={src.label === 'AI' ? 'AI 审阅生成的批注' : '客户经确认链接留下的批注'} data-testid={src.testId}>
              {src.label}
            </Badge>
          )}
          <span className="shrink-0 tabular-nums">{fmtMdTime(c.created_at)}</span>
          {c.anchor.stale && <Badge tone="warn" className="h-4 shrink-0 px-1.5 text-2xs">锚点已变</Badge>}
          {c.resolved && <Badge tone="ok" className="h-4 shrink-0 px-1.5 text-2xs">已解决</Badge>}
          {c.replies.length > 0 && collapsed && <span className="shrink-0 tabular-nums">{c.replies.length} 条回复</span>}
          <Crosshair className="ml-auto size-3 shrink-0 opacity-60" aria-hidden />
        </span>
        {!collapsed && c.anchor.quote && (
          <span className="block truncate border-l-2 border-warn-dot pl-1.5 text-2xs text-fg-muted" title={c.anchor.quote}>
            {c.anchor.quote}
          </span>
        )}
        {collapsed ? (
          <span className="block truncate whitespace-nowrap text-xs leading-5 text-fg-muted">{c.body}</span>
        ) : (
          <div className="break-words text-xs leading-5 text-fg"><Markdown text={c.body} /></div>
        )}
      </button>
      {!collapsed && c.replies.length > 0 && (
        <ul className="flex flex-col gap-1 border-l-2 border-border pl-2" aria-label="回复">
          {c.replies.map((r) => (
            <li key={r.id} className="text-xs" data-testid="review-reply">
              <span className="flex items-center gap-1.5 text-2xs text-fg-muted">
                <Avatar size="sm" name={r.author.name} className="size-4 text-2xs" />
                <span className="font-medium text-fg-strong">{r.author.name}</span> · {fmtMdTime(r.created_at)}
              </span>
              <div className="break-words leading-5 text-fg"><Markdown text={r.body} /></div>
            </li>
          ))}
        </ul>
      )}
      {replying && !collapsed ? (
        <form
          className="flex flex-col gap-1"
          data-testid="review-reply-form"
          data-esc-local
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            cancelReply()
          }}
          onSubmit={(e) => {
            e.preventDefault()
            submitReply()
          }}
        >
          <MentionTextarea
            autoFocus
            rows={2}
            maxLength={COMMENT_BODY_MAX}
            value={replyBody}
            onValueChange={(v) => setReplyBody(c.id, v)}
            aria-label="回复内容"
            placeholder="回复（@ 提及成员，Ctrl+Enter 提交）"
            data-testid="review-reply-body"
            onSubmit={submitReply}
          />
          <div className="flex justify-end gap-1">
            <Button type="button" size={ctlSize} variant="ghost" onClick={cancelReply}>
              取消
            </Button>
            <Button type="submit" size={ctlSize} variant="secondary" disabled={busy || !replyBody.trim()} data-testid="review-reply-submit">
              回复
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-0.5">
          {!collapsed && (
            <Button ref={replyBtn} size={ctlSize} variant="ghost" onClick={() => setReplyBody(c.id, '')} data-testid="review-reply-open">
              <CornerDownRight aria-hidden />回复
            </Button>
          )}
          {/* Z18 批注 → 修改提案：块锚批注 + AI 已开 + reviewer 起；成功跳 AI 面板「建议」 */}
          {!collapsed && aiEnabled && c.anchor.block_id && (
            <Button
              size={ctlSize}
              variant="ghost"
              disabled={busy || !pid || !canResolve}
              title={canResolve ? '按此批注生成一条修订建议（AI），到「建议」面板确认后写入' : '转提案需要审阅者及以上角色'}
              onClick={() =>
                pid &&
                void run(async () => {
                  const prop = await commentToProposal(pid, c.id)
                  if (prop) {
                    focusProposal(prop.id)
                    gotoAiProposals()
                    toast('已生成修改建议——已在「建议」面板定位到它', 'success')
                  }
                }, '转修改提案失败')
              }
              data-testid={`review-to-proposal-${c.id}`}
            >
              <Wand2 aria-hidden />转提案
            </Button>
          )}
          {!collapsed && linkedProposalId && (
            <Button
              size={ctlSize}
              variant="ghost"
              title="打开「建议」面板并定位到由本批注生成的提案"
              onClick={() => {
                focusProposal(linkedProposalId)
                gotoAiProposals()
              }}
              data-testid={`review-goto-proposal-${c.id}`}
            >
              <Sparkles aria-hidden />查看建议
            </Button>
          )}
          <Button
            size={ctlSize}
            variant="ghost"
            className={c.resolved ? '' : 'text-ok-fg'}
            disabled={busy || !pid || !canResolve}
            onClick={() => pid && void run(() => resolveComment(pid, c.id, !c.resolved), '更新批注失败')}
            data-testid="review-resolve"
          >
            {c.resolved ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
            {c.resolved ? '重新打开' : '解决'}
          </Button>
          {confirmDel ? (
            <span className="ml-auto flex items-center gap-1" role="group" aria-label="确认删除批注">
              <span className="text-xs text-danger-fg">删除？</span>
              <Button variant="danger" size={ctlSize} disabled={busy || !pid} onClick={() => pid && void run(() => deleteComment(pid, c.id), '删除批注失败')} data-testid="review-delete-confirm">
                确认
              </Button>
              <Button variant="ghost" size={ctlSize} onClick={() => setConfirmDel(false)} data-testid="review-delete-cancel">
                取消
              </Button>
            </span>
          ) : (
            <Button
              size={iconSize}
              variant="ghost"
              className="ml-auto text-fg-muted hover:text-danger-fg"
              aria-label="删除批注" title="删除批注"
              disabled={busy || !pid || !canDelete}
              onClick={() => setConfirmDel(true)}
              data-testid="review-delete"
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      )}
      <DiscardDialog
        open={askDiscard}
        onStay={() => setAskDiscard(false)}
        onDiscard={() => {
          setAskDiscard(false)
          doCancelReply()
        }}
      />
    </li>
  )
}
