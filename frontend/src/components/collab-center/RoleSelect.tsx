import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type SelectSize } from '@/components/ui/select'
import { ROLE_LABEL, ROLE_RANK, type Role } from '@/lib/types'
import { LAST_OWNER_HINT } from './format'

/**
 * 角色下拉（docs/plan/14 §6.2）：选项按 ROLE_RANK 降序；owner 只在 `allowOwner` 时出现（成员行且当前用户为 owner）。
 * `disabledRoles`：最后一个 owner 的行禁用降级项（后端 409 兜底）。
 */
export interface RoleSelectProps<R extends Role = Role> {
  value: R
  options: readonly R[]
  onChange: (r: R) => void
  label: string
  id?: string
  className?: string
  /** 触发器尺寸档（05 §2.2 sm 28 / md 32；touch 密度自动升 44） */
  size?: SelectSize
  disabled?: boolean
  disabledRoles?: readonly Role[]
  testId?: string
}

export function RoleSelect<R extends Role>({ value, options, onChange, label, id, className, size = 'md', disabled, disabledRoles = [], testId }: RoleSelectProps<R>) {
  const sorted = [...options].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])
  return (
    <Select value={value} onValueChange={(v) => onChange(v as R)} disabled={disabled}>
      <SelectTrigger id={id} size={size} aria-label={label} className={className} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sorted.map((r) => (
          <SelectItem key={r} value={r} disabled={disabledRoles.includes(r)} title={disabledRoles.includes(r) ? LAST_OWNER_HINT : undefined}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
