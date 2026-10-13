import { useId, useState } from 'react'
import { Check, ChevronDown, Copy, Link2, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Heat } from '@/components/ui/heat'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ROLE_LABEL, type Role, type ShareLink } from '@/lib/types'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { ROLE_TONE } from './MembersSection'
import { RoleSelect } from './RoleSelect'
import { COPY_FAIL_MSG, EXPIRY_LABEL, SHARE_ROLES, daysLeftOf, expiryDays, fmtExpiry, fmtSeen, type Expiry, type ShareRole } from './format'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, EmptyLine, ErrorLine, SectionHead } from './shared'
import { useCopied } from '@/hooks/useMisc'
import { copyText } from '@/lib/download'

/**
 * 登录协作链接段（W6 05 §3.9；docs/plan/14 §6.2；Overleaf Link sharing 扩到四档 + 有效期）：
 * 新建（角色 Select + 有效期 Select + secondary「生成链接」）/ 链接卡 ×N（角色语义 Badge · 到期 Heat · 复制 / 撤销 · 展开「经此链接进入的人」= accepted_by）。
 * 复制成功 toast（§6.6）。
 */
export interface LinksSectionProps {
  pid: string
  links: ShareLink[]
  canManage: boolean
  /** 链接表读取中：无缓存数据时显骨架，压住「尚无分享链接」假空态闪烁 */
  loading?: boolean
  /** 链接表读失败（非 501）：错误行 + 重试 */
  error?: string | null
  onRetry?: () => void
  onCreate: (role: Exclude<Role, 'owner'>, expiresInDays: number | null) => void
  onRevoke: (token: string) => void
}

