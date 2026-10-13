import { useState, type FormEvent } from 'react'
import { PASSWORD_MIN } from '@/components/auth/session'
import { Button } from '@/components/ui/button'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { MeIn } from '@/types/account'
import { validatePassword, type FormErrors } from './formErrors'

export interface PasswordFormProps {
  saving: boolean
  unavailable: boolean
  onSave(patch: MeIn): Promise<FormErrors | null>
}

/**
 * 账户页改密（17 §3.2 / 21 §4.6）：当前密码 + 新密码 + 确认 → PUT /api/users/me {password:{current,new}}。
 * 唯一改密入口；字段级错误用 Field.error；借鉴 Overleaf「Change Password」要求当前密码。
 */
export function PasswordForm({ saving, unavailable, onSave }: PasswordFormProps) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validatePassword({ current, next, confirm })
    setErrors(errs)
    if (Object.keys(errs).length) return
    const fe = await onSave({ password: { current, new: next } })
    if (fe) {
      setErrors(fe) // 服务端字段错（如当前密码不正确）落到对应字段
    } else {
      setCurrent('')
      setNext('')
      setConfirm('')
    }
  }

  return (
    <form data-slot="PasswordForm" data-testid="password-form" className="grid max-w-form gap-4" onSubmit={(e) => void submit(e)} aria-busy={saving || undefined} noValidate>
      <Field error={errors.current}>
        <FieldLabel>当前密码</FieldLabel>
        <FieldControl>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" disabled={unavailable} data-testid="password-current" />
        </FieldControl>
        <FieldError data-testid="password-current-error" />
      </Field>
      <Field error={errors.next}>
        <FieldLabel>新密码</FieldLabel>
        <FieldControl>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" disabled={unavailable} data-testid="password-new" />
        </FieldControl>
        <FieldDescription>至少 {PASSWORD_MIN} 位；改密后所有设备（含本会话）需重新登录。</FieldDescription>
        <FieldError data-testid="password-new-error" />
      </Field>
      <Field error={errors.confirm}>
        <FieldLabel>确认新密码</FieldLabel>
        <FieldControl>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" disabled={unavailable} data-testid="password-confirm" />
        </FieldControl>
        <FieldError data-testid="password-confirm-error" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || unavailable || !current || !next || !confirm} data-testid="password-save">
          {saving ? '修改中…' : '修改密码'}
        </Button>
        {unavailable && <span className="text-xs text-fg-muted">账户接口当前不可用（501），暂不可修改</span>}
        {(errors._form || Object.keys(errors).length > 0) && (
          <span role="alert" className="text-xs text-danger-fg" data-testid="password-error">
            {errors._form ?? '请修正标红的字段后再提交'}
          </span>
        )}
      </div>
    </form>
  )
}
