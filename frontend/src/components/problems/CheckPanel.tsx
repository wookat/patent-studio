import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, MinusCircle, Play, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { diagLocationLabel } from '@/lib/diagLocation'
import type { CheckResult, Diagnostic } from '@/lib/types'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'
import { useIsDesktop } from '@/hooks/useMisc'
import { useStudio } from '@/store'
import { LINT_RULES, matchesRule } from './lintRules'
import { locateSourceLine } from './locateSource'

/** 诊断位置按钮（「权利要求 3」等，不露源码行号）：点击 → 源码视图打开对应书并把该行滚到中央高亮（domain-02） */
function LineLink({ item }: { item: Diagnostic & { line: number } }) {
  const ast = useStudio((s) => s.ast)
  const where = diagLocationLabel(item, ast)
  return (
    <button
      type="button"
      className={cn(touchHit, 'shrink-0 rounded text-link hover:underline', FOCUS_RING)}
      onClick={() => locateSourceLine({ book: null, line: item.line, source: 'problems' })}
      aria-label={`在源码中定位到${where}`}
      title="在源码中定位"
      data-testid="lint-goto"
    >
      {where}
    </button>
  )
}

const hasLine = (d: Diagnostic): d is Diagnostic & { line: number } => d.line != null

type Status = 'PASS' | 'FAIL' | 'SKIP'
const STATUS_ORDER: Status[] = ['FAIL', 'PASS', 'SKIP']
const STATUS_LABEL: Record<Status, string> = { PASS: '通过', FAIL: '未通过', SKIP: '跳过' }

function StatusIcon({ status, className }: { status: Status | 'WARN'; className?: string }) {
  if (status === 'PASS') return <CheckCircle2 className={cn('size-3.5 shrink-0 text-ok-fg', className)} aria-label="通过" />
  if (status === 'FAIL') return <XCircle className={cn('size-3.5 shrink-0 text-danger-fg', className)} aria-label="未通过" />
  if (status === 'WARN') return <AlertTriangle className={cn('size-3.5 shrink-0 text-warn-fg', className)} aria-label="警告" />
  return <MinusCircle className={cn('size-3.5 shrink-0 text-fg-muted', className)} aria-label="跳过" />
}

/** 可折叠分组：标题行 + 计数 */
function Group({ title, count, tone, defaultOpen, children, testId }: { title: string; count: number; tone: 'ok' | 'bad' | 'muted'; defaultOpen: boolean; children: ReactNode; testId: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-sm border" data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-hover in-data-[density=touch]:min-h-row-compact"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
        <span className={cn('font-medium', tone === 'ok' && 'text-ok-fg', tone === 'bad' && 'text-danger-fg', tone === 'muted' && 'text-fg-muted')}>{title}</span>
        <span className="tabular text-fg-muted">{count}</span>
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  )
}

