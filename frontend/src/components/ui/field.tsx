import * as React from 'react'
import { cn } from '@/lib/utils'
import { Label } from './label'

/**
 * Field（受控错误）：`<Field error={errors.title}> <FieldLabel/> <FieldControl>{input}</FieldControl> <FieldDescription/> <FieldError/> </Field>`
 * - FieldControl 给子控件注入 id / aria-invalid / aria-describedby（与 lib/formErrors.ts 的 422 → 字段映射配套）
 * - FieldError 12px destructive；无 error 不渲染
 */
interface FieldContextValue {
  id: string
  error?: string
  descriptionId: string
  errorId: string
}
const FieldContext = React.createContext<FieldContextValue | null>(null)

function useField() {
  const ctx = React.useContext(FieldContext)
  if (!ctx) throw new Error('Field* 组件须放在 <Field> 内')
  return ctx
}

interface FieldProps extends React.ComponentProps<'div'> {
  error?: string
  /** 控件 id（默认 useId） */
  id?: string
}

function Field({ className, error, id: idProp, children, ...props }: FieldProps) {
  const auto = React.useId()
  const id = idProp ?? `field-${auto}`
  const value = React.useMemo(() => ({ id, error, descriptionId: `${id}-desc`, errorId: `${id}-err` }), [id, error])
  return (
    <FieldContext.Provider value={value}>
      <div data-slot="field" data-invalid={error ? '' : undefined} className={cn('grid gap-1.5', className)} {...props}>
        {children}
      </div>
    </FieldContext.Provider>
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { id, error } = useField()
  return <Label data-slot="field-label" htmlFor={id} className={cn(error && 'text-destructive', className)} {...props} />
}

/** 单子元素：克隆并注入 id / aria-* */
function FieldControl({ children }: { children: React.ReactElement<Record<string, unknown>> }) {
  const { id, error, descriptionId, errorId } = useField()
  const describedBy = [error ? errorId : null, descriptionId].filter(Boolean).join(' ') || undefined
  return React.cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'data-slot': 'field-control',
  })
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { descriptionId } = useField()
  return <p data-slot="field-description" id={descriptionId} className={cn('text-xs text-muted-foreground', className)} {...props} />
}

function FieldError({ className, children, ...props }: React.ComponentProps<'p'>) {
  const { error, errorId } = useField()
  const text = children ?? error
  if (!text) return null
  return (
    <p data-slot="field-error" id={errorId} role="alert" className={cn('text-xs text-destructive', className)} {...props}>
      {text}
    </p>
  )
}

export { Field, FieldLabel, FieldControl, FieldDescription, FieldError }
