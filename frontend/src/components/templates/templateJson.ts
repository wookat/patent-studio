import type { TemplateIn } from '@/lib/types'

/** 模板 JSON（导出的 Template 或手写的 TemplateIn）→ TemplateIn；形状不对抛错 */
export function parseTemplateJson(text: string): TemplateIn {
  const j: unknown = JSON.parse(text)
  if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('不是 JSON 对象')
  const o = j as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('缺少 name')
  if (typeof o.settings !== 'object' || o.settings === null || Array.isArray(o.settings)) throw new Error('缺少 settings 对象')
  const s = o.settings as Record<string, unknown>
  if (s.style !== undefined && (typeof s.style !== 'object' || s.style === null || Array.isArray(s.style))) throw new Error('settings.style 应为对象')
  const dt = o.document_type ?? 'patent_cn_invention'
  if (dt !== 'patent_cn_invention') throw new Error(`不支持的 document_type：${String(dt)}`)
  return {
    name: o.name.trim(),
    description: typeof o.description === 'string' ? o.description : '',
    document_type: dt,
    settings: {
      style: (s.style as TemplateIn['settings']['style']) ?? {},
      sub_except: Array.isArray(s.sub_except) ? (s.sub_except as string[]) : undefined,
      abstract_limit: typeof s.abstract_limit === 'number' ? s.abstract_limit : undefined,
    },
  }
}
