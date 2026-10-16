import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { fmtTokens } from '@/lib/format'
import { Bot, Construction, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { AI_MODEL_ROUTES } from '@/store/admin'
import { useStudio } from '@/store'

const AiUsageChart = lazy(() => import('./AiUsageChart'))


export function validateBudget(raw: string): string | undefined {
  if (raw.trim() === '') return '请填写日预算'
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) return '须为不小于 0 的整数（token）'
  return undefined
}

/**
 * AI tab（21 §4.6 / R-AI-01 / R-AI-09）：机构级开关（关闭 → 全机构所有案卷禁用外发，案级开关 disabled）·
 * 模型路由只读 · 今日用量 Chart（lazy，Recharts 只在此 tab 加载）· 日预算 → PUT /api/admin/settings.ai_daily_tokens。
 * 「本月用量」需要 AiUsageSummary 增加月度字段，见 integration_requests。
 */
export function AiPanel() {
  const settings = useStudio((s) => s.orgSettings)
  const unavailable = useStudio((s) => s.orgSettingsUnavailable)
  const saving = useStudio((s) => s.orgSettingsSaving)
  const loadOrgSettings = useStudio((s) => s.loadOrgSettings)
  const saveOrgSettings = useStudio((s) => s.saveOrgSettings)
  const usage = useStudio((s) => s.orgAiUsage)
  const usageUnavailable = useStudio((s) => s.orgAiUsageUnavailable)
  const loadOrgAiUsage = useStudio((s) => s.loadOrgAiUsage)

  useEffect(() => {
    void loadOrgSettings()
    void loadOrgAiUsage()
  }, [loadOrgSettings, loadOrgAiUsage])

  const [budget, setBudget] = useState('')
  const [budgetError, setBudgetError] = useState<string | undefined>()
  useEffect(() => {
    if (settings) setBudget(String(settings.ai_daily_tokens))
  }, [settings])

  if (unavailable) {
    return <EmptyState icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="机构 AI 设置接口（GET/PUT /api/admin/settings）尚未提供（501）。" data-testid="admin-ai-unavailable" />
  }
  if (!settings) {
    return (
      <div className="grid max-w-form gap-3" aria-busy data-testid="admin-ai-loading">
        <Skeleton className="h-md-control" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  const enabled = settings.ai_enabled
  const onToggle = (v: boolean) => void saveOrgSettings({ ai_enabled: v })
  const onBudget = (e: FormEvent) => {
    e.preventDefault()
    const err = validateBudget(budget)
    setBudgetError(err)
    if (err) return
    void saveOrgSettings({ ai_daily_tokens: Number(budget) })
  }
  const budgetDirty = budget !== String(settings.ai_daily_tokens)
  const pct = usage && usage.budget > 0 ? Math.min(100, Math.round((usage.today_tokens / usage.budget) * 100)) : 0

  return (
    <div className="grid max-w-form gap-6" data-testid="admin-ai-panel">
      <section aria-labelledby="admin-ai-switch-h" className="grid gap-3">
        <h3 id="admin-ai-switch-h" className="text-sm font-semibold">机构级 AI 开关</h3>
        <div className="flex items-center justify-between gap-3 rounded-md border bg-panel px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor="org-ai-enabled" className="text-sm">允许向 AI 服务外发案卷内容</Label>
            <p className="text-xs text-fg-muted">关闭后所有案卷的 AI 智能体与 MCP 语义工具都停止外发；各案的案级开关变为不可用。</p>
          </div>
          <Switch id="org-ai-enabled" checked={enabled} disabled={saving} onCheckedChange={onToggle} data-testid="org-ai-enabled" />
        </div>
        {!enabled && (
          <Alert variant="warn" data-testid="org-ai-disabled-alert">
            <TriangleAlert aria-hidden />
            <AlertTitle>AI 已对全机构关闭</AlertTitle>
            <AlertDescription>此设置对机构内所有成员与所有案卷生效；案级「AI 外发」开关将显示为禁用，直到这里重新开启。</AlertDescription>
          </Alert>
        )}
      </section>

      <section aria-labelledby="admin-ai-routes-h" className="grid gap-2">
        <h3 id="admin-ai-routes-h" className="text-sm font-semibold">模型路由（只读）</h3>
        <ul className="divide-y divide-border rounded-md border bg-panel" data-testid="ai-model-routes">
          {AI_MODEL_ROUTES.map((r) => (
            <li key={r.model} className="flex items-start gap-3 px-3 py-2 text-sm">
              <Bot className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs">{r.model}</code>
                  <Badge tone="neutral">{r.role}</Badge>
                </div>
                <p className="text-xs text-fg-muted">{r.note}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-muted">路由由部署配置决定（PATENT_STUDIO_AI_BASE_URL），此处不可修改。</p>
      </section>

      <section aria-labelledby="admin-ai-usage-h" className="grid gap-3">
        <h3 id="admin-ai-usage-h" className="text-sm font-semibold">今日用量</h3>
        {usageUnavailable ? (
          <EmptyState icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="AI 用量接口（GET /api/admin/ai-usage）尚未提供（501）。" size="sm" data-testid="ai-usage-unavailable" />
        ) : !usage ? (
          <Skeleton className="h-48" data-testid="ai-usage-loading" />
        ) : (
          <div className="grid gap-3 rounded-md border bg-panel p-3" data-testid="ai-usage">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>
                今日 <strong className="tabular-nums">{fmtTokens(usage.today_tokens)}</strong> token
              </span>
              <span className="text-xs tabular-nums text-fg-muted">预算 {fmtTokens(usage.budget)} · {pct}%</span>
            </div>
            <Progress value={pct} aria-label="今日用量占预算比例" />
            {usage.by_project.length === 0 ? (
              <p className="text-xs text-fg-muted">今日尚无 AI 调用。</p>
            ) : (
              <Suspense fallback={<Skeleton className="h-48" />}>
                <AiUsageChart usage={usage} />
              </Suspense>
            )}
            {usage.by_model.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-xs text-fg-muted" data-testid="ai-usage-by-model">
                {usage.by_model.map((m) => (
                  <li key={m.model} className="rounded-sm bg-sunken px-2 py-0.5 tabular-nums">
                    <code className="font-mono">{m.model}</code> {fmtTokens(m.tokens)} · {m.calls} 次
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="admin-ai-budget-h" className="grid gap-3">
        <h3 id="admin-ai-budget-h" className="text-sm font-semibold">日预算</h3>
        <form className="grid gap-3" onSubmit={onBudget} noValidate data-testid="ai-budget-form">
          <Field error={budgetError}>
            <FieldLabel>每日 token 上限</FieldLabel>
            <FieldControl>
              <Input type="number" inputMode="numeric" min={0} step={1000} value={budget} onChange={(e) => setBudget(e.target.value)} className="max-w-48 tabular-nums" data-testid="ai-budget" />
            </FieldControl>
            <FieldDescription>达到上限后当日新的 AI 任务排队到次日；0 表示不限。</FieldDescription>
            <FieldError data-testid="ai-budget-error" />
          </Field>
          <div>
            <Button type="submit" variant="outline" disabled={!budgetDirty || saving} data-testid="ai-budget-save">
              {saving ? '保存中…' : '保存预算'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
