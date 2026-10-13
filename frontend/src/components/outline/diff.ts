export interface DiffSummary {
  /** 当前行数 − 备份行数 */
  lineDelta: number
  /** 当前有、备份没有的行数（多重集差） */
  added: number
  /** 备份有、当前没有的行数 */
  removed: number
  /** 首个逐行不同的位置（1-based）与两侧文本；完全相同为 null */
  first: { line: number; backup: string; current: string } | null
  identical: boolean
}

/** 备份内容 vs 当前内容的轻量摘要（不做 LCS，只算行数差、多重集差与首个差异行） */
export function summarizeDiff(backup: string, current: string): DiffSummary {
  const a = backup.replace(/\r\n?/g, '\n').split('\n')
  const b = current.replace(/\r\n?/g, '\n').split('\n')
  const count = new Map<string, number>()
  for (const l of a) count.set(l, (count.get(l) ?? 0) + 1)
  let added = 0
  for (const l of b) {
    const c = count.get(l) ?? 0
    if (c > 0) count.set(l, c - 1)
    else added += 1
  }
  let removed = 0
  for (const c of count.values()) removed += c
  let first: DiffSummary['first'] = null
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      first = { line: i + 1, backup: a[i] ?? '', current: b[i] ?? '' }
      break
    }
  }
  return { lineDelta: b.length - a.length, added, removed, first, identical: first === null }
}
