import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { QUESTIONNAIRE_FIELDS } from '@/types/convert'
import { useStudio } from '@/store'
import { LABEL_NEW_PROJECT } from '@/lib/copy'

/** 向导第 ② 步：交底书问卷（6 个字段，全部可留空 / 整步可跳过）。单列，375 下逐字段纵排。 */
export function QuestionnaireStep() {
  const q = useStudio((s) => s.questionnaire)
  const setQuestionnaire = useStudio((s) => s.setQuestionnaire)
  return (
    <div className="flex flex-col gap-3" data-testid="convert-step-questionnaire">
      <p className="text-xs text-fg-muted">
        补充原文没写清的信息，帮助模型写出完整的三书；全部可留空，也可直接「跳过」。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {QUESTIONNAIRE_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label htmlFor={`convert-q-${key}`}>{label}</Label>
            <Textarea
              id={`convert-q-${key}`}
              rows={2}
              value={q[key] ?? ''}
              onChange={(e) => setQuestionnaire({ [key]: e.target.value })}
              className="min-h-14 text-sm"
              data-testid={`convert-q-${key}`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 向导第 ③ 步：目标（新案卷 / 当前案卷草稿）+ 明示外发同意 */
export function TargetStep() {
  const pid = useStudio((s) => s.pid)
  const target = useStudio((s) => s.convertTarget)
  const setConvertTarget = useStudio((s) => s.setConvertTarget)
  const ack = useStudio((s) => s.convertAiAck)
  const setConvertAiAck = useStudio((s) => s.setConvertAiAck)
  const toDraft = target !== 'new'

  return (
    <div className="flex flex-col gap-4" data-testid="convert-step-target">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">写入目标</legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-sm border p-3 has-[:checked]:border-brand-300 has-[:checked]:bg-selected">
          <input type="radio" name="convert-target" className="mt-1 accent-primary" checked={!toDraft} onChange={() => setConvertTarget('new')} data-testid="convert-target-new" />
          <span className="flex flex-col">
            <span className="font-medium">{LABEL_NEW_PROJECT}</span>
            <span className="text-xs text-fg-muted">生成的三书写入一个新案卷，完成后可直接打开</span>
          </span>
        </label>
        <label
          className="flex cursor-pointer items-start gap-2 rounded-sm border p-3 has-[:checked]:border-brand-300 has-[:checked]:bg-selected has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
        >
          <input
            type="radio"
            name="convert-target"
            className="mt-1 accent-primary"
            checked={toDraft}
            disabled={!pid}
            onChange={() => pid && setConvertTarget({ pid })}
            data-testid="convert-target-draft"
          />
          <span className="flex flex-col">
            <span className="font-medium">当前案卷的草稿版本{pid ? `（${pid}）` : ''}</span>
            <span className="text-xs text-fg-muted">
              {pid ? '写入一次版本历史提交，不覆盖工作区；完成后预览 diff，再决定采纳或丢弃' : '尚未打开案卷'}
            </span>
          </span>
        </label>
      </fieldset>

      <label className="flex items-start gap-2 rounded-sm border border-warn-dot/50 bg-warn-bg p-3 text-sm" data-testid="convert-ack-row">
        <input type="checkbox" className="mt-1 accent-primary" checked={ack} onChange={(e) => setConvertAiAck(e.target.checked)} data-testid="convert-ack" />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">我知悉：上传文件的全文与问卷内容将发送到 AI 中转站（api.aicdks.com）生成草稿</span>
          <span className="text-xs text-fg-muted">
            后台任务使用重型模型（swe-2-max）异步生成，用时约 1–2 分钟；未勾选不会发出任何请求。
          </span>
        </span>
      </label>
    </div>
  )
}
