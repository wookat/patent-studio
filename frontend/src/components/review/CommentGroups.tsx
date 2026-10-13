import type { Comment } from '@/lib/types'
import type { Ast } from '@/types/ast'
import { cn } from '@/lib/utils'
import { blockLabel, type Group } from './reviewUtils'
import { CommentCard } from './CommentCard'

export interface CommentGroupsProps {
  groups: readonly Group[]
  ast: Ast | null
  pid: string | null
  activeCommentId: string | null
  cursorLine: number
  desktop: boolean
  busy: boolean
  padX: string
  run: (fn: () => Promise<unknown>, fail: string) => Promise<void>
  /** 卡片「定位」：setActiveComment + locate 由调用方组合（见 ReviewBody） */
  onLocate: (cm: Comment) => void
}

/** 批注按块分组渲染（未解决/已解决/全部三档共用；空组返回 null） */
export function CommentGroups({ groups, ast, pid, activeCommentId, cursorLine, desktop, busy, padX, run, onLocate }: CommentGroupsProps) {
  if (groups.length === 0) return null
  return (
    <div className={cn('flex flex-col gap-2 pb-3', padX)} data-testid="review-comment-groups">
      {groups.map((g) => (
        <div key={g.blockId || `line-${g.line}`} className="flex flex-col gap-1.5" data-testid="review-comment-group" role="group" aria-label={blockLabel(ast, g.blockId)}>
          <p className="truncate pt-1 text-2xs font-medium uppercase tracking-wide text-fg-muted" title={g.blockId}>
            {blockLabel(ast, g.blockId)}
          </p>
          <ul className="flex flex-col gap-1.5">
            {g.items.map((c) => (
              <CommentCard
                key={c.id}
                pid={pid}
                comment={c}
                active={c.id === activeCommentId}
                atCursor={c.anchor.line === cursorLine}
                desktop={desktop}
                busy={busy}
                onLocate={onLocate}
                run={run}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