/** 当前案形式检查：十条规则逐项列出（03 §1.4：通过项也要看得见） */
function LintSection() {
  const pid = useStudio((s) => s.pid)
  const settings = useStudio((s) => s.settings)
  const lintItems = useStudio((s) => s.lintItems)
  const run = useStudio((s) => s.lintRun)
  const running = useStudio((s) => s.lintRunning)
  const runLint = useStudio((s) => s.runLint)
  /* lintContent !== content ⇒ 结果基于改前正文（递交页横幅同契约；面板本身也标，行号可能对不上） */
  const stale = useStudio((s) => s.lintRun !== null && s.lintRun.report !== null && s.lintContent !== s.content)

  const rows = LINT_RULES.map((rule) => {
    const hits = lintItems.filter((d) => matchesRule(d.id, rule.id))
    const worst: Diagnostic['severity'] | null = hits.some((d) => d.severity === 'error') ? 'error' : hits.some((d) => d.severity === 'warning') ? 'warning' : hits.length ? 'info' : null
    return { rule, hits, worst }
  })
  // 后端返回了不在目录里的规则 → 也要显示，不能吞掉
  const known = new Set(LINT_RULES.map((r) => r.id))
  const extra = lintItems.filter((d) => ![...known].some((k) => matchesRule(d.id, k)))
  const failed = rows.filter((r) => r.worst === 'error')
  const warned = rows.filter((r) => r.worst === 'warning' || r.worst === 'info')
  const passed = rows.filter((r) => r.worst == null)
  const hasRun = run?.report != null
  const desktop = useIsDesktop()
  // 触控：诊断行 min-h 44（row-compact）、图标 / 文本 / 右侧规则号同一基线；「运行」按钮 md 占满一行不右浮
  const rowCls = cn('flex gap-2 px-2 text-xs', desktop ? 'items-start py-1' : 'min-h-row-compact items-center py-2')

  const renderRow = (r: (typeof rows)[number]) => (
    <li key={r.rule.id} className={rowCls} data-testid={`lint-rule-${r.rule.id}`} data-status={r.worst == null ? 'PASS' : 'FAIL'}>
      <StatusIcon status={r.worst == null ? 'PASS' : r.worst === 'error' ? 'FAIL' : 'WARN'} className={cn(desktop && 'mt-0.5')} />
      <span className="min-w-0 flex-1">
        <span>{r.rule.name}</span>
        {r.hits.length === 0 && r.rule.desc && <span className="ml-2 text-fg-muted">{r.rule.desc}</span>}
        {r.hits.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {r.hits.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2 text-fg-muted">
                <span className={cn(d.severity === 'error' && 'text-danger-fg')}>{d.message}</span>
                {hasLine(d) && <LineLink item={d} />}
              </li>
            ))}
          </ul>
        )}
      </span>
      <code className="shrink-0 font-mono text-2xs text-fg-muted">{r.rule.id}</code>
    </li>
  )

  return (
    <section className="flex flex-col gap-2" aria-label="当前案形式检查" data-testid="lint-section">
      <div className="flex flex-wrap items-center gap-2" data-testid="lint-header">
        <Heading className={cn('font-medium', desktop ? 'text-xs' : 'text-sm')}>当前案 · 形式检查（{LINT_RULES.length} 项可自动判定）</Heading>
        {hasRun && (
          <span className="text-xs text-fg-muted tabular" data-testid="lint-summary">
            {failed.length > 0 && <span className="text-danger-fg">{failed.length} 未通过</span>}
            {failed.length > 0 && (warned.length > 0 || passed.length > 0) && ' · '}
            {warned.length > 0 && <span className="text-warn-fg">{warned.length} 警告</span>}
            {warned.length > 0 && passed.length > 0 && ' · '}
            {passed.length > 0 && <span className="text-ok-fg">{passed.length} 通过</span>}
            {run && <> · {run.ms} ms</>}
          </span>
        )}
        <Button size={desktop ? 'sm' : 'md'} className={desktop ? 'ml-auto h-7' : 'w-full'} disabled={!pid || !settings || running} onClick={() => void runLint()} data-testid="run-lint">
          {running ? <Loader2 className="animate-spin" /> : <Play />} 运行当前案检查
        </Button>
      </div>
      {run?.error && (
        <p className="flex items-center gap-2 rounded-sm border border-danger-fg/40 bg-danger-bg px-2 py-1.5 text-xs text-danger-fg" role="alert">
          <XCircle className="size-3.5" /> 检查请求失败：{run.error}
        </p>
      )}
      {!hasRun && !run?.error && (
        <p className="text-xs text-fg-muted">尚未运行。检查使用编辑器中的当前内容与当前设置，结果同时写入「问题」tab。</p>
      )}
      {hasRun && (
        <div className="flex flex-col gap-1.5">
          {stale && (
            <p className="flex items-center gap-1.5 rounded-sm border border-warn-fg/40 bg-warn-bg px-2 py-1 text-xs text-warn-fg" data-testid="lint-stale">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> 正文已修改，结果基于修改前的内容——建议重新运行
            </p>
          )}
          {failed.length > 0 && <Group title="未通过" count={failed.length} tone="bad" defaultOpen testId="lint-group-fail"><ul className="divide-y">{failed.map(renderRow)}</ul></Group>}
          {warned.length > 0 && <Group title="警告" count={warned.length} tone="muted" defaultOpen testId="lint-group-warn"><ul className="divide-y">{warned.map(renderRow)}</ul></Group>}
          {extra.length > 0 && (
            <Group title="其他诊断" count={extra.length} tone="muted" defaultOpen testId="lint-group-extra">
              <ul className="divide-y">
                {extra.map((d) => (
                  <li key={d.id} className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 text-xs', desktop ? 'py-1' : 'min-h-row-compact py-2')} data-testid="lint-extra-row">
                    <StatusIcon status={d.severity === 'error' ? 'FAIL' : 'WARN'} />
                    <span className="min-w-0 flex-1 basis-40 break-words">{d.message}</span>
                    {hasLine(d) && <LineLink item={d} />}
                    <code className="max-w-2/5 shrink-0 truncate font-mono text-2xs text-fg-muted" title={d.id}>{d.id}</code>
                  </li>
                ))}
              </ul>
            </Group>
          )}
          <Group title="通过" count={passed.length} tone="ok" defaultOpen={failed.length === 0 && warned.length === 0} testId="lint-group-pass"><ul className="divide-y">{passed.map(renderRow)}</ul></Group>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-xs text-fg-muted">
        <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warn-fg" />
        未覆盖：权项支持性、清楚性、新颖性、创造性 — 自动检查不能替代人工审校。
      </p>
    </section>
  )
}

/** 仓库回归 check_all.py（开发者向）：PASS / FAIL / SKIP 分组、可折叠、显示耗时 */
export function CheckAllResult({ res, compact }: { res: CheckResult; compact?: boolean }) {
  const groups = STATUS_ORDER.map((st) => ({ st, items: res.results.filter((r) => r.status === st) })).filter((g) => g.items.length > 0)
  const [showOutput, setShowOutput] = useState(false)
  return (
    <div className="flex flex-col gap-1.5" data-testid="check-all-result">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', res.ok ? 'border-ok-dot/40 text-ok-fg' : 'border-danger-fg/40 text-danger-fg')} data-testid="check-all-status">
          <StatusIcon status={res.ok ? 'PASS' : 'FAIL'} /> {res.ok ? '回归通过' : `回归未通过（exit ${res.exit_code ?? '?'}）`}
        </span>
        {groups.map((g) => (
          <span key={g.st} className="tabular text-fg-muted">{g.items.length} {g.st}</span>
        ))}
        <span className="tabular text-fg-muted">· {(res.duration_ms / 1000).toFixed(1)} s</span>
      </div>
      {groups.map((g) => (
        <Group key={g.st} title={STATUS_LABEL[g.st]} count={g.items.length} tone={g.st === 'PASS' ? 'ok' : g.st === 'FAIL' ? 'bad' : 'muted'} defaultOpen={g.st === 'FAIL' || (!compact && g.st === 'PASS' && !groups.some((x) => x.st === 'FAIL'))} testId={`check-group-${g.st.toLowerCase()}`}>
          <ul className="divide-y">
            {g.items.map((r, i) => (
              <li key={`${g.st}-${i}`} className="flex items-center gap-2 px-2 py-1 text-xs">
                <StatusIcon status={g.st} />
                <span className="font-mono">{r.name}</span>
              </li>
            ))}
          </ul>
        </Group>
      ))}
      {Object.keys(res.docx_source).length > 0 && (
        <p className="text-xs text-fg-muted">
          docx 来源：{Object.entries(res.docx_source).map(([k, v]) => `${k}=${v}`).join(' · ')}
        </p>
      )}
      <div>
        <button type="button" className="text-xs text-fg-muted hover:text-fg-strong" onClick={() => setShowOutput((v) => !v)} aria-expanded={showOutput}>
          {showOutput ? '收起' : '展开'}完整输出
        </button>
        {showOutput && <pre className="mt-1 max-h-60 overflow-auto rounded-sm bg-sunken p-2 font-mono text-2xs leading-4 whitespace-pre-wrap">{res.output}</pre>}
      </div>
    </div>
  )
}

function CheckAllSection() {
  const run = useStudio((s) => s.checkAllRun)
  const running = useStudio((s) => s.checkAllRunning)
  const runCheckAll = useStudio((s) => s.runCheckAll)
  const [open, setOpen] = useState(false)
  const desktop = useIsDesktop()
  return (
    <section className="flex flex-col gap-2" aria-label="仓库回归" data-testid="check-all-section">
      {/* 触控：折叠行与「运行」按钮上下堆叠（各占一行），避免 375 下同行挤压折行错位 */}
      <div className={cn('flex gap-2', desktop ? 'items-center' : 'flex-col')} data-testid="check-all-header">
        <button
          type="button"
          className={cn('flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg-strong in-data-[density=touch]:min-h-touch', !desktop && 'whitespace-nowrap')}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="check-all-toggle"
        >
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', !open && '-rotate-90')} />
          仓库回归 check_all.py（开发者）
          {run?.result && (
            <span className="ml-1 tabular">· {run.result.results.filter((r) => r.status === 'PASS').length} PASS · {run.result.results.filter((r) => r.status === 'FAIL').length} FAIL · {run.result.results.filter((r) => r.status === 'SKIP').length} SKIP</span>
          )}
        </button>
        <Button size={desktop ? 'sm' : 'md'} variant="outline" className={desktop ? 'ml-auto h-7' : 'w-full'} disabled={running} onClick={() => { setOpen(true); void runCheckAll() }} data-testid="run-check">
          {running ? <Loader2 className="animate-spin" /> : <Play />} 运行 check_all 回归
        </Button>
      </div>
      {open && (
        <div className="pl-5">
          {run?.error && <p className="text-xs text-danger-fg" role="alert">{run.error}</p>}
          {run?.result ? <CheckAllResult res={run.result} compact /> : !run?.error && <p className="text-xs text-fg-muted">对整个仓库执行 check_all.py（两案零漂移 md5、pytest 等），耗时数十秒；与当前编辑内容无关。</p>}
        </div>
      )}
    </section>
  )
}

/** 底部面板「检查」tab（03 §3.8 / 02 §5.2）：当前案形式检查 + 仓库回归 */
export function CheckPanel() {
  const desktop = useIsDesktop()
  return (
    <div data-slot="CheckPanel" className={cn('flex flex-col text-sm', desktop ? 'gap-4 p-3' : 'gap-section-m px-sheet-m pb-sheet-m pt-sheet-top-m')} data-testid="check-panel">
      <LintSection />
      <CheckAllSection />
    </div>
  )
}
