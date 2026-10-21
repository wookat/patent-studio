import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useStudio } from '@/store'
import { workbenchApi, type OrgPolicy } from '@/workbench/api'
import type { PlatformOrg } from '@/workbench/types'

/**
 * C0/P03 机构外发策略卡（平台面）：owner/admin 可撤销 ai_egress / 开启 training_consent；
 * 其他角色只读。策略版本、更新人、更新时间如实展示；训练授权默认关且仅表达本平台授权记录，
 * 不构成第三方供应商不训练的承诺。v1 面不可用（401/网络）时整体隐藏（fail-closed）。
 */
export function OrgEgressPolicyCard({ platformExpected = true }: { platformExpected?: boolean }) {
  const [orgs, setOrgs] = useState<PlatformOrg[] | null>(null)
  const [orgsError, setOrgsError] = useState('')
  const [orgsRetry, setOrgsRetry] = useState(0)
  const [orgIdx, setOrgIdx] = useState(0)
  const [policy, setPolicy] = useState<OrgPolicy | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ ai_egress: boolean; training_consent: boolean; note: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!platformExpected) return  // 本地文件模式：不请求平台机构列表
    let dead = false
    workbenchApi.organizations()
      .then((os) => { if (!dead) { setOrgs(os); setOrgsError('') } })
      .catch((e) => { if (!dead) { setOrgs(null); setOrgsError(e instanceof Error ? e.message : '机构列表读取失败') } })
    return () => { dead = true }
  }, [orgsRetry, platformExpected])

  const org = orgs?.[orgIdx] ?? null

  useEffect(() => {
    if (!org) return
    let dead = false
    const reset = () => {
      if (dead) return
      setPolicy(null)
      setDraft(null)
      setRole(null)
      setSaved(false)
      setError('')
    }
    void Promise.resolve()
      .then(reset)  // 切机构时清上一案数据（异步回调，避免 effect 同步 setState）
      .then(() => Promise.all([workbenchApi.orgPolicy(org.id), workbenchApi.me(), workbenchApi.memberships(org.id)]))
      .then(([p, me, members]) => {
        if (dead) return
        const m = members.find((x) => x.principal_id === me.id && x.status === 'active')
        setRole(m?.role ?? null)
        setPolicy(p)
        setDraft({ ai_egress: p.ai_egress, training_consent: p.training_consent, note: p.note ?? '' })
      })
      .catch((e) => {
        if (dead) return
        setPolicy(null)
        setError(e instanceof Error ? e.message : '策略读取失败')
      })
    return () => { dead = true }
  }, [org])

  if (!platformExpected) {
    return (
      <section aria-labelledby="admin-egress-h" className="grid gap-2" data-testid="admin-egress-policy">
        <h3 id="admin-egress-h" className="text-sm font-semibold">AI 外发授权（平台机构）</h3>
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-muted" data-testid="egress-local">
          本地文件模式：本部署没有平台机构，机构外发策略不适用。案卷级外发仍由本案「AI 外发」开关控制。
        </p>
      </section>
    )
  }

  const head = (
    <div>
      <h3 id="admin-egress-h" className="text-sm font-semibold">AI 外发授权（平台机构）</h3>
      <p className="text-xs text-fg-muted">
        本机构案卷内容是否允许发往 AI 服务；撤销即时生效，运行中任务的下一次上游调用即被拦截。
      </p>
    </div>
  )

  if (orgsError) {
    return (
      <section aria-labelledby="admin-egress-h" className="grid gap-3" data-testid="admin-egress-policy">
        {head}
        <Alert variant="danger" data-testid="egress-error">
          <ShieldCheck aria-hidden />
          <AlertTitle>机构策略不可用</AlertTitle>
          <AlertDescription>
            {orgsError}。服务端可能拒绝（403/网络），界面不代为假定授权。
            <Button size="sm" variant="outline" className="ml-2" onClick={() => setOrgsRetry((n) => n + 1)} data-testid="egress-retry">
              重试
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  if (!orgs) return null  // 首次加载中

  if (orgs.length === 0) {
    return (
      <section aria-labelledby="admin-egress-h" className="grid gap-3" data-testid="admin-egress-policy">
        {head}
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-muted" data-testid="egress-no-org">
          当前账号不属于任何平台机构——没有可管理的机构外发策略。
        </p>
      </section>
    )
  }

  const editable = role === 'owner' || role === 'admin'
  const dirty =
    !!policy && !!draft &&
    (draft.ai_egress !== policy.ai_egress || draft.training_consent !== policy.training_consent || draft.note !== (policy.note ?? ''))

  const save = () => {
    if (!org || !draft) return
    setSaving(true)
    setSaved(false)
    setError('')
    workbenchApi
      .putOrgPolicy(org.id, draft)
      .then((p) => {
        setPolicy(p)
        setDraft({ ai_egress: p.ai_egress, training_consent: p.training_consent, note: p.note ?? '' })
        setSaved(true)
        /* 同会话一致性：策略保存后活动案 caseContext/aiStatus 必须重取——
           否则 AI 面板沿用旧授权显示就绪（P03 实测缺口） */
        void useStudio.getState().loadCaseContext()
        void useStudio.getState().loadAiStatus()
      })
      .catch((e) => setError(e instanceof Error ? e.message : '保存失败'))
      .finally(() => setSaving(false))
  }

  return (
    <section aria-labelledby="admin-egress-h" className="grid gap-3" data-testid="admin-egress-policy">
      {head}
      {!editable && role && (
        <p className="text-xs text-fg-muted" data-testid="egress-readonly">仅 owner / admin 可修改，你当前为只读（{role}）。</p>
      )}
      {orgs.length > 1 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="选择机构">
          {orgs.map((o, i) => (
            <Button key={o.id} size="sm" variant={i === orgIdx ? 'secondary' : 'ghost'} onClick={() => setOrgIdx(i)} data-testid={`egress-org-${o.slug}`}>
              {o.name}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <Alert variant="danger" data-testid="egress-error">
          <ShieldCheck aria-hidden />
          <AlertTitle>外发策略不可用</AlertTitle>
          <AlertDescription>{error || '无法读取机构策略，服务端可能拒绝（403）。界面不代为假定授权。'}</AlertDescription>
        </Alert>
      )}
      {policy && draft && (
        <div className="grid gap-3" data-testid="egress-form">
          <div className="flex items-center justify-between gap-3 rounded-md border bg-panel px-3 py-2">
            <div className="min-w-0">
              <Label htmlFor="egress-ai" className="text-sm">允许案卷内容外发 AI 服务</Label>
              <p className="text-xs text-fg-muted">关闭后本案机构全部 AI 调用（chat/任务/查新/转换）被服务端拒绝。</p>
            </div>
            <Switch
              id="egress-ai"
              checked={draft.ai_egress}
              disabled={!editable || saving}
              onCheckedChange={(v) => { setDraft({ ...draft, ai_egress: v }); setSaved(false) }}
              data-testid="egress-ai-switch"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border bg-panel px-3 py-2">
            <div className="min-w-0">
              <Label htmlFor="egress-train" className="text-sm">授权用于模型训练</Label>
              <p className="text-xs text-fg-muted">
                默认关闭。此选项仅记录「本平台对机构的授权立场」，不保证第三方供应商实际不训练。
              </p>
            </div>
            <Switch
              id="egress-train"
              checked={draft.training_consent}
              disabled={!editable || saving}
              onCheckedChange={(v) => { setDraft({ ...draft, training_consent: v }); setSaved(false) }}
              data-testid="egress-train-switch"
            />
          </div>
          <div className="flex items-center gap-2">
            {editable && (
              <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving} data-testid="egress-save">
                {saving ? '保存中…' : '保存'}
              </Button>
            )}
            {saved && <Badge tone="ok" data-testid="egress-saved">已保存</Badge>}
            <span className="text-xs text-fg-muted" data-testid="egress-meta">
              版本 v{policy.version}
              {policy.updated_by ? ` · 更新人 ${policy.updated_by}` : ''}
              {policy.updated_at ? ` · ${new Date(policy.updated_at).toLocaleString()}` : ''}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
