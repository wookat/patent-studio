export const SEARCH_MAX_HITS = 500
const CONTEXT = 24

export interface SearchHit {
  /** 1-based */
  line: number
  col: number
  before: string
  match: string
  after: string
}

/** 逐行大小写不敏感的全文匹配（每行可多命中）；上限 SEARCH_MAX_HITS 条 */
export function searchContent(content: string, query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length && hits.length < SEARCH_MAX_HITS; i++) {
    const ln = lines[i]
    const lower = ln.toLowerCase()
    let from = 0
    for (;;) {
      const at = lower.indexOf(q, from)
      if (at < 0) break
      hits.push({
        line: i + 1,
        col: at + 1,
        before: ln.slice(Math.max(0, at - CONTEXT), at),
        match: ln.slice(at, at + q.length),
        after: ln.slice(at + q.length, at + q.length + CONTEXT),
      })
      from = at + Math.max(1, q.length)
      if (hits.length >= SEARCH_MAX_HITS) break
    }
  }
  return hits
}
