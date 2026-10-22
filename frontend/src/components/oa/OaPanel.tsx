import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileUp, Gavel, Loader2, Sparkles } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { FOCUS_RING, cn } from '@/lib/utils'
import { editorCommands } from '@/components/editor/commands'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { ATTACHMENT_MAX_BYTES } from '@/types/attachments'
import type { OaAnswer } from '@/types/oa'
import { useStudio, selectAiEnabled, selectOaJob, selectReadonly } from '@/store'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { OaItemList } from './OaItemList'
import { OaAnswerCard } from './OaAnswerCard'
import { OaRounds } from './OaRounds'
import { findClaimLine } from './oaUtils'

/**
 * OA 答复工作台（docs/plan/09 §3.4 / §6.1；控制台 tab「OA」）：
 * 粘贴 / 上传通知书 → 拆条（确定性，不出站）→ 条目列表 · 答复卡（生成 / 编辑要点 / 权项 CriticMarkup 写入 claims）→ 导出意见陈述书。
 * 容器 ≥ 42rem 双栏（列表 | 详情），更窄（375）单列：列表 → 点进详情（返回按钮）。
 * 权项写入走 editorCommands.replaceLine 整行替换为 CriticMarkup 行，从不直接改写；接受 / 拒绝在审阅面板完成。
 * W5（§6.6 / R-OA-05）：顶部轮次条（一通 / 二通…，登记发文日 → 期限）；PDF 上传直接拆条（api.oaParsePdf）；
 * 每条「生成争辩稿（AI）」→ S7 → Proposal 进 AI 面板「建议」tab。
 */
