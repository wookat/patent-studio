import { useState, type ComponentProps, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { AccessReport, AccessRow, NotViewedRow } from '@/types/collab-center'
import { fmtSeen } from './format'
import { Avatar, EmptyLine, ErrorLine, SectionHint } from './shared'

/**
 * 访问记录段（W6 05 §3.9 / §3.16 时间线；腾讯文档「浏览记录」已查看 / 未查看两 tab）：
 * 已查看 = 时间线（--ok-dot 点 / 头像 + 在线点 / 姓名 · 角色 / 最近 · 次数）；未查看 = 灰点 + 半透明头像 + 「经成员·链接·邀请」outline 徽章。
 * 已看 / 未看只用 tokens 状态色（ok / neutral）且永远带文字。501（B1-access-log 未就绪）时显示提示，不弹 toast。
 */
export interface AccessSectionProps {
  access: AccessReport | null
  loading: boolean
  unavailable: boolean
  /** 读失败（非 501）：错误行 + 重试 */
  error?: string | null
  onRetry?: () => void
}

const VIA_LABEL: Record<NotViewedRow['via'], string> = { member: '成员', link: '链接', invite: '邀请' }

type Sub = 'viewed' | 'not_viewed'

export function AccessSection({ access, loading, unavailable, error = null, onRetry }: AccessSectionProps) {
  const [sub, setSub] = useState<Sub>('viewed')
  const viewed = access?.viewed ?? []
  const notViewed = access?.not_viewed ?? []

  if (unavailable) {
    return (
      <div className="flex flex-col gap-2 p-3 text-sm" data-slot="AccessSection" data-testid="collab-access">
        <SectionHint testId="collab-access-unavailable">访问记录（B1-access-log）尚未实现。</SectionHint>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 text-sm" data-slot="AccessSection" data-testid="collab-access">
      {error && onRetry ? (
        <ErrorLine label="访问记录加载失败" error={error} onRetry={onRetry} testId="collab-access-error" />
      ) : (
      <Tabs value={sub} onValueChange={(v) => setSub(v as Sub)}>
        <TabsList variant="pill" className="grid w-full grid-cols-2" aria-label="访问记录分组">
          <TabsTrigger value="viewed" data-testid="collab-access-tab-viewed">
            已查看 <span className="tabular-nums text-fg-muted">{viewed.length}</span>
          </TabsTrigger>
          <TabsTrigger value="not_viewed" data-testid="collab-access-tab-not-viewed">
            未查看 <span className="tabular-nums text-fg-muted">{notViewed.length}</span>
          </TabsTrigger>
        </TabsList>
        {loading && !access ? (
          <div className="flex flex-col gap-2 py-3" role="status" aria-label="加载中" data-testid="collab-access-loading">
            <span className="sr-only">加载中…</span>
            <Skeleton className="h-md-control" />
            <Skeleton className="h-md-control" />
            <Skeleton className="h-md-control" />
          </div>
        ) : (
          <>
            <TabsContent value="viewed" data-testid="collab-access-viewed">
              {viewed.length === 0 ? (
                <EmptyLine testId="collab-access-viewed-empty">还没有人打开过本案。</EmptyLine>
              ) : (
                <ol className="mt-2 flex flex-col" aria-label="已查看">
                  {viewed.map((r, i) => <ViewedRow key={r.user.user_id} row={r} last={i === viewed.length - 1} />)}
                </ol>
              )}
            </TabsContent>
            <TabsContent value="not_viewed" data-testid="collab-access-not-viewed">
              {notViewed.length === 0 ? (
                <EmptyLine testId="collab-access-not-viewed-empty">所有有权访问的人都已查看。</EmptyLine>
              ) : (
                <ol className="mt-2 flex flex-col" aria-label="未查看">
                  {notViewed.map((r, i) => <NotViewedItem key={`${r.via}:${r.user?.user_id ?? r.email}`} row={r} last={i === notViewed.length - 1} />)}
                </ol>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
      )}
    </div>
  )
}

/** 时间线一格：左列 8px 点 + 竖线（最后一格不画线），右侧内容行 ≥40 */
function TimelineItem({ tone, last, children, ...props }: { tone: 'ok' | 'neutral'; last: boolean; children: ReactNode } & ComponentProps<'li'>) {
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0" data-tone={tone} {...props}>
      <span className="flex w-2 shrink-0 flex-col items-center pt-2" aria-hidden>
        <span className={cn('size-2 shrink-0 rounded-full', tone === 'ok' ? 'bg-ok-dot' : 'bg-border-strong')} />
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </span>
      <div className="flex min-h-md-control min-w-0 flex-1 items-center gap-2">{children}</div>
    </li>
  )
}

function ViewedRow({ row, last }: { row: AccessRow; last: boolean }) {
  const name = row.user.display_name || row.user.email
  return (
    <TimelineItem tone="ok" last={last} data-testid="collab-access-row" data-user={row.user.user_id} data-online={row.online}>
      <Avatar name={name} user={row.user} online={row.online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm text-fg-strong" title={name}>
          <span className="truncate">{name}</span>
          <span className="sr-only">{row.online ? '在线' : '离线'}</span>
        </div>
        <div className="truncate text-xs text-fg-muted" title={`${row.user.role ? ROLE_LABEL[row.user.role] : '已移出'} · 最近 ${fmtSeen(row.last_seen)}`}>
          {row.user.role ? ROLE_LABEL[row.user.role] : '已移出'} · 最近 {fmtSeen(row.last_seen)}
        </div>
      </div>
      <Badge tone="ok" className="shrink-0" aria-label={`已查看，打开 ${row.count} 次`}>
        已看 <span className="tabular-nums">{row.count}</span> 次
      </Badge>
    </TimelineItem>
  )
}

function NotViewedItem({ row, last }: { row: NotViewedRow; last: boolean }) {
  const name = row.user?.display_name || row.email
  return (
    <TimelineItem tone="neutral" last={last} data-testid="collab-access-not-viewed-row" data-via={row.via}>
      <Avatar name={name} user={row.user} dimmed />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-fg" title={name}>{name}</div>
        <div className="truncate text-xs text-fg-muted" title={row.user && row.user.email !== name ? row.user.email : '未查看'}>
          {row.user && row.user.email !== name ? row.user.email : '未查看'}
        </div>
      </div>
      <Badge tone="outline" className="shrink-0 text-fg-muted">经{VIA_LABEL[row.via]}</Badge>
    </TimelineItem>
  )
}
