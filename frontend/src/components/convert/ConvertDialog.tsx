import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, FolderOpen, History, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { cn } from '@/lib/utils'
import { CONVERT_EXTS } from '@/types/convert'
import { useStudio, selectConvertJob, selectConvertResult } from '@/store'
import { showHistory } from '@/components/shell/shellActions'
import { PickStep } from './PickStep'
import { QuestionnaireStep, TargetStep } from './QuestionnaireStep'
import { DraftDiff, ErrorView, ReportView, RunningView } from './RunStep'

/** 向导视图：store 的 convertStep + 本地「问卷 / 目标」子步 + 由 job 状态派生的 done / error */
type View = 'pick' | 'questionnaire' | 'target' | 'running' | 'done' | 'error'

const STEPS: { id: Exclude<View, 'error'>; label: string }[] = [
  { id: 'pick', label: '选文件' },
  { id: 'questionnaire', label: '问卷' },
  { id: 'target', label: '目标' },
  { id: 'running', label: '生成' },
  { id: 'done', label: '结果' },
]

/**
 * 论文 / 技术交底书转专利向导（docs/plan/09 §3.3 / §6.1）：
 * ① 拖入文件 + 抽取预览 → ② 问卷（可跳过）→ ③ 目标 + 明示外发同意 → 后台任务进度 → 结果报告；
 * target=当前案卷时只写入草稿版本（history commit），预览 diff 后「采纳」= restoreVersion（经 dirty 守卫），「丢弃」= 关闭不动工作区。
 * 关闭时把焦点还给菜单栏「文件」（移动端无菜单栏则走 Radix 默认）。
 */
