import { useState } from 'react'
import { CalendarClock, CalendarPlus, CheckCircle2, Loader2, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { todayISO } from '@/lib/caseForm'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { OaDelivery, OaRound, OaRoundKind } from '@/types/oa'
export const OA_ROUND_KIND_LABEL: Record<OaRoundKind, string> = { first: '一通', subsequent: '后续通知', reexam: '复审', rejection: '驳回决定' }
const DELIVERY_LABEL: Record<OaDelivery, string> = { electronic: '电子', mail: '邮寄' }

/** 轮次显示名：一通 / 二通 / 三通…（按 created_at 序）；复审通知 / 驳回决定单列 */
export function roundTitle(round: OaRound, index: number): string {
  if (round.kind === 'reexam') return '复审通知'
  if (round.kind === 'rejection') return '驳回决定'
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return `${CN[index] ?? index + 1}通`
}

interface Props {
  readonly?: boolean
  compact?: boolean
}

/**
 * OA 轮次条（W5 R-OA-05 UI）：一通 / 二通… 可切换；「新增轮次」表单（类型 / 发文日 / 送达方式 → POST …/oa/rounds，
 * 后端同时登记答复期限 R-OA-02）。后端 501 时显示「多轮历史开发中」而不是报错。
 */
export function OaRounds({ readonly, compact }: Props) {
  const rounds = useStudio((s) => s.oaRounds)
  const loading = useStudio((s) => s.oaRoundsLoading)
  const unavailable = useStudio((s) => s.oaRoundsUnavailable)
  const activeId = useStudio((s) => s.oaActiveRoundId)
  const setActive = useStudio((s) => s.setOaActiveRound)
  const create = useStudio((s) => s.createOaRound)
  const remove = useStudio((s) => s.deleteOaRound)
  const extend = useStudio((s) => s.extendOaRound)
  const file = useStudio((s) => s.fileOaRound)
  const [adding, setAdding] = useState(false)
  /* null = 跟随轮次数的自动默认（挂载时 rounds 还没到，useState 初值会把「一通」冻成永久默认——二通错走 4 个月期限） */
  const [kindOverride, setKindOverride] = useState<OaRoundKind | null>(null)
  const kind = kindOverride ?? (rounds.length ? 'subsequent' : 'first')
  const [issuedOn, setIssuedOn] = useState('')
  const [delivery, setDelivery] = useState<OaDelivery>('electronic')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [actBusy, setActBusy] = useState(false)
  // 写操作单飞：延期/答复登记/删除连点不重复发请求
  const fire = (op: () => Promise<unknown>) => {
    if (actBusy) return
    setActBusy(true)
    void op().finally(() => setActBusy(false))
  }
  const [filingOpen, setFilingOpen] = useState(false)
  const [filedOn, setFiledOn] = useState(todayISO)
  const size = compact ? 'xl' : 'sm'
  const inputSize = compact ? 'xl' : 'sm'

  const submit = async () => {
    if (!issuedOn) return
    setSaving(true)
    const r = await create({ kind, issued_on: issuedOn, delivery })
    setSaving(false)
    if (r) {
      setAdding(false)
      setIssuedOn('')
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-label="OA 轮次" data-testid="oa-rounds">
      <div className="flex flex-wrap items-center gap-1.5">
        <CalendarClock className="size-3.5 text-fg-muted" aria-hidden />
        <span className="text-xs font-medium text-fg-muted">轮次</span>
        {loading && <Loader2 className="size-3 animate-spin text-fg-muted" aria-label="加载中" />}
        {unavailable ? (
          <span className="text-xs text-fg-muted" data-testid="oa-rounds-unavailable">多轮历史开发中（后端 501）</span>
        ) : rounds.length === 0 && !loading ? (
          <span className="text-xs text-fg-muted" data-testid="oa-rounds-empty">尚无轮次记录；拆条前可先登记发文日以自动计算答复期限</span>
        ) : (
          <div role="tablist" aria-label="OA 轮次" className="flex flex-wrap items-center gap-1">
            {rounds.map((r, i) => {
              const active = r.id === activeId
              return (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setActive(r.id); setConfirmDel(false) }}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 text-xs transition-colors hover:bg-hover',
                    FOCUS_RING,
                    compact ? 'min-h-11' : 'h-7',
                    active ? 'border-brand-300 bg-selected font-medium' : 'border-border text-fg-muted',
                  )}
                  data-testid={`oa-round-${r.id}`}
                  data-active={active || undefined}
                >
                  {roundTitle(r, i)}
                  <span className="font-normal text-fg-muted">{r.issued_on}</span>
                  {r.items > 0 && <Badge tone="neutral" className="h-4 px-1 text-2xs">{r.items} 条</Badge>}
                  {r.extensions.length > 0 && <Badge tone="outline" className="h-4 px-1 text-2xs">延期 {r.extensions.reduce((n, x) => n + x.months, 0)} 月</Badge>}
                  {r.filed_on && <Badge tone="outline" className="h-4 px-1 text-2xs text-ok-fg">{r.kind === 'rejection' ? '已请求' : '已答复'} {r.filed_on}</Badge>}
                </button>
              )
            })}
          </div>
        )}
        {!readonly && !unavailable && (
          <Button type="button" size={size} variant="ghost" className="ml-auto" onClick={() => setAdding((v) => !v)} aria-expanded={adding} data-testid="oa-round-add">
            <Plus aria-hidden /> 新增轮次
          </Button>
        )}
        {!readonly && activeId && !unavailable && (
          confirmDel ? (
            <span className="flex items-center gap-1" role="group" aria-label="确认删除当前轮次">
              <span className="text-xs text-danger-fg">删除当前轮次？</span>
              <Button type="button" variant="danger" size="xs" disabled={actBusy} onClick={() => fire(() => { setConfirmDel(false); return remove(activeId) })} data-testid="oa-round-delete-confirm">
                确认
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="取消删除" onClick={() => setConfirmDel(false)} data-testid="oa-round-delete-cancel">
                <X aria-hidden />
              </Button>
            </span>
          ) : (
            <Button type="button" size={size} variant="ghost" aria-label="删除当前轮次" title="删除当前轮次" onClick={() => setConfirmDel(true)} data-testid="oa-round-delete">
              <Trash2 aria-hidden />
            </Button>
          )
        )}
      </div>
      {!readonly && !unavailable && activeId && (() => {
        const active = rounds.find((r) => r.id === activeId)
        if (!active) return null
        const extended = active.extensions.reduce((n, x) => n + x.months, 0)
        const filed = !!active.filed_on
        // 驳回决定：期限=复审请求（法定期限不可延期），filed_on=复审请求递交日
        const rejection = active.kind === 'rejection'
        return (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="oa-round-actions">
            {filed ? (
              <span className="inline-flex items-center gap-1 text-xs text-ok-fg" data-testid="oa-round-filed">
                <CheckCircle2 className="size-3.5" aria-hidden /> {rejection ? '已提复审请求' : '已答复递交'}（{active.filed_on}）
              </span>
            ) : (
              <>
                {!rejection && (
                  <>
                    <Button type="button" size={size} variant="ghost" disabled={extended >= 2 || actBusy} onClick={() => fire(() => extend(activeId, 1))} data-testid="oa-extend-1">
                      <CalendarPlus aria-hidden /> 延期 1 月
                    </Button>
                    <Button type="button" size={size} variant="ghost" disabled={extended >= 2 || actBusy} onClick={() => fire(() => extend(activeId, 2))} data-testid="oa-extend-2">
                      延期 2 月
                    </Button>
                    {extended >= 2 && <span className="text-2xs text-fg-muted">累计延期已达上限 2 个月</span>}
                  </>
                )}
                <Button type="button" size={size} variant="ghost" onClick={() => setFilingOpen((v) => !v)} aria-expanded={filingOpen} data-testid="oa-filed-toggle">
                  <CheckCircle2 aria-hidden /> {rejection ? '登记复审请求' : '标已答复'}
                </Button>
                {filingOpen && (
                  <span className="inline-flex items-center gap-1">
                    <Input type="date" size={inputSize} value={filedOn} onChange={(e) => setFiledOn(e.target.value)} aria-label={rejection ? '复审请求递交日' : '答复递交日'} data-testid="oa-filed-date" />
                    <Button type="button" size={size} disabled={!filedOn || actBusy} onClick={() => fire(() => file(activeId, filedOn).then((ok) => ok && setFilingOpen(false)))} data-testid="oa-filed-save">确认</Button>
                  </span>
                )}
              </>
            )}
          </div>
        )
      })()}
      {adding && (
        <form
          className="grid gap-2 rounded-md border bg-sunken p-2 @md:grid-cols-[1fr_1fr_1fr_auto] @md:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          data-testid="oa-round-form"
        >
          <div className="grid gap-1">
            <Label htmlFor="oa-round-kind" className="text-xs">类型</Label>
            <Select value={kind} onValueChange={(v) => setKindOverride(v as OaRoundKind)}>
              <SelectTrigger id="oa-round-kind" size={inputSize} data-testid="oa-round-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(OA_ROUND_KIND_LABEL) as OaRoundKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{OA_ROUND_KIND_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="oa-round-date" className="text-xs">发文日</Label>
            <Input id="oa-round-date" type="date" size={inputSize} required value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} data-testid="oa-round-date" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="oa-round-delivery" className="text-xs">送达</Label>
            <Select value={delivery} onValueChange={(v) => setDelivery(v as OaDelivery)}>
              <SelectTrigger id="oa-round-delivery" size={inputSize} data-testid="oa-round-delivery">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DELIVERY_LABEL) as OaDelivery[]).map((d) => (
                  <SelectItem key={d} value={d}>{DELIVERY_LABEL[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1">
            <Button type="submit" size={size} disabled={!issuedOn || saving} data-testid="oa-round-save">
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} 登记
            </Button>
            <Button type="button" size={size} variant="ghost" onClick={() => setAdding(false)}>取消</Button>
          </div>
        </form>
      )}
    </section>
  )
}
