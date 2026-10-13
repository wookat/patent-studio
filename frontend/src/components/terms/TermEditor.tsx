import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useStudio } from '@/store'
import type { TermDraft } from '@/store/terms'
import type { Term } from '@/types/terms'
import { parseAliases, validateTerm } from './termsModel'

/**
 * 术语编辑表单（新增 / 修改共用）：主名、别名（顿号 / 逗号分隔）、英文、定义、首现行。
 * 每个输入都有 <label>；Enter 提交、Esc 取消。
 */
export function TermEditor({
  initial, others, saving, error, onSave, onCancel,
}: {
  initial: Term
  /** 其余术语（用于本地重名 / 冲突校验） */
  others: Term[]
  saving: boolean
  error?: string | null
  onSave: (t: Term) => void
  onCancel: () => void
}) {
  const id = useId()
  /* 批71：五字段草稿存 store（termDraft）——TermsPanel 随侧栏视图切换/伴随栏换面板/抽屉关闭卸载，
     本地态草稿随实例死；字段兜底 initial（store 草稿必在，父级按 termDraft 才挂载本表单） */
  const termDraft = useStudio((s) => s.termDraft)
  const setTermDraft = useStudio((s) => s.setTermDraft)
  const patch = (p: Partial<TermDraft>) => { if (termDraft) setTermDraft({ ...termDraft, ...p }) }
  const name = termDraft?.name ?? initial.name
  const aliases = termDraft?.aliases ?? initial.aliases.join('、')
  const en = termDraft?.en ?? initial.en ?? ''
  const definition = termDraft?.definition ?? initial.definition ?? ''
  const firstLine = termDraft?.firstLine ?? initial.first_line?.toString() ?? ''
  const [localError, setLocalError] = useState<string | null>(null)

  const build = (): Term => ({
    name: name.trim(),
    aliases: parseAliases(aliases),
    en: en.trim() || null,
    definition: definition.trim() || null,
    first_line: /^\d+$/.test(firstLine.trim()) ? Number(firstLine.trim()) : null,
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = build()
    const err = validateTerm(t, others)
    setLocalError(err)
    if (!err) onSave(t)
  }

  const shown = localError ?? error ?? null
  const isNew = !initial.name

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      aria-label={isNew ? '新增术语' : `编辑术语 ${initial.name}`}
      className="flex flex-col gap-2 rounded-md border border-border bg-sunken p-2"
      data-testid="term-editor"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-name`}>主名 *</Label>
          <Input id={`${id}-name`} value={name} onChange={(e) => patch({ name: e.target.value })} required autoFocus size="sm" data-testid="term-name" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-en`}>英文</Label>
          <Input id={`${id}-en`} value={en} onChange={(e) => patch({ en: e.target.value })} size="sm" data-testid="term-en" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-aliases`}>别名（顿号 / 逗号分隔）</Label>
        <Input id={`${id}-aliases`} value={aliases} onChange={(e) => patch({ aliases: e.target.value })} size="sm" data-testid="term-aliases" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-def`}>定义</Label>
        <Textarea id={`${id}-def`} value={definition} onChange={(e) => patch({ definition: e.target.value })} rows={2} data-testid="term-definition" />
      </div>
      <div className="flex flex-col gap-1 sm:w-32">
        <Label htmlFor={`${id}-line`}>首现行</Label>
        <Input id={`${id}-line`} value={firstLine} onChange={(e) => patch({ firstLine: e.target.value })} inputMode="numeric" pattern="\d*" size="sm" data-testid="term-first-line" />
      </div>
      {shown && (
        <p role="alert" className="text-xs text-danger-fg" data-testid="term-editor-error">
          {shown}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} data-testid="term-cancel">
          取消
        </Button>
        <Button type="submit" size="sm" variant="secondary" disabled={saving} data-testid="term-save">
          {saving ? '保存中…' : isNew ? '添加' : '保存'}
        </Button>
      </div>
    </form>
  )
}
