import { useEffect, useRef, useState } from 'react'
import { CalendarClock, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Heat, heatLabel } from '@/components/ui/heat'
import { Skeleton } from '@/components/ui/skeleton'
import { clearProjectQuery, goDeadlines, projectHash, readHashPid, readHashProjectQuery } from '@/lib/hash'
import { FOCUS_RING_INSET, TRANSITION_COLOR, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { DEADLINE_GROUPS, DEADLINE_GROUP_LABEL, selectDeadlineGroups } from '@/store/deadlines'
import { DEADLINE_KIND_LABEL } from '@/types/deadlines'
/** 伴随栏头部动作：跳 #/deadlines */
export function DeadlinesCompanionActions() {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="打开期限中心" title="打开期限中心" onClick={goDeadlines} data-testid="companion-deadlines-open">
      <ExternalLink aria-hidden />
    </Button>
  )
}

/**
 * 伴随栏「期限」正文（prep 契约 registerCompanionBody('deadlines')）：`#/p/<pid>?panel=deadlines` 时
 * 列出全机构未完成期限（逾期 / 今日 / 7 天 / 30 天 / 以后 分组，行 36），Heat 分桶同 store/deadlines；无 primary。
 */
export function DeadlinesCompanionBody() {
  const items = useStudio((s) => s.deadlines)
  const loading = useStudio((s) => s.deadlinesLoading)
  const unavailable = useStudio((s) => s.deadlinesUnavailable)
  const error = useStudio((s) => s.deadlinesError)
  const load = useStudio((s) => s.loadDeadlines)
  const toast = useStudio((s) => s.toast)
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (items.length === 0) void load()
  }, [items.length, load])
  // ?dl=<期限 id> 深链（期限/催办通知落点）：数据到位后滚到该行并短暂高亮，随即清掉一次性 query。
  // 期限 id 按规则键跨案撞名（oa_reply:<round> 各案同名）——定位须 pid+id 复合；dl 经 hashchange 跟
  // 踪，同一伴随栏内连点第二条通知也能触发。
  const [dl, setDl] = useState<string | null>(() => readHashProjectQuery().dl ?? null)
  useEffect(() => {
    const onHash = () => setDl(readHashProjectQuery().dl ?? null)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // 滚动/高亮定时器由 ref 持有：clearProjectQuery 的 hashchange 会 setDl(null) 令本 effect 重跑，
  // 若把定时器挂在 effect 清理里，dl 转正 cleanup 会杀掉尚未触发的滚动/闪烁（jsdom 同步派发 hashchange 实测可复现）。
  const flashTimer = useRef<number | null>(null)
  const dlRetry = useRef<string | null>(null)
  useEffect(() => {
    if (!dl || loading) return
    const key = `${readHashPid()}/${dl}`
    const el = document.querySelector(`[data-deadline-key="${CSS.escape(key)}"]`)
    if (!el) {
      /* 列表是挂载时快照——找不到先强刷一次再判；仍无 ⇒ 期限已完成/被删，
         与 ?c=「该批注不存在或已被删除」同契约（不再静默丢参数） */
      if (dlRetry.current !== key) {
        dlRetry.current = key
        void load()
        return
      }
      dlRetry.current = null
      clearProjectQuery()
      toast('该期限不存在或已完成', 'info')
      return
    }
    clearProjectQuery()
    flashTimer.current = window.setTimeout(() => {
      el.scrollIntoView({ block: 'center' })
      setFlashId(key)
    }, 0)
  }, [items, dl, loading, load, toast])
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    [],
  )
  useEffect(() => {
    if (flashId === null) return
    const t = window.setTimeout(() => setFlashId(null), 2400)
    return () => window.clearTimeout(t)
  }, [flashId])
  const groups = selectDeadlineGroups({ deadlines: items })

  if (unavailable) return <EmptyState size="sm" icon={CalendarClock} title={NOT_IMPLEMENTED_TITLE} reason="期限中心后端接口尚未上线。" />
  if (error && items.length === 0) return <EmptyState size="sm" icon={CalendarClock} title="期限加载失败" reason={error} action={<Button variant="secondary" size="sm" onClick={() => void load()}>重试</Button>} />
  if (loading && items.length === 0)
    return (
      <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="加载中">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-row-compact rounded-sm" />
        ))}
      </div>
    )
  const pending = DEADLINE_GROUPS.filter((g) => g !== 'done' && groups[g].length > 0)
  if (pending.length === 0) return <EmptyState size="sm" icon={CalendarClock} title="没有待办期限" reason="所有案卷期限均已完成。" />

  return (
    <div className="flex flex-col" data-testid="companion-deadlines">
      {pending.map((g) => (
        <section key={g} aria-label={DEADLINE_GROUP_LABEL[g]}>
          <h3 className="sticky top-0 z-sticky flex h-md-control items-center gap-2 border-b border-border bg-sunken px-3 text-xs font-medium text-fg-muted">
            {DEADLINE_GROUP_LABEL[g]}
            <Count value={groups[g].length} size="sm" showZero />
          </h3>
          <ul className="divide-y divide-border">
            {groups[g].map((d) => (
              <li key={`${d.pid}/${d.id}`}>
                <a
                  href={`#${projectHash(d.pid)}`}
                  data-deadline-key={`${d.pid}/${d.id}`}
                  aria-current={flashId === `${d.pid}/${d.id}` ? 'true' : undefined}
                  className={cn('flex min-h-row-compact items-center gap-2 px-3 py-1.5 hover:bg-hover', FOCUS_RING_INSET, TRANSITION_COLOR, flashId === `${d.pid}/${d.id}` && 'bg-selected/50 ring-1 ring-inset ring-primary/40')}
                  title={`${d.title} · ${DEADLINE_KIND_LABEL[d.kind]} · ${d.due}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm text-fg-strong" title={d.title}>{d.title}</span>
                    <span className="truncate text-xs text-fg-muted tabular-nums"
                      title={`${d.case_no ? `${d.case_no} · ` : ''}${DEADLINE_KIND_LABEL[d.kind]} · ${d.due}${d.source === 'manual' && d.override_reason ? `（改期：${d.override_reason}）` : ''}`}>
                      {d.case_no ? `${d.case_no} · ` : ''}
                      {DEADLINE_KIND_LABEL[d.kind]} · {d.due}
                    </span>
                  </span>
                  <Heat daysLeft={d.days_left} size="sm">
                    {heatLabel(d.days_left)}
                  </Heat>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
