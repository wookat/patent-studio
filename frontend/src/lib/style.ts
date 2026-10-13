import type { Style, StyleOverride } from './types'
import { deepClone } from './utils'

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 默认 style 深合并 override → 有效 style */
export function mergeStyle(defaults: Style, override: StyleOverride | undefined): Style {
  const out = deepClone(defaults) as unknown as Obj
  const walk = (dst: Obj, src: Obj) => {
    for (const [k, v] of Object.entries(src)) {
      if (isObj(v) && isObj(dst[k])) walk(dst[k] as Obj, v)
      else dst[k] = v
    }
  }
  if (override) walk(out, override as Obj)
  return out as unknown as Style
}

/** 有效 style 与默认值的差异（只保留不同的叶子），空对象表示完全默认 */
export function diffStyle(defaults: Style, eff: Style): StyleOverride {
  const walk = (d: Obj, e: Obj): Obj => {
    const out: Obj = {}
    for (const [k, v] of Object.entries(e)) {
      const dv = d[k]
      if (isObj(v) && isObj(dv)) {
        const sub = walk(dv, v)
        if (Object.keys(sub).length) out[k] = sub
      } else if (JSON.stringify(v) !== JSON.stringify(dv)) {
        out[k] = v
      }
    }
    return out
  }
  return walk(defaults as unknown as Obj, eff as unknown as Obj) as StyleOverride
}

export function countLeaves(o: unknown): number {
  if (!isObj(o)) return 1
  return Object.values(o).reduce<number>((n, v) => n + countLeaves(v), 0)
}

/** 磅 → 中文字号名（常用值） */
export function ptName(pt: number): string {
  const m: Record<string, string> = {
    '42': '初号', '36': '小初', '26': '一号', '24': '小一', '22': '二号', '18': '小二', '16': '三号',
    '15': '小三', '14': '四号', '12': '小四', '10.5': '五号', '9': '小五', '7.5': '六号', '6.5': '小六',
    '5.5': '七号', '5': '八号',
  }
  return m[String(pt)] ?? ''
}

/** 字号下拉预设（小四 12 → 八号 5；settings 组合框可选可输） */
export const SIZE_PRESETS: { name: string; pt: number }[] = [
  { name: '初号', pt: 42 }, { name: '小初', pt: 36 }, { name: '一号', pt: 26 }, { name: '小一', pt: 24 },
  { name: '二号', pt: 22 }, { name: '小二', pt: 18 }, { name: '三号', pt: 16 }, { name: '小三', pt: 15 },
  { name: '四号', pt: 14 }, { name: '小四', pt: 12 }, { name: '五号', pt: 10.5 }, { name: '小五', pt: 9 },
  { name: '六号', pt: 7.5 }, { name: '小六', pt: 6.5 }, { name: '七号', pt: 5.5 }, { name: '八号', pt: 5 },
]

export const FONT_SUGGESTIONS = [
  '宋体', '黑体', '仿宋', '楷体', 'SimSun', 'SimHei', 'FangSong', 'KaiTi',
  'Noto Serif CJK SC', 'Noto Sans CJK SC', 'Source Han Serif SC', 'Source Han Sans SC',
  'Times New Roman', 'Liberation Serif', 'Cambria Math', 'Courier New', 'Consolas',
]
