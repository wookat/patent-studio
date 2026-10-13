import type { OaItem } from '@/types/oa'

const H2 = /^##\s+(.+?)\s*$/
const CLAIM = /^(\d+)\s*[.．、]/

/**
 * 在 content.md 中定位第 n 项权利要求所在行（1-based；镜像 editor/section.ts 的 `N.` 规则，只在「## 权利要求书」内找）。
 * 找不到返回 null（权项未写 / 编号不连续）。
 */
export function findClaimLine(content: string, claim: number): number | null {
  const lines = content.split('\n')
  let inClaims = false
  for (let i = 0; i < lines.length; i++) {
    const h2 = H2.exec(lines[i])
    if (h2) {
      inClaims = h2[1] === '权利要求书'
      continue
    }
    if (!inClaims) continue
    const m = CLAIM.exec(lines[i])
    if (m && Number(m[1]) === claim) return i + 1
  }
  return null
}

/** 列表项一行摘要（去换行、截断） */
export function oaItemSummary(item: OaItem, max = 80): string {
  const t = item.text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 把用户编辑的多行文本还原为要点数组（每行一条，去空行） */
export function pointsFromText(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*[-•·]\s*/, '').trim())
    .filter(Boolean)
}
