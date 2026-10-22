import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Check, ChevronDown, Construction, Crosshair, Inbox, Loader2, Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { EmptyState, NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { FOCUS_RING, cn } from '@/lib/utils'
import { selectReadonly, useStudio } from '@/store'
import { Markdown } from './Markdown'
import { PROPOSAL_KIND_LABEL, SCENARIOS, type Proposal, type ProposalState } from '@/types/agent'
import type { AiSuggestion } from '@/types/ai'
import { anchorLabel, applySuggestion, focusAnchor, gotoReview, selectionLabel } from './aiModel'
import { CriticPreview } from './CriticPreview'

const GROUPS: readonly ProposalState[] = ['pending', 'applied', 'dismissed']
const SUG_SOURCE: Record<AiSuggestion['source'], string> = { rewrite: '改写', unify: '术语统一', oa: 'OA 答复' }
const scenarioLabel = (id: Proposal['scenario']) => SCENARIOS.find((s) => s.id === id)?.label ?? id
const KIND_TONE: Record<Proposal['kind'], 'ok' | 'warn' | 'info'> = { critic: 'ok', comment: 'warn', patch: 'info' }
const APPLY_LABEL: Record<Proposal['kind'], string> = { critic: '接受为建议', comment: '写入为批注', patch: '应用补丁' }
/** 用户视角的三态文案（05 §3.11：待处理 / 已接受 / 已拒绝） */
const STATE_LABEL: Record<ProposalState, string> = { pending: '待处理', applied: '已接受', dismissed: '已拒绝' }

/**
 * 建议 tab（05 §3.11 / S6）：Proposal 按 state 分组 待处理 / 已接受 / 已拒绝；卡 = 头 32（sparkles + 场景名 + 锚点 mono + 形态 Badge）
 * → diff 区 mono 13/20 `--bg-sunken`（critic → CriticMarkup del/ins；comment → 批注正文；patch → 新增块 / 文件）→ 「为什么」12 → 脚：定位 ghost ｜ 拒绝 secondary · 接受 soft。
 * 接受 = 写 CriticMarkup 建议（不直接改源码）；已接受左 2px `--ok-dot`；已拒绝 `--fg-muted` 折叠。本地「待写入」建议并入待处理组顶部。
 */
export function AiProposals({ pid, compact, canAct }: { pid: string | null; compact: boolean; canAct: boolean }) {
  const proposals = useStudio((s) => s.proposals)
  const suggestions = useStudio((s) => s.suggestions)
  const loading = useStudio((s) => s.agentLoading)
  const unavailable = useStudio((s) => s.agentUnavailable)
  const applyAll = useStudio((s) => s.applyAllProposals)
  const pendingProposalId = useStudio((s) => s.pendingProposalId)
  const consumePendingProposal = useStudio((s) => s.consumePendingProposal)
  const [open, setOpen] = useState<Record<ProposalState, boolean>>({ pending: true, applied: false, dismissed: false })
  const [applyAllBusy, setApplyAllBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  // 批注「转提案」/「查看建议」落到这条提案：展开所在组 → 滚动到卡 → 短暂高亮（flash 由卡上 data-flash 驱动样式）
  useEffect(() => {
    if (!pendingProposalId) return
    const p = proposals.find((x) => x.id === pendingProposalId)
    if (!p) {
      consumePendingProposal()
      return
    }
    if (!open[p.state]) setOpen((o) => ({ ...o, [p.state]: true }))
    const t = requestAnimationFrame(() => {
      document.querySelector(`[data-testid="ai-proposal-${CSS.escape(p.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFlash(p.id)
      consumePendingProposal()
    })
    return () => cancelAnimationFrame(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在待定位标记到达时消费一次
  }, [pendingProposalId])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(t)
  }, [flash])

  if (unavailable && proposals.length === 0 && suggestions.length === 0) {
    return <EmptyState size="sm" icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="智能体建议接口尚未落地；选区润色 / 规范化 / 扩写产生的本地建议仍会显示在这里。" data-testid="ai-proposals-unavailable" />
  }
  if (loading && proposals.length === 0 && suggestions.length === 0) {
    return (
      <p role="status" className="flex items-center justify-center gap-1.5 py-6 text-xs text-fg-muted" data-testid="ai-proposals-loading">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> 正在加载建议…
      </p>
    )
  }
  if (!loading && proposals.length === 0 && suggestions.length === 0) {
    return <EmptyState size="sm" icon={Inbox} title="选一个场景开始" reason="在「场景」运行任务，或对选区使用润色 / 规范化 / 扩写后，AI 建议会出现在这里；写入前不会改动源码。" data-testid="ai-proposals-empty" />
  }

  return (
    <div className="flex flex-col gap-3" data-testid="ai-proposals">
      {GROUPS.map((state) => {
        const list = proposals.filter((p) => p.state === state)
        const extra = state === 'pending' ? suggestions.length : 0
        const n = list.length + extra
        return (
          <section key={state} aria-labelledby={`ai-proposals-${state}-h`} data-testid={`ai-proposals-${state}`} data-count={n}>
            <h3 className="flex items-center">
              <button
                type="button"
                id={`ai-proposals-${state}-h`}
                className={cn('flex h-sm-control flex-1 items-center gap-1.5 rounded-sm text-2xs font-medium uppercase tracking-wide text-fg-subtle hover:text-fg', FOCUS_RING)}
                aria-expanded={open[state]}
                aria-controls={`ai-proposals-${state}-list`}
                onClick={() => setOpen((o) => ({ ...o, [state]: !o[state] }))}
              >
                <ChevronDown className={cn('size-3.5 transition-transform duration-(--dur-fast)', !open[state] && '-rotate-90')} aria-hidden />
                {STATE_LABEL[state]}
                <Count value={n} showZero tone={state === 'pending' && n > 0 ? 'brand' : 'neutral'} />
              </button>
              {state === 'pending' && canAct && list.length > 1 && pid && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={applyAllBusy}
                  data-testid="ai-proposals-apply-all"
                  onClick={async () => {
                    setApplyAllBusy(true)
                    try { await applyAll(pid) } finally { setApplyAllBusy(false) }
                  }}
                >
                  {applyAllBusy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                  全部应用（{list.length}）
                </Button>
              )}
            </h3>
            {open[state] && (
              <ul id={`ai-proposals-${state}-list`} className="flex flex-col gap-2">
                {state === 'pending' && list.length > 0 && (
                  <li aria-hidden className="flex items-center gap-3 px-1 text-2xs text-fg-muted">
                    <span className="font-mono text-primary">{'{++ 新增 ++}'}</span>
                    <span className="font-mono text-danger-fg">{'{-- 删除 --}'}</span>
                    <span>—— 未修改</span>
                  </li>
                )}
                {state === 'pending' && suggestions.map((sug) => <LocalSuggestionCard key={sug.id} sug={sug} compact={compact} />)}
                {list.map((p) => <ProposalCard key={p.id} p={p} pid={pid} compact={compact} canAct={canAct} flash={flash === p.id} />)}
                {n === 0 && <li className="px-1 py-1.5 text-xs text-fg-muted">暂无</li>}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** 卡壳：r8 边 `--bg-panel` `--sh-sm`；已接受左 2px ok-dot；已拒绝 fg-muted */
function Card({ state, flash, children, ...rest }: ComponentProps<'li'> & { state: ProposalState; flash?: boolean }) {
  return (
    <li
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-panel text-xs shadow-sm',
        state === 'applied' && 'border-l-2 border-l-ok-dot',
        state === 'dismissed' && 'text-fg-muted',
        flash && 'ring-2 ring-primary/60',
      )}
      data-state={state}
      data-flash={flash || undefined}
      {...rest}
    >
      {children}
    </li>
  )
}

function CardHead({ title, loc, children }: { title: string; loc: string; children?: ReactNode }) {
  return (
    <div className="flex h-md-control items-center gap-2 border-b border-border bg-app px-3">
      <Sparkles className="size-4 shrink-0 text-info-fg" aria-hidden />
      <span className="truncate text-sm font-medium text-fg-strong" title={title}>{title}</span>
      <span className="truncate font-mono text-2xs text-fg-muted" title={loc}>{loc}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">{children}</span>
    </div>
  )
}

function ProposalCard({ p, pid, compact, canAct, flash }: { p: Proposal; pid: string | null; compact: boolean; canAct: boolean; flash?: boolean }) {
  const apply = useStudio((s) => s.applyProposal)
  const dismiss = useStudio((s) => s.dismissProposal)
  const toast = useStudio((s) => s.toast)
  const [busy, setBusy] = useState<'apply' | 'dismiss' | null>(null)
  const locatable = 'block_id' in p.anchor
  const failed = p.checks.filter((c) => !c.ok)
  const btn = compact ? 'md' : 'sm'

  const act = async (what: 'apply' | 'dismiss') => {
    if (!pid || busy) return
    setBusy(what)
    const ok = what === 'apply' ? await apply(pid, p.id) : await dismiss(pid, p.id)
    setBusy(null)
    if (ok && what === 'apply' && p.kind === 'critic') gotoReview()
  }
  const ast = useStudio((s) => s.ast)
  const where = anchorLabel(p.anchor, ast)
  const locate = () => {
    if (!focusAnchor(p.anchor)) toast('文件级建议没有正文锚点，应用后请在案卷文件中查看', 'info')
  }

  return (
    <Card state={p.state} flash={flash} data-testid={`ai-proposal-${p.id}`} data-kind={p.kind}>
      <CardHead title={scenarioLabel(p.scenario)} loc={where}>
        <Badge tone={p.state === 'dismissed' ? 'neutral' : KIND_TONE[p.kind]}>{PROPOSAL_KIND_LABEL[p.kind]}</Badge>
        {p.state !== 'pending' && <Badge tone={p.state === 'applied' ? 'ok' : 'outline'}>{STATE_LABEL[p.state]}</Badge>}
      </CardHead>

      <div className={cn('m-2 rounded-sm bg-sunken px-2.5 py-1.5', p.state === 'dismissed' && 'max-h-sm-control overflow-hidden')} data-testid={`ai-proposal-preview-${p.id}`}>
        {p.kind === 'critic' && p.critic_markdown != null ? (
          <CriticPreview markdown={p.critic_markdown} maxLines={p.state === 'dismissed' ? 1 : compact ? 6 : 8} />
        ) : p.kind === 'comment' ? (
          <div className="break-words text-sm leading-5"><Markdown text={p.comment_body ?? ''} /></div>
        ) : p.patch && 'blocks' in p.patch ? (
          <div className="flex flex-col gap-1">
            {p.patch.blocks.map((b, i) => (
              <p key={i} className="whitespace-pre-wrap break-words font-mono text-sm leading-5">
                <span className="text-fg-muted">{b.replace_block_id ? `替换 ${b.replace_block_id}：` : `插入到 ${b.after_block_id} 之后：`}</span>
                {b.markdown}
              </p>
            ))}
          </div>
        ) : p.patch && 'file' in p.patch ? (
          <p className="whitespace-pre-wrap break-words font-mono text-sm leading-5">
            <span className="text-fg-muted">新文件 {p.patch.file}：</span>
            {p.patch.content.slice(0, 600)}
            {p.patch.content.length > 600 ? '…' : ''}
          </p>
        ) : (
          <p className="text-fg-muted">（无预览）</p>
        )}
      </div>

      {p.state !== 'dismissed' && p.checks.length > 0 && (
        <ul className="flex flex-wrap gap-1 px-3 pb-1" aria-label="自检结果">
          {p.checks.map((c) => (
            <li key={c.name}>
              <Badge tone={c.ok ? 'ok' : 'danger'} title={c.why}>
                {c.ok ? <Check /> : <X />}
                {c.name}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && p.state === 'pending' && (
        <p className="px-3 pb-1 text-xs text-warn-fg">{failed.map((c) => c.why).filter(Boolean).join('；') || '有自检未通过，写入前请核对。'}</p>
      )}
      {p.source?.kind === 'comment' && (
        <p className="px-3 pb-1 text-2xs text-fg-subtle" data-testid={`ai-proposal-source-${p.id}`}>
          来自批注 · {p.source.author || '批注'}{p.source.quote ? `「${p.source.quote}」` : ''}
        </p>
      )}
      {p.state !== 'dismissed' && (p.model || p.usage) && (
        <p className="px-3 pb-1 text-2xs text-fg-subtle">
          为什么：{p.source?.kind === 'comment' ? `批注「${p.source.body.slice(0, 40)}${p.source.body.length > 40 ? '…' : ''}」` : `${scenarioLabel(p.scenario)}场景根据${where}生成`}
          {p.usage ? ` · ${p.usage.prompt + p.usage.completion} token` : ''}
        </p>
      )}

      <div className={cn('flex items-center gap-1 border-t border-border px-2 py-1.5', compact && 'flex-wrap')}>
        <Button
          size={compact ? 'md' : 'xs'}
          variant="ghost"
          className={cn(compact && 'flex-1')}
          disabled={!locatable}
          onClick={locate}
          aria-label={`定位到 ${where}`}
          data-testid={`ai-proposal-locate-${p.id}`}
        >
          <Crosshair /> 定位
        </Button>
        {p.state === 'pending' && (
          <>
            <span className="grow" />
            <Button
              size={btn}
              variant="secondary"
              className={cn(compact && 'flex-1')}
              disabled={!canAct || busy != null}
              loading={busy === 'dismiss'}
              onClick={() => void act('dismiss')}
              data-testid={`ai-proposal-dismiss-${p.id}`}
            >
              <X /> 拒绝
            </Button>
            <Button
              size={btn}
              variant="soft"
              className={cn(compact && 'flex-1')}
              disabled={!canAct || busy != null}
              loading={busy === 'apply'}
              onClick={() => void act('apply')}
              data-testid={`ai-proposal-apply-${p.id}`}
            >
              <Check /> {APPLY_LABEL[p.kind]}
            </Button>
          </>
        )}
      </div>
      {busy && <span className="sr-only" role="status"><Loader2 aria-hidden /> 处理中</span>}
    </Card>
  )
}

/** 本地待写入建议（store.suggestions：选区改写 / 术语统一 / OA 答复），接受 → CriticMarkup 进编辑器 → 审阅面板 */
function LocalSuggestionCard({ sug, compact }: { sug: AiSuggestion; compact: boolean }) {
  const dismiss = useStudio((s) => s.dismissSuggestion)
  const toast = useStudio((s) => s.toast)
  const readonly = useStudio(selectReadonly)
  const ast = useStudio((s) => s.ast)
  const content = useStudio((s) => s.content)
  const label = selectionLabel({ lineStart: sug.line_start, lineEnd: sug.line_end }, ast, content)
  const apply = () => {
    applySuggestion(sug)
    toast(`已把对${label}的建议作为修订写入正文，请在审阅面板接受或拒绝`, 'success')
    gotoReview()
  }
  const btn = compact ? 'md' : 'sm'
  return (
    <Card state="pending" data-testid="ai-suggestion" data-source={sug.source}>
      <CardHead title={SUG_SOURCE[sug.source]} loc={label}>
        <Badge tone="ok">修订建议</Badge>
      </CardHead>
      <div className="m-2 rounded-sm bg-sunken px-2.5 py-1.5">
        <CriticPreview markdown={sug.critic_markdown} maxLines={compact ? 6 : 8} />
      </div>
      <div className={cn('flex items-center justify-end gap-1 border-t border-border px-2 py-1.5', compact && 'flex-wrap')}>
        <Button size={btn} variant="secondary" className={cn(compact && 'flex-1')} onClick={() => dismiss(sug.id)} aria-label="拒绝此建议" data-testid="ai-suggestion-dismiss">
          <X /> 拒绝
        </Button>
        <Button size={btn} variant="soft" className={cn(compact && 'flex-1')} onClick={apply} disabled={readonly} title={readonly ? '只读模式：无法写入建议' : undefined} aria-label="接受为 CriticMarkup 建议写入源码" data-testid="ai-suggestion-apply">
          <Check /> 接受为建议
        </Button>
      </div>
    </Card>
  )
}
