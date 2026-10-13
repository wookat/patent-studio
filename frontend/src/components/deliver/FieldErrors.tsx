import { AlertCircle, ChevronRight } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { FOCUS_RING, cn } from '@/lib/utils'
import type { DeliverError } from '@/types/deliver'
/** 台账字段 → 用户视角名称（案件表单同名字段；未知字段回退到 key） */
export const FIELD_LABEL: Record<string, string> = {
  applicants: '申请人',
  inventors: '发明人',
  case_no: '案号',
  client: '客户',
  kind: '案件类型',
  owner_user_id: '责任人',
  title: '发明名称',
  'dates.filed': '申请日',
  'dates.application_no': '申请号',
}
export const fieldLabel = (field: string) => FIELD_LABEL[field] ?? field

export interface FieldErrorsProps {
  errors: DeliverError[]
  loading: boolean
  /** 后端 501：不渲染（字段级错误是增强项，不阻塞递交页） */
  unavailable: boolean
  /** 点一条 → 打开案件表单并聚焦字段（store.openCaseForm({field})） */
  onOpen(field: string): void
  className?: string
}

/**
 * 递交页字段级错误（21 §4.4 / R-CHK-05）：GET /deliver/errors 的 errors[]，每条一个 destructive Alert，整条可点击 →
 * openCaseForm({ field })。没有错误 / 501 ⇒ 不渲染（体检表已经有「通过」空态，不重复）。
 * 规则 code 只落在 data-code（技术定位），界面只显示字段名 + 人话 message。
 */
export function FieldErrors({ errors, loading, unavailable, onOpen, className }: FieldErrorsProps) {
  if (unavailable) return null
  if (loading && errors.length === 0) return <Skeleton className="h-12 w-full" data-testid="field-errors-loading" />
  if (errors.length === 0) return null
  return (
    <section data-slot="FieldErrors" data-testid="field-errors" aria-label="台账字段错误" className={cn('grid gap-2', className)}>
      <h2 className="text-sm font-semibold text-fg-strong">
        台账字段 <span className="text-fg-muted">· {errors.length} 项待补</span>
      </h2>
      <ul className="grid gap-2">
        {errors.map((e) => (
          <li key={`${e.field}:${e.code}`}>
            <button
              type="button"
              className={cn('w-full rounded-md text-left', FOCUS_RING)}
              onClick={() => onOpen(e.field)}
              data-testid={`field-error-${e.field}`}
              data-field={e.field}
              data-code={e.code}
            >
              <Alert variant="danger" role="presentation" className="transition-colors hover:border-danger-dot/60">
                <AlertCircle />
                <AlertTitle className="flex items-center gap-1">
                  {fieldLabel(e.field)}
                  <ChevronRight className="ml-auto size-4 text-fg-muted" aria-hidden />
                </AlertTitle>
                <AlertDescription>{e.message} · 点击打开案件表单填写</AlertDescription>
              </Alert>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
