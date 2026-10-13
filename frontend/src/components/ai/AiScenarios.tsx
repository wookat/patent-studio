import { useMemo, useRef, useState } from 'react'
import { Ban, Construction, Play, ShieldOff, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ROLE_RANK, type Role } from '@/lib/types'
import { selectReadonly, useStudio } from '@/store'
import { SCENARIOS, type Scenario, type ScenarioInfo } from '@/types/agent'
import { OA_KIND_LABEL } from '@/types/oa'

type Params = Record<string, unknown>

const ROLE_LABEL: Record<ScenarioInfo['minRole'], string> = { viewer: '查看者', reviewer: '审阅者', editor: '编辑者' }
/** 项目角色未知（AUTH=off 或未返回）视为 editor：服务端仍独立 403 */
const selectProjectRole = (s: { project: { role?: Role | null } | null }): Role => s.project?.role ?? 'editor'

/**
 * 场景 tab（W5 §6.6 A2 / R-AI-07）：S1–S7、S9、S10 场景卡（S8 无合规检索源，不注册不展示）。
 * 每卡：标题 / 一句话说明 / 产出形态 / 参数表单 / 「运行」→ store.runScenario → api.agentRun；
 * 三种空态：机构禁用（403 ai_disabled_by_org）/ 案级关闭（settings.ai_enabled=false）/ 501 未落地 → EmptyState「功能开发中」。
 */
export function AiScenarios({ pid, enabled, compact }: { pid: string | null; enabled: boolean; compact: boolean }) {
  const unavailable = useStudio((s) => s.agentUnavailable)
  const disabledByOrg = useStudio((s) => s.agentDisabledByOrg)
  const budgetExceeded = useStudio((s) => s.agentBudgetExceeded)
  const setAiEnabled = useStudio((s) => s.setAiEnabled)
  const readonly = useStudio(selectReadonly)

  if (disabledByOrg) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="机构已禁用 AI"
        reason="本机构管理员关闭了 AI 功能，所有场景不可运行。如需启用，请联系机构管理员在「机构管理 → AI」中开启。"
        data-testid="ai-scenarios-disabled-org"
      />
    )
  }
  if (!enabled) {
    return (
      <EmptyState
        icon={Ban}
        title="本案未开启 AI 外发"
        reason="运行场景需要把案卷文本发送到 AI 中转站。开启前不会发出任何请求；所有结果以建议形式呈现，由你决定是否写入。"
        action={
          <Button size="sm" variant="soft" onClick={() => setAiEnabled(true)} disabled={!pid || readonly} data-testid="ai-scenarios-enable">
            开启本案 AI 外发
          </Button>
        }
        data-testid="ai-scenarios-disabled-case"
      />
    )
  }
  if (unavailable) {
    return <EmptyState icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="智能体场景接口（agent-core-backend）尚未落地，暂不能运行。" data-testid="ai-scenarios-unavailable" />
  }

  return (
    <div className="flex flex-col gap-2" data-testid="ai-scenarios">
      {budgetExceeded && (
        <p role="alert" className="flex items-center gap-1.5 rounded-md bg-warn-bg px-2.5 py-2 text-xs text-warn-fg" data-testid="ai-budget-exceeded">
          <Wallet className="size-3.5 shrink-0" aria-hidden />
          今日 AI 预算已用完，场景明日恢复；对话与选区动作仍可用。
        </p>
      )}
      <ul className="grid grid-cols-1 gap-2">
        {SCENARIOS.map((sc) => (
          <ScenarioCard key={sc.id} sc={sc} pid={pid} compact={compact} />
        ))}
      </ul>
    </div>
  )
}

