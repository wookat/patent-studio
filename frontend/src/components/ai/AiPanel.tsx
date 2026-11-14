import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ClipboardCheck, History, Inbox, LayoutGrid, Loader2, MessageSquare, ShieldOff, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Count } from '@/components/ui/count'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api'
import { BOOK_LABELS } from '@/lib/docset'
import type { ChatScope } from '@/lib/types'
import { FOCUS_RING, cn } from '@/lib/utils'
import { DESKTOP_QUERY, selectAiEnabled, selectAiRunning, selectReadonly, useStudio } from '@/store'
import type { AgentTab } from '@/store/agent'
import { useMediaQuery } from '@/hooks/useMisc'
import type { RewriteAction } from '@/types/ai'
import { AiChat } from './AiChat'
import { AiJobList } from './AiJobs'
import { AiJobsTab } from './AiJobsTab'
import { AiProposals } from './AiProposals'
import { AiScenarios } from './AiScenarios'
import { REWRITE_ACTIONS, applySuggestion, gotoReview, runRewrite, selectionLabel, useLastSelection } from './aiModel'
import { AI_RUNTIME_DOT, useAiRuntime } from './aiRuntime'

/** Tab 顺序按 05 §S6：建议 · 对话 · 任务 · 场景（默认仍取 store.agentTab） */
const TABS: { id: AgentTab; label: string; Icon: typeof MessageSquare }[] = [
  { id: 'proposals', label: '建议', Icon: Inbox },
  { id: 'chat', label: '对话', Icon: MessageSquare },
  { id: 'jobs', label: '任务', Icon: History },
  { id: 'scenarios', label: '场景', Icon: LayoutGrid },
]

/**
 * AI 智能体面板（伴随栏 `id=ai` 正文；Rail「AI」/ 移动 AI Tab / NavDrawer 复用同一组件；05 §S6 / §3.11）。
 * 结构：运行态行（12px 常驻说明「接受只写入建议，不直接改源码」+ 运行态圆点，mock 与真模型同形态）→ 运维信息折叠「详情」
 * → `Tabs` 下划线式 建议 `Count` · 对话 · 任务 · 场景 → 各 tab 内容滚动；面板内无 primary（soft / secondary / ghost）。
 * 功能与 W5 一致：案级「允许外发」开关（settings.ai_enabled，默认关，关闭时零网络请求）；机构禁用 → 整面板 EmptyState；
 * 所有 AI 改动以 CriticMarkup 建议 / 批注 / 待确认补丁呈现，不静默改写源码。
 */