export function ConvertDialog() {
  const open = useStudio((s) => s.dialog === 'convert')
  const closeDialog = useStudio((s) => s.closeDialog)
  const resetConvert = useStudio((s) => s.resetConvert)
  const unavailable = useStudio((s) => s.convertUnavailable)
  const step = useStudio((s) => s.convertStep)
  const setConvertStep = useStudio((s) => s.setConvertStep)
  const hasSource = useStudio((s) => s.convertFile !== null || s.convertAttachment !== null)
  const ack = useStudio((s) => s.convertAiAck)
  const target = useStudio((s) => s.convertTarget)
  const convertError = useStudio((s) => s.convertError)
  const startConvert = useStudio((s) => s.startConvert)
  const job = useStudio(selectConvertJob)
  const result = useStudio(selectConvertResult)
  const pid = useStudio((s) => s.pid)
  const toast = useStudio((s) => s.toast)
  const questionnaire = useStudio((s) => s.questionnaire)
  const [subStep, setSubStep] = useState<'questionnaire' | 'target'>('questionnaire')
  const [ask, setAsk] = useState(false)

  const view: View =
    step === 'error' || (step === 'running' && (job?.status === 'error' || job?.status === 'interrupted'))
      ? 'error'
      : step === 'running' && job?.status === 'done'
        ? 'done'
        : step === 'questionnaire'
          ? subStep
          : step === 'done'
            ? 'done'
            : step === 'pick'
              ? 'pick'
              : 'running'

  /* 向导三步内的输入（已选文件 / 问卷答案 / 目标 / 同意勾选）关闭即丢——running/done/error 视图不拦（原有语义保留） */
  const inputViews = view === 'pick' || view === 'questionnaire' || view === 'target'
  const dirty = hasSource || Object.values(questionnaire).some((v) => (v ?? '').trim() !== '') || target !== 'new' || ack
  useBeforeUnload(() => open && inputViews && dirty)

  const close = () => {
    if (view === 'running') toast('转换任务继续在后台运行，可在 AI 面板任务列表查看', 'info')
    setSubStep('questionnaire')
    resetConvert()
    closeDialog()
  }
  const requestClose = () => {
    if (inputViews && dirty) setAsk(true)
    else close()
  }
  const onOpenChange = (v: boolean) => {
    if (!v) requestClose()
  }

  const submit = async () => {
    const j = await startConvert()
    if (!j && useStudio.getState().convertUnavailable) toast('转换服务尚未落地（501）', 'error')
  }

  const draftPid = target !== 'new' ? target.pid : null
  const draftSha = result?.draft_sha ?? null

  const adopt = () => {
    if (!draftPid || !draftSha) return
    close()
    useStudio.getState().restoreVersion(draftPid, draftSha)
  }
  const openNew = () => {
    if (!result?.new_pid) return
    const newPid = result.new_pid
    close()
    useStudio.getState().requestNavigation({ type: 'open-project', pid: newPid })
  }
  const viewInHistory = () => {
    if (!draftPid || !draftSha) return
    close()
    showHistory()
    void useStudio.getState().selectVersion(draftPid, draftSha)
  }
  const retry = () => {
    setConvertStep('pick')
    setSubStep('questionnaire')
  }

  const stepIndex = STEPS.findIndex((s) => s.id === (view === 'error' ? 'running' : view))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="ConvertDialog"
        data-testid="convert-dialog"
        data-view={view}
        className="flex max-h-[min(92dvh,720px)] flex-col gap-3 sm:max-w-xl"
        onCloseAutoFocus={(e) => {
          const menu = document.querySelector<HTMLElement>('[data-testid="menu-file"]')
          if (menu) {
            e.preventDefault()
            menu.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>论文 / 技术交底书转专利</DialogTitle>
          <DialogDescription>
            上传 {CONVERT_EXTS.map((e) => `.${e}`).join(' / ')}，可选填交底书问卷，后台生成三书草稿；结果写入新案卷或作为当前案卷的草稿版本，预览 diff 后再采纳，不覆盖工作区。
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="向导步骤" data-testid="convert-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1',
                i === stepIndex ? 'font-medium text-fg' : i < stepIndex ? 'text-ok-fg' : 'text-fg-muted',
              )}
            >
              <span className={cn('inline-flex size-4 items-center justify-center rounded-full border text-2xs tabular-nums', i === stepIndex && 'border-brand-300 bg-selected text-link', i < stepIndex && 'border-ok-dot text-ok-fg')}>
                {i < stepIndex ? <Check className="size-2.5" aria-hidden /> : i + 1}
              </span>
              {s.label}
              {i < STEPS.length - 1 && <span aria-hidden className="mx-0.5 text-fg-subtle">›</span>}
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {unavailable && view !== 'done' && (
            <p role="status" className="mb-2 rounded border border-dashed p-2 text-xs text-fg-muted" data-testid="convert-unavailable">
              转换服务（E3）尚未落地：后端返回 501。向导可走到提交，任务不会真正启动。
            </p>
          )}
          {view === 'pick' && <PickStep />}
          {view === 'questionnaire' && <QuestionnaireStep />}
          {view === 'target' && <TargetStep />}
          {view === 'running' && <RunningView job={job} />}
          {view === 'error' && <ErrorView job={job} error={convertError} />}
          {view === 'done' && result && (
            <div className="flex flex-col gap-3" data-testid="convert-step-done">
              <ReportView result={result} />
              {draftPid && draftSha && <DraftDiff pid={draftPid} sha={draftSha} />}
              {!draftPid && !result.new_pid && !draftSha && (
                <p className="text-xs text-fg-muted">任务已完成，但未返回案卷或草稿标识。</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sm:items-center">
          {view === 'pick' && (
            <>
              <Button type="button" variant="ghost" onClick={requestClose} data-testid="convert-close">取消</Button>
              <Button type="button" disabled={!hasSource} onClick={() => setConvertStep('questionnaire')} data-testid="convert-next">
                下一步 <ArrowRight />
              </Button>
            </>
          )}
          {view === 'questionnaire' && (
            <>
              <Button type="button" variant="ghost" onClick={() => setConvertStep('pick')} data-testid="convert-back" className="sm:mr-auto">
                <ArrowLeft /> 上一步
              </Button>
              <Button type="button" variant="secondary" onClick={() => setSubStep('target')} data-testid="convert-skip">跳过问卷</Button>
              <Button type="button" onClick={() => setSubStep('target')} data-testid="convert-next">
                下一步 <ArrowRight />
              </Button>
            </>
          )}
          {view === 'target' && (
            <>
              <Button type="button" variant="ghost" onClick={() => setSubStep('questionnaire')} data-testid="convert-back" className="sm:mr-auto">
                <ArrowLeft /> 上一步
              </Button>
              <Button type="button" disabled={!hasSource || !ack} onClick={() => void submit()} data-testid="convert-start" title={ack ? undefined : '需先勾选知悉外发'}>
                <Sparkles /> 开始生成
              </Button>
            </>
          )}
          {view === 'running' && (
            <Button type="button" variant="ghost" onClick={close} data-testid="convert-close">后台运行，关闭</Button>
          )}
          {view === 'error' && (
            <>
              <Button type="button" variant="ghost" onClick={close} data-testid="convert-close">关闭</Button>
              <Button type="button" variant="secondary" onClick={retry} data-testid="convert-retry">重新选择文件</Button>
            </>
          )}
          {view === 'done' && (
            <>
              {draftPid && draftSha ? (
                <>
                  <Button type="button" variant="ghost" onClick={close} data-testid="convert-discard" className="sm:mr-auto">
                    <Trash2 /> 丢弃
                  </Button>
                  <Button type="button" variant="secondary" onClick={viewInHistory} data-testid="convert-view-history">
                    <History /> 在版本历史中查看
                  </Button>
                  <Button type="button" onClick={adopt} data-testid="convert-adopt" disabled={!pid}>
                    <Check /> 采纳为工作区
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={close} data-testid="convert-close">关闭</Button>
                  {result?.new_pid && (
                    <Button type="button" onClick={openNew} data-testid="convert-open-new">
                      <FolderOpen /> 打开新案卷
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); close() }} />
    </Dialog>
  )
}
