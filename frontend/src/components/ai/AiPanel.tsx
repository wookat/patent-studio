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
import { cn } from '@/lib/utils'
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
  const loadAiStatus = useStudio((s) => s.loadAiStatus)
  const loadJobs = useStudio((s) => s.loadJobs)
  const loadAgent = useStudio((s) => s.loadAgent)
  const runningJobs = useStudio(selectAiRunning)
  const authStatus = useStudio((s) => s.authStatus)
  const tab = useStudio((s) => s.agentTab)
  const setTab = useStudio((s) => s.setAgentTab)
  const pendingCount = useStudio((s) => s.proposals.filter((p) => p.state === 'pending').length + s.suggestions.length)
  const liveJobs = useStudio((s) => s.agentJobs.filter((j) => j.status === 'queued' || j.status === 'running').length)
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

      {orgDisabled ? (
        <EmptyState
          size="sm"
          icon={ShieldOff}
          title="机构已禁用 AI"
          reason="本机构管理员关闭了 AI 智能体；如需启用，请联系机构管理员在「机构管理 › AI」中开启。"
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
        {REWRITE_ACTIONS.map((a) => (
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
