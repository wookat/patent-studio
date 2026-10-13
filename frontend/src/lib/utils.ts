import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 焦点环（05 §1.7）：2px --ring 外描边、offset 1；所有可聚焦原语共用，禁止各自混写 ring 类 */
export const FOCUS_RING = 'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-ring'
/** 焦点环画在容器内侧（表格行 / 列表项 / 面板头等溢出裁切场景） */
export const FOCUS_RING_INSET = 'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring'
/** 颜色过渡：150ms · cubic-bezier(.2,0,0,1)；reduced-motion 时 token 为 0 */
export const TRANSITION_COLOR = 'transition-colors duration-(--dur-color) ease-(--ease)'
/** 禁用态：不用 opacity，走 --fg-disabled / --bg-sunken（对比可控） */
export const DISABLED = 'disabled:pointer-events-none disabled:text-fg-disabled aria-disabled:pointer-events-none aria-disabled:text-fg-disabled'
/** 触控命中区（06 §2.2）：视觉高度按档，在 data-density=touch 后代用 ::after 把命中区扩到 max(100%, 44)；桌面零影响。
 *  用法：cn(touchHit, …)；相邻可点控件 gap ≥ 8，容器不要 overflow-hidden（横向行用 ScrollRow）。定义在 index.css @utility touch-hit。 */
export const touchHit = 'touch-hit'

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[path[path.length - 1]] = value
}

export function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}
