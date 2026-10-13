import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  FEE_STATUS_LABEL,
  FEE_STATUSES,
  type CaseFormErrors,
  type CaseFormValues,
  type FeeStatus,
  type Priority,
} from '@/lib/caseForm'
import { cn } from '@/lib/utils'
import { KIND_LABEL, RELATED_KIND_LABEL, type CaseKind, type RelatedCase, type RelatedKind } from '@/types/case'

export interface CaseFormProps {
  values: CaseFormValues
  errors: CaseFormErrors
  onChange(patch: Partial<CaseFormValues>): void
  /** viewer 只读 */
  readonly?: boolean
  /** 375：控件 44px */
  mobile?: boolean
  className?: string
}

const NONE = '__none__'
const CASE_KINDS = Object.keys(KIND_LABEL) as CaseKind[]

type TextKey = { [K in keyof CaseFormValues]: CaseFormValues[K] extends string ? K : never }[keyof CaseFormValues]

/**
 * 案件元数据表单（21 §2 R-CASE-02）：只渲染 + 校验展示，值 / 错误由父组件持有（lib/caseForm.ts 纯函数）。
 * 分四组：基本 · 日期 · 人员 · 优先权 / 费用；旧 case.json 没有的字段一律显示空值。
 */
export function CaseForm({ values, errors, onChange, readonly, mobile, className }: CaseFormProps) {
  const size = mobile ? 'xl' : 'md'
  const text = (key: TextKey, label: string, opts: { type?: string; placeholder?: string; mono?: boolean; inputMode?: 'decimal'; description?: string } = {}) => (
    <Field error={errors[key]} key={key}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Input
          type={opts.type ?? 'text'}
          size={size}
          value={values[key]}
          placeholder={opts.placeholder}
          readOnly={readonly}
          inputMode={opts.inputMode}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<CaseFormValues>)}
          className={cn(opts.mono && 'tabular-nums')}
          data-testid={`case-${key}`}
        />
      </FieldControl>
      {opts.description && <FieldDescription>{opts.description}</FieldDescription>}
      <FieldError />
    </Field>
  )
  const date = (key: TextKey, label: string, description?: string) => text(key, label, { type: 'date', placeholder: 'YYYY-MM-DD', mono: true, description })
  const setPriority = (i: number, patch: Partial<Priority>) => onChange({ priority: values.priority.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const setRelated = (i: number, patch: Partial<RelatedCase>) => onChange({ related: values.related.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const RELATED_KINDS = Object.keys(RELATED_KIND_LABEL) as RelatedKind[]

  return (
    <div className={cn('grid gap-5', className)} data-slot="case-form">
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-xs font-medium text-fg-muted">基本信息</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {text('caseNo', '案号', { placeholder: 'PS-2026-001', mono: true })}
          <Field error={errors.kind}>
            <FieldLabel>类型</FieldLabel>
            <Select value={values.kind} onValueChange={(v) => onChange({ kind: v as CaseKind })} disabled={readonly}>
              <FieldControl>
                <SelectTrigger size={size} data-testid="case-kind">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {CASE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError />
          </Field>
          {/* 批77：申请号是数字+点结构——移动端给数字键盘（FilingDialog inputMode=decimal 同闸） */}
          {text('applicationNo', '申请号', { placeholder: '202610123456.7', mono: true, inputMode: 'decimal' })}
          {text('client', '客户', { placeholder: '委托单位 / 个人' })}
          {text('clientContact', '客户联系人', { placeholder: '姓名 · 电话 / 邮箱' })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field error={errors.applicants}>
            <FieldLabel>申请人</FieldLabel>
            <FieldControl>
              <Textarea rows={2} value={values.applicants} readOnly={readonly} onChange={(e) => onChange({ applicants: e.target.value })} placeholder="一行一个" data-testid="case-applicants" />
            </FieldControl>
            <FieldError />
          </Field>
          <Field error={errors.inventors}>
            <FieldLabel>发明人</FieldLabel>
            <FieldControl>
              <Textarea rows={2} value={values.inventors} readOnly={readonly} onChange={(e) => onChange({ inventors: e.target.value })} placeholder="一行一个" data-testid="case-inventors" />
            </FieldControl>
            <FieldError />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-xs font-medium text-fg-muted">关键日期</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {date('opened', '立案日')}
          {date('targetFiling', '目标递交日', '代理机构自定，非法定期限')}
          {date('filingDate', '申请日', '实际递交 / 受理日，期限推算的起算日')}
          {date('publicationDate', '公开日')}
          {date('examRequestDate', '实审请求日')}
          {date('grantDate', '授权日')}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-xs font-medium text-fg-muted">人员与费用</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {text('attorney', '代理师', { placeholder: '主办代理师' })}
          {text('reviewer', '审核人', { placeholder: '内审 / 质检' })}
          <Field error={errors.feeStatus}>
            <FieldLabel>费用状态</FieldLabel>
            <Select value={values.feeStatus || NONE} onValueChange={(v) => onChange({ feeStatus: v === NONE ? '' : (v as FeeStatus) })} disabled={readonly}>
              <FieldControl>
                <SelectTrigger size={size} data-testid="case-feeStatus">
                  <SelectValue placeholder="未设置" />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value={NONE}>未设置</SelectItem>
                {FEE_STATUSES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FEE_STATUS_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-fg-muted">
          优先权
          {!readonly && (
            <Button type="button" variant="ghost" size={mobile ? 'lg' : 'sm'} onClick={() => onChange({ priority: [...values.priority, { country: 'CN', date: '', number: '' }] })} data-testid="priority-add">
              <Plus aria-hidden />
              添加优先权
            </Button>
          )}
        </legend>
        {values.priority.length === 0 ? (
          <p className="text-sm text-fg-muted">无优先权要求。</p>
        ) : (
          <ul className="grid gap-3">
            {values.priority.map((p, i) => (
              <li key={i} className="grid items-start gap-2 rounded-md border border-border bg-sunken p-3 sm:grid-cols-[6rem_1fr_1fr_auto]" data-testid={`priority-${i}`}>
                <Field error={errors[`priority.${i}.country`]}>
                  <FieldLabel>国别</FieldLabel>
                  <FieldControl>
                    <Input size={size} value={p.country} readOnly={readonly} maxLength={2} placeholder="CN" className="uppercase" onChange={(e) => setPriority(i, { country: e.target.value })} data-testid={`priority-${i}-country`} />
                  </FieldControl>
                  <FieldError />
                </Field>
                <Field error={errors[`priority.${i}.date`]}>
                  <FieldLabel>优先权日</FieldLabel>
                  <FieldControl>
                    <Input type="date" size={size} value={p.date} readOnly={readonly} className="tabular-nums" onChange={(e) => setPriority(i, { date: e.target.value })} data-testid={`priority-${i}-date`} />
                  </FieldControl>
                  <FieldError />
                </Field>
                <Field error={errors[`priority.${i}.number`]}>
                  <FieldLabel>在先申请号</FieldLabel>
                  <FieldControl>
                    <Input size={size} value={p.number} readOnly={readonly} className="tabular-nums" onChange={(e) => setPriority(i, { number: e.target.value })} data-testid={`priority-${i}-number`} />
                  </FieldControl>
                  <FieldError />
                </Field>
                {!readonly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size={mobile ? 'icon-xl' : 'icon'}
                    className="sm:mt-6"
                    aria-label={`删除第 ${i + 1} 项优先权`}
                    onClick={() => onChange({ priority: values.priority.filter((_, j) => j !== i) })}
                    data-testid={`priority-${i}-remove`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-fg-muted">
          关联案
          {!readonly && (
            <Button
              type="button"
              variant="ghost"
              size={mobile ? 'lg' : 'sm'}
              onClick={() => onChange({ related: [...values.related, { pid: '', kind: 'associated', note: '' }] })}
              data-testid="related-add"
            >
              <Plus aria-hidden />
              添加关联案
            </Button>
          )}
        </legend>
        {values.related.length === 0 ? (
          <p className="text-sm text-fg-muted">无关联案。分案↔母案由「新建分案」自动登记，也可手动添加。</p>
        ) : (
          <ul className="grid gap-3">
            {values.related.map((r, i) => (
              <li key={i} className="grid items-start gap-2 rounded-md border border-border bg-sunken p-3 sm:grid-cols-[6.5rem_1fr_1fr_auto]" data-testid={`related-${i}`}>
                <Field error={errors[`related.${i}.kind`]}>
                  <FieldLabel>关系</FieldLabel>
                  <Select value={r.kind} onValueChange={(v) => setRelated(i, { kind: v as RelatedKind })} disabled={readonly}>
                    <FieldControl>
                      <SelectTrigger size={size} data-testid={`related-${i}-kind`}>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {RELATED_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {RELATED_KIND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError />
                </Field>
                <Field error={errors[`related.${i}.pid`]}>
                  <FieldLabel>案卷标识</FieldLabel>
                  <FieldControl>
                    <Input size={size} value={r.pid} readOnly={readonly} placeholder="案卷 id" className="font-mono" onChange={(e) => setRelated(i, { pid: e.target.value })} data-testid={`related-${i}-pid`} />
                  </FieldControl>
                  <FieldError />
                </Field>
                <Field error={errors[`related.${i}.note`]}>
                  <FieldLabel>备注</FieldLabel>
                  <FieldControl>
                    <Input size={size} value={r.note} readOnly={readonly} placeholder="可空" onChange={(e) => setRelated(i, { note: e.target.value })} data-testid={`related-${i}-note`} />
                  </FieldControl>
                  <FieldError />
                </Field>
                <div className="flex items-start gap-1 sm:mt-6">
                  {r.pid.trim() && (
                    <a
                      href={`#/p/${encodeURIComponent(r.pid.trim())}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex size-sm-control shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"
                      aria-label={`打开案卷 ${r.pid.trim()}`}
                      data-testid={`related-${i}-open`}
                    >
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                  {!readonly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size={mobile ? 'icon-xl' : 'icon'}
                      aria-label={`删除第 ${i + 1} 项关联案`}
                      onClick={() => onChange({ related: values.related.filter((_, j) => j !== i) })}
                      data-testid={`related-${i}-remove`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  )
}
