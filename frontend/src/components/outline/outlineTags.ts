import type { SectionItem } from '@/lib/outline'

export const pad4 = (n: number) => `[${String(n).padStart(4, '0')}]`

/** 引用号列表：连续区间 `2–6`；离散 `1,3`；空串无引用 */
export function refRange(refs: readonly number[]): string {
  if (!refs.length) return ''
  const consecutive = refs.length >= 2 && refs.every((n, i) => i === 0 || n === refs[i - 1] + 1)
  return consecutive ? `${refs[0]}–${refs[refs.length - 1]}` : refs.join(',')
}

/**
 * 权项独 / 从标签（独从来自 AST claim_kind，不由引用推断）：独立 `独`（装置项引用方法项也仍是独立）；
 * 从属显示父项 `→2–6` / `→1,3`；从属但解不出引用时 `从`
 */
export function claimRefTag(dependent: boolean, refs: readonly number[]): string {
  if (!dependent) return '独'
  if (!refs.length) return '从'
  const consecutive = refs.length >= 2 && refs.every((n, i) => i === 0 || n === refs[i - 1] + 1)
  return consecutive ? `→${refs[0]}–${refs[refs.length - 1]}` : `→${refs.join(',')}`
}

/** 章节的段号范围 `[0031]–[0088]`；无编号段返回 null */
export function paraRangeTag(s: Pick<SectionItem, 'firstPara' | 'lastPara'>): string | null {
  if (s.firstPara === null) return null
  const last = s.lastPara ?? s.firstPara
  return last > s.firstPara ? `${pad4(s.firstPara)}–${pad4(last)}` : pad4(s.firstPara)
}
