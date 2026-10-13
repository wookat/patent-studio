import { Check, MessageSquareText } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { fmtRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PublicComment } from '@/types/public-share'
/**
 * 客户已提意见线程列表（S9 右栏 / S10f 底部 Sheet 共用）：作者 · 相对时间 · 引文 · 正文 · 已处理徽记。
 * 每条 `row-<id>`；空态 EmptyState sm。
 */
export function CommentThreads({ comments, className, canComment = true }: { comments: PublicComment[]; className?: string; canComment?: boolean }) {
  if (comments.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={MessageSquareText}
        title="还没有意见"
        /* 只读链接（scope=read / allow_comment=false）不提示拖选批注——侧栏权限行已写明「仅阅读」 */
        reason={canComment ? '拖选文字或点某一段即可针对具体位置提出。' : undefined}
        className={className}
        data-testid="client-comments-empty"
      />
    )
  }
  return (
    <ul className={cn('flex flex-col divide-y divide-border', className)} aria-label="已提意见">
      {comments.map((c) => (
        <li key={c.id} className={cn('flex flex-col gap-1.5 px-4 py-3 text-sm', c.resolved && 'opacity-70')} data-testid={`row-${c.id}`}>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-2xs font-medium text-fg">
              {c.author.name.slice(0, 1)}
            </span>
            <span className="font-medium text-fg-strong">{c.author.name}</span>
            <span className="tabular-nums">{fmtRelative(c.created_at * 1000)}</span>
            {c.resolved && (
              <span className="ml-auto inline-flex h-4 items-center gap-0.5 rounded-full bg-ok-bg px-1.5 text-2xs text-ok-fg">
                <Check className="size-3" aria-hidden />
                已处理
              </span>
            )}
          </div>
          {c.anchor.quote ? (
            <blockquote className="line-clamp-2 border-l-2 border-warn-dot bg-sunken px-2 py-1 text-xs text-fg-muted">{c.anchor.quote}</blockquote>
          ) : (
            <span className="text-2xs text-fg-muted">整份文件</span>
          )}
          <p className="whitespace-pre-wrap break-words text-fg">{c.body}</p>
          {c.replies.length > 0 && <p className="text-2xs text-fg-muted tabular-nums">{c.replies.length} 条回复</p>}
        </li>
      ))}
    </ul>
  )
}
