import { AlertTriangle, Check, Copy, KeyRound, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtRelativeIso } from '@/lib/format'
import { useIsDesktop, useCopied } from '@/hooks/useMisc'
import type { AuditEntry, Pat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import { copyText } from '@/lib/download'

export interface IntegrationsPageProps {
  className?: string
}

const STDIO_CMD = 'uv run --project /ABS/PATH/patent-studio/backend python -m app.mcp'

function codexToml() {
  return [
    '[mcp_servers.patent-studio]',
    'command = "uv"',
    'args = ["run", "--project", "/ABS/PATH/patent-studio/backend", "python", "-m", "app.mcp"]',
    'env = { PATENT_PROJECTS_DIR = "/ABS/PATH/patent-studio/examples" }',
  ].join('\n')
}

function claudeCmd(httpUrl: string, token: string | null) {
  const lines = [`# 本机 stdio`, `claude mcp add patent-studio -- ${STDIO_CMD}`, `# 远程 HTTP（需 make dev）`]
  lines.push(
    token
      ? `claude mcp add --transport http patent-studio ${httpUrl} --header "Authorization: Bearer ${token}"`
      : `claude mcp add --transport http patent-studio ${httpUrl}`,
  )
  return lines.join('\n')
}


function argsSummary(args: Record<string, unknown>): string {
  const s = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

/** 复制到剪贴板，失败（非安全上下文 / 权限）时 toast 提示手动复制 */
function useCopy() {
  const toast = useStudio((s) => s.toast)
  const [copied, markCopied] = useCopied<string>()
  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      markCopied(key)
      toast('已复制', 'success')
    } else {
      toast('复制失败，请手动选择文本复制', 'error')
    }
  }
  return { copy, copied }
}

