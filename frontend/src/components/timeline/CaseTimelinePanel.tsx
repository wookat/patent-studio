import { useCallback, useEffect, useState } from 'react'
import { History, MessageSquarePlus, RefreshCw } from 'lucide-react'
import { api, isNotImplemented } from '@/lib/api'
import { NOTE_BODY_MAX, type TimelineEvent } from '@/types/timeline'
import { useStudio } from '@/store'
import { ROLE_RANK } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { MentionTextarea } from '@/components/review/MentionTextarea'
import { fmtMdTime } from '@/lib/format'
import { TIMELINE_KIND, splitMentions } from './timelineKinds'

export interface CaseTimelinePanelProps {
  /** 换案请由父级 key={pid} 重挂（状态随之清空） */
  pid: string | null
  className?: string
}

/**
 * 案件时间线（docs/plan/21 §4 R-CASE-05 UI）：GET /api/projects/{pid}/timeline 合并事件流——
 * 建案 / 状态 / 备注（可 @）/ 分享 & 客户确认 / 递交 / OA 轮次 / 期限完成 / 指派审阅 / 导出 / AI 提案；
 * 「添加备注」POST /notes（MentionTextarea @ 成员）。加载 Skeleton / 空态 / 错误 Alert+重试 / 501 EmptyState「功能开发中」。
 */
