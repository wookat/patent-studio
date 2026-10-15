import { useState } from 'react'
import { fmtMs } from '@/lib/format'
import { Bot, Hammer } from 'lucide-react'
import { AiJobList, AiSuggestionList } from '@/components/ai/AiJobs'
import { ConsoleHeaderActions, ConsolePanel } from '@/components/console/ConsolePanel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelErrorBoundary } from '@/components/ui/error-boundary'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { diagLocationLabel } from '@/lib/diagLocation'

import { useStudio } from '@/store'

type MobileConsoleTab = 'problems' | 'output' | 'jobs'

const TABS: readonly SegmentedOption<MobileConsoleTab>[] = [
  {
    value: 'problems',
    label: '问题',
    'data-testid': 'mobile-console-tab-problems',
  },
  {
    value: 'output',
    label: '输出',
    'data-testid': 'mobile-console-tab-output',
  },
  { value: 'jobs', label: '任务', 'data-testid': 'mobile-console-tab-jobs' },
]

/**
 * 移动端「控制台」Tab（21 §4.3 控制台行：问题 / 输出 / 任务）：首行 = 分段切换 + 右侧复制 / 清空（仅问题 tab），不再另起一行「控制台」标题。
 * - 问题：复用 ConsolePanel variant='mobile'（不渲染面板头）（体检 + lint；全部/错误/警告/提示 ｜ 回归检查 / OA 答复；行内 [定位] 走 gotoLine → 切回编辑 Tab）
 * - 输出：最近一次构建的结果（阶段 · 耗时分段 · 错误人话 message + 定位；原始异常/日志折叠在「原始日志」），不重复问题列表
 * - 任务：AI 后台任务与待写入建议（与 AI 面板同一 store.jobs / suggestions）
 */
export function MobileConsole() {
  const [tab, setTab] = useState<MobileConsoleTab>('problems')
  return (
    <section data-slot="MobileConsole" data-testid="mobile-console" data-tab={tab} className="flex h-full min-h-0 flex-col bg-panel" aria-label="控制台">
      <div className="flex h-11 shrink-0 items-center gap-group-m border-b px-page-m" data-testid="mobile-console-header">
        <Segmented size="md" options={TABS} value={tab} onValueChange={setTab} aria-label="控制台内容" data-testid="mobile-console-kind" className="min-w-0 flex-1 [&_[data-slot=segmented-item]]:flex-1" />
        {tab === 'problems' && <ConsoleHeaderActions mobile />}
      </div>
      {/* 单元崩溃只死该 tab，分段头保留可切换；key=tab 切 tab 即重置边界（同 MobileAiTab 出口） */}
      <PanelErrorBoundary key={tab} label="控制台" onClose={() => useStudio.getState().setMobileTab('edit')}>
        {tab === 'problems' && <ConsolePanel variant="mobile" header={false} className="min-h-0 flex-1" />}
        {tab === 'output' && <BuildOutput />}
        {tab === 'jobs' && <Jobs />}
      </PanelErrorBoundary>
    </section>
  )
}

const PHASE_LABEL = {
  idle: '未构建',
  queued: '排队中',
  building: '构建中',
  ok: '构建成功',
  error: '构建失败',
  superseded: '已被新构建取代',
} as const

function BuildOutput() {
  const phase = useStudio((s) => s.phase)
  const outcome = useStudio((s) => s.outcome)
  const netError = useStudio((s) => s.netError)
  const elapsedMs = useStudio((s) => s.elapsedMs)
  const gotoLine = useStudio((s) => s.gotoLine)
  const ast = useStudio((s) => s.ast)

  if (!outcome && !netError && phase === 'idle') {
    return <EmptyState icon={Hammer} title="尚未构建" reason="编辑后自动构建，或在顶栏点击「构建」" className="flex-1" data-testid="mobile-console-output-empty" />
  }
  const t = outcome?.timings ?? {}
  const sum = outcome?.summary
  const rows: [string, string | null][] = [
    ['状态', phase === 'building' ? `${PHASE_LABEL[phase]} ${fmtMs(elapsedMs)}` : PHASE_LABEL[phase]],
    ['总耗时', t.total_ms != null ? fmtMs(t.total_ms) : null],
    ['排队', t.queue_ms != null ? fmtMs(t.queue_ms) : null],
    ['DOCX', t.docx_ms != null ? fmtMs(t.docx_ms) : null],
    ['PDF', t.pdf_ms != null ? fmtMs(t.pdf_ms) : null],
    ['正文', sum ? `权项 ${sum.claims} · 段落 ${sum.paragraphs} · 页 ${sum.pages ?? '-'}` : null],
    ['诊断', outcome?.diagnostics.length ? `${outcome.diagnostics.length} 条（见「问题」）` : null],
  ]
  const err = outcome?.error
  const errLine = err?.line ?? null
  const raw = err && err.detail && err.detail.trim() !== err.message.trim() ? err.detail : null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm" data-testid="mobile-console-output">
      {netError && (
        <Alert variant="danger">
          <AlertTitle>无法连接构建服务</AlertTitle>
          <AlertDescription>{netError}</AlertDescription>
        </Alert>
      )}
      {err && (
        <Alert variant="danger" data-testid="mobile-console-build-error">
          <AlertTitle>{err.message}</AlertTitle>
          <AlertDescription className="break-words">
            {errLine != null && (
              <Button variant="link" size="xl" className="h-auto min-h-row-mobile px-0" onClick={() => gotoLine(errLine)}>
                在源码中定位到{diagLocationLabel({ line: errLine }, ast)}
              </Button>
            )}
            {raw && (
              <details className="mt-1" data-testid="mobile-console-build-raw">
                <summary className="cursor-pointer select-none text-fg-muted">原始日志</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs text-fg-muted">{raw}</pre>
              </details>
            )}
          </AlertDescription>
        </Alert>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 tabular">
        {rows
          .filter((r): r is [string, string] => r[1] != null)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="min-w-0 break-words text-fg">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

function Jobs() {
  const empty = useStudio((s) => s.jobs.length === 0 && s.suggestions.length === 0)
  if (empty) {
    return (
      <EmptyState
        icon={Bot}
        title="暂无 AI 任务"
        reason="在 AI Tab 发起审阅、材料转专利或 OA 答复后，任务进度显示在这里"
        className="flex-1"
        data-testid="mobile-console-jobs-empty"
      />
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3" data-testid="mobile-console-jobs">
      <AiJobList />
      <AiSuggestionList />
    </div>
  )
}
