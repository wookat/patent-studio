import { useState } from 'react'
import { AlertTriangle, CircleX, Info, Loader2, WandSparkles } from 'lucide-react'
import { Heading } from '@/components/ui/heading'
import { Button } from '@/components/ui/button'
import { diagLocationLabel } from '@/lib/diagLocation'
import type { Severity } from '@/lib/types'
import { cn } from '@/lib/utils'
import { selectAiEnabled, useStudio } from '@/store'
import type { PreflightItem } from '@/types/preflight'
import { BOOK_LABELS } from '@/lib/docset'
import { applySuggestion, gotoReview, runRewrite } from '@/components/ai/aiModel'
import { LOCATE_ROW, groupByRule, ruleLabel, SEVERITY_LABEL, usePreflightLocate } from './preflightUtils'

const ICON: Record<Severity, React.ReactNode> = {
  error: <CircleX className="text-danger-fg" aria-hidden />,
  warning: <AlertTriangle className="text-warn-fg" aria-hidden />,
  info: <Info className="text-info" aria-hidden />,
}
const TITLE_COLOR: Record<Severity, string> = { error: 'text-danger-fg', warning: 'text-warn-fg', info: 'text-info' }

/**
 * 问题视图：按规则分组（组按严重度排），每组 = 严重度图标 + 规则名 + 条数；条目 = message · 位置（权利要求 3 / 说明书 · 段落 [0012]，不露行号与块 id）· detail。
 * 点击条目 → 源码行 + 结构块高亮 + PDF 定位（usePreflightLocate）。
 * spec.corpus_overlap 条带「AI 去重改写」：整段行区间 + 命中原句（detail）走 rewrite(decopy)，
 * 产出 CriticMarkup 建议直接写入正文，引导到审阅面板接受/拒绝。
 */
export function ItemsView({ items }: { items: PreflightItem[] }) {
  const locate = usePreflightLocate()
  const ast = useStudio((s) => s.ast)
  const aiEnabled = useStudio(selectAiEnabled)
  const toast = useStudio((s) => s.toast)
  const [decopyBusy, setDecopyBusy] = useState<string | null>(null)
  const groups = groupByRule(items)
  const where = (it: PreflightItem) => {
    const label = diagLocationLabel({ line: it.line, blockId: it.block_id, section: it.book ? BOOK_LABELS[it.book] : null }, ast)
    return label === '全文' && !it.book ? '—' : label
  }
  const decopyRange = (it: PreflightItem) => {
    if (!ast || it.book !== 'description' || !it.block_id) return null
    const block = ast.description.find((b) => b.id === it.block_id)
    if (!block) return null
    const off = ast.books.description.offset
    return { lineStart: off + block.lines.start, lineEnd: off + block.lines.end }
  }
  const runDecopy = async (key: string, it: PreflightItem) => {
    const range = decopyRange(it)
    if (!range) return
    setDecopyBusy(key)
    try {
      const before = useStudio.getState().suggestions.length
      const instruction = it.detail ? `涉嫌搬运的原句是：「${it.detail}」——只重写它` : undefined
      const ok = await runRewrite('decopy', range, instruction)
      if (!ok) return
      const sug = useStudio.getState().suggestions.at(-1)
      if (sug && useStudio.getState().suggestions.length > before) applySuggestion(sug)
      toast('已把去重改写作为修订写入正文，请在审阅面板接受或拒绝', 'success')
      gotoReview()
    } finally {
      setDecopyBusy(null)
    }
  }
  return (
    <div className="py-1" data-testid="preflight-items">
      {groups.map((g) => (
        <section key={g.rule} aria-labelledby={`preflight-rule-${g.rule}`} data-testid="preflight-rule-group" data-rule={g.rule} data-severity={g.severity}>
          <Heading
            id={`preflight-rule-${g.rule}`}
            className={cn('flex h-sm-control items-center gap-1.5 px-3 text-sm font-semibold [&_svg]:size-3.5', TITLE_COLOR[g.severity])}
          >
            {ICON[g.severity]}
            <span className="sr-only">{SEVERITY_LABEL[g.severity]}：</span>
            <span className="truncate" title={ruleLabel(g.rule)}>{ruleLabel(g.rule)}</span>
            <span className="font-mono text-xs font-normal text-fg-muted">{g.rule}</span>
            <span className="ml-auto text-xs font-normal tabular-nums text-fg-muted">{g.items.length}</span>
          </Heading>
          <ul className="border-b border-border">
            {g.items.map((it, i) => {
              const key = `${g.rule}#${i}`
              const canDecopy = g.rule === 'spec.corpus_overlap' && decopyRange(it) !== null
              return (
                <li key={key} data-testid="preflight-item" data-line={it.line ?? undefined}>
                  <button
                    type="button"
                    className={cn(LOCATE_ROW, 'flex-col items-start gap-0.5 px-3 py-1.5 in-data-[variant=mobile]:py-2.5')}
                    onClick={() => locate(it.line, it.block_id, it.book)}
                    title={it.line !== null || it.block_id ? `在源码中定位到${where(it)}` : undefined}
                  >
                    <span className="break-words text-sm leading-5 text-fg">{it.message}</span>
                    <span className="text-xs leading-4 text-fg-muted" data-testid="preflight-item-loc">
                      {where(it)}
                    </span>
                    {it.detail && <span className="break-words text-xs leading-4 text-fg-muted">{it.detail}</span>}
                  </button>
                  {canDecopy && (
                    <div className="px-3 pb-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-sm-control gap-1 px-2 text-xs text-primary"
                        disabled={!aiEnabled || decopyBusy !== null}
                        aria-busy={decopyBusy === key || undefined}
                        data-testid={`preflight-decopy-${i}`}
                        title={aiEnabled ? '让 AI 换句式重写该句（防搬运），结果进审阅面板' : 'AI 外发已关闭，在 AI 面板开启后可用'}
                        onClick={() => void runDecopy(key, it)}
                      >
                        {decopyBusy === key ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <WandSparkles className="size-3" aria-hidden />}
                        AI 去重改写
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