export function OaPanel() {
  const pid = useStudio((s) => s.pid)
  const text = useStudio((s) => s.oaText)
  const setOaText = useStudio((s) => s.setOaText)
  const parseOa = useStudio((s) => s.parseOa)
  const parsing = useStudio((s) => s.oaParsing)
  const items = useStudio((s) => s.oaItems)
  const warnings = useStudio((s) => s.oaWarnings)
  const answers = useStudio((s) => s.oaAnswers)
  const activeId = useStudio((s) => s.oaActiveItemId)
  const setOaActiveItem = useStudio((s) => s.setOaActiveItem)
  const answerOa = useStudio((s) => s.answerOa)
  const setOaAnswers = useStudio((s) => s.setOaAnswers)
  const saveOaPoints = useStudio((s) => s.saveOaPoints)
  const markOaApplied = useStudio((s) => s.markOaApplied)
  const error = useStudio((s) => s.oaError)
  const unavailable = useStudio((s) => s.oaUnavailable)
  const job = useStudio(selectOaJob)
  const aiEnabled = useStudio(selectAiEnabled)
  const toast = useStudio((s) => s.toast)
  const readonly = useStudio(selectReadonly)
  const parseOaPdf = useStudio((s) => s.parseOaPdf)
  const loadOaRounds = useStudio((s) => s.loadOaRounds)
  const loadOaItems = useStudio((s) => s.loadOaItems)
  const argueOaItem = useStudio((s) => s.argueOaItem)
  const argueItemId = useStudio((s) => s.oaArgueItemId)
  const argueJob = useStudio((s) => (s.oaArgueJobId ? s.agentJobs.find((j) => j.id === s.oaArgueJobId) ?? null : null))
  const isDesktop = useIsDesktop()
  const fileRef = useRef<HTMLInputElement>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [inputOpen, setInputOpen] = useState(true)
  const appliedJob = useRef<string | null>(null)

  const generating = job?.status === 'queued' || job?.status === 'running'
  const arguing = argueJob?.status === 'queued' || argueJob?.status === 'running'
  const arguingItemId = arguing ? argueItemId : null

  useEffect(() => {
    if (!pid) return
    void loadOaRounds(pid)
    /* D-OA-1：拆条工作集只写不读时代刷新即丢——面板挂载即把 items.json + 已存答复灌回 */
    void loadOaItems(pid)
  }, [pid, loadOaRounds, loadOaItems])

  // job 完成 → 把 result.answers 写入 oaAnswers（每个 job 只写一次）
  useEffect(() => {
    if (!job || job.status !== 'done' || appliedJob.current === job.id) return
    appliedJob.current = job.id
    const list = job.result?.answers
    if (Array.isArray(list)) setOaAnswers(list as OaAnswer[])
  }, [job, setOaAnswers])

  const active = items.find((it) => it.id === activeId) ?? null
  const answered = Object.keys(answers).length

  const onUpload = async (file: File | undefined) => {
    if (!file) return
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast(`通知书过大：上限 ${Math.floor(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB（${(file.size / 1024 / 1024).toFixed(1)} MB）`, 'error')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') {
      await parseOaPdf(file)
      if (useStudio.getState().oaItems.length > 0) setInputOpen(false)
    } else if (ext !== 'txt' && ext !== 'md') {
      toast('通知书上传只接受 .txt / .md 文本或带文字层的 .pdf；docx 请先复制正文粘贴', 'info')
    } else {
      setOaText((await file.text()).replace(/\r\n?/g, '\n'))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const parse = async () => {
    await parseOa()
    if (useStudio.getState().oaItems.length > 0) setInputOpen(false)
  }

  /* 详情脏稿（答复要点编辑中）换条守卫：OaAnswerCard 经 onDirtyChange 上报；
     脏时点别的条目先 DiscardDialog，确认放弃才真正换条（批54 goBack 同族）.
     select 不再无条件清 detailDirty——脏时点「当前已选中条目」会把守卫清空、
     随后换条绕过确认（批73 OBS-B71-2 收口）；仅在确认放弃路径清 */
  const [detailDirty, setDetailDirty] = useState(false)
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)
  const select = (id: string) => {
    setOaActiveItem(id)
    setDetailOpen(true)
  }
  const selectGuarded = (id: string) => {
    if (detailDirty && id !== activeId) setPendingSelect(id)
    else select(id)
  }
  /* 批73：store 草稿只保重挂不保刷新——脏稿关页签同 TermsPanel 惯例拦 beforeunload */
  useBeforeUnload(() => detailDirty)

  const generate = async (ids?: string[]) => {
    const j = await answerOa(ids)
    if (!j && useStudio.getState().oaUnavailable) toast('OA 答复服务尚未落地（501）', 'error')
  }

  const gotoClaim = (claim: number): number | null => {
    const line = findClaimLine(useStudio.getState().content, claim)
    if (line === null) {
      toast(`未在「权利要求书」中找到第 ${claim} 项`, 'error')
      return null
    }
    useStudio.getState().gotoLine(line)
    return line
  }

  const applyEdits = () => {
    if (!active) return
    const a = answers[active.id]
    if (!a) return
    let ok = 0
    let lastLine: number | null = null
    for (const ce of a.claim_edits) {
      const line = findClaimLine(useStudio.getState().content, ce.claim)
      if (line === null) {
        toast(`未找到权利要求 ${ce.claim}，已跳过`, 'error')
        continue
      }
      if (!editorCommands.replaceLine(line, '', ce.critic_line)) {
        toast('编辑器未显示：请切到「双栏」或「仅编辑」后再试', 'info')
        return
      }
      ok++
      lastLine = line
    }
    if (ok === 0) return
    markOaApplied(active.id)
    toast(`已把 ${ok} 条修订建议写入权利要求书，请到审阅面板接受 / 拒绝`, 'success')
    if (lastLine !== null) useStudio.getState().requestScroll(lastLine)
  }

  const review = () => {
    const s = useStudio.getState()
    if (isDesktop) s.setRailTab('review')
    else s.openMobileNav('review')
  }
  /** 与 CommentCard「转提案」同一路径：伴随栏 / 底栏 AI 页签 */
  const openAiPanel = () => {
    const s = useStudio.getState()
    if (isDesktop) s.openCompanion('ai')
    else s.setMobileTab('ai')
  }

  /** W5 R-OA-03：S7 争辩稿 → Proposal；成功后切到 AI 面板「建议」tab（任务进行中时在「任务与历史」可见） */
  const argue = async (itemId: string) => {
    setOaActiveItem(itemId)
    const j = await argueOaItem(itemId)
    const s = useStudio.getState()
    if (!j) {
      if (s.agentUnavailable) toast('争辩稿生成（S7）尚未落地（501）', 'error')
      else if (s.agentDisabledByOrg) toast('机构已禁用 AI', 'error')
      else if (s.agentError) toast(s.agentError, 'error')
      return
    }
    s.setAgentTab('proposals')
    openAiPanel()
    toast('争辩稿任务已提交，完成后在 AI 面板「建议」tab 处置（不会直接改写源码）', 'success')
  }

  const exportUrl = pid ? api.oaExportUrl(pid) : undefined

  return (
    <div data-slot="OaPanel" data-testid="oa-panel" className="@container flex h-full min-h-0 flex-col gap-2 p-3 text-sm">
      {pid && <OaRounds readonly={readonly} compact={!isDesktop} />}
      <section className="flex flex-col gap-2 border-t pt-2" data-testid="oa-input" aria-labelledby="oa-input-title">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            id="oa-input-title"
            className={cn('inline-flex items-center gap-1 text-xs font-medium text-fg-muted in-data-[density=touch]:min-h-touch', FOCUS_RING)}
            onClick={() => setInputOpen((v) => !v)}
            aria-expanded={inputOpen}
            aria-controls="oa-input-body"
            data-testid="oa-input-toggle"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', !inputOpen && '-rotate-90')} aria-hidden />
            审查意见通知书正文
            {items.length > 0 && <span className="font-normal">· 已拆 {items.length} 条</span>}
          </button>
          {unavailable && <span className="text-xs text-fg-muted" data-testid="oa-unavailable">OA 工作台（E3）尚未落地：后端返回 501</span>}
          {error && !unavailable && <span role="alert" className="text-xs text-danger-fg" data-testid="oa-error">{error}</span>}
        </div>
        <div id="oa-input-body" className={cn('flex flex-col gap-2', !inputOpen && 'hidden')}>
          <label htmlFor="oa-text" className="sr-only">审查意见通知书正文（粘贴）</label>
          <Textarea
            id="oa-text"
            value={text}
            onChange={(e) => setOaText(e.target.value)}
            placeholder="粘贴通知书正文；按「1.」「2.」/「关于权利要求」拆条（本地确定性处理，不发送到 AI）"
            rows={5}
            disabled={!pid || readonly}
            className="text-xs"
            data-testid="oa-text"
          />
          <input ref={fileRef} type="file" accept=".txt,.md,.pdf,application/pdf" className="sr-only" aria-label="上传通知书文件（.txt / .md / .pdf）" onChange={(e) => void onUpload(e.target.files?.[0])} data-testid="oa-file-input" />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => void parse()} disabled={!pid || readonly || parsing || !text.trim()} title={readonly ? '只读角色不可拆条' : undefined} data-testid="oa-parse">
              {parsing ? <Loader2 className="animate-spin" aria-hidden /> : <Gavel aria-hidden />} 拆条
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={!pid || readonly} title={readonly ? '只读角色不可上传通知书' : undefined} data-testid="oa-upload">
              <FileUp aria-hidden /> 上传 .txt / .md / .pdf
            </Button>
            {!pid && <span className="text-xs text-fg-muted">请先打开案卷</span>}
          </div>
          {warnings.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-warn-fg" aria-label="拆条警告" data-testid="oa-warnings">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      </section>

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-t pt-2" data-testid="oa-toolbar">
            <Button type="button" size="sm" onClick={() => void generate()} disabled={readonly || !aiEnabled || generating} title={readonly ? '只读角色不可生成答复' : undefined} data-testid="oa-generate-all">
              {generating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} AI 生成全部答复
            </Button>
            {!aiEnabled && (
              <button type="button" className="text-xs text-warn-fg underline-offset-2 hover:underline" onClick={openAiPanel} data-testid="oa-ai-hint">
                未允许外发到 AI，去 AI 面板开启
              </button>
            )}
            {generating && (
              <div className="flex min-w-32 flex-1 items-center gap-2" aria-live="polite" data-testid="oa-progress">
                <div role="progressbar" aria-label="答复生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((job?.progress ?? 0) * 100)} className="h-1.5 flex-1 overflow-hidden rounded bg-sunken">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
                </div>
                <span className="text-xs text-fg-muted">{job?.message || '排队中…'}</span>
              </div>
            )}
            {job?.status === 'error' && <span role="alert" className="text-xs text-danger-fg" data-testid="oa-job-error">生成失败：{job.error?.message ?? '未知错误'}</span>}
            {answered > 0 && exportUrl ? (
              <Button asChild size="sm" variant="secondary" className="ml-auto" data-testid="oa-export">
                <a href={exportUrl} download>
                  <Download aria-hidden /> 导出意见陈述书 DOCX
                </a>
              </Button>
            ) : (
              <Button type="button" size="sm" variant="secondary" className="ml-auto" disabled title="先生成至少一条答复" data-testid="oa-export">
                <Download aria-hidden /> 导出意见陈述书 DOCX
              </Button>
            )}
            {items.length - answered > 0 && (
              <span className="text-xs text-warn-fg" data-testid="oa-unanswered">还有 {items.length - answered} 条未答复</span>
            )}
          </div>

          <div className="grid min-h-0 flex-1 gap-3 @lg:grid-cols-[minmax(200px,2fr)_minmax(0,3fr)]" data-testid="oa-workspace">
            <OaItemList
              items={items}
              answers={answers}
              activeId={activeId}
              onSelect={selectGuarded}
              className={cn(detailOpen && active && 'hidden @lg:block')}
            />
            {active ? (
              <div className={cn('flex min-h-0 flex-col gap-2', !detailOpen && 'hidden @lg:flex')}>
                {!readonly && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed px-2 py-1.5 text-xs" data-testid="oa-argue-bar">
                    <span className="text-fg-muted">争辩稿以修订建议形态进入 AI 面板「建议」，不会直接改写源码</span>
                    <Button
                      type="button"
                      size={isDesktop ? 'sm' : 'xl'}
                      variant="outline"
                      className={cn(!isDesktop && 'min-h-11 w-full')}
                      disabled={!aiEnabled || arguing}
                      onClick={() => void argue(active.id)}
                      aria-label={`对意见 ${active.id} 生成争辩稿（AI）`}
                      data-testid={`oa-argue-${active.id}`}
                    >
                      {arguingItemId === active.id ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} 生成争辩稿（AI）
                    </Button>
                  </div>
                )}
                <OaAnswerCard
                  key={active.id}
                  item={active}
                  answer={answers[active.id] ?? null}
                  readonly={readonly}
                  aiEnabled={aiEnabled}
                  generating={generating}
                  onBack={() => setDetailOpen(false)}
                  onGenerate={() => void generate([active.id])}
                  onSavePoints={(points) => void saveOaPoints(active.id, points)}
                  onApplyEdits={applyEdits}
                  onGotoClaim={(c) => void gotoClaim(c)}
                  onReview={review}
                  onDirtyChange={setDetailDirty}
                />
              </div>
            ) : (
              <p className="hidden self-center text-center text-xs text-fg-muted @lg:block">选择左侧条目查看 / 生成答复</p>
            )}
          </div>
        </>
      )}
      <DiscardDialog
        open={pendingSelect !== null}
        onStay={() => setPendingSelect(null)}
        onDiscard={() => {
          const id = pendingSelect
          setPendingSelect(null)
          /* 批71：确认「放弃修改」须同时清 store 草稿——否则换回原条目时草稿仍在（回复草稿按条目保留是刻意，
             但本路径用户已明示放弃）；批73：守卫脏旗也在此清（select 已不代劳） */
          setDetailDirty(false)
          useStudio.getState().setOaAnswerDraft(null)
          if (id) select(id)
        }}
      />
    </div>
  )
}
