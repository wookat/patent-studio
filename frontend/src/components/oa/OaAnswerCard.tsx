import { useEffect, useState } from 'react'
import { ArrowLeft, Crosshair, Eye, FilePen, Loader2, Pencil, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Heading } from '@/components/ui/heading'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { OaAnswer, OaItem } from '@/types/oa'
import { OA_KIND_LABEL } from '@/types/oa'
import { pointsFromText } from './oaUtils'

interface Props {
  item: OaItem
  answer: OaAnswer | null
  /** 只读角色（viewer/reviewer）：生成答复 / 编辑要点为 editor 写口，钮禁用并说明 */
  readonly?: boolean
  aiEnabled: boolean
  generating: boolean
  /** 窄容器（375）下显示的「返回列表」 */
  onBack(): void
  onGenerate(): void
  onSavePoints(points: string[]): void
  /** 把该条全部权项建议以 CriticMarkup 写入 claims（editorCommands.replaceLine） */
  onApplyEdits(): void
  onGotoClaim(claim: number): void
  onReview(): void
  /** 要点脏稿状态上报（OaPanel 换条守卫用） */
  onDirtyChange?(dirty: boolean): void
}

/** 单条审查意见的答复卡：原文 · 要点（可编辑）· 修改说明 · 权项 CriticMarkup 建议（写入 / 定位 / 跳审阅）；
   * 批71：要点编辑态/草稿存 store（oaAnswerDraft 按 itemId 认领）——控制台页签切换/关控制台/面板卸载都不再丢稿，
   * 重开同条目直接恢复编辑态（卸载丢草稿族收口；父级 item.id key 重挂语义不变） */
