import { useState } from 'react'
import { FileDiff, GitCompare, History, RotateCcw, X } from 'lucide-react'
import { selectReadonly, useStudio } from '@/store'
import type { Version } from '@/lib/types'
import { summarizeDiff, type DiffSummary } from '@/components/outline/diff'
import { FOCUS_RING, cn } from '@/lib/utils'
import { versionLabel } from '@/lib/versionLabel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsDesktop } from '@/hooks/useMisc'
import { useHistoryViewLifecycle } from '@/hooks/useHistoryRefresh'
import { fmtFull, fmtWhen } from '@/lib/format'


/** 时间线分组标题："今天" / "昨天" / "2026-08-21" */
function dayKey(sec: number, now = Date.now()) {
  const d = new Date(sec * 1000)
  if (new Date(now).toDateString() === d.toDateString()) return '今天'
  if (new Date(now - 86_400_000).toDateString() === d.toDateString()) return '昨天'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type VersionKind = 'save' | 'restore' | 'backup' | 'other'

function versionKind(message: string): VersionKind {
  if (message === 'save') return 'save'
  if (message.startsWith('restore ')) return 'restore'
  if (message.startsWith('backup ')) return 'backup'
  return 'other'
}

/** 时间线圆点：保存 = info · 恢复 = violet · 旧备份 = neutral · 选中 = primary */
const DOT_TONE: Record<VersionKind, string> = {
  save: 'bg-info-dot',
  restore: 'bg-violet-dot',
  backup: 'bg-border-strong',
  other: 'bg-teal-dot',
}

function DiffLine({ label, text, tone }: { label: string; text: string; tone: 'removed' | 'added' }) {
  return (
    <div className={cn('flex gap-1.5 rounded-xs px-1.5 py-0.5 font-mono text-2xs leading-4', tone === 'removed' ? 'bg-danger-bg text-danger-fg' : 'bg-ok-bg text-ok-fg')}>
      <span className="shrink-0">{label}</span>
      <span className="truncate" title={text}>{text || <span className="italic opacity-70">（空行）</span>}</span>
    </div>
  )
}

/** 选中版本后的差异摘要：行数差、增/删行、首个差异行（该版 vs 编辑区当前内容） */
function DiffPreview({ diff }: { diff: DiffSummary }) {
  return (
    <div data-testid="version-diff" className="flex flex-col gap-1.5 text-xs">
      {diff.identical ? (
        <p className="text-fg-muted">与当前内容完全相同。</p>
      ) : (
        <>
          <p className="tabular-nums text-fg-muted">
            当前比该版
            <b className={cn('mx-1 font-mono', diff.lineDelta > 0 ? 'text-ok-fg' : diff.lineDelta < 0 ? 'text-danger-fg' : 'text-fg')}>
              {diff.lineDelta > 0 ? `+${diff.lineDelta}` : diff.lineDelta}
            </b>
            行 · <span className="font-mono text-ok-fg">+{diff.added}</span> / <span className="font-mono text-danger-fg">−{diff.removed}</span> 行
          </p>
          {diff.first && (
            <div className="flex flex-col gap-0.5">
              <p className="text-fg-muted">
                首个差异 · 第 <b className="font-mono text-fg">{diff.first.line}</b> 行
              </p>
              <DiffLine label="−" text={diff.first.backup} tone="removed" />
              <DiffLine label="+" text={diff.first.current} tone="added" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** `git diff` 统一格式逐行着色（+ ok / − danger / @@ 弱化），不解析语义 */
function UnifiedDiff({ text }: { text: string }) {
  if (!text) return <p className="text-xs text-fg-muted">与已保存内容无差异。</p>
  return (
    <pre data-testid="version-unified-diff" className="max-h-64 overflow-auto rounded-md border border-border bg-panel p-1.5 font-mono text-2xs leading-4">
      {text.replace(/\n$/, '').split('\n').map((l, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap break-all px-1',
            l.startsWith('+') && !l.startsWith('+++') && 'bg-ok-bg text-ok-fg',
            l.startsWith('-') && !l.startsWith('---') && 'bg-danger-bg text-danger-fg',
            l.startsWith('@@') && 'text-info-fg',
            (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff') || l.startsWith('index')) && 'text-fg-muted',
          )}
        >
          {l}
        </div>
      ))}
    </pre>
  )
}

export interface HistoryBodyProps {
  pid: string | null
  className?: string
}

/**
 * 版本历史正文（W6 05 §3.11；伴随栏 id=history）：时间线（按天分组、语义圆点、相对时间、+/− 行数）+ 选中版本差异卡（摘要 / 完整 diff / 恢复）。
 * 行为与 outline/HistoryPanel 一致：useHistoryRefresh（saved 变化 / 协同写回刷新）/ selectVersion / loadDiff / restoreVersion / resetHistory。
 * 无 primary：恢复 = secondary；375 控件 44px。
 */
export function HistoryBody({ pid, className }: HistoryBodyProps) {
  const desktop = useIsDesktop()
  const versions = useStudio((s) => s.versions)
  const historyLoading = useStudio((s) => s.historyLoading)
  const historyUnavailable = useStudio((s) => s.historyUnavailable)
  const selectedSha = useStudio((s) => s.selectedSha)
  const versionContent = useStudio((s) => s.versionContent)
  const historyDiff = useStudio((s) => s.historyDiff)
  const selectVersion = useStudio((s) => s.selectVersion)
  const loadDiff = useStudio((s) => s.loadDiff)
  const restoreVersion = useStudio((s) => s.restoreVersion)
  const content = useStudio((s) => s.content)
  const readonly = useStudio(selectReadonly)
  const [error, setError] = useState<string | null>(null)
  const [showFull, setShowFull] = useState(false)
  const ctlSize = desktop ? 'sm' : 'md'

  // 保存成功 / 协同写回后刷新列表；最后一个历史视图卸载才清空（并存互不清，R62-02）
  useHistoryViewLifecycle(pid)

  const pick = (sha: string | null) => {
    if (!pid) return
    setError(null)
    setShowFull(false)
    setComparePair(null)
    selectVersion(pid, sha).catch((e: Error) => setError(e.message))
  }
  // A↔B 对比（outline/HistoryPanel 批53 同实现）：选中版为锚，另选一版即比较两版；a 恒为较早版
  const [comparePair, setComparePair] = useState<{ a: string; b: string } | null>(null)
  const compareWith = (v: Version) => {
    if (!pid || !selectedSha) return
    setError(null)
    const ai = versions.findIndex((x) => x.sha === v.sha)
    const bi = versions.findIndex((x) => x.sha === selectedSha)
    const [a, b] = ai > bi ? [v.sha, selectedSha] : [selectedSha, v.sha]
    setComparePair({ a, b })
    loadDiff(pid, a, b).catch((e: Error) => setError(e.message))
  }
  const clearCompare = () => setComparePair(null)
  const toggleFull = () => {
    if (!pid || !selectedSha) return
    const next = !showFull
    setShowFull(next)
    if (next && historyDiff?.a !== selectedSha) loadDiff(pid, selectedSha).catch((e: Error) => setError(e.message))
  }

  const selected: Version | undefined = versions.find((v) => v.sha === selectedSha)
  const cmpDiff = comparePair && historyDiff?.a === comparePair.a && historyDiff?.b === comparePair.b ? historyDiff.diff : null
  const fullDiff = showFull && !comparePair && historyDiff?.a === selectedSha && historyDiff?.b === 'work' ? historyDiff.diff : null

  return (
    <div data-slot="HistoryBody" data-testid="history-body" className={cn('flex h-full min-h-0 flex-col text-sm', className)}>
      <div className="flex min-h-panel-header items-center gap-1.5 border-b border-border px-3 text-xs">
        <span className="font-semibold text-fg-strong">版本</span>
        <Count value={versions.length} tone="brand" showZero data-testid="history-count" />
        <span className="ml-auto truncate text-fg-muted">每次保存自动记录一版</span>
      </div>

      {versions.length === 0 ? (
        <div role="status" aria-busy={historyLoading} className="min-h-0 flex-1 overflow-auto px-3 py-2" data-testid="version-list-empty">
          {historyLoading ? (
            <div className="flex flex-col gap-2" data-testid="history-loading">
              <Skeleton className="h-row w-full rounded-md" />
              <Skeleton className="h-row w-full rounded-md" />
              <Skeleton className="h-row w-full rounded-md" />
            </div>
          ) : (
            <EmptyState
              size="sm"
              icon={History}
              title={historyUnavailable ? '此部署未启用版本历史' : '暂无版本'}
              reason={historyUnavailable ? '联系管理员开启项目内 git 历史后，每次保存将自动记录。' : '保存后自动生成第一版。'}
              data-testid="history-empty"
            />
          )}
        </div>
      ) : (
      <ol role="listbox" aria-label="版本列表" aria-busy={historyLoading} className="min-h-0 flex-1 overflow-auto px-3 py-2" data-testid="version-list">
        {versions.map((v, i) => {
          const active = v.sha === selectedSha
          const kind = versionKind(v.message)
          const day = dayKey(v.at)
          const showDay = i === 0 || dayKey(versions[i - 1].at) !== day
          const last = i === versions.length - 1
          return (
            <li key={v.sha} role="none" className="relative">
              {showDay && (
                <p className={cn('text-2xs font-medium uppercase tracking-wide text-fg-muted', i > 0 && 'mt-2')} aria-hidden>
                  {day}
                </p>
              )}
              <div className="relative flex gap-2.5 pl-1">
                <span className="relative flex w-3 shrink-0 flex-col items-center" aria-hidden>
                  <span className={cn('mt-3.5 size-2 shrink-0 rounded-full ring-2 ring-panel', active ? 'bg-primary' : DOT_TONE[kind])} />
                  {!last && <span className="mt-1 w-px flex-1 bg-border" />}
                </span>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={`${v.sha}\n${fmtFull(v.at)} · ${v.author}\n${versionLabel(v.message)}`}
                  className={cn(
                    'my-0.5 flex min-h-row w-full min-w-0 items-center justify-between gap-2 rounded-md border px-2 text-left transition-colors motion-reduce:transition-none',
                    FOCUS_RING,
                    !desktop && 'min-h-row-mobile',
                    active ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-sunken',
                  )}
                  onClick={() => pick(active ? null : v.sha)}
                  data-testid="version-row"
                  data-sha={v.sha}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className={cn('truncate text-sm leading-5', active ? 'font-semibold text-primary-text' : 'text-fg')} title={versionLabel(v.message)}>{versionLabel(v.message)}</span>
                    <span className="truncate text-2xs leading-4 text-fg-muted" title={`${fmtWhen(v.at)} · ${v.author}`}>
                      <span className="tabular-nums">{fmtWhen(v.at)}</span> · {v.author}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end font-mono text-2xs leading-4 text-fg-muted">
                    <span>{v.sha.slice(0, 7)}</span>
                    {(v.added > 0 || v.deleted > 0) && (
                      <span className="tabular-nums" data-testid="version-lines">
                        <span className="text-ok-fg">+{v.added}</span> <span className="text-danger-fg">−{v.deleted}</span>
                      </span>
                    )}
                  </span>
                </button>
              </div>
            </li>
          )
        })}
      </ol>
      )}

      {selected && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-sunken p-3" data-testid="version-detail">
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="font-medium text-fg-strong">{versionLabel(selected.message)}</span>
            <span className="font-mono">{selected.sha.slice(0, 7)}</span>
            <span className="ml-auto tabular-nums">{fmtWhen(selected.at)}</span>
          </p>
          {comparePair && (
            <div className="flex items-center gap-1.5" data-testid="version-compare-bar">
              <GitCompare className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs text-fg">
                对比 <b className="font-mono">{comparePair.a.slice(0, 7)}</b> → <b className="font-mono">{comparePair.b.slice(0, 7)}</b>
              </span>
              <Button size="icon-xs" variant="ghost" aria-label="退出对比" onClick={clearCompare} data-testid="version-compare-clear">
                <X aria-hidden />
              </Button>
            </div>
          )}
          {error ? (
            <Alert variant="danger" data-testid="history-error">
              <AlertDescription>
                读取失败：{error}
                <Button size="xs" variant="link" className="px-1" onClick={() => pick(selectedSha)} data-testid="history-retry">重试</Button>
              </AlertDescription>
            </Alert>
          ) : comparePair ? (
            cmpDiff ? <UnifiedDiff text={cmpDiff} /> : <p className="text-xs text-fg-muted">读取差异…</p>
          ) : versionContent === null ? (
            <div className="flex flex-col gap-1.5" aria-busy>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : (
            <DiffPreview diff={summarizeDiff(versionContent, content)} />
          )}
          {fullDiff !== null ? (
            <UnifiedDiff text={fullDiff} />
          ) : showFull ? (
            <p className="flex flex-col gap-1.5" aria-busy data-testid="history-diff-loading">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
            </p>
          ) : null}
          {!comparePair && versions.length > 1 && (
            <div className="flex items-center gap-1.5">
              <GitCompare className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
              <Select
                value=""
                onValueChange={(sha) => {
                  const v = versions.find((x) => x.sha === sha)
                  if (v) compareWith(v)
                }}
              >
                <SelectTrigger size="sm" aria-label="选择要对比的另一版本" className="min-w-0 flex-1 text-xs" data-testid="version-compare-select">
                  <SelectValue placeholder="对比其他版本…" />
                </SelectTrigger>
                <SelectContent>
                  {versions.filter((v) => v.sha !== selectedSha).map((v) => (
                    <SelectItem key={v.sha} value={v.sha} className="text-xs">
                      {v.sha.slice(0, 7)} · {versionLabel(v.message)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex gap-1.5">
            {!comparePair && (
              <Button size={ctlSize} variant="ghost" className="flex-1" disabled={versionContent === null} onClick={toggleFull} aria-pressed={showFull} data-testid="version-full-diff">
                <FileDiff aria-hidden />
                {showFull ? '收起差异' : '完整差异'}
              </Button>
            )}
            <Button size={ctlSize} variant="secondary" className="flex-1" disabled={versionContent === null || readonly} onClick={() => restoreVersion(pid!, selected.sha)} data-testid="restore-version">
              <RotateCcw aria-hidden />
              恢复此版本
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 伴随栏 id=history 正文：按案子 key，切案后选中项 / 已拉取内容自然重置 */
export function HistoryCompanionBody() {
  const pid = useStudio((s) => s.pid)
  return <HistoryBody key={pid ?? ''} pid={pid} />
}
