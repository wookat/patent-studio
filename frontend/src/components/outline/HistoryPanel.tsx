import { useState } from 'react'
import { FileDiff, GitCompare, History, RotateCcw, X } from 'lucide-react'
import { selectReadonly, useStudio } from '@/store'
import type { Version } from '@/lib/types'
import { summarizeDiff, type DiffSummary } from './diff'
import { FOCUS_RING, cn } from '@/lib/utils'
import { fmtFull, fmtWhen } from '@/lib/format'
import { versionLabel } from '@/lib/versionLabel'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHistoryViewLifecycle } from '@/hooks/useHistoryRefresh'

function DiffLine({ label, text, tone }: { label: string; text: string; tone: 'removed' | 'added' }) {
  return (
    <div className={cn('flex gap-1.5 rounded px-1.5 py-0.5 font-mono text-2xs leading-none', tone === 'removed' ? 'bg-danger-bg text-danger-fg' : 'bg-ok-bg text-ok-fg')}>
      <span className="shrink-0">{label}</span>
      <span className="truncate" title={text}>{text || <span className="italic opacity-60">（空行）</span>}</span>
    </div>
  )
}

/** 选中版本后的差异摘要：行数差、增/删行、首个差异行（该版 vs 编辑区当前内容） */
function DiffPreview({ diff }: { diff: DiffSummary }) {
  return (
    <div data-testid="version-diff" className="space-y-1.5 text-xs">
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
            <div className="space-y-0.5">
              <p className="text-fg-muted">首个差异 · 第 <b className="font-mono">{diff.first.line}</b> 行</p>
              <DiffLine label="−" text={diff.first.backup} tone="removed" />
              <DiffLine label="+" text={diff.first.current} tone="added" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** `git diff` 统一格式逐行着色（+ 绿 / − 红 / @@ 弱化），不解析语义 */
function UnifiedDiff({ text }: { text: string }) {
  if (!text) return <p className="text-xs text-fg-muted">与已保存内容无差异。</p>
  return (
    <pre data-testid="version-unified-diff" className="max-h-48 overflow-auto rounded bg-panel p-1.5 font-mono text-2xs leading-none">
      {text.replace(/\n$/, '').split('\n').map((l, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap break-all',
            l.startsWith('+') && !l.startsWith('+++') && 'bg-ok-bg text-ok-fg',
            l.startsWith('-') && !l.startsWith('---') && 'bg-danger-bg text-danger-fg',
            l.startsWith('@@') && 'text-fg-muted',
          )}
        >
          {l}
        </div>
      ))}
    </pre>
  )
}

/**
 * 版本历史（07 §4.3 / §5.1）：每次保存自动提交到项目内 git（.studio/history），列表 = history slice 的 versions。
 * 选中 → 拉取该版 content.md 与编辑区当前内容做行级摘要；「完整差异」= 后端 `diff(sha, work)` 统一 diff；
 * 「恢复」经 restoreVersion → dirtyGuard('custom') → 后端写回 content.md 并再提交 `restore <sha7>`。
 */
export function HistoryPanel() {
  const pid = useStudio((s) => s.pid)
  // 按案子 key：切案后选中项 / 已拉取内容自然重置
  return <HistoryBody key={pid ?? ''} pid={pid} />
}

function HistoryBody({ pid }: { pid: string | null }) {
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

  // 保存成功 / 协同写回后刷新列表；最后一个历史视图卸载才清空（并存互不清，R62-02）
  useHistoryViewLifecycle(pid)

  const pick = (sha: string | null) => {
    if (!pid) return
    setError(null)
    setShowFull(false)
    setComparePair(null)
    selectVersion(pid, sha).catch((e: Error) => setError(e.message))
  }
  // A↔B 对比：选中版为锚，另点一行的 ⇄ 即比较两版（a 恒为较早版——versions 按新→旧排序，index 大者旧）
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
    <div data-slot="HistoryPanel" className="flex h-full min-h-0 flex-col text-sm">
      <p className="px-2.5 py-1.5 text-xs leading-4 text-fg-muted">每次保存自动记录一版。选中查看与当前内容的差异；恢复会写回并新增一版。</p>
      {versions.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto px-1 pb-1" data-testid="version-list-empty">
          <p role="status" aria-busy={historyLoading} className="flex h-tree-row items-center gap-1.5 px-2.5 text-base text-fg-muted">
            <History className="size-4" aria-hidden />
            {historyUnavailable ? '此部署未启用版本历史' : historyLoading ? '读取版本…' : '暂无版本（保存后自动生成）'}
          </p>
        </div>
      ) : (
      <ul role="listbox" aria-label="版本列表" aria-busy={historyLoading} className="min-h-0 flex-1 overflow-auto px-1 pb-1" data-testid="version-list">
        {versions.map((v) => {
          const active = v.sha === selectedSha
          return (
            <li key={v.sha} role="none">
              <button
                type="button"
                role="option"
                aria-selected={active}
                title={`${v.sha}\n${fmtFull(v.at)} · ${v.author}\n${versionLabel(v.message)}`}
                className={cn(
                  'flex w-full items-center justify-between gap-1.5 rounded py-1 pl-2.5 pr-1.5 text-left',
                  FOCUS_RING,
                  active ? 'bg-selected font-bold text-link' : 'hover:bg-hover',
                )}
                onClick={() => pick(active ? null : v.sha)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base leading-5" title={versionLabel(v.message)}>{versionLabel(v.message)}</span>
                  <span className={cn('truncate font-mono text-2xs font-normal leading-none', active ? 'text-link' : 'text-fg-muted')} title={`${fmtWhen(v.at)} · ${v.author}`}>
                    {fmtWhen(v.at)} · {v.author}
                  </span>
                </span>
                <span className={cn('flex shrink-0 flex-col items-end font-mono text-2xs font-normal leading-none', active ? 'text-link' : 'text-fg-muted')}>
                  <span>{v.sha.slice(0, 7)}</span>
                  {(v.added > 0 || v.deleted > 0) && (
                    <span className="tabular-nums" data-testid="version-lines">
                      <span className={active ? undefined : 'text-ok-fg'}>+{v.added}</span> <span className={active ? undefined : 'text-danger-fg'}>−{v.deleted}</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      )}

      {selected && (
        <div className="shrink-0 space-y-2 border-t bg-sunken/60 p-2.5" data-testid="version-detail">
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
            <p className="text-xs text-danger-fg">
              读取失败：{error}
              <Button size="xs" variant="link" className="px-1" onClick={() => pick(selectedSha)} data-testid="history-retry">重试</Button>
            </p>
          ) : comparePair ? (
            cmpDiff ? <UnifiedDiff text={cmpDiff} /> : <p className="text-xs text-fg-muted">读取差异…</p>
          ) : versionContent === null ? (
            <p className="text-xs text-fg-muted">读取版本…</p>
          ) : (
            <DiffPreview diff={summarizeDiff(versionContent, content)} />
          )}
          {fullDiff !== null && <UnifiedDiff text={fullDiff} />}
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
              <Button size="sm" variant="ghost" className="h-7 flex-1 rounded text-xs" disabled={versionContent === null} onClick={toggleFull} aria-pressed={showFull} data-testid="version-full-diff">
                <FileDiff aria-hidden />
                {showFull ? '收起差异' : '完整差异'}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 flex-1 rounded text-xs" disabled={versionContent === null || readonly} onClick={() => restoreVersion(pid!, selected.sha)} data-testid="restore-version">
              <RotateCcw aria-hidden />
              恢复此版本
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