export function LinksSection({ links, canManage, loading = false, error = null, onRetry, onCreate, onRevoke }: LinksSectionProps) {
  const uid = useId()
  const toast = useStudio((s) => s.toast)
  const [role, setRole] = useState<ShareRole>('viewer')
  const [expiry, setExpiry] = useState<Expiry>('7')
  const [copied, markCopied] = useCopied<string>()

  const copy = async (l: ShareLink) => {
    if (await copyText(l.url)) {
      markCopied(l.token)
      toast('链接已复制', 'success')
    } else toast(COPY_FAIL_MSG, 'error')
  }

  return (
    <div className="flex flex-col gap-2 p-3 text-sm" data-slot="LinksSection" data-testid="collab-links">
      <SectionHead>登录协作链接</SectionHead>
      {canManage && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-sunken p-2" data-testid="collab-link-form">
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`${uid}-role`} className="text-xs text-fg-muted">角色</Label>
              <RoleSelect value={role} options={SHARE_ROLES} onChange={setRole} label="链接角色" id={`${uid}-role`} size="sm" testId="collab-link-role" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`${uid}-expiry`} className="text-xs text-fg-muted">有效期</Label>
              <Select value={expiry} onValueChange={(v) => setExpiry(v as Expiry)}>
                <SelectTrigger id={`${uid}-expiry`} size="sm" data-testid="collab-link-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EXPIRY_LABEL) as Expiry[]).map((k) => (
                    <SelectItem key={k} value={k}>{EXPIRY_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" className="self-end" onClick={() => onCreate(role, expiryDays(expiry))} data-testid="collab-link-create">
            <Link2 aria-hidden />
            生成链接
          </Button>
        </div>
      )}

      {error && onRetry && (/_501_|未开启|账号/.test(error)
        ? <EmptyLine testId="collab-links-unavailable">分享链接未开启（当前部署未开账号功能 / 返回 501）。</EmptyLine>
        : <ErrorLine label="链接列表加载失败" error={error} onRetry={onRetry} testId="collab-links-error" />)}

      {loading && !error && links.length === 0 ? (
        <div className="flex flex-col gap-2 py-1" role="status" aria-label="加载中" data-testid="collab-links-loading">
          <span className="sr-only">加载中…</span>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-md-control" />
          <Skeleton className="h-md-control" />
        </div>
      ) : (
        <>
          <p className="text-xs text-fg-muted" data-testid="collab-links-summary">
            链接 <span className="tabular-nums text-fg">{links.length}</span> · 经链接进入{' '}
            <span className="tabular-nums text-fg">{links.reduce((n, l) => n + (l.accepted_by?.length ?? 0), 0)}</span> 人
          </p>
          {links.length === 0 ? (
            !error && <EmptyLine testId="collab-links-empty">尚无分享链接。</EmptyLine>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="分享链接">
              {links.map((l) => (
                <LinkCard key={l.token} link={l} canManage={canManage} copied={copied === l.token} onCopy={() => void copy(l)} onRevoke={() => onRevoke(l.token)} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

interface LinkCardProps {
  link: ShareLink
  canManage: boolean
  copied: boolean
  onCopy: () => void
  onRevoke: () => void
}

function LinkCard({ link: l, canManage, copied, onCopy, onRevoke }: LinkCardProps) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const accepted = l.accepted_by ?? []
  const listId = `collab-link-accepted-${l.token}`
  const expiryText = fmtExpiry(l)
  const expired = expiryText === '已过期'
  const daysLeft = daysLeftOf(l.expires_at)
  return (
    <li
      className={cn('flex flex-col gap-1.5 rounded-md border border-border bg-panel p-2.5', expired && 'bg-sunken opacity-70')}
      title={l.url}
      data-slot="LinkCard"
      data-testid="collab-link-row"
      data-token={l.token}
      data-role={l.role}
    >
      <div className="flex items-center gap-1.5">
        <Badge tone={ROLE_TONE[l.role]}>{ROLE_LABEL[l.role]}</Badge>
        <span className="min-w-0 flex-1" />
        {expired ? (
          <Badge tone="danger">{expiryText}</Badge>
        ) : daysLeft == null ? (
          <span className="text-xs text-fg-muted">{expiryText}</span>
        ) : (
          <Heat daysLeft={daysLeft} title={expiryText}>{expiryText}</Heat>
        )}
        <Button variant="ghost" size="xs" aria-label={copied ? '已复制' : `复制 ${ROLE_LABEL[l.role]} 链接`} onClick={onCopy} data-testid={`collab-link-copy-${l.token}`}>
          {copied ? <Check className="text-ok-fg" aria-hidden /> : <Copy aria-hidden />}
          {copied ? '已复制' : '复制'}
        </Button>
        {canManage && (
          confirming ? (
            <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`确认撤销 ${ROLE_LABEL[l.role]} 链接`}>
              <span className="text-xs text-danger-fg">撤销？</span>
              <Button variant="danger" size="xs" onClick={() => { setConfirming(false); onRevoke() }} data-testid={`collab-link-revoke-confirm-${l.token}`}>
                确认
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="取消" onClick={() => setConfirming(false)} data-testid={`collab-link-revoke-cancel-${l.token}`}>
                <X aria-hidden />
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-fg-muted hover:text-danger-fg"
              aria-label={`撤销 ${ROLE_LABEL[l.role]} 链接`}
              title="撤销链接"
              onClick={() => setConfirming(true)}
              data-testid={`collab-link-revoke-${l.token}`}
            >
              <Trash2 aria-hidden />
            </Button>
          )
        )}
      </div>
      <code className="truncate font-mono text-xs text-fg-muted" aria-label="链接地址">{l.url.replace(/^https?:\/\//, '')}</code>
      {accepted.length === 0 ? (
        <span className="text-xs text-fg-muted" data-testid={`collab-link-accepted-none-${l.token}`}>尚无人经此链接进入</span>
      ) : (
        <>
          <button
            type="button"
            className={cn('inline-flex min-h-xs-control items-center gap-1 self-start rounded-sm text-xs text-fg-muted hover:text-fg', FOCUS_RING)}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            data-testid={`collab-link-accepted-toggle-${l.token}`}
          >
            <ChevronDown className={cn('size-3.5 transition-transform motion-reduce:transition-none', open ? 'rotate-0' : '-rotate-90')} aria-hidden />
            <span className="tabular-nums text-fg">{accepted.length}</span> 人经此链接进入
          </button>
          {open && (
            <ul id={listId} className="flex flex-col divide-y divide-border" aria-label="经此链接进入的人" data-testid={`collab-link-accepted-${l.token}`}>
              {accepted.map((a) => {
                const name = a.display_name || a.email
                return (
                  <li key={a.user_id} className="flex min-h-md-control items-center gap-2 text-xs">
                    <Avatar name={name} user={a} />
                    <span className="min-w-0 flex-1 truncate text-fg" title={name}>{name}</span>
                    <span className="shrink-0 text-fg-muted">{fmtSeen(a.accepted_at)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </li>
  )
}