function ScenarioCard({ sc, pid, compact }: { sc: ScenarioInfo; pid: string | null; compact: boolean }) {
  const role = useStudio(selectProjectRole)
  const runScenario = useStudio((s) => s.runScenario)
  const setAgentTab = useStudio((s) => s.setAgentTab)
  const running = useStudio((s) => s.agentJobs.some((j) => j.kind === `agent:${sc.id}` && (j.status === 'queued' || j.status === 'running')))
  const budgetExceeded = useStudio((s) => s.agentBudgetExceeded)
  const [params, setParams] = useState<Params>(() => defaultParams(sc.id))
  const [busy, setBusy] = useState(false)
  /** 双击真副作用（双 job）——state 闸挡不住同拍双击，ref 同步判（DeliverPage 先例） */
  const busyRef = useRef(false)

  const roleOk = ROLE_RANK[role] >= ROLE_RANK[sc.minRole]
  const missing = missingParam(sc.id, params)
  const disabled = !pid || !roleOk || busy || running || budgetExceeded || missing != null

  const run = async () => {
    if (!pid || disabled || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const job = await runScenario(pid, sc.id, params)
      if (job) setAgentTab('jobs')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <li
      className="rounded-lg border border-border bg-panel p-3 shadow-sm"
      data-testid={`ai-scenario-${sc.id}`}
      data-state={running ? 'running' : undefined}
      aria-labelledby={`ai-scenario-${sc.id}-title`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`ai-scenario-${sc.id}-title`} className="text-sm font-medium text-fg-strong">
            <span className="mr-1.5 font-mono text-2xs uppercase text-fg-subtle">{sc.id}</span>
            {sc.label}
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">{sc.hint}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {sc.weight === 'heavy' && <Badge tone="neutral" title="含规划步，进 heavy 队列串行">较慢</Badge>}
          {sc.produces.map((k) => (
            <Badge key={k} tone={k === 'critic' ? 'ok' : k === 'comment' ? 'warn' : 'info'}>
              {k === 'critic' ? '修订' : k === 'comment' ? '批注' : '新增'}
            </Badge>
          ))}
        </div>
      </div>

      <ParamForm id={sc.id} params={params} onChange={setParams} compact={compact} />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-2xs text-fg-muted">
          {!roleOk ? `需要${ROLE_LABEL[sc.minRole]}权限` : missing ?? (running ? '进行中，见「任务」' : '')}
        </span>
        <Button
          size={compact ? 'md' : 'sm'}
          variant="soft"
          className={cn(compact && 'min-h-touch')}
          disabled={disabled}
          loading={busy}
          loadingLabel="正在提交"
          onClick={() => void run()}
          aria-label={`运行 ${sc.label}`}
          data-testid={`ai-run-${sc.id}`}
        >
          <Play /> 运行
        </Button>
      </div>
    </li>
  )
}

function defaultParams(id: Scenario): Params {
  switch (id) {
    case 's6':
      return { limit: 300 }
    case 's9':
      return { target_lang: 'en' }
    case 's10':
      return { audience: 'client' }
    default:
      return {}
  }
}

function missingParam(id: Scenario, p: Params): string | null {
  if (id === 's1' && !(typeof p.text === 'string' && p.text.trim())) return '请粘贴交底书内容'
  if (id === 's7' && !p.oa_item_id) return '请选择一条审查意见（或在 OA 面板逐条生成）'
  return null
}

/** 各场景参数表单（无参数的场景不渲染） */
function ParamForm({ id, params, onChange, compact }: { id: Scenario; params: Params; onChange: (p: Params) => void; compact: boolean }) {
  const set = (k: string, v: unknown) => onChange({ ...params, [k]: v })
  const oaItems = useStudio((s) => s.oaItems)
  const proposals = useStudio((s) => s.proposals)
  const comments = useMemo(() => proposals.filter((p) => p.kind === 'comment' && p.state !== 'dismissed'), [proposals])
  const inputSize = compact ? 'lg' : 'sm'

  switch (id) {
    case 's1':
      return (
        <label className="mt-2 block text-xs">
          <span className="mb-1 block text-fg-muted">交底书内容</span>
          <Textarea
            rows={3}
            value={typeof params.text === 'string' ? params.text : ''}
            onChange={(e) => set('text', e.target.value)}
            placeholder="粘贴技术交底书正文（或先在「导入」里导入 DOCX）"
            className="resize-y text-sm"
            data-testid="ai-param-s1-disclosure"
          />
        </label>
      )
    case 's3':
      return (
        <label className="mt-2 block text-xs">
          <span className="mb-1 block text-fg-muted">来源批注（可选，默认对全部权项树批评结果补全）</span>
          <Select value={typeof params.comment_id === 'string' ? params.comment_id : 'all'} onValueChange={(v) => set('comment_id', v === 'all' ? undefined : v)}>
            <SelectTrigger size={inputSize} aria-label="来源批注" data-testid="ai-param-s3-comment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部待处理批注</SelectItem>
              {comments.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {(c.comment_body ?? '').slice(0, 40) || c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )
    case 's6':
      return (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-fg-muted">字数上限</span>
          <Input
            type="number"
            inputMode="decimal"
            min={100}
            max={300}
            step={10}
            size={inputSize}
            className="w-24"
            value={typeof params.limit === 'number' ? params.limit : 300}
            onChange={(e) => set('limit', Math.max(100, Math.min(300, Number(e.target.value) || 300)))}
            data-testid="ai-param-s6-limit"
          />
          <span className="text-fg-muted">字（CNIPA 摘要 ≤300）</span>
        </label>
      )
    case 's7':
      return (
        <label className="mt-2 block text-xs">
          <span className="mb-1 block text-fg-muted">审查意见条目</span>
          {oaItems.length === 0 ? (
            <span className="text-fg-muted" data-testid="ai-param-s7-empty">尚未拆条：先在 OA 面板粘贴 / 上传审查意见通知书。</span>
          ) : (
            <Select value={typeof params.oa_item_id === 'string' ? params.oa_item_id : ''} onValueChange={(v) => set('oa_item_id', v)}>
              <SelectTrigger size={inputSize} aria-label="审查意见条目" data-testid="ai-param-s7-item">
                <SelectValue placeholder="选择一条审查意见" />
              </SelectTrigger>
              <SelectContent>
                {oaItems.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {OA_KIND_LABEL[it.kind]} · 权{it.claims.join('、') || '—'} · {it.text.slice(0, 24)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </label>
      )
    case 's9':
      return (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-fg-muted">目标语言</span>
          <Select value={typeof params.target_lang === 'string' ? params.target_lang : 'en'} onValueChange={(v) => set('target_lang', v)}>
            <SelectTrigger size={inputSize} className="w-32" aria-label="目标语言" data-testid="ai-param-s9-lang">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">英语（en）</SelectItem>
              <SelectItem value="ja">日语（ja）</SelectItem>
              <SelectItem value="de">德语（de）</SelectItem>
            </SelectContent>
          </Select>
        </label>
      )
    case 's10':
      return (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-fg-muted">读者</span>
          <Select value={typeof params.audience === 'string' ? params.audience : 'client'} onValueChange={(v) => set('audience', v)}>
            <SelectTrigger size={inputSize} className="w-36" aria-label="读者" data-testid="ai-param-s10-audience">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="client">客户（非专业）</SelectItem>
              <SelectItem value="inventor">发明人（技术）</SelectItem>
            </SelectContent>
          </Select>
        </label>
      )
    default:
      return null
  }
}
