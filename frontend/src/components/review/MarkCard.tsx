import { Check, Reply, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtFull } from '@/lib/format'
import { FOCUS_RING, cn } from '@/lib/utils'
import { relativeTime } from '@/components/notify/notifyKinds'
import { CRITIC_KIND_LABEL } from './criticExtension'
import { blockLabel, clusterSummary, formatOf, markContext, type MarkCluster } from './reviewUtils'
import type { Ast } from '@/types/ast'
import type { CriticMark } from '@/lib/types'

/** CriticMarkup 建议卡配色（W6 05 §3.10：只用 --ok/--danger/--info/--violet 族） */
const KIND_TONE: Record<CriticMark['kind'], 'ok' | 'danger' | 'info' | 'violet'> = {
  ins: 'ok',
  del: 'danger',
  sub: 'info',
  comment: 'violet',
  mark: 'violet',
}
const KIND_TEXT: Record<CriticMark['kind'], string> = {
  ins: 'bg-ok-bg text-ok-fg',
  del: 'bg-danger-bg text-danger-fg line-through',
  sub: 'bg-info-bg text-info-fg',
  comment: 'bg-violet-bg text-violet-fg italic',
  mark: 'bg-violet-bg text-violet-fg',
}
const KIND_BORDER: Record<CriticMark['kind'], string> = {
  ins: 'border-l-ok-dot',
  del: 'border-l-danger-dot',
  sub: 'border-l-info-dot',
  comment: 'border-l-violet-dot',
  mark: 'border-l-violet-dot',
}

export const READONLY_TIP = '只读角色（查看者 / 审阅者）不能接受或拒绝修订'

export interface MarkCardProps {
  c: MarkCluster
  ast: Ast | null
  /** 所属分组的 blockId（定位 / aria-label 用） */
  blockId: string
  /** 该行原文（markContext 上下文截取） */
  lineText: string
  activeMarkId: string | null
  cursorLine: number
  desktop: boolean
  ctlSize: 'xs' | 'md'
  readonly: boolean
  pid: string | null
  /** 点卡定位：setActiveMark + locate + revealMark/gotoLine 由调用方组合 */
  onLocate: (c: MarkCluster) => void
  onReply: (c: MarkCluster) => void
  acceptMarks: (ids: string[]) => void
  rejectMarks: (ids: string[]) => void
}

/** 修订簇卡：单条 CriticMark 簇的徽章/摘要/定位/接受·拒绝·回复动作行（ReviewBody 的修订列表行） */
export function MarkCard({ c, ast, blockId, lineText, activeMarkId, cursorLine, desktop, ctlSize, readonly, pid, onLocate, onReply, acceptMarks, rejectMarks }: MarkCardProps) {
  const active = c.marks.some((m) => m.id === activeMarkId)
  const atCursor = c.line === cursorLine || active
  const removable = c.kind === 'comment' || c.kind === 'mark'
  const where = blockLabel(ast, blockId)
  const ctx = markContext(lineText, c)
  const summary = clusterSummary(c)
  const fmt = formatOf(c)
  const ids = c.marks.map((m) => m.id)
  return (
    <li
      data-testid="review-mark"
      data-mark-id={c.id}
      data-mark-ids={ids.join(' ')}
      data-kind={c.kind}
      data-active={active || undefined}
      className={cn(
        'group/mark flex flex-col gap-1 rounded-md border border-border border-l-2 bg-panel p-2 transition-colors motion-reduce:transition-none',
        KIND_BORDER[c.kind],
        atCursor ? 'border-primary ring-1 ring-primary/40' : 'hover:bg-sunken',
      )}
    >
      <button
        type="button"
        className={cn('flex min-w-0 flex-col gap-1 rounded-sm text-left', FOCUS_RING, !desktop && 'min-h-touch justify-center')}
        title={`定位到${where}`}
        data-testid="review-mark-locate"
        onClick={() => onLocate(c)}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-muted">
          <Badge tone={fmt ? 'info' : KIND_TONE[c.kind]}>{fmt ? '格式' : CRITIC_KIND_LABEL[c.kind]}</Badge>
          {c.author && (
            <span className="truncate text-xs font-medium text-fg-strong" title={c.author} data-testid="review-mark-author">{c.author}</span>
          )}
          {c.at !== null && (
            <span className="shrink-0 tabular-nums" title={fmtFull(c.at)} data-testid="review-mark-time">
              {relativeTime(c.at)}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-xs leading-5 text-fg" title={summary} data-testid="review-mark-summary">
          {ctx.before && <span className="text-fg-muted">{ctx.before}</span>}
          {fmt ? (
            <>
              <span className={cn('rounded-xs px-0.5', fmt.removed ? 'bg-danger-bg text-danger-fg' : 'bg-info-bg text-info-fg')}>{fmt.text}</span>
              <span className="pl-1 text-fg-muted">{fmt.removed ? '去掉' : ''}{fmt.label}</span>
            </>
          ) : c.kind === 'sub' ? (
            <>
              <span className="rounded-xs bg-danger-bg px-0.5 text-danger-fg line-through">{c.a}</span>
              <span className="rounded-xs bg-ok-bg px-0.5 text-ok-fg">{c.b}</span>
            </>
          ) : c.kind === 'ins' || c.kind === 'del' ? (
            (c.kind === 'ins' ? c.b : c.a) ? (
              <span className={cn('rounded-xs px-0.5', KIND_TEXT[c.kind])}>{c.kind === 'ins' ? c.b : c.a}</span>
            ) : (
              <span className="italic text-fg-muted">（空）</span>
            )
          ) : (
            <span className={cn('rounded-xs px-0.5', KIND_TEXT[c.kind])}>{c.marks[0]?.a}</span>
          )}
          {ctx.after && <span className="text-fg-muted">{ctx.after}</span>}
        </span>
      </button>
      <span
        className={cn(
          'flex items-center justify-end gap-1',
          desktop &&
            'h-0 overflow-hidden opacity-0 transition-[height,opacity] group-hover/mark:h-xs-control group-hover/mark:opacity-100 group-focus-within/mark:h-xs-control group-focus-within/mark:opacity-100 group-data-[active]/mark:h-xs-control group-data-[active]/mark:opacity-100 motion-reduce:transition-none',
        )}
        data-testid="review-mark-actions"
      >
        <Button
          size={ctlSize}
          variant="ghost"
          aria-label={`回复这处${CRITIC_KIND_LABEL[c.kind]}（${where}）`}
          onClick={() => onReply(c)}
          disabled={!pid}
          data-testid="review-mark-reply"
        >
          <Reply aria-hidden />回复
        </Button>
        <Button
          size={ctlSize}
          variant="ghost"
          className="text-ok-fg"
          aria-label={removable ? `去除${CRITIC_KIND_LABEL[c.kind]}标记（${where}）` : `接受${CRITIC_KIND_LABEL[c.kind]}（${where}）`}
          onClick={() => acceptMarks(ids)}
          disabled={readonly}
          title={readonly ? READONLY_TIP : undefined}
          data-testid="review-accept"
        >
          <Check aria-hidden />{removable ? '去除' : '接受'}
        </Button>
        {!removable && (
          <Button
            size={ctlSize}
            variant="ghost"
            className="text-danger-fg"
            aria-label={`拒绝${CRITIC_KIND_LABEL[c.kind]}（${where}）`}
            onClick={() => rejectMarks(ids)}
            disabled={readonly}
            title={readonly ? READONLY_TIP : undefined}
            data-testid="review-reject"
          >
            <X aria-hidden />拒绝
          </Button>
        )}
      </span>
    </li>
  )
}
