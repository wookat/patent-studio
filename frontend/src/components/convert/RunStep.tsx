import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AiJob } from '@/types/ai'
import type { ConvertResult } from '@/types/convert'
import { classifyDiffLine, diffStats } from './convertUtils'

/** 后台任务进度（③ 提交后）：role=progressbar + 阶段文案；关闭对话框不终止任务 */
export function RunningView({ job }: { job: AiJob | null }) {
  const pct = Math.round(Math.max(0, Math.min(1, job?.progress ?? 0)) * 100)
  return (
    <div className="flex flex-col gap-3" data-testid="convert-step-running" aria-live="polite">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin text-info-fg" aria-hidden />
        <span className="font-medium">{job?.status === 'queued' ? '排队中…' : '正在生成三书草稿…'}</span>
        <span className="ml-auto text-xs tabular-nums text-fg-muted">{pct}%</span>
      </div>
      <div role="progressbar" aria-label="转换进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded bg-sunken">
        <div className="h-full rounded bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-fg-muted" data-testid="convert-job-message">
        {job?.message || '已提交，等待后台任务开始（重型模型约 1–2 分钟）'}
      </p>
      <p className="text-xs text-fg-muted">关闭本窗口不会中断任务；可稍后在 AI 面板的任务列表查看结果。</p>
    </div>
  )
}

export function ErrorView({ job, error }: { job: AiJob | null; error: string | null }) {
  const msg = job?.error?.message ?? (job?.status === 'interrupted' ? '任务被中断（服务重启）' : error) ?? '未知错误'
  return (
    <div role="alert" className="flex items-start gap-2 rounded-sm border border-danger-dot bg-danger-bg p-3 text-sm" data-testid="convert-step-error">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger-fg" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-danger-fg">转换失败</span>
        <span className="break-words text-fg-muted">{msg}</span>
        {job?.error?.kind && <span className="text-xs text-fg-muted">类型：{job.error.kind}</span>}
      </div>
    </div>
  )
}

/** 结果报告：警告 / 抽取术语 / 用量 */
export function ReportView({ result }: { result: ConvertResult }) {
  const r = result.report
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="convert-report">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-ok-fg" aria-hidden />
        <span className="font-medium">
          三书草稿已生成
          {result.new_pid ? `：已写入新案卷「${result.new_pid}」` : result.draft_sha ? `：已提交为版本 ${result.draft_sha.slice(0, 7)}（工作区未改动）` : ''}
        </span>
      </div>
      {r.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-warn-fg" aria-label="转换警告" data-testid="convert-warnings">
          {r.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      {r.terms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="convert-terms">
          <span className="text-fg-muted">抽取术语：</span>
          {r.terms.map((t) => (
            <span key={t.name} className="rounded border px-1.5 py-0.5" title={t.aliases?.length ? `别名：${t.aliases.join('、')}` : undefined}>{t.name}</span>
          ))}
        </div>
      )}
      <p className="text-xs text-fg-muted" data-testid="convert-usage">
        用量：提示 {r.usage.prompt_tokens} · 补全 {r.usage.completion_tokens} · 合计 {r.usage.total_tokens} token
      </p>
    </div>
  )
}

/** 草稿 vs 工作区 diff（复用 GET /history/diff?a=<draft_sha>&b=work） */
export function DraftDiff({ pid, sha }: { pid: string; sha: string }) {
  const [state, setState] = useState<{ sha: string; diff?: string; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const cur = state?.sha === sha ? state : null
  const diff = cur?.diff ?? null
  const error = cur?.error ?? null

  useEffect(() => {
    let alive = true
    api
      .historyDiff(pid, sha, 'work')
      .then((r) => alive && setState({ sha, diff: r.diff }))
      .catch((e: Error) => alive && setState({ sha, error: e.message }))
    return () => {
      alive = false
    }
  }, [pid, sha, attempt])

  if (error)
    return (
      <p role="alert" className="text-xs text-danger-fg" data-testid="convert-diff-error">
        diff 加载失败：{error}
        <Button size="xs" variant="link" className="px-1" onClick={() => setAttempt((a) => a + 1)} data-testid="convert-diff-retry">重试</Button>
      </p>
    )
  if (diff === null) return <p className="text-xs text-fg-muted" data-testid="convert-diff-loading">正在加载 diff…</p>
  const lines = diff.split('\n')
  const { added, deleted } = diffStats(diff)
  return (
    <div className="flex min-h-0 flex-col gap-1" data-testid="convert-diff">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg">草稿 → 工作区</span>
        <span className="text-ok-fg">+{added}</span>
        <span className="text-danger-fg">−{deleted}</span>
        <span className="ml-auto">左：草稿 {sha.slice(0, 7)} · 右：当前工作区</span>
      </div>
      {diff.trim() === '' ? (
        <p className="rounded border p-2 text-xs text-fg-muted">草稿与工作区完全一致。</p>
      ) : (
        <pre className="max-h-56 overflow-auto rounded border bg-sunken font-mono text-xs leading-relaxed" data-testid="convert-diff-body">
          {lines.map((l, i) => {
            const k = classifyDiffLine(l)
            return (
              <div
                key={i}
                className={cn(
                  'whitespace-pre-wrap break-words px-2',
                  k === 'add' && 'bg-ok-bg text-ok-fg',
                  k === 'del' && 'bg-danger-bg text-danger-fg',
                  k === 'hunk' && 'bg-sunken text-fg-muted',
                  k === 'meta' && 'text-fg-muted',
                )}
              >
                {l || ' '}
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}
