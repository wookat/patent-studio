import { Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { AiJob, AiSuggestion } from '@/types/ai'
import { applySuggestion, gotoReview } from './aiModel'
import { diagLocationLabel } from '@/lib/diagLocation'
import { BOOK_LABELS } from '@/lib/docset'
import type { Ast, BookName } from '@/types/ast'

const JOB_KIND: Record<AiJob['kind'], string> = { review: 'AI 审阅', convert: '一键转专利', oa_answer: 'OA 答复' }
const JOB_STATUS: Record<AiJob['status'], string> = { queued: '排队中', running: '进行中', done: '已完成', error: '失败', interrupted: '已中断' }
const SUG_SOURCE: Record<AiSuggestion['source'], string> = { rewrite: '改写', unify: '术语统一', oa: 'OA 答复' }

const running = (j: AiJob) => j.status === 'queued' || j.status === 'running'

/** 后台任务卡片：进度条（role=progressbar）+ 状态 / 消息 + 进行中「停止跟踪」/ 完成「去审阅」/ 失败原因 */
export function AiJobList() {
  const jobs = useStudio((s) => s.jobs)
  const unwatchJob = useStudio((s) => s.unwatchJob)
  const upsertJob = useStudio((s) => s.upsertJob)
  const hideJob = useStudio((s) => s.hideJob)
  if (jobs.length === 0) return null
  const stop = (j: AiJob) => {
    unwatchJob(j.id)
    upsertJob({ ...j, status: 'interrupted', message: '已停止跟踪；服务端任务会继续跑完，结果不再自动更新' })
  }
  return (
    <section aria-label="后台任务" className="flex flex-col gap-1.5" data-testid="ai-jobs">
      <h3 className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">后台任务</h3>
      <ul className="flex flex-col gap-1.5">
        {jobs.slice(0, 5).map((j) => {
          const pct = Math.round(Math.max(0, Math.min(1, j.progress)) * 100)
          const label = `${JOB_KIND[j.kind] ?? j.kind} · ${JOB_STATUS[j.status] ?? j.status}`
          const count = typeof j.result?.count === 'number' ? j.result.count : Array.isArray(j.result?.comments) ? j.result.comments.length : null
          return (
            <li key={j.id} className="rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-sm" data-testid="ai-job" data-status={j.status}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 font-medium text-fg-strong">
                  {running(j) && <Loader2 className="size-3 animate-spin" aria-hidden />}
                  {label}
                </span>
                {running(j) ? (
                  <Button size="xs" variant="ghost" onClick={() => stop(j)} aria-label={`停止跟踪 ${label}`} data-testid="ai-job-cancel">
                    <X /> 停止
                  </Button>
                ) : (
                  <Button size="icon-xs" variant="ghost" onClick={() => hideJob(j.id)} aria-label={`移除 ${label}`} data-testid="ai-job-hide">
                    <X />
                  </Button>
                )}
              </div>
              <Progress
                value={j.status === 'done' ? 100 : pct}
                label={label}
                className={cn('mt-1.5 h-1', j.status === 'error' ? '[&>[data-slot=progress-indicator]]:bg-danger-dot' : j.status === 'done' && '[&>[data-slot=progress-indicator]]:bg-ok-dot')}
              />
              <p className="mt-1 text-fg-muted" data-testid="ai-job-message">
                {j.status === 'error' ? j.error?.message ?? j.message : j.message}
                {j.status === 'done' && count != null ? `（${count} 条）` : ''}
              </p>
              {j.status === 'done' && j.kind === 'review' && (
                <Button size="xs" variant="secondary" className="mt-1.5" onClick={gotoReview} data-testid="ai-job-review">
                  去审阅面板查看批注
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 建议位置：AST 可定位 → 「权利要求 3」「说明书 · 段落 [0012]」（跨块用 –）；否则退到书名 */
function suggestionWhere(sug: AiSuggestion, ast: Ast | null): string {
  const at = (line: number) => {
    const l = diagLocationLabel({ line }, ast)
    return l === '全文' ? (BOOK_LABELS[sug.book as BookName] ?? sug.book) : l
  }
  const a = at(sug.line_start)
  const b = sug.line_end > sug.line_start ? at(sug.line_end) : a
  return a === b ? a : `${a} – ${b}`
}

/** 待写入的修订建议（来自其他入口，如 OA 答复 / 未自动写入的改写）：作为修订写入正文 → 审阅面板；或忽略 */
export function AiSuggestionList() {
  const suggestions = useStudio((s) => s.suggestions)
  const dismiss = useStudio((s) => s.dismissSuggestion)
  const ast = useStudio((s) => s.ast)
  const toast = useStudio((s) => s.toast)
  if (suggestions.length === 0) return null
  const apply = (sug: AiSuggestion) => {
    applySuggestion(sug)
    toast('建议已作为修订写入正文，请在审阅面板接受或拒绝', 'success')
    gotoReview()
  }
  return (
    <section aria-label="待写入的建议" className="flex flex-col gap-1.5" data-testid="ai-suggestions">
      <h3 className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">待写入的建议（{suggestions.length}）</h3>
      <ul className="flex flex-col gap-1.5">
        {suggestions.map((sug) => (
          <li key={sug.id} className="rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-sm" data-testid="ai-suggestion">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {SUG_SOURCE[sug.source]} · {suggestionWhere(sug, ast)}
              </span>
              <span className="flex gap-1">
                <Button size="xs" variant="soft" onClick={() => apply(sug)} aria-label="作为修订写入正文" data-testid="ai-suggestion-apply">
                  <Check /> 接受为建议
                </Button>
                <Button size="xs" variant="ghost" onClick={() => dismiss(sug.id)} aria-label="拒绝此建议" data-testid="ai-suggestion-dismiss">
                  <X /> 拒绝
                </Button>
              </span>
            </div>
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-sunken px-2 py-1 font-mono text-2xs text-fg-muted">{sug.critic_markdown}</pre>
          </li>
        ))}
      </ul>
    </section>
  )
}