export function AiPanel() {
  const pid = useStudio((s) => s.pid)
  const enabled = useStudio(selectAiEnabled)
  const readonly = useStudio(selectReadonly)
  const settings = useStudio((s) => s.settings)
  const setAiEnabled = useStudio((s) => s.setAiEnabled)
  const status = useStudio((s) => s.aiStatus)
  const statusLoading = useStudio((s) => s.aiStatusLoading)
  const unavailable = useStudio((s) => s.aiUnavailable)
  const orgDisabled = useStudio((s) => s.agentDisabledByOrg)
  const caseCtx = useStudio((s) => s.caseContext)
  const authStatus = useStudio((s) => s.authStatus)
  /* P03：真实就绪 = 本案绑定态。AUTH=on 时 denied/ambiguous 服务端必 403；bound 且机构策略关 → 禁用。
     不能靠 /ai/status 的全局闸门假绿。unbound/unavailable（本地或未映射）不落此判定，服务端仍为最终门。 */
  const bindingBlocked = !!pid && caseCtx?.pid === pid && (
    caseCtx.binding === 'denied' || caseCtx.binding === 'ambiguous' ||
    (caseCtx.binding === 'bound' && caseCtx.egress_policy?.ai_egress === false) ||
    // 复核10：AUTH=on 下 binding=unavailable（PG 未配置/无平台身份）后端必 403——不误装绿灯；
    // bound 但机构非 active（suspended/archived）同样 fail-closed。AUTH=off 本地模式（auth==='off'）豁免。
    (caseCtx.auth === 'on' && caseCtx.binding === 'unavailable') ||
    (caseCtx.binding === 'bound' && !!caseCtx.organization && caseCtx.organization.status !== 'active')
  )
  // 复核10：已认证会话 + 有案卷但上下文未取回（加载中/失败）——不是「已核验」，如实标核验中
  const ctxPending = !!pid && authStatus === 'authed' && (!caseCtx || caseCtx.pid !== pid)
  const loadAiStatus = useStudio((s) => s.loadAiStatus)
  const loadJobs = useStudio((s) => s.loadJobs)
  const loadAgent = useStudio((s) => s.loadAgent)
  const runningJobs = useStudio(selectAiRunning)
  const tab = useStudio((s) => s.agentTab)
  const setTab = useStudio((s) => s.setAgentTab)
  const pendingCount = useStudio((s) => s.proposals.filter((p) => p.state === 'pending').length + s.suggestions.length)
  const liveJobs = useStudio((s) => s.agentJobs.filter((j) => j.status === 'queued' || j.status === 'running').length)
  const resumableJobs = useStudio((s) => s.agentJobs.filter((j) => j.status === 'interrupted').length)
  const pendingConfirms = useStudio((s) => s.chat.filter((m) => m.confirm && !m.confirm.decision).length)
  const aiScope = useStudio((s) => s.aiScope)
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [usage, setUsage] = useState<{ calls: number; tokens: number } | null>(null)

  // 每次挂载最多自动探测一次：探测失败（网络错 / 非 501）不重试，避免 status 仍为 null 时反复请求
  const probed = useRef(false)
  useEffect(() => {
    if (probed.current || status || unavailable || statusLoading) return
    probed.current = true
    void loadAiStatus()
  }, [status, unavailable, statusLoading, loadAiStatus])

  // 开启且接入层可用时才拉任务 / 建议 / 用量（关闭态零请求）；用量在后台任务数变化时刷新
  useEffect(() => {
    if (pid && enabled && !unavailable) {
      void loadJobs(pid)
      void loadAgent(pid)
    }
  }, [pid, enabled, unavailable, loadJobs, loadAgent])
  useEffect(() => {
    if (!pid || !enabled || unavailable) return
    let cancelled = false
    api
      .aiUsage(pid)
      .then((r) => {
        if (cancelled) return
        // 全量口径用后端 total（rows 只含最近 limit 条——截窗求和在 >limit 记录的案卷上偏少）
        setUsage({ calls: r.total.requests, tokens: r.total.prompt_tokens + r.total.completion_tokens })
      })
      .catch((e: unknown) => {
        if (!cancelled && !(e instanceof ApiError && e.status === 501)) setUsage(null)
      })
    return () => {
      cancelled = true
    }
  }, [pid, enabled, unavailable, runningJobs])

  const canAct = enabled && !unavailable && !!pid
  const rt = useAiRuntime()


  return (
    <div data-slot="AiPanel" data-testid="ai-panel" data-enabled={enabled} data-tab={tab} className="flex h-full min-h-0 flex-col text-sm">
      {/* 运行态行 + 常驻说明（12） */}
      <div className="flex shrink-0 flex-col gap-1 pb-2" data-testid="ai-status">
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-fg" data-testid="ai-status-enabled" data-tone={rt.tone}>
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', AI_RUNTIME_DOT[rt.tone], rt.tone === 'info' && 'motion-safe:animate-pulse')} />
            <span className="truncate" data-testid="ai-enabled-badge">{rt.label}</span>
            {status && <span className="truncate text-2xs text-fg-muted" data-testid="ai-reachable-badge">{rt.suffix}</span>}
          </span>
          <label className={cn('ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5', !desktop && 'min-h-touch pl-2')} data-testid="ai-enabled-row">
            <span className="text-2xs text-fg-muted">外发</span>
            <Switch checked={enabled} onCheckedChange={setAiEnabled} disabled={!pid || !settings || readonly} aria-label="允许把本案内容发送到 AI 中转站" data-testid="ai-enabled-switch" />
          </label>
        </div>
        <p className="text-xs text-fg-muted" data-testid="ai-accept-note">
          接受只写入建议，不直接改源码 — 所有 AI 改动以 CriticMarkup 建议或批注呈现，由你接受或拒绝。
        </p>
        {pid && (
          <OverviewStrip
            desktop={desktop}
            scope={aiScope}
            running={liveJobs}
            resumableJobs={resumableJobs}
            pending={pendingCount}
            pendingConfirms={pendingConfirms}
            onGo={setTab}
          />
        )}
        <Collapsible>
          <CollapsibleTrigger className={cn('inline-flex items-center gap-1 rounded-xs text-2xs text-fg-subtle hover:text-fg [&[aria-expanded=true]>svg]:rotate-180', desktop ? 'h-xs-control' : 'min-h-touch min-w-touch px-2')} data-testid="ai-details-toggle">
            <ChevronDown className="size-3 transition-transform duration-(--dur-fast)" aria-hidden />
            详情
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-sm bg-sunken px-2 py-1.5 text-2xs text-fg-muted" data-testid="ai-details">
              <dt>供应商</dt>
              <dd data-testid="ai-provider">
                {unavailable ? '接入层尚未落地（501）' : statusLoading && !status ? '…' : status ? `${status.provider}${status.key_present ? '' : '（未配置 key）'}` : '未知'}
                {status?.error && <span className="ml-1 text-danger-fg">{status.error}</span>}
              </dd>
              <dt>模型</dt>
              <dd className="break-all font-mono" data-testid="ai-models">
                {status ? `${status.models.interactive} / ${status.models.heavy} → 兜底 ${status.models.fallback}` : '—'}
              </dd>
              <dt>可达</dt>
              <dd>{status ? (status.reachable === true ? '中转站可达' : status.reachable === false ? '中转站不可达' : '未探测') : '—'}</dd>
              {enabled && usage && (
                <>
                  <dt>本案用量</dt>
                  <dd className="font-mono" data-testid="ai-usage">
                    {usage.calls} 次 · {usage.tokens} token
                  </dd>
                </>
              )}
              {authStatus === 'authed' && (
                <>
                  <dt>开关</dt>
                  <dd>保存在案卷设置（studio.json），需要编辑权限</dd>
                </>
              )}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {ctxPending ? (
        <EmptyState
          size="sm"
          icon={Loader2}
          title="正在核验本案授权"
          reason="案卷上下文加载中或加载失败——绑定机构/外发策略核验完成前不假定可用。"
          className="my-auto"
          data-testid="ai-ctx-pending"
          action={
            <Button size="sm" variant="outline" onClick={() => useStudio.getState().loadCaseContext()} data-testid="ai-ctx-retry">
              重试
            </Button>
          }
        />
      ) : orgDisabled || bindingBlocked ? (
        <EmptyState
          size="sm"
          icon={ShieldOff}
          title={
            caseCtx?.binding === 'bound' && caseCtx.egress_policy?.ai_egress === false ? '机构已撤销本案 AI 外发' :
            caseCtx?.binding === 'bound' && caseCtx.organization?.status !== 'active' ? '机构已停用' :
            caseCtx?.binding === 'unavailable' ? '平台绑定不可用' :
            '机构已禁用 AI'
          }
          reason={
            caseCtx?.binding === 'denied' ? '你对本案绑定的平台机构没有访问权限，服务端会拒绝（403）。' :
            caseCtx?.binding === 'ambiguous' ? '本案案号在多个机构下命中，未唯一绑定——服务端 fail-closed 拒绝 AI 外发。' :
            caseCtx?.binding === 'unavailable' ? 'AUTH=on 但平台绑定解析不可用（PG 未配置或身份异常），服务端会拒绝——稍后重试或检查部署配置。' :
            caseCtx?.binding === 'bound' && caseCtx.organization && caseCtx.organization.status !== 'active' ? `机构状态为 ${caseCtx.organization.status}，服务端 fail-closed 拒绝 AI 外发。` :
            '本机构管理员关闭了 AI 智能体；如需启用，请联系机构管理员在「机构管理 › AI」中开启。'
          }
          className="my-auto"
          data-testid="ai-org-disabled"
        />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as AgentTab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList aria-label="AI 智能体" size="md" className="shrink-0 px-0">
            {TABS.map((t) => {
              const n = t.id === 'proposals' ? pendingCount : t.id === 'jobs' ? liveJobs : 0
              return (
                <TabsTrigger key={t.id} value={t.id} className="flex-1 px-1.5 text-sm" data-testid={`ai-tab-${t.id}`}>
                  <t.Icon aria-hidden className="shrink-0" />
                  <span className="truncate">{t.label}</span>
                  {n > 0 && <Count value={n} tone={t.id === 'jobs' ? 'brand' : 'neutral'} aria-label={`${n} 条`} data-testid={`ai-tab-${t.id}-badge`} />}
                </TabsTrigger>
              )
            })}
          </TabsList>

          {/* 批71：四页签 forceMount——切页签不再卸载各自实例，保住 AiChat 滚动/开关、场景参数、建议折叠、任务滚动位（草稿文本另经 aiChatDraft store 保命） */}
          <TabsContent value="chat" forceMount className="flex min-h-0 flex-1 flex-col gap-2 pt-2" data-testid="ai-tabpanel-chat">
            {!enabled ? (
              <DisabledNotice pid={pid} hasSettings={!!settings} readonly={readonly} onEnable={() => setAiEnabled(true)} />
            ) : unavailable ? (
              <p className="rounded-sm border border-dashed border-border px-3 py-2 text-center text-xs text-fg-muted" data-testid="ai-placeholder">
                AI 接入层尚未落地（501），对话与改写暂不可用。
              </p>
            ) : null}
            <QuickActions canAct={canAct} runningJobs={runningJobs} />
            <AiChat enabled={canAct} compact={!desktop} />
          </TabsContent>
          <TabsContent value="scenarios" forceMount className="min-h-0 flex-1 overflow-y-auto pt-2" data-testid="ai-tabpanel-scenarios">
            <AiScenarios pid={pid} enabled={enabled} compact={!desktop} />
          </TabsContent>
          <TabsContent value="proposals" forceMount className="min-h-0 flex-1 overflow-y-auto pt-2" data-testid="ai-tabpanel-proposals">
            {!enabled ? (
              <EmptyState size="sm" icon={Inbox} title="AI 外发未开启" reason="开启本案 AI 外发后，AI 建议会出现在这里。" action={<EnableButton pid={pid} hasSettings={!!settings} readonly={readonly} onEnable={() => setAiEnabled(true)} />} />
            ) : (
              <AiProposals pid={pid} compact={!desktop} canAct={canAct && !readonly} />
            )}
          </TabsContent>
          <TabsContent value="jobs" forceMount className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-2" data-testid="ai-tabpanel-jobs">
            {!enabled ? (
              <EmptyState size="sm" icon={History} title="AI 外发未开启" reason="开启本案 AI 外发后，任务与用量会出现在这里。" action={<EnableButton pid={pid} hasSettings={!!settings} readonly={readonly} onEnable={() => setAiEnabled(true)} />} />
            ) : (
              <AiJobsTab pid={pid} compact={!desktop} />
            )}
            <AiJobList />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

/** P04/P07 紧凑可操作概览：当前范围 → 执行/待恢复任务 → 待人工决定；每段直达对应页签。
 *  移动端（非 desktop）待决定/待恢复排最前（375 首屏优先），触控 ≥44px（touchHit）。 */
function OverviewStrip({
  desktop,
  scope,
  running,
  resumableJobs,
  pending,
  pendingConfirms,
  onGo,
}: {
  desktop: boolean
  scope: ChatScope | null
  running: number
  resumableJobs: number
  pending: number
  pendingConfirms: number
  onGo: (t: AgentTab) => void
}) {
  const scopeLabel = (() => {
    const src = scope?.source
    const parts: string[] = []
    if (src?.full) parts.push('整卷')
    else if (src?.book) parts.push(BOOK_LABELS[src.book as keyof typeof BOOK_LABELS] ?? '当前书')
    else if (src?.lines) parts.push(`选区L${src.lines[0]}-${src.lines[1]}`)
    const m = scope?.materials?.length ?? 0
    if (m) parts.push(`${m}材料`)
    return parts.length ? parts.join('+') : '仅提问'
  })()
  // 复核9：两类入口分开——interrupted 任务续跑钮在「任务」页签；待决确认卡在「对话」页签。
  const decisions = pending + pendingConfirms
  const cells: { id: string; label: string; value: string; hint: string; tab: AgentTab; tone: 'warn' | 'brand' | 'default' }[] = [
    {
      id: 'pending',
      label: '待我决定',
      value: decisions > 0 ? `${decisions} 项` : '无',
      hint:
        pendingConfirms > 0 && pending > 0 ? `${pendingConfirms} 个确认卡在对话中等你裁决，另有 ${pending} 条建议` :
        pendingConfirms > 0 ? '有确认卡在对话中等你批准/拒绝' :
        pending > 0 ? '有建议/补丁等你接受或拒绝' : '无待决产出',
      tab: pendingConfirms > 0 ? 'chat' : 'proposals',
      tone: decisions > 0 ? 'warn' : 'default',
    },
    {
      id: 'tasks',
      label: '任务',
      value: running > 0 ? `${running} 进行中` : resumableJobs > 0 ? `${resumableJobs} 待恢复` : '空闲',
      hint: resumableJobs > 0 ? '有中断任务可在「任务与历史」续跑' : running > 0 ? '后台执行中' : '无进行中任务',
      tab: 'jobs',
      tone: running > 0 || resumableJobs > 0 ? 'brand' : 'default',
    },
    {
      id: 'scope',
      label: '本轮范围',
      value: scopeLabel,
      hint: '本论对话授权给 Agent 的上下文范围',
      tab: 'chat',
      tone: 'default',
    },
  ]
  const ordered = desktop ? [cells[2], cells[1], cells[0]] : cells
  return (
    <div
      role="group"
      aria-label="本轮协作概览：范围、任务、待决定"
      className="grid grid-cols-3 gap-1 rounded-md border border-border bg-sunken p-1"
      data-testid="ai-overview"
    >
      {ordered.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onGo(c.tab)}
          title={`${c.label}：${c.hint}（点击前往）`}
          className={cn(
            'flex min-w-0 flex-col items-start gap-0.5 rounded-sm px-2 py-1 text-left',
            'hover:bg-panel',
            FOCUS_RING,
            !desktop && 'min-h-touch',
          )}
          data-testid={`ai-overview-${c.id}`}
        >
          <span className="flex w-full items-center gap-1 text-2xs text-fg-muted">
            {c.tone !== 'default' && (
              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', c.tone === 'warn' ? 'bg-warn-dot' : 'bg-brand-500')} />
            )}
            {c.label}
          </span>
          <span className="w-full truncate text-xs font-medium text-fg-strong" data-testid={`ai-overview-${c.id}-value`}>
            {c.value}
          </span>
        </button>
      ))}
    </div>
  )
}

function EnableButton({ pid, hasSettings, readonly, onEnable }: { pid: string | null; hasSettings: boolean; readonly: boolean; onEnable: () => void }) {
  return (
    <Button size="sm" variant="soft" onClick={onEnable} disabled={!pid || !hasSettings || readonly} data-testid="ai-enable-button">
      <Sparkles /> 开启本案 AI 外发
    </Button>
  )
}

/** 关闭态说明（qa：关闭时零请求；只读用户不能开启） */
function DisabledNotice({ pid, hasSettings, readonly, onEnable }: { pid: string | null; hasSettings: boolean; readonly: boolean; onEnable: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-fg-muted" data-testid="ai-disabled-notice">
      <ShieldOff className="size-5 text-fg-icon" aria-hidden />
      <p>本案未允许外发。对话、选区润色 / 规范化 / 扩写 / 解释、场景与 AI 审阅都需要把案卷文本发送到 AI 中转站，开启前不会发出任何请求。</p>
      {readonly && <p data-testid="ai-enable-readonly">你对本案只有只读权限，不能开启外发。</p>}
      <EnableButton pid={pid} hasSettings={hasSettings} readonly={readonly} onEnable={onEnable} />
    </div>
  )
}

/**
 * 选区快捷动作（润色 / 规范化 / 扩写 / 解释 → CriticMarkup 建议；与 SelectionActionBar 同一 runRewrite）+ AI 审阅全文；
 * 桌面（≥md）：flex-wrap + flex-1 平分一行（与 W7 一致，硬规则桌面不变）；
 * 触控（<md）：sm chip 一行 ScrollRow（32 视觉 / touch-hit 44）不换行不拉伸，禁用态只变字色（--fg-disabled）不铺灰块；无 primary
 */
function QuickActions({ canAct, runningJobs }: { canAct: boolean; runningJobs: number }) {
  const startReview = useStudio((s) => s.startReview)
  const toast = useStudio((s) => s.toast)
  const setTab = useStudio((s) => s.setAgentTab)
  const sel = useLastSelection()
  const ast = useStudio((s) => s.ast)
  const where = sel ? selectionLabel(sel, ast, useStudio.getState().content) : null
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [busy, setBusy] = useState<RewriteAction | 'review' | null>(null)
  const chip = desktop ? 'flex-1' : 'rounded-full disabled:bg-transparent disabled:shadow-none'

  const quick = async (action: RewriteAction) => {
    if (!sel || busy) return
    setBusy(action)
    const before = useStudio.getState().suggestions.length
    const ok = await runRewrite(action, { lineStart: sel.lineStart, lineEnd: sel.lineEnd })
    setBusy(null)
    if (!ok || action === 'explain') return
    const sug = useStudio.getState().suggestions.at(-1)
    if (sug && useStudio.getState().suggestions.length > before) applySuggestion(sug)
    toast(`已把对${where}的建议作为修订写入正文，请在审阅面板接受或拒绝`, 'success')
    gotoReview()
  }

  const review = async () => {
    if (busy) return
    setBusy('review')
    const job = await startReview('all')
    setBusy(null)
    if (job) {
      toast('AI 审阅已在后台开始，完成后以批注线程（作者 AI）出现在审阅面板', 'info')
      setTab('jobs')
    }
  }

  return (
    <section aria-label="快捷动作" className="flex shrink-0 flex-col gap-1.5" data-testid="ai-quick-actions">
      <h3 className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
        快捷动作
        <span className="ml-1 font-normal normal-case tracking-normal">{where ? `对选区 · ${where}` : '在编辑器中选中文字后可用'}</span>
      </h3>
      <Row desktop={desktop}>
        {/* 无选区不摆一排禁用钮（T6）：选中文字后才出现 */}
        {sel && REWRITE_ACTIONS.map((a) => (
          <Button
            key={a.action}
            size="sm"
            variant="secondary"
            className={chip}
            disabled={!canAct || !sel || busy != null}
            aria-busy={busy === a.action || undefined}
            title={a.hint}
            onClick={() => void quick(a.action)}
            data-testid={`ai-quick-${a.action}`}
          >
            {busy === a.action ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {a.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="soft"
          className={chip}
          disabled={!canAct || busy != null || runningJobs > 0}
          aria-busy={busy === 'review' || undefined}
          title="审阅在后台运行（较慢模型），结果以批注线程（作者 AI）落到审阅面板，不改源码"
          onClick={() => void review()}
          data-testid="ai-review-button"
        >
          {busy === 'review' ? <Loader2 className="animate-spin" aria-hidden /> : <ClipboardCheck />}
          审阅全文{runningJobs > 0 ? '（进行中）' : ''}
        </Button>
      </Row>
    </section>
  )
}

function Row({ desktop, children }: { desktop: boolean; children: ReactNode }) {
  if (desktop) {
    return (
      <div role="group" aria-label="快捷动作" className="flex flex-wrap gap-1" data-testid="ai-quick-row">
        {children}
      </div>
    )
  }
  return (
    <ScrollRow role="group" aria-label="快捷动作" bleed={false} className="px-0" data-testid="ai-quick-row">
      {children}
    </ScrollRow>
  )
}
