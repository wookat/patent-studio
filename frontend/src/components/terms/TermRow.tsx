import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { lineChipLabel } from '@/lib/diagLocation'
import { FOCUS_RING, cn } from '@/lib/utils'
import { selectReadonly, useStudio } from '@/store'
import type { Term } from '@/types/terms'

export interface TermRowProps {
  term: Term
  /** 正文里该术语的别名命中条数（terms.* 诊断） */
  issueCount: number
  variant: 'table' | 'card'
  onEdit: () => void
  onDelete: () => void
  onGotoLine: (line: number) => void
}

/** 术语一行：桌面 <tr>（主名 / 别名 / 英文 / 定义 / 首现）；窄屏卡片。删除为两步确认 */
export function TermRow({ term, issueCount, variant, onEdit, onDelete, onGotoLine }: TermRowProps) {
  const [confirming, setConfirming] = useState(false)
  const ast = useStudio((s) => s.ast)
  const readonly = useStudio(selectReadonly)
  const actions = (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button size="icon-sm" variant="ghost" onClick={onEdit} disabled={readonly} aria-label={`编辑术语「${term.name}」`} title={`编辑术语「${term.name}」`} data-testid="term-edit">
        <Pencil aria-hidden />
      </Button>
      {confirming && !readonly ? (
        <>
          <Button size="sm" variant="danger" onClick={onDelete} aria-label={`确认删除术语「${term.name}」`} data-testid="term-delete-confirm">
            确认删除
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} aria-label="取消删除">
            取消
          </Button>
        </>
      ) : (
        <Button size="icon-sm" variant="ghost" className="text-fg-muted hover:text-danger-fg" disabled={readonly} onClick={() => setConfirming(true)} aria-label={`删除术语「${term.name}」`} title={`删除术语「${term.name}」`} data-testid="term-delete">
          <Trash2 aria-hidden />
        </Button>
      )}
    </span>
  )
  const firstLine =
    term.first_line != null ? (
      <button
        type="button"
        className={cn('rounded-xs font-mono tabular-nums text-fg underline-offset-2 hover:underline', FOCUS_RING)}
        onClick={() => onGotoLine(term.first_line as number)}
        aria-label={`跳到首次出现处：${lineChipLabel(term.first_line as number, ast)}`}
      >
        {lineChipLabel(term.first_line as number, ast)}
      </button>
    ) : (
      <span className="text-fg-muted">—</span>
    )
  const issueBadge = issueCount > 0 && (
    <Count value={issueCount} tone="danger" className="ml-1 align-middle" title={`正文有 ${issueCount} 处使用别名`} data-testid="term-issue-count" />
  )

  if (variant === 'table') {
    return (
      <tr className="h-row-menu border-b border-border align-middle last:border-b-0 hover:bg-sunken" data-testid="term-row">
        <td className="px-2 font-medium text-fg-strong">
          {term.name}
          {issueBadge}
        </td>
        <td className="px-2 text-fg-muted">{term.aliases.join('、') || '—'}</td>
        <td className="px-2 text-fg-muted">{term.en ?? '—'}</td>
        <td className="max-w-64 truncate px-2 text-fg-muted" title={term.definition ?? undefined}>
          {term.definition ?? '—'}
        </td>
        <td className="px-2">{firstLine}</td>
        <td className="px-1">{actions}</td>
      </tr>
    )
  }
  return (
    <li className={cn('flex flex-col gap-1 rounded-md border border-border bg-panel p-2 text-xs')} data-testid="term-row">
      <div className="flex min-h-row-menu items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-fg-strong" title={term.en ? `${term.name} ${term.en}` : term.name}>
          {term.name}
          {issueBadge}
          {term.en && <span className="ml-1 text-xs font-normal text-fg-muted">{term.en}</span>}
        </span>
        {actions}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-fg-muted">
        <dt>别名</dt>
        <dd>{term.aliases.join('、') || '—'}</dd>
        <dt>定义</dt>
        <dd className="break-words">{term.definition ?? '—'}</dd>
        <dt>首现</dt>
        <dd>{firstLine}</dd>
      </dl>
    </li>
  )
}