function Snippet({ id, title, code, copy, copied }: { id: string; title: ReactNode; code: string; copy: (k: string, t: string) => void; copied: string | null }) {
  return (
    <div className="min-w-0 rounded-sm border bg-panel" data-testid={`snippet-${id}`}>
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">{title}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-2 text-xs" onClick={() => copy(id, code)} aria-label={`复制 ${typeof title === 'string' ? title : id} 配置`} data-testid={`copy-${id}`}>
          {copied === id ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied === id ? '已复制' : '复制'}
        </Button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-2xs leading-5" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

/**
 * 「设置 › 集成」页（docs/plan/10 §3 / §7.1；GitHub PAT 一次性明文范式）：
 * MCP 接入方式 + 状态 · 个人访问令牌（AUTH=on：生成/一次性明文/撤销；off：说明只接受本机） · Codex / Claude Code 配置片段一键复制 · 当前案卷审计最近 50 条。
 * 375：令牌列表用卡片而非表格；片段横向可滚。
 */
export function IntegrationsPage({ className }: IntegrationsPageProps) {
  const pid = useStudio((s) => s.pid)
  const projectTitle = useStudio((s) => s.project?.title)
  const projectSettings = useStudio((s) => s.project?.settings)
  const saveSettings = useStudio((s) => s.saveSettings)
  const authStatus = useStudio((s) => s.authStatus)
  const pats = useStudio((s) => s.pats)
  const patsLoading = useStudio((s) => s.patsLoading)
  const patsUnavailable = useStudio((s) => s.patsUnavailable)
  const newPat = useStudio((s) => s.newPat)
  const loadPats = useStudio((s) => s.loadPats)
  const createPat = useStudio((s) => s.createPat)
  const revokePat = useStudio((s) => s.revokePat)
  const dismissNewPat = useStudio((s) => s.dismissNewPat)
  const toast = useStudio((s) => s.toast)
  const desktop = useIsDesktop()
  const { copy, copied } = useCopy()

  const [patName, setPatName] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const revokingRef = useRef(false)

  /* 审计日志走 TanStack Query：key=[pid,limit] 自带竞态最后发起者落地；扩窗时 placeholderData 保旧列不闪空 */
  const [auditLimit, setAuditLimit] = useState(50)
  const [limitPid, setLimitPid] = useState(pid)
  if (pid !== limitPid) { setLimitPid(pid); setAuditLimit(50) }

  /* 通知外发 webhook：案级 settings.notify_webhook_url 可配；发送测试走 POST /notify/test */
  const [webhookUrl, setWebhookUrl] = useState(projectSettings?.notify_webhook_url ?? '')
  const [webhookTest, setWebhookTest] = useState<{ ok: boolean; detail: string } | null>(null)
  const [webhookBusy, setWebhookBusy] = useState(false)
  useEffect(() => { setWebhookUrl(projectSettings?.notify_webhook_url ?? '') }, [pid, projectSettings?.notify_webhook_url])
  const saveWebhook = () => {
    if (!projectSettings) return
    saveSettings({ ...projectSettings, notify_webhook_url: webhookUrl.trim() })
    toast('已保存 webhook 配置')
  }
  const testWebhook = async () => {
    if (!pid) return
    setWebhookBusy(true); setWebhookTest(null)
    try {
      setWebhookTest(await api.testWebhook(pid, webhookUrl.trim() || undefined))
    } catch (e) {
      setWebhookTest({ ok: false, detail: e instanceof Error ? e.message : String(e) })
    } finally { setWebhookBusy(false) }
  }
  const auditQ = useQuery({
    queryKey: ['mcpAudit', pid, auditLimit],
    queryFn: () => api.audit(pid!, auditLimit),
    enabled: !!pid,
    placeholderData: keepPreviousData,
  })
  const audit = auditQ.data ?? []
  const auditLoading = auditQ.isFetching
  const auditError = auditQ.error ? (auditQ.error instanceof Error ? auditQ.error.message : String(auditQ.error)) : null
  const auditHasMore = audit.length === auditLimit

  useEffect(() => { void loadPats() }, [loadPats])

  const httpUrl = `${window.location.origin}/mcp`
  const authOn = !patsUnavailable
  const token = newPat?.token ?? (authOn ? 'pat_…' : null)

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    const n = patName.trim()
    if (!n || creating) return
    setCreating(true)
    const p = await createPat(n)
    setCreating(false)
    if (p) setPatName('')
  }
  const revoke = async (p: Pat) => {
    if (revokingRef.current) return
    revokingRef.current = true
    setConfirmRevoke(null)
    try {
      await revokePat(p.id)
      toast(`已撤销令牌「${p.name}」`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '撤销失败', 'error')
    } finally {
      revokingRef.current = false
    }
  }

  const patRow = (p: Pat) => {
    const isNew = newPat?.id === p.id
    const confirming = confirmRevoke === p.id
    const revokeBtn = confirming ? (
      <span className="flex items-center gap-1 text-xs" role="group" aria-label={`确认撤销令牌 ${p.name}`}>
        <span className="text-danger-fg">撤销？</span>
        <Button variant="danger" size="sm" className="h-7 px-2 text-xs" onClick={() => void revoke(p)} data-testid={`pat-revoke-confirm-${p.id}`}>
          <Check className="size-3.5" aria-hidden /> 确认
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmRevoke(null)}>
          <X className="size-3.5" aria-hidden /> 取消
        </Button>
      </span>
    ) : (
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-fg-muted hover:text-danger-fg" onClick={() => setConfirmRevoke(p.id)} aria-label={`撤销令牌 ${p.name}`} data-testid={`pat-revoke-${p.id}`}>
        <Trash2 className="size-3.5" aria-hidden /> 撤销
      </Button>
    )
    return (
      <li key={p.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', isNew && 'bg-ok-bg')} data-testid="pat-row">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KeyRound className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span className="truncate font-medium" title={p.name}>{p.name}</span>
            <code className="shrink-0 rounded bg-sunken px-1 text-2xs text-fg-muted">{p.prefix}…</code>
          </div>
          <p className="pl-5.5 text-xs text-fg-muted">
            创建于 <time dateTime={p.created_at}>{fmtRelativeIso(p.created_at)}</time>
            <span className="px-1">·</span>
            {p.last_used_at ? <>最近使用 <time dateTime={p.last_used_at}>{fmtRelativeIso(p.last_used_at)}</time></> : '尚未使用'}
          </p>
        </div>
        {revokeBtn}
      </li>
    )
  }

  const auditRow = (a: AuditEntry, i: number) => {
    const ok = a.result === 'ok'
    return (
      <li key={`${a.ts}-${i}`} className={cn('px-3 py-1.5 text-xs', desktop ? 'grid grid-cols-[5.5rem_5rem_7rem_1fr_auto] items-center gap-2' : 'space-y-0.5')}>
        <time dateTime={a.ts} className="text-fg-muted tabular-nums">{fmtRelativeIso(a.ts)}</time>
        {desktop ? (
          <>
            <span className="truncate text-fg-muted" title={a.who}>{a.who}</span>
            <code className="truncate">{a.tool}</code>
            <span className="truncate font-mono text-fg-muted" title={argsSummary(a.args)}>{argsSummary(a.args)}</span>
            <Badge tone={ok ? 'ok' : 'danger'} className="h-5 px-1.5 text-2xs">{ok ? 'ok' : a.result.replace(/^error:/, '')}</Badge>
          </>
        ) : (
          <>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <code>{a.tool}</code>
              <span className="text-fg-muted">{a.who}</span>
              <Badge tone={ok ? 'ok' : 'danger'} className="h-5 px-1.5 text-2xs">{ok ? 'ok' : a.result.replace(/^error:/, '')}</Badge>
            </span>
            {Object.keys(a.args).length > 0 && <span className="block truncate font-mono text-fg-muted" title={argsSummary(a.args)}>{argsSummary(a.args)}</span>}
          </>
        )}
      </li>
    )
  }

  return (
    <section data-slot="IntegrationsPage" data-testid="settings-page-integrations" aria-label="集成" className={cn('min-w-0 space-y-5', className)}>
      <div>
        <h3 className="pb-1 pt-3 text-sm font-semibold">MCP · Codex / Claude Code 接入</h3>
        <p className="text-xs text-fg-muted">
          让 Codex、Claude Code 等智能体通过 MCP 读写案卷：改动默认以 CriticMarkup 建议写入，由你在审阅面板接受或拒绝；每次调用都记入审计日志。
        </p>
        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2" data-testid="mcp-status">
          <div className="rounded-sm border bg-panel px-3 py-2">
            <dt className="text-fg-muted">本机 stdio</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1">
              <code className="min-w-0 flex-1 truncate font-mono text-2xs">python -m app.mcp</code>
              <Badge tone="ok" className="h-5 shrink-0 px-1.5 text-2xs">无需令牌</Badge>
            </dd>
          </div>
          <div className="rounded-sm border bg-panel px-3 py-2">
            <dt className="text-fg-muted">远程 Streamable HTTP</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1">
              <code className="min-w-0 flex-1 truncate font-mono text-2xs" title={httpUrl}>{httpUrl}</code>
              <Badge tone={authOn ? 'warn' : 'neutral'} className="h-5 shrink-0 px-1.5 text-2xs">
                {authOn ? 'Bearer 令牌' : '仅本机'}
              </Badge>
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <div className="flex items-center gap-2 pb-1">
          <h4 className="text-xs font-semibold text-fg-muted">个人访问令牌</h4>
          {authOn && (
            <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={() => void loadPats()} disabled={patsLoading} aria-label="刷新令牌列表">
              <RefreshCw className={cn('size-3.5', patsLoading && 'animate-spin')} aria-hidden />
            </Button>
          )}
        </div>
        {patsUnavailable ? (
          <p className="rounded-sm border border-dashed px-3 py-2 text-xs text-fg-muted" data-testid="pat-unavailable">
            当前为单机模式（<code>PATENT_STUDIO_AUTH=off</code>）：MCP 的 HTTP 端点只接受本机连接，不需要令牌；开启账号（AUTH=on）后可在此生成绑定用户的令牌供远程使用。
          </p>
        ) : (
          <div className="space-y-2">
            {newPat && (
              <div role="status" className="rounded-sm border border-ok-dot/40 bg-ok-bg p-3 text-xs" data-testid="pat-new">
                <p className="flex items-start gap-1.5 font-medium">
                  <AlertTriangle className="mt-px size-3.5 shrink-0 text-warn-fg" aria-hidden />
                  令牌「{newPat.name}」已生成。明文只显示这一次——现在复制并妥善保存；关闭后无法再次查看。
                </p>
                <div className="mt-2 flex items-center gap-1 rounded border bg-panel px-2 py-1">
                  <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-2xs" data-testid="pat-token">{newPat.token}</code>
                  <Button variant="ghost" size="sm" className="h-6 shrink-0 gap-1 px-2 text-xs" onClick={() => copy('token', newPat.token)} data-testid="pat-token-copy">
                    {copied === 'token' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    {copied === 'token' ? '已复制' : '复制'}
                  </Button>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={dismissNewPat} data-testid="pat-new-dismiss">我已保存，关闭</Button>
                </div>
              </div>
            )}
            <form className="flex flex-wrap items-end gap-2 rounded-sm border bg-panel p-3" onSubmit={(e) => void onCreate(e)} aria-label="生成个人访问令牌" data-testid="pat-create-form">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="pat-name" className="text-xs">令牌名称</Label>
                <Input
                  id="pat-name"
                  value={patName}
                  onChange={(e) => setPatName(e.target.value)}
                  placeholder="如：Codex 笔记本"
                  className="h-8 text-sm"
                  maxLength={64}
                  disabled={authStatus === 'anon'}
                  data-testid="pat-name"
                />
              </div>
              <Button type="submit" size="sm" disabled={!patName.trim() || creating || authStatus === 'anon'} data-testid="pat-create">
                {creating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <KeyRound className="size-3.5" aria-hidden />}
                生成令牌
              </Button>
              {authStatus === 'anon' && <p className="w-full text-xs text-fg-muted">登录后才能生成绑定账号的令牌。</p>}
            </form>
            {pats.length === 0 ? (
              <p className="rounded-sm border border-dashed px-3 py-3 text-center text-xs text-fg-muted" data-testid="pat-list">
                {patsLoading ? '正在加载…' : '尚无令牌'}
              </p>
            ) : (
              <ul className="divide-y rounded-sm border text-sm" aria-label="令牌列表" data-testid="pat-list">
                {pats.map(patRow)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg-muted">通知外发 webhook</h4>
        <p className="text-xs text-fg-muted">
          催办、查新完成等站内通知同步 POST 到此地址（Server酱 / Bark / 企微 / 自建网关通用 JSON）。
          留空则回落环境变量 <code>PATENT_STUDIO_NOTIFY_WEBHOOK</code>，再回落服务端日志通道——通知永不丢。
        </p>
        <div className="flex flex-wrap items-end gap-2 rounded-sm border bg-panel p-3" data-testid="webhook-form">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="webhook-url" className="text-xs">Webhook URL</Label>
            <Input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://sctapi.ftqq.com/<key>.send 或自建网关地址"
              className="h-8 font-mono text-xs"
              data-testid="webhook-url-input"
            />
          </div>
          <Button size="sm" className="h-8 px-3 text-xs" onClick={saveWebhook} disabled={!projectSettings} data-testid="webhook-save">保存</Button>
          <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => void testWebhook()} disabled={webhookBusy || !pid} loading={webhookBusy} loadingLabel="发送中" data-testid="webhook-test">
            发送测试
          </Button>
          {webhookTest && (
            <p className={cn('w-full text-xs', webhookTest.ok ? 'text-ok-fg' : 'text-danger-fg')} data-testid="webhook-test-result" role="status">
              {webhookTest.ok ? `测试成功：${webhookTest.detail}` : `测试失败：${webhookTest.detail}`}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg-muted">客户端配置</h4>
        <p className="text-xs text-fg-muted">把 <code>/ABS/PATH</code> 换成本机仓库路径；完整说明见 docs/mcp.md。</p>
        <Snippet id="codex" title="Codex · ~/.codex/config.toml" code={codexToml()} copy={copy} copied={copied} />
        <Snippet id="claude" title="Claude Code · 终端" code={claudeCmd(httpUrl, token)} copy={copy} copied={copied} />
      </div>

      <div>
        <div className="flex items-center gap-2 pb-1">
          <h4 className="min-w-0 truncate text-xs font-semibold text-fg-muted">审计日志{pid && projectTitle && ` · ${projectTitle}`}</h4>
          <span className="text-2xs text-fg-muted">{auditHasMore ? `最近 ${audit.length} 条` : `全部 ${audit.length} 条`}</span>
          <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={() => void auditQ.refetch()} disabled={!pid || auditLoading} aria-label="刷新审计日志" data-testid="audit-refresh">
            <RefreshCw className={cn('size-3.5', auditLoading && 'animate-spin')} aria-hidden />
          </Button>
        </div>
        {!pid ? (
          <p className="rounded-sm border border-dashed px-3 py-3 text-center text-xs text-fg-muted">打开案卷后显示该案的 MCP 调用记录。</p>
        ) : auditError ? (
          <p className="rounded-sm border border-danger-dot/50 px-3 py-3 text-center text-xs text-danger-fg" data-testid="audit-error">
            审计日志加载失败：{auditError}
            <Button size="xs" variant="link" className="px-1" onClick={() => void auditQ.refetch()}>重试</Button>
          </p>
        ) : audit.length === 0 ? (
          <p className="rounded-sm border border-dashed px-3 py-3 text-center text-xs text-fg-muted" data-testid="audit-empty">
            {auditLoading ? '正在加载…' : '尚无审计记录：智能体通过 MCP 操作本案后会出现在这里。'}
          </p>
        ) : (
          <>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-sm border" aria-label="审计日志" data-testid="audit-list">
              {audit.map(auditRow)}
            </ul>
            {auditHasMore && (
              <div className="mt-2 flex justify-center">
                <Button variant="secondary" size="xs" loading={auditLoading} loadingLabel="正在加载" onClick={() => setAuditLimit((l) => l + 50)} data-testid="audit-load-more">
                  加载更早记录
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
