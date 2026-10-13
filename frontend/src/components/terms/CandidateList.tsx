import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Count } from '@/components/ui/count'
import { lineChipLabel } from '@/lib/diagLocation'
import { selectReadonly, useStudio } from '@/store'
import type { TermCandidate } from '@/types/terms'
import { FOCUS_RING, cn } from '@/lib/utils'

const SOURCE_LABEL: Record<TermCandidate['source'], string> = { freq: '高频', 'figure-label': '附图标记', ai: 'AI' }

/** 候选术语（确定性抽取：高频名词短语 + 附图标记名称；AI 可选）：采纳 → 进术语表并保存；忽略 → 移出候选 */
export function CandidateList({ onAdopt }: { onAdopt: (c: TermCandidate) => void }) {
  const candidates = useStudio((s) => s.candidates)
  const gotoLine = useStudio((s) => s.gotoLine)
  const ast = useStudio((s) => s.ast)
  const readonly = useStudio(selectReadonly)
  const dismiss = useStudio((s) => s.dismissCandidate)
  if (candidates.length === 0) return null
  return (
    <section aria-label="候选术语" className="flex flex-col gap-1.5" data-testid="term-candidates">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-strong">
        候选术语
        <Count value={candidates.length} tone="brand" />
      </h3>
      <ul className="flex flex-col gap-1">
        {candidates.map((c) => (
          <li key={c.name} className="flex min-h-row-menu items-center gap-2 rounded-sm border border-border bg-panel px-2 py-1 text-xs hover:bg-sunken" data-testid="term-candidate">
            <span className="min-w-0 flex-1 truncate" title={c.name}>
              <span className="font-medium text-fg-strong">{c.name}</span>
              <Badge tone={c.source === 'ai' ? 'violet' : c.source === 'figure-label' ? 'teal' : 'neutral'} className="ml-1 align-middle">
                {SOURCE_LABEL[c.source] ?? c.source}
              </Badge>
              <span className="ml-1 text-fg-muted">
                <span className="tabular-nums">{c.count}</span> 次
                {c.lines[0] != null && (
                  <>
                    {' · '}
                    <button type="button" className={cn('rounded-xs font-mono tabular-nums underline-offset-2 hover:underline', FOCUS_RING)} onClick={() => gotoLine(c.lines[0])} aria-label={`跳到首次出现处：${lineChipLabel(c.lines[0], ast)}`}>
                      {lineChipLabel(c.lines[0], ast)}
                    </button>
                  </>
                )}
              </span>
            </span>
            <Button size="icon-sm" variant="ghost" className="text-ok-fg" disabled={readonly} onClick={() => onAdopt(c)} aria-label={`采纳「${c.name}」为术语`} data-testid="term-candidate-adopt">
              <Check aria-hidden />
            </Button>
            <Button size="icon-sm" variant="ghost" className="text-fg-muted" onClick={() => dismiss(c)} aria-label={`忽略候选「${c.name}」`} data-testid="term-candidate-dismiss">
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
