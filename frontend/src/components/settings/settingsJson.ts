import type { Settings } from '@/lib/types'

const ARRAY_KEYS = ['abstract_figure', 'spec_figures', 'sub_except'] as const

/**
 * 设置 JSON（studio.json 导出或手写）→ 白名单 Partial<Settings>，形状不对抛错。
 * 导入时即拒（对齐后端 normalize_settings 的「字段形态不合法」422 口径），不让坏值先进 store 再在渲染期炸。
 * null 与缺省同义（backend 同样跳过 None）；style 无键时返回 {}（导入视为整份设置文档，置零漂移基准）。
 */
export function parseSettingsJson(text: string): Partial<Settings> & { style: Settings['style'] } {
  const j: unknown = JSON.parse(text)
  if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('不是 JSON 对象')
  const o = j as Record<string, unknown>
  const out: Partial<Settings> & { style: Settings['style'] } = { style: {} }
  if (o.style !== undefined) {
    if (typeof o.style !== 'object' || o.style === null || Array.isArray(o.style)) throw new Error('style 应为对象')
    out.style = o.style as Settings['style']
  }
  for (const k of ARRAY_KEYS) {
    const v = o[k]
    if (v === undefined || v === null) continue
    if (!Array.isArray(v)) throw new Error(`${k} 应为数组`)
    ;(out as Record<string, unknown>)[k] = v
  }
  if (o.abstract_limit !== undefined && o.abstract_limit !== null) {
    if (typeof o.abstract_limit !== 'number' || !Number.isFinite(o.abstract_limit)) throw new Error('abstract_limit 应为数字')
    out.abstract_limit = o.abstract_limit
  }
  return out
}