export function CaseTimelinePanel({ pid, className }: CaseTimelinePanelProps) {
  const desktop = useIsDesktop()
  const authed = useStudio((s) => s.authStatus === 'authed')
  // POST /notes 服务端门槛 reviewer+（auth.ROUTE_ROLE）；viewer 不渲死端钮（R51-02/R54-02 同类）
  const canNote = useStudio((s) => !s.projectLoading && (!s.project?.role || ROLE_RANK[s.project.role] >= ROLE_RANK.reviewer))
  const toast = useStudio((s) => s.toast)
  const [items, setItems] = useState<TimelineEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  /* 批71：备注草稿存 store（timelineNote，null=未撰写）——Drawer 关闭/宿主卸载不再丢稿（卸载丢草稿族收口） */
  const note = useStudio((s) => s.timelineNote)
  const setTimelineNote = useStudio((s) => s.setTimelineNote)
  const composing = typeof note === 'string'
  const [busy, setBusy] = useState(false)
  /* 批73：取消/Esc 与关页签同 DiscardDialog 口径——store 草稿只保重挂不保刷新，
     有内容的备注静默丢弃曾是相对 OA/术语守卫面的漏网（OBS-B71-3 收口） */
  const [pendingCancel, setPendingCancel] = useState(false)
  const requestCancel = () => {
    if ((note ?? '').trim()) setPendingCancel(true)
    else setTimelineNote(null)
  }
  useBeforeUnload(() => !!(note ?? '').trim())

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!pid) return
      try {
        const r = await api.timeline(pid, signal)
        setItems([...r.items].sort((a, b) => b.ts - a.ts))
        setUnavailable(false)
        setError(null)
      } catch (e) {
        if (signal?.aborted) return
        if (isNotImplemented(e)) setUnavailable(true)
        else setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!signal?.aborted) setRefreshing(false)
      }
    },
    [pid],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  const refresh = () => {
    setRefreshing(true)
    setError(null)
    void load()
  }
  const loading = items === null && !error && !unavailable

  const submit = async () => {
    const body = (note ?? '').trim()
    if (!pid || !body) return
    setBusy(true)
    try {
      const ev = await api.addNote(pid, { body })
      setItems((prev) => [ev, ...(prev ?? [])])
      setTimelineNote(null)
      toast('备注已添加', 'success')
    } catch (e) {
      if (isNotImplemented(e)) setUnavailable(true)
      else toast(`添加备注失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const btnSize = desktop ? 'sm' : 'xl'

  if (unavailable) {
    return (
      <div data-slot="CaseTimelinePanel" data-testid="timeline-panel" className={cn('flex h-full min-h-0 flex-col', className)}>
        <EmptyState
          size="sm"
          icon={History}
          title={NOT_IMPLEMENTED_TITLE}
          reason="案件时间线与备注由 share-confirm-backend 单元实现（接口返回 501）。"
          data-testid="timeline-unavailable"
        />
      </div>
    )
  }

  return (
    <div data-slot="CaseTimelinePanel" data-testid="timeline-panel" className={cn('flex h-full min-h-0 flex-col text-sm', className)}>
      <div className={cn('flex shrink-0 items-center justify-between gap-2 border-b border-border px-3', desktop ? 'h-md-control' : 'min-h-touch')}>
        <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
          案件时间线
          {items && <Count value={items.length} size="sm" showZero />}
        </h3>
        <div className="flex items-center gap-1">
          <Button size={desktop ? 'icon-sm' : 'icon-xl'} variant="ghost" aria-label="刷新时间线" title="刷新时间线" disabled={loading || refreshing || !pid} onClick={refresh} data-testid="timeline-refresh">
            <RefreshCw aria-hidden className={loading || refreshing ? 'motion-safe:animate-spin' : undefined} />
          </Button>
          {authed && canNote && (
            <Button size={btnSize} variant="ghost" disabled={!pid || composing} onClick={() => setTimelineNote('')} data-testid="timeline-add-note">
              <MessageSquarePlus aria-hidden />
              添加备注
            </Button>
          )}
        </div>
      </div>

      {composing && (
        <form
          className="mx-3 my-2 space-y-2 rounded-md border border-border bg-sunken p-2"
          data-testid="timeline-note-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <MentionTextarea
            autoFocus
            rows={2}
            maxLength={NOTE_BODY_MAX}
            value={note ?? ''}
            onValueChange={setTimelineNote}
            aria-label="备注内容"
            placeholder="备注（@ 提及成员，Ctrl+Enter 提交）"
            data-testid="timeline-note-body"
            onSubmit={() => void submit()}
            onCancel={requestCancel}
          />
          <div className="flex justify-end gap-1">
            <Button type="button" size={btnSize} variant="ghost" onClick={requestCancel}>
              取消
            </Button>
            <Button type="submit" size={btnSize} disabled={busy || !(note ?? '').trim()} data-testid="timeline-note-submit">
              添加
            </Button>
          </div>
        </form>
      )}

      {error && (
        <Alert variant="danger" className="mx-3 my-2" data-testid="timeline-error">
          <AlertDescription>
            时间线加载失败：{error}
            <Button size="sm" variant="link" className="px-1 text-xs" onClick={refresh}>重试</Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2" tabIndex={0}>
        {loading && (
          <div className="space-y-2" data-testid="timeline-loading" aria-busy>
            <Skeleton className="h-row w-full" />
            <Skeleton className="h-row w-full" />
            <Skeleton className="h-row w-full" />
          </div>
        )}
        {items && items.length === 0 && (
          <EmptyState size="sm" icon={History} title="还没有事件" reason="建案、分享确认、递交、OA、期限与备注都会记录在这里。" data-testid="timeline-empty" />
        )}
        {items && items.length > 0 && (
          <ol className="relative ml-3 border-l border-border" aria-label="案件事件" data-testid="timeline-list">
            {items.map((ev) => {
              const k = TIMELINE_KIND[ev.kind]
              return (
                <li key={ev.id} className={cn('relative pb-4 pl-5 last:pb-0', !desktop && 'min-h-row-mobile')} data-testid="timeline-event" data-kind={ev.kind}>
                  <span className={cn('absolute -left-3 top-0 inline-flex size-6 items-center justify-center rounded-full ring-2 ring-panel', k.className)} aria-hidden>
                    <k.Icon className="size-3.5" />
                  </span>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs leading-6">
                    <span className="font-medium text-fg-strong">{k.label}</span>
                    {ev.actor && <span className="truncate text-fg-muted" title={ev.actor.display_name}>{ev.actor.display_name}</span>}
                    <time className="ml-auto text-2xs text-fg-subtle tabular-nums" dateTime={new Date(ev.ts * 1000).toISOString()}>{fmtMdTime(ev.ts)}</time>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-5 text-fg">
                    {splitMentions(ev.text, ev.mentions).map((seg, i) =>
                      seg.mention ? (
                        <span key={i} className="rounded-xs bg-info-bg px-0.5 font-medium text-info-fg" data-testid="timeline-mention">
                          {seg.text}
                        </span>
                      ) : (
                        <span key={i}>{seg.text}</span>
                      ),
                    )}
                  </p>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <DiscardDialog
        open={pendingCancel}
        onStay={() => setPendingCancel(false)}
        onDiscard={() => {
          setPendingCancel(false)
          setTimelineNote(null)
        }}
      />
    </div>
  )
}
