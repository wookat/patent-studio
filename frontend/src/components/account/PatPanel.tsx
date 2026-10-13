import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Construction, Copy, KeyRound, Trash2, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtRelativeIso } from '@/lib/format'
import type { Pat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { validatePatName, type FormErrors } from './formErrors'
import { useCopied } from '@/hooks/useMisc'
import { copyText } from '@/lib/download'


/**
 * 集成 · 个人访问令牌（21 §4.6 账户页第四项）：新建（Field 校验）→ 一次性明文 token 复制条 → 列表 / 撤销二次确认。
 * 数据走 store.mcp（pats / createPat / revokePat；AUTH=off 或 501 → patsUnavailable → EmptyState）。接入命令仍在案卷设置「集成」页。
 */
export function PatPanel() {
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

  const [name, setName] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [creating, setCreating] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const revokingRef = useRef(false)
  const [copied, markCopied] = useCopied()

  useEffect(() => { void loadPats() }, [loadPats, authStatus])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validatePatName(name, pats)
    setErrors(errs)
    if (Object.keys(errs).length || creating) return
    setCreating(true)
    const p = await createPat(name.trim())
    setCreating(false)
    if (p) setName('')
  }

  const copyToken = async () => {
    if (!newPat) return
    if (await copyText(newPat.token)) {
      markCopied(true)
      toast('令牌已复制', 'success')
    } else {
      toast('复制失败，请手动选择文本复制', 'error')
    }
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

  if (patsUnavailable) {
    return (
      <section data-slot="PatPanel" data-testid="pat-panel" className="max-w-form">
        <EmptyState
          icon={Construction}
          title={NOT_IMPLEMENTED_TITLE}
          reason={authStatus === 'off' ? '当前部署未启用登录（AUTH=off），个人访问令牌不可用；本机智能体可直接用 stdio 接入。' : '个人访问令牌接口尚未提供（501）。'}
          data-testid="pat-unavailable"
        />
      </section>
    )
  }

  return (
    <section data-slot="PatPanel" data-testid="pat-panel" aria-labelledby="pat-title" className="grid max-w-form gap-5">
      <div>
        <h2 id="pat-title" className="text-sm font-semibold">个人访问令牌</h2>
        <p className="mt-1 text-xs text-fg-muted">
          供 Codex / Claude Code 等外部智能体通过 MCP（Bearer）访问你有权限的案卷；改动以 CriticMarkup 建议写入并记入审计。令牌明文只显示一次。
        </p>
      </div>

      <form className="grid gap-3" onSubmit={(e) => void onCreate(e)} noValidate data-testid="pat-form">
        <Field error={errors.name}>
          <FieldLabel>令牌名称</FieldLabel>
          <FieldControl>
            <Input value={name} maxLength={64} placeholder="如「Codex 本机」" onChange={(e) => setName(e.target.value)} data-testid="pat-name" />
          </FieldControl>
          <FieldDescription>用来区分不同设备 / 智能体，撤销时按名称找。</FieldDescription>
          <FieldError data-testid="pat-name-error" />
        </Field>
        <div>
          <Button type="submit" disabled={creating} data-testid="pat-create">
            <KeyRound aria-hidden />
            {creating ? '生成中…' : '生成令牌'}
          </Button>
        </div>
      </form>

      {newPat && (
        <Alert variant="ok" data-testid="pat-new">
          <Check aria-hidden />
          <AlertTitle>令牌「{newPat.name}」已生成，请立即复制</AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-sm bg-sunken px-2 py-1 font-mono text-2xs" data-testid="pat-token">{newPat.token}</code>
              <Button size="sm" variant="outline" onClick={() => void copyToken()} data-testid="pat-copy">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? '已复制' : '复制'}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissNewPat} aria-label="关闭令牌提示" title="关闭令牌提示">
                <X aria-hidden />
              </Button>
            </div>
            <p className="mt-1">关闭后无法再次查看；丢失请撤销后重新生成。</p>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <h3 className="pb-1 text-xs font-semibold text-fg-muted">已有令牌</h3>
        {patsLoading && pats.length === 0 ? (
          <div className="grid gap-2" aria-busy data-testid="pat-loading">
            <Skeleton className="h-row" />
            <Skeleton className="h-row" />
          </div>
        ) : pats.length === 0 ? (
          <EmptyState icon={KeyRound} title="还没有令牌" reason="生成后可在 Codex / Claude Code 的 MCP 配置里作为 Bearer 使用。" size="sm" data-testid="pat-empty" />
        ) : (
          <ul className="divide-y divide-border rounded-md border bg-panel" data-testid="pat-list">
            {pats.map((p) => {
              const confirming = confirmRevoke === p.id
              return (
                <li key={p.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', newPat?.id === p.id && 'bg-ok-bg/40')} data-testid="pat-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <KeyRound className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                      <span className="truncate text-sm font-medium" title={p.name}>{p.name}</span>
                      <Badge tone="outline" className="font-mono">{p.prefix}…</Badge>
                    </div>
                    <p className="pl-5.5 text-xs text-fg-muted">
                      创建于 <time dateTime={p.created_at}>{fmtRelativeIso(p.created_at)}</time>
                      <span className="px-1">·</span>
                      {p.last_used_at ? <>最近使用 <time dateTime={p.last_used_at}>{fmtRelativeIso(p.last_used_at)}</time></> : '尚未使用'}
                    </p>
                  </div>
                  {confirming ? (
                    <span className="flex items-center gap-1 text-xs" role="group" aria-label={`确认撤销令牌 ${p.name}`}>
                      <span className="text-danger-fg">撤销？</span>
                      <Button variant="danger" size="sm" onClick={() => void revoke(p)} data-testid={`pat-revoke-confirm-${p.id}`}>
                        <Check aria-hidden /> 确认
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(null)}>
                        <X aria-hidden /> 取消
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-fg-muted hover:text-danger-fg" onClick={() => setConfirmRevoke(p.id)} aria-label={`撤销令牌 ${p.name}`} data-testid={`pat-revoke-${p.id}`}>
                      <Trash2 aria-hidden /> 撤销
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
