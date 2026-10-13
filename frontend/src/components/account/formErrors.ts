import { PASSWORD_MIN } from '@/components/auth/session'
import { ApiError } from '@/lib/api'

/**
 * 账户表单字段级错误（21 §4.6 用 Field + formErrors）：客户端规则在提交前跑一遍，返回 {field: message}；
 * 服务端 422 若带字段名（FastAPI `loc: ['body', <field>]`）也映射到字段，否则落到 `_form`。
 * lib/formErrors.ts（共享）落地后此文件只保留校验规则。
 */
export type FormErrors = Record<string, string>

export function validateProfile(v: { display_name: string }): FormErrors {
  const out: FormErrors = {}
  const name = v.display_name.trim()
  if (!name) out.display_name = '请输入显示名'
  else if (name.length > 64) out.display_name = '显示名最多 64 个字符'
  return out
}

export function validatePassword(v: { current: string; next: string; confirm: string }): FormErrors {
  const out: FormErrors = {}
  if (!v.current) out.current = '请输入当前密码'
  if (v.next.length < PASSWORD_MIN) out.next = `新密码至少 ${PASSWORD_MIN} 位`
  else if (v.next === v.current) out.next = '新密码不能与当前密码相同'
  if (v.confirm !== v.next) out.confirm = '两次输入的新密码不一致'
  return out
}

export function validatePatName(name: string, existing: readonly { name: string }[]): FormErrors {
  const out: FormErrors = {}
  const n = name.trim()
  if (!n) out.name = '请为令牌起个名字，如「Codex 本机」'
  else if (n.length > 64) out.name = '名称最多 64 个字符'
  else if (existing.some((p) => p.name === n)) out.name = '已有同名令牌'
  return out
}

interface FastApiItem {
  loc?: unknown[]
  msg?: string
}

/** ApiError → {field: message}；非结构化错误归 `_form`。error_detail 形状的 `detail.detail` 字符串也映射字段（R71-02）。 */
export function formErrorsFrom(e: unknown, fields: readonly string[]): FormErrors {
  if (e instanceof ApiError) {
    const d: unknown = e.detail
    if (d && !Array.isArray(d) && typeof d === 'object' && typeof (d as { detail?: unknown }).detail === 'string'
        && fields.includes((d as { detail: string }).detail)) {
      return { [(d as { detail: string }).detail]: e.message }
    }
    if (Array.isArray(d)) {
      const out: FormErrors = {}
      for (const it of d as FastApiItem[]) {
        const field = it.loc?.find((p): p is string => typeof p === 'string' && fields.includes(p))
        if (field && it.msg) out[field] = it.msg
      }
      if (Object.keys(out).length) return out
    }
    return { _form: e.message }
  }
  return { _form: e instanceof Error ? e.message : String(e) }
}