export function OaAnswerCard({ item, answer, readonly, aiEnabled, generating, onBack, onGenerate, onSavePoints, onApplyEdits, onGotoClaim, onReview, onDirtyChange }: Props) {
  const setOaAnswerDraft = useStudio((s) => s.setOaAnswerDraft)
  const editing = useStudio((s) => s.oaAnswerDraft?.itemId === item.id)
  const draft = useStudio((s) => (s.oaAnswerDraft?.itemId === item.id ? s.oaAnswerDraft.text : ''))
  const [askDiscard, setAskDiscard] = useState(false)
  /* 脏稿经「列表」返回也确认——丢弃意图挂起在 pendingBack，确认后回到列表而非只退出编辑 */
  const [pendingBack, setPendingBack] = useState(false)

  const startEdit = () => setOaAnswerDraft({ itemId: item.id, text: (answer?.points ?? []).join('\n') })
  const save = () => {
    onSavePoints(pointsFromText(draft))
    setOaAnswerDraft(null)
  }
  const isDirty = editing && draft !== (answer?.points ?? []).join('\n')
  /* 脏态上报给父级：换条 / 关面板守卫用；key 重挂即卸载，卸载时归零 */
  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])
  /* 要点草稿与已存版本不同才算脏——取消前确认（DiscardDialog 惯例），未改动直接关 */
  const cancelEdit = () => {
    if (isDirty) setAskDiscard(true)
    else setOaAnswerDraft(null)
  }
  const goBack = () => {
    if (isDirty) {
      setPendingBack(true)
      setAskDiscard(true)
    } else onBack()
  }

  return (
    <article className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto" aria-labelledby={`oa-detail-title-${item.id}`} data-testid="oa-detail">
      <header className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={goBack} className="@lg:hidden -ml-2" data-testid="oa-back">
          <ArrowLeft /> 列表
        </Button>
        <Heading id={`oa-detail-title-${item.id}`} className="font-medium">意见 {item.id}</Heading>
        <Badge tone="outline">{OA_KIND_LABEL[item.kind]}</Badge>
        {item.claims.length > 0 && <span className="text-xs text-fg-muted">涉及权利要求 {item.claims.join('、')}</span>}
        {answer?.applied && <Badge tone="ok" data-testid="oa-applied-badge">已写入 claims</Badge>}
      </header>

      <section className="flex flex-col gap-1">
        <Heading offset={1} className="text-xs font-medium text-fg-muted">通知书原文</Heading>
        <p className="whitespace-pre-wrap rounded border bg-sunken p-2 text-xs leading-relaxed" data-testid="oa-detail-text">{item.text}</p>
      </section>

      {!answer ? (
        <div className="flex flex-col items-start gap-2 rounded border border-dashed p-3 text-xs text-fg-muted" data-testid="oa-no-answer">
          <p>尚未生成答复。AI 会给出答复要点与权项修改建议（CriticMarkup），是否写入由你决定。</p>
          {!aiEnabled && <p className="text-warn-fg">本案未允许外发到 AI：请先在 AI 面板打开开关。</p>}
          <Button type="button" size="sm" onClick={onGenerate} disabled={readonly || !aiEnabled || generating} title={readonly ? '只读角色不可生成答复' : undefined} data-testid="oa-generate-one">
            {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} 生成本条答复
          </Button>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-1" data-testid="oa-points">
            <div className="flex items-center gap-2">
              <Heading offset={1} className="text-xs font-medium text-fg-muted">答复要点</Heading>
              {!editing && (
                <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 in-data-[density=touch]:h-touch" onClick={startEdit} disabled={readonly} title={readonly ? '只读角色不可编辑要点' : undefined} data-testid="oa-points-edit">
                  <Pencil /> 编辑
                </Button>
              )}
            </div>
            {editing ? (
              <div className="flex flex-col gap-1">
                <Textarea
                  aria-label="编辑答复要点（每行一条）"
                  value={draft}
                  onChange={(e) => setOaAnswerDraft({ itemId: item.id, text: e.target.value })}
                  rows={Math.max(3, draft.split('\n').length)}
                  className="text-xs"
                  data-testid="oa-points-textarea"
                />
                <div className="flex justify-end gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={cancelEdit} data-testid="oa-points-cancel">取消</Button>
                  <Button type="button" size="sm" onClick={save} data-testid="oa-points-save">保存要点</Button>
                </div>
              </div>
            ) : answer.points.length === 0 ? (
              <p className="text-xs text-fg-muted">（无要点）</p>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed">
                {answer.points.map((p, i) => <li key={i}>{p}</li>)}
              </ol>
            )}
          </section>

          {answer.amend_summary && (
            <section className="flex flex-col gap-1">
              <Heading offset={1} className="text-xs font-medium text-fg-muted">修改说明</Heading>
              <p className="text-xs leading-relaxed" data-testid="oa-amend-summary">{answer.amend_summary}</p>
            </section>
          )}

          <section className="flex flex-col gap-1" data-testid="oa-claim-edits">
            <div className="flex flex-wrap items-center gap-2">
              <Heading offset={1} className="text-xs font-medium text-fg-muted">权项修改建议（CriticMarkup，写入后在审阅面板接受 / 拒绝）</Heading>
            </div>
            {answer.claim_edits.length === 0 ? (
              <p className="text-xs text-fg-muted">无需修改权利要求。</p>
            ) : (
              <ul className="space-y-1.5">
                {answer.claim_edits.map((ce, i) => (
                  <li key={`${ce.claim}-${i}`} className="rounded border p-2" data-testid={`oa-claim-edit-${ce.claim}`}>
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <span className="font-medium">权利要求 {ce.claim}</span>
                      <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 in-data-[density=touch]:h-touch" onClick={() => onGotoClaim(ce.claim)} data-testid={`oa-goto-claim-${ce.claim}`}>
                        <Crosshair /> 定位
                      </Button>
                    </div>
                    <CriticLine text={ce.critic_line} />
                  </li>
                ))}
              </ul>
            )}
            {answer.claim_edits.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {answer.applied ? (
                  <Button type="button" size="sm" variant="secondary" onClick={onReview} data-testid="oa-review">
                    <Eye /> 去审阅面板接受 / 拒绝
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={onApplyEdits} data-testid="oa-apply-edits">
                    <FilePen /> 以修订写入权利要求书（{answer.claim_edits.length} 条）
                  </Button>
                )}
              </div>
            )}
          </section>
        </>
      )}
      <DiscardDialog
        open={askDiscard}
        onStay={() => { setAskDiscard(false); setPendingBack(false) }}
        onDiscard={() => {
          setAskDiscard(false)
          setOaAnswerDraft(null)
          if (pendingBack) {
            setPendingBack(false)
            onBack()
          }
        }}
      />
    </article>
  )
}

const CRITIC = /(\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{~~[\s\S]*?~>[\s\S]*?~~\})/g

/** CriticMarkup 行的只读着色：{++ ++} 绿、{-- --} 红删除线、{~~ a ~> b ~~} 红→绿 */
export function CriticLine({ text }: { text: string }) {
  const parts = text.split(CRITIC)
  return (
    <code className="block whitespace-pre-wrap break-words rounded bg-sunken px-2 py-1 font-mono text-xs leading-relaxed" data-testid="oa-critic-line">
      {parts.map((p, i) => {
        if (p.startsWith('{++')) return <ins key={i} className="rounded bg-ok-bg px-0.5 text-ok-fg no-underline">{p.slice(3, -3)}</ins>
        if (p.startsWith('{--')) return <del key={i} className="rounded bg-danger-bg px-0.5 text-danger-fg">{p.slice(3, -3)}</del>
        if (p.startsWith('{~~')) {
          const [a, b] = p.slice(3, -3).split('~>')
          return (
            <span key={i} className={cn('rounded px-0.5')}>
              <del className="bg-danger-bg text-danger-fg">{a}</del>
              <span aria-hidden className="text-fg-muted">→</span>
              <ins className="bg-ok-bg text-ok-fg no-underline">{b}</ins>
            </span>
          )
        }
        return <span key={i}>{p}</span>
      })}
    </code>
  )
}
