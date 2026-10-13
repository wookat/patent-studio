import { useId, useState } from 'react'
import { Check, Copy, Eye, FileCheck2, Link2, MessageSquare, Trash2, TriangleAlert, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Heat } from '@/components/ui/heat'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { PublicShareBaseline, PublicShareLink, PublicShareLinkIn, PublicShareScope } from '@/types/public-share'
import { COPY_FAIL_MSG, PUBLIC_BASELINE_LABEL, PUBLIC_SCOPE_LABEL, PUBLIC_TTL_LABEL, daysLeftOf, fmtPublicExpiry, publicReviewUrl, publicTtlDays, type PublicTtl } from './format'
import { EmptyLine, ErrorLine, SectionHead, SectionHint } from './shared'
import { useCopied } from '@/hooks/useMisc'
import { copyText } from '@/lib/download'
import { NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'

/**
 * 客户审阅链接段（W6 05 §3.9 公开链接卡；21 §4.5 / §7.2 行 12；挂在协作者中心「链接」tab 的登录协作链接之下）：
 * 新建（权限 阅读 / 批注 / 确认 + 有效期 1 / 7 / 30 天 / 永久 + 是否允许下载，缺省不允许；secondary 按钮，无 primary）
 * / 链接卡 ×N（scope 语义 Badge · 到期 Heat · 访问 N 次 · 最近访问 · 创建人 · 复制 `#/c/<token>` · 撤销）。
 * 已撤销 / 已过期卡降不透明度并去掉复制 / 撤销。501 ⇒ 「功能开发中」占位；列表错误 ⇒ 段内 alert。
 * 链接权限不会放宽案级协作设置（后端收紧），这里只按创建者意图选。
 * W9 domain-02：正文尚有未接受 / 拒绝的修订时（pendingRevisions > 0）表单顶部警告并露出「客户看到」基线选择，
 * 缺省 original（撰写人已定正文，后端 critic.resolve）；链接卡标出非缺省的 final。
 */
export interface PublicLinksSectionProps {
  links: PublicShareLink[]
  loading: boolean
  unavailable: boolean
  /** 列表拉取失败（非 501）：段内提示，不影响新建 */
  error?: string | null
  canManage: boolean
  /** 当前正文里未决修订数（ins / del / sub）；>0 时提示并可选基线 */
  pendingRevisions?: number
  /** 链接表读失败重试（重调 loadPublicLinks） */
  onRetry?: () => void
  onCreate: (body: PublicShareLinkIn) => Promise<PublicShareLink | null>
  onRevoke: (token: string) => void
}

const BASELINES: readonly PublicShareBaseline[] = ['original', 'final']

const SCOPES: readonly PublicShareScope[] = ['read', 'comment', 'confirm']
const SCOPE_ICON: Record<PublicShareScope, typeof Eye> = { read: Eye, comment: MessageSquare, confirm: FileCheck2 }
const SCOPE_TONE: Record<PublicShareScope, 'neutral' | 'info' | 'violet'> = { read: 'neutral', comment: 'info', confirm: 'violet' }

export function PublicLinksSection({ links, loading, unavailable, error = null, canManage, pendingRevisions = 0, onRetry, onCreate, onRevoke }: PublicLinksSectionProps) {
  const uid = useId()
  const toast = useStudio((s) => s.toast)
  const [scope, setScope] = useState<PublicShareScope>('confirm')
  const [baseline, setBaseline] = useState<PublicShareBaseline>('original')
  const [ttl, setTtl] = useState<PublicTtl>('7')
  const [download, setDownload] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, markCopied] = useCopied<string>()

  const copy = async (token: string) => {
    if (await copyText(publicReviewUrl(token))) {
      markCopied(token)
      toast('审阅链接已复制', 'success')
    } else toast(COPY_FAIL_MSG, 'error')
  }

  const create = async () => {
    setBusy(true)
    const body: PublicShareLinkIn = { scope, ttl_days: publicTtlDays(ttl), allow_download: download }
    if (pendingRevisions > 0) body.baseline = baseline
    const link = await onCreate(body)
    setBusy(false)
    if (link) {
      toast('审阅链接已生成', 'success')
      void copy(link.token)
    }
  }

  const active = links.filter((l) => !l.revoked)
  const visits = links.reduce((n, l) => n + l.visits, 0)

  return (
    <section className="flex flex-col gap-2 border-t border-border p-3 text-sm" aria-labelledby={`${uid}-h`} data-slot="PublicLinksSection" data-testid="collab-public-links">
      <SectionHead id={`${uid}-h`}>客户审阅链接</SectionHead>
      <p className="text-xs leading-5 text-fg-muted">客户免登录打开 PDF / 版面，可批注、确认定稿；不显示源码，下载按此处设置。</p>

      {unavailable ? (
        <SectionHint testId="collab-public-links-unavailable">{NOT_IMPLEMENTED_TITLE}：此部署尚未开放客户审阅链接。</SectionHint>
      ) : (
        <>
          {canManage && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-sunken p-2" data-testid="collab-public-link-form">
              {pendingRevisions > 0 && (
                <div className="flex flex-col gap-1.5 rounded-md bg-warn-bg px-2.5 py-2 text-xs text-warn-fg" role="status" data-testid="collab-public-link-pending">
                  <p className="flex items-start gap-1.5 leading-5">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                      正文还有 <span className="font-semibold tabular-nums" data-testid="collab-public-link-pending-count">{pendingRevisions}</span> 处修订尚未接受 / 拒绝；客户缺省只看您已定的正文，不会把待定建议当作定稿。
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`${uid}-baseline`} className="shrink-0 text-xs text-warn-fg">客户看到</Label>
                    <Select value={baseline} onValueChange={(v) => setBaseline(v as PublicShareBaseline)}>
                      <SelectTrigger id={`${uid}-baseline`} size="sm" className="flex-1 bg-panel" aria-label="客户看到哪份正文" data-testid="collab-public-link-baseline">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BASELINES.map((b) => (
                          <SelectItem key={b} value={b} data-testid={`collab-public-link-baseline-${b}`}>{PUBLIC_BASELINE_LABEL[b]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`${uid}-scope`} className="text-xs text-fg-muted">客户可以</Label>
                  <Select value={scope} onValueChange={(v) => setScope(v as PublicShareScope)}>
                    <SelectTrigger id={`${uid}-scope`} size="sm" aria-label="客户权限" data-testid="collab-public-link-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPES.map((s) => (
                        <SelectItem key={s} value={s} data-testid={`collab-public-link-scope-${s}`}>{PUBLIC_SCOPE_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`${uid}-ttl`} className="text-xs text-fg-muted">有效期</Label>
                  <Select value={ttl} onValueChange={(v) => setTtl(v as PublicTtl)}>
                    <SelectTrigger id={`${uid}-ttl`} size="sm" aria-label="有效期" data-testid="collab-public-link-ttl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PUBLIC_TTL_LABEL) as PublicTtl[]).map((k) => (
                        <SelectItem key={k} value={k} data-testid={`collab-public-link-ttl-${k}`}>{PUBLIC_TTL_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex min-h-sm-control flex-1 items-center gap-2 text-xs text-fg" htmlFor={`${uid}-download`}>
                  <Checkbox id={`${uid}-download`} checked={download} onCheckedChange={setDownload} data-testid="collab-public-link-download" />
                  允许客户下载 PDF
                </label>
                <Button type="button" variant="secondary" size="sm" className="shrink-0" loading={busy} onClick={() => void create()} data-testid="collab-public-link-create">
                  <Link2 aria-hidden />
                  生成审阅链接
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-fg-muted" data-testid="collab-public-links-summary">
            有效链接 <span className="tabular-nums text-fg">{active.length}</span> · 累计访问 <span className="tabular-nums text-fg">{visits}</span> 次
          </p>

          {error && (
            onRetry ? (
              <ErrorLine label="审阅链接列表加载失败" error={error} onRetry={onRetry} testId="collab-public-links-error" />
            ) : (
              <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger-fg" data-testid="collab-public-links-error">
                审阅链接列表加载失败：{error}
              </p>
            )
          )}
          {loading && links.length === 0 ? (
            <div className="flex flex-col gap-2" data-testid="collab-public-links-loading" role="status" aria-label="正在加载审阅链接">
              <Skeleton className="h-touch rounded-md" />
              <Skeleton className="h-touch rounded-md" />
            </div>
          ) : links.length === 0 ? (
            <EmptyLine testId="collab-public-links-empty">尚无客户审阅链接。</EmptyLine>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="客户审阅链接">
              {links.map((l) => (
                <PublicLinkCard key={l.token} link={l} canManage={canManage} copied={copied === l.token} onCopy={() => void copy(l.token)} onRevoke={() => onRevoke(l.token)} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

interface CardProps {
  link: PublicShareLink
  canManage: boolean
  copied: boolean
  onCopy: () => void
  onRevoke: () => void
}

/** 公开链接卡（05 §3.9）：头行 scope Badge + 可下载 + 到期 Heat；中行截断 URL；尾行访问统计 + 复制 / 撤销 */
function PublicLinkCard({ link: l, canManage, copied, onCopy, onRevoke }: CardProps) {
  const [confirming, setConfirming] = useState(false)
  const expiry = fmtPublicExpiry(l)
  const dead = l.revoked || expiry === '已过期'
  const daysLeft = daysLeftOf(l.expires_at)
  const Icon = SCOPE_ICON[l.scope]
  const url = publicReviewUrl(l.token)
  return (
    <li
      className={cn('flex flex-col gap-1.5 rounded-md border border-border bg-panel p-2.5', dead && 'bg-sunken opacity-70')}
      data-slot="PublicLinkCard"
      data-testid={`row-${l.token}`}
      data-token={l.token}
      data-scope={l.scope}
      data-revoked={l.revoked || undefined}
    >
      <div className="flex items-center gap-1.5">
        <Badge tone={l.revoked ? 'outline' : SCOPE_TONE[l.scope]}>
          <Icon aria-hidden />
          {PUBLIC_SCOPE_LABEL[l.scope]}
        </Badge>
        {l.allow_download && <Badge tone="info">可下载</Badge>}
        {l.baseline === 'final' && (
          <Badge tone="warn" title="链接生成时选了「含未决修订」：客户看到的是所有建议按接受后的正文" data-testid={`collab-public-link-baseline-${l.token}`}>
            含未决修订
          </Badge>
        )}
        <span className="min-w-0 flex-1" />
        {l.revoked ? (
          <Badge tone="neutral" data-testid={`collab-public-link-expiry-${l.token}`}>{expiry}</Badge>
        ) : expiry === '已过期' ? (
          <Badge tone="danger" data-testid={`collab-public-link-expiry-${l.token}`}>{expiry}</Badge>
        ) : daysLeft == null ? (
          <span className="text-xs text-fg-muted" data-testid={`collab-public-link-expiry-${l.token}`}>{expiry}</span>
        ) : (
          <Heat daysLeft={daysLeft} title={expiry} data-testid={`collab-public-link-expiry-${l.token}`}>
            {expiry}
          </Heat>
        )}
      </div>
      <code className="truncate font-mono text-xs text-fg-muted" title={url} aria-label="审阅链接地址">
        {url.replace(/^https?:\/\//, '')}
      </code>
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-fg-muted" data-testid={`collab-public-link-visits-${l.token}`}>
          访问 <span className="tabular-nums text-fg">{l.visits}</span> 次
          {l.last_visit_at ? <> · 最近 {fmtRelative(l.last_visit_at * 1000)}</> : ' · 尚未被打开'}
          {' · '}
          {l.created_by.display_name} 创建于 {fmtRelative(l.created_at * 1000)}
        </p>
        {!l.revoked && (
          <Button variant="ghost" size="xs" aria-label={copied ? '已复制' : '复制审阅链接'} onClick={onCopy} data-testid={`collab-public-link-copy-${l.token}`}>
            {copied ? <Check className="text-ok-fg" aria-hidden /> : <Copy aria-hidden />}
            {copied ? '已复制' : '复制'}
          </Button>
        )}
        {canManage && !l.revoked && (
          confirming ? (
            <span className="flex shrink-0 items-center gap-1" role="group" aria-label="确认撤销审阅链接">
              <span className="text-xs text-danger-fg">撤销？</span>
              <Button variant="danger" size="xs" onClick={() => { setConfirming(false); onRevoke() }} data-testid={`collab-public-link-revoke-confirm-${l.token}`}>
                确认
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="取消" onClick={() => setConfirming(false)} data-testid={`collab-public-link-revoke-cancel-${l.token}`}>
                <X aria-hidden />
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="icon-xs" className="text-fg-muted hover:text-danger-fg" aria-label="撤销审阅链接" title="撤销链接" onClick={() => setConfirming(true)} data-testid={`collab-public-link-revoke-${l.token}`}>
              <Trash2 aria-hidden />
            </Button>
          )
        )}
      </div>
    </li>
  )
}
