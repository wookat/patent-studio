import { useId, useState, type FormEvent } from 'react'
import { labelText } from '@/collab/colors'
import { Button } from '@/components/ui/button'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { User } from '@/lib/types'
import { cn, touchHit } from '@/lib/utils'
import { AVATAR_COLORS, AVATAR_COLOR_HEX, USER_TITLES, avatarColorFor, type AvatarColor, type MeIn, type UserTitle } from '@/types/account'
import { validateProfile, type FormErrors } from './formErrors'

export interface ProfileFormProps {
  user: User
  saving: boolean
  /** PUT /api/users/me 返回 501（auth=off 或未启用的部署）：表单只读 */
  unavailable: boolean
  onSave(patch: MeIn): Promise<FormErrors | null>
  /** 375（06 §2.3 / §3.1）：字段间 24、Label→说明 4、同组 chip 间 8；头衔 chip sm 32、头像色圆点 32（命中区 touchHit 44） */
  mobile?: boolean
}

const isTitle = (v: string): v is UserTitle => v === '' || (USER_TITLES as readonly string[]).includes(v)

/**
 * 个人资料表单（17 §3.2 / 21 §4.6）：显示名（Field + 字段级错误）/ 头衔（展示用单选）/ 头像色（8 色 swatch，不选则按名字派生）；
 * 只提交改动过的字段；改密码在 PasswordForm。单列 max-w-form（640），375 全宽。
 */
export function ProfileForm({ user, saving, unavailable, onSave, mobile = false }: ProfileFormProps) {
  const uid = useId()
  const [name, setName] = useState(user.display_name)
  const [title, setTitle] = useState<UserTitle>(isTitle(user.title ?? '') ? (user.title as UserTitle) : '')
  const [color, setColor] = useState<AvatarColor>((user.avatar_color as AvatarColor) ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const derived = avatarColorFor(user.display_name || user.email)
  const shown = color || derived
  const dirty = name.trim() !== user.display_name || title !== (user.title ?? '') || color !== (user.avatar_color ?? '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateProfile({ display_name: name })
    setErrors(errs)
    if (Object.keys(errs).length) return
    const patch: MeIn = {}
    if (name.trim() !== user.display_name) patch.display_name = name.trim()
    if (title !== (user.title ?? '')) patch.title = title
    if (color !== (user.avatar_color ?? '')) patch.avatar_color = color
    if (Object.keys(patch).length) {
      const fe = await onSave(patch)
      if (fe) setErrors(fe) // 服务端字段错（如显示名过长）落到字段
    }
  }

  return (
    <form data-slot="ProfileForm" data-testid="profile-form" className={cn('grid max-w-form', mobile ? 'gap-section-m' : 'gap-5')} onSubmit={(e) => void submit(e)} aria-busy={saving || undefined} noValidate>
      <div className="flex items-center gap-3">
        <span
          className="flex size-12 items-center justify-center rounded-full text-lg font-semibold"
          style={{
            backgroundColor: AVATAR_COLOR_HEX[shown],
            color: labelText(AVATAR_COLOR_HEX[shown]),
          }}
          aria-hidden
          data-testid="profile-avatar"
          data-color={shown}
        >
          {(name.trim() || user.email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={user.email}>{user.email}</div>
          <div className="text-xs text-fg-muted">{user.is_superuser ? '超级管理员' : '成员'}</div>
        </div>
      </div>

      <Field error={errors.display_name} className={mobile ? 'gap-1' : undefined}>
        <FieldLabel>显示名</FieldLabel>
        <FieldControl>
          <Input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} disabled={unavailable} autoComplete="nickname" data-testid="profile-name" />
        </FieldControl>
        <FieldDescription>出现在成员列表、批注署名与客户确认页。</FieldDescription>
        <FieldError data-testid="profile-name-error" />
      </Field>

      <fieldset className={cn('grid border-0 p-0', mobile ? 'gap-group-m' : 'gap-1.5')} disabled={unavailable}>
        <legend className="text-sm font-medium">头衔</legend>
        <p className={cn('text-xs text-fg-muted', mobile && 'mt-1')}>仅展示（成员列表 / 批注署名），不影响权限。</p>
        <div className={cn('flex flex-wrap', mobile ? 'gap-group-m' : 'gap-1.5')} role="radiogroup" aria-label="头衔" data-testid="profile-titles">
          {(['', ...USER_TITLES] as UserTitle[]).map((t) => (
            <label key={t || 'none'} className={cn('relative inline-flex', mobile && touchHit)}>
              <input type="radio" name={`${uid}-title`} value={t} checked={title === t} onChange={() => setTitle(t)} className="peer sr-only" />
              <span className="inline-flex h-sm-control cursor-pointer items-center rounded-full border px-3 text-xs peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-link peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring peer-disabled:cursor-default peer-disabled:opacity-50">
                {t || '无'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={cn('grid border-0 p-0', mobile ? 'gap-group-m' : 'gap-1.5')} disabled={unavailable}>
        <legend className="text-sm font-medium">头像色</legend>
        <div className={cn(mobile ? 'mt-2 grid justify-items-start gap-group-m' : 'flex flex-wrap items-center gap-1.5')} role="radiogroup" aria-label="头像色" data-testid="profile-colors">
          <label className={cn('relative inline-flex', mobile && touchHit)}>
            <input type="radio" name={`${uid}-color`} value="" checked={color === ''} onChange={() => setColor('')} className="peer sr-only" aria-label="自动" />
            <span className="inline-flex h-sm-control cursor-pointer items-center rounded-full border px-2 text-xs peer-checked:border-primary peer-checked:bg-primary-soft peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring">自动</span>
          </label>
          <div className={cn('contents', mobile && 'grid w-full grid-cols-8 justify-items-center')} data-testid="profile-color-dots">
            {AVATAR_COLORS.map((c) => (
              <label key={c} className={cn('relative flex cursor-pointer items-center justify-center', mobile ? cn('size-sm-control', touchHit) : 'size-md-control')}>
                <input type="radio" name={`${uid}-color`} value={c} checked={color === c} onChange={() => setColor(c)} className="peer sr-only" aria-label={`头像色 ${c}`} />
                <span
                  className={cn('block rounded-full ring-offset-2 ring-offset-panel peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring', mobile ? 'size-sm-control' : 'size-6')}
                  style={{ backgroundColor: AVATAR_COLOR_HEX[c] }}
                  aria-hidden
                />
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <div className={cn('flex flex-wrap items-center gap-2', unavailable && 'text-xs text-fg-muted')}>
        <Button type="submit" disabled={!dirty || saving || unavailable} data-testid="profile-save">
          {saving ? '保存中…' : '保存'}
        </Button>
        {unavailable && <span data-testid="profile-unavailable">资料接口当前不可用（501），暂不可保存</span>}
      </div>
    </form>
  )
}
