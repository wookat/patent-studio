import type { Ast } from '@/types/ast'

/** 去掉空白与 Markdown/公式标记，使 PDF 文字层与 content.md 源行可比 */
const strip = (s: string) => s.replace(/[\s*#_~$\\{}|`>]/g, '')
/** 同上，供 lib/pdfIndex.ts heuristic 模式复用 */
export const stripForMatch = strip

const WINDOW = 10
const STEP = 4
const MIN = 4
/** PDF 查找词取块首行文本的前 N 字（pdf.js 文字项很短，过长的查询跨项命不中） */
const QUERY_LEN = 12

/** 内核生成的段号锚文本：13 → `[0013]`（DOCX / PDF 行首原样出现） */
export const paraAnchor = (n: number) => `[${String(n).padStart(4, '0')}]`

const ANCHOR_RE = /^\s*\[(\d{4})\]/

/** 段号 → 该段在 content.md 的全文首行（表 / 代码块 / 表题后置 / 表注共用其所属块的首行）；找不到返回 null */
export function paraLine(ast: Ast, paraNo: number): number | null {
  const off = ast.books.description.offset
  for (const b of ast.description) {
    if (b.kind === 'paragraph' || b.kind === 'code') {
      if (b.para_no === paraNo) return off + b.lines.start
    } else if (b.kind === 'table') {
      if (b.para_no === paraNo || b.caption_after?.para_no === paraNo || b.note?.para_no === paraNo) return off + b.lines.start
    }
  }
  return null
}

/**
 * 从 PDF 文字层的一段文字（通常是一整行）反查 content.md 行号（1-based）。
 * 0) 行首是内核段号 `[0013]` 且有 AST → 直接查该段（UX-6 段号锚；找不到再走文本匹配）；
 * 1) 整段（去标记后）被某一行包含 → 该行（多行命中取第一行）；
 * 2) 否则按 10 字滑窗投票：每个窗口命中的源行各记一票（应对段号 / 软换行 / 渲染插入的空格与公式），
 *    票数最多者胜，平票取更靠前的行；没有任何窗口命中或文字过短（< 4 字）→ null。
 */
export function locateInSource(content: string, snippet: string, ast: Ast | null = null): number | null {
  if (ast) {
    const m = ANCHOR_RE.exec(snippet)
    if (m) {
      const line = paraLine(ast, Number(m[1]))
      if (line !== null) return line
    }
  }
  const q = strip(snippet)
  if (q.length < MIN) return null
  const lines = content.split('\n').map(strip)

  const whole = lines.findIndex((l) => l.includes(q))
  if (whole >= 0) return whole + 1
  if (q.length <= WINDOW) return null

  const votes = new Map<number, number>()
  for (let i = 0; i + WINDOW <= q.length; i += STEP) {
    const w = q.slice(i, i + WINDOW)
    lines.forEach((l, idx) => {
      if (l.includes(w)) votes.set(idx, (votes.get(idx) ?? 0) + 1)
    })
  }
  let best = -1
  let bestVotes = 0
  for (const [idx, n] of votes) {
    if (n > bestVotes || (n === bestVotes && idx < best)) {
      best = idx
      bestVotes = n
    }
  }
  return best >= 0 ? best + 1 : null
}

const head = (text: string) => strip(text).slice(0, QUERY_LEN)

/**
 * 大纲 / 结构块 → PDF 内查找词（正向定位，喂给 PdfPreview 的 find）。查找按 pdf.js 文字项逐项匹配（find.ts），而内核 PDF 中
 * 数字 / 拉丁字母与中文被切成不同项，书名页眉因字距被 pdf.js 读成「说 明 书」，所以查找词只用单项内完整的文字：
 * 段号锚 `[0013]`（说明书段 / 表 / 代码块 / 附图题注段，公式用 anchor_para_no）；章节 / 小节用标题；权项用编号项 `8.`；
 * 三书根节点用页眉「说 明 书 摘 要」「权 利 要 求 书」/ 说明书首章标题。id 不在 AST 中或无可用锚返回 null。
 */
export function pdfQueryForBlock(ast: Ast, id: string): string | null {
  if (id === 'abstract') return '说 明 书 摘 要'
  if (id === 'claims') return '权 利 要 求 书'
  if (id === 'description') {
    const first = ast.description[0]
    return first?.kind === 'section' ? first.title : null
  }
  const claim = ast.claims.find((c) => c.id === id)
  if (claim) return `${claim.num}.`
  const fig = ast.figures.find((f) => f.id === id)
  if (fig) {
    for (const b of ast.description) {
      if (b.kind === 'paragraph' && b.lines.start === fig.caption_line && b.para_no !== null) return paraAnchor(b.para_no)
    }
    return null
  }
  const b = ast.description.find((x) => x.id === id)
  if (!b) return null
  switch (b.kind) {
    case 'section':
    case 'subsection':
      return b.title
    case 'paragraph':
      return b.para_no !== null ? paraAnchor(b.para_no) : head(b.text)
    case 'table':
    case 'code':
    case 'figure':
      return paraAnchor(b.para_no)
    case 'equation':
      return b.anchor_para_no !== null ? paraAnchor(b.anchor_para_no) : b.label
  }
}
