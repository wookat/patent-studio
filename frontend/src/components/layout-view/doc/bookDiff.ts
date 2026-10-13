import { findBlockLines } from '@/store/blocks'
import type { Ast, BookName } from '@/types/ast'

/**
 * 整书新旧 Markdown → 写回策略（docs/plan/22 决策 5）：
 *   - `none`：无变化；
 *   - `block`：改动完全落在**一个** AST 块的行范围内（含行内格式、权项增删段、表格改单元）→ 块补丁（POST /blocks/{id}）；
 *   - `multi`：改动触及块间空行 / 跨块 / 新增或删除块 / 段落拆并（块内新增空行）→ 整书 PUT /docs/{book}。
 * 算法：按行做公共前后缀对齐，取旧文变化区间 [s, e)（e ≤ s 表示纯插入）；找唯一包含该区间的块（书相对 1-based 行 → 0-based 下标）；
 * 新块 Markdown = 新文同一位置、长度按行数差调整。纯插入落在块边界（s == 块首 或 s == 块尾+1）视为该块内改动
 * （靠前的块优先）；新块含比旧块更多空行 ⇒ 拆段 ⇒ multi。任何不确定都退到 multi（整书 PUT 永远正确）。
 */
export type BookDiff = { kind: 'none' } | { kind: 'block'; id: string; markdown: string } | { kind: 'multi' }

export function bookDiff(oldMd: string, newMd: string, ast: Ast, book: BookName): BookDiff {
  if (oldMd === newMd) return { kind: 'none' }
  const a = oldMd.split('\n')
  const b = newMd.split('\n')
  let pre = 0
  const max = Math.min(a.length, b.length)
  while (pre < max && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const s = pre
  const e = a.length - suf // 旧文变化区间 [s, e)，可能 e === s（纯插入）
  const delta = b.length - a.length

  const blocks = book === 'abstract' ? ast.abstract.paragraphs : book === 'claims' ? ast.claims : ast.description
  for (const blk of blocks) {
    const loc = findBlockLines(ast, blk.id)
    if (!loc || loc.book !== book) continue
    const bs = loc.start - 1
    const be = loc.end // 0-based [bs, be)
    const inside = e > s ? s >= bs && e <= be : s >= bs && s <= be
    if (!inside) continue
    const oldLines = a.slice(bs, be)
    const newLines = b.slice(bs, be + delta)
    if (newLines.length === 0) return { kind: 'multi' }
    if (blanks(newLines) > blanks(oldLines)) return { kind: 'multi' }
    if (newLines[0] === '' || newLines[newLines.length - 1] === '') return { kind: 'multi' }
    return { kind: 'block', id: blk.id, markdown: newLines.join('\n') }
  }
  return { kind: 'multi' }
}

const blanks = (lines: readonly string[]) => lines.filter((l) => l === '').length
