import { FIGURE_ACCEPT } from '@/components/figures/figureModel'
import type { Ast, FiguresBadLine } from '@/types/ast'
import { ATTACHMENT_MAX_BYTES } from '@/types/attachments'
import type { PreflightItem } from '@/types/preflight'

const FIGURE_EXTS = FIGURE_ACCEPT.split(',')
const FIGURE_MAX_MB = Math.floor(ATTACHMENT_MAX_BYTES / 1024 / 1024)

/** 附图上传前端预校验（扩展名同后端 projects.DOCX_FIG_EXTS，大小与附件一致 ≤50MB）：返回 null 表示可上传 */
export function figureReject(f: { name: string; size: number }): string | null {
  const ext = /\.[^.]+$/.exec(f.name)?.[0]?.toLowerCase() ?? ''
  if (!FIGURE_EXTS.includes(ext)) return `不支持的附图类型 ${ext || '(无扩展名)'}（可用：${FIGURE_ACCEPT.replaceAll(',', ' ')}）`
  if (f.size > ATTACHMENT_MAX_BYTES) return `超过 ${FIGURE_MAX_MB} MB（${(f.size / 1024 / 1024).toFixed(1)} MB）`
  return null
}

/** 把一批文件分成可上传 / 被拒（含原因）两组 */
export function splitFiles<T extends { name: string; size: number }>(files: readonly T[], reject: (f: T) => string | null) {
  const ok: T[] = []
  const bad: { file: T; reason: string }[] = []
  for (const f of files) {
    const reason = reject(f)
    if (reason) bad.push({ file: f, reason })
    else ok.push(f)
  }
  return { ok, bad }
}

/** docs/figures.md 无法解析的行（15 §2：`ast.figures_bad_lines`，内核 figures_md.FiguresDoc.bad_lines） */
export type BadLine = FiguresBadLine

export function badLinesOf(ast: Ast | null): BadLine[] {
  return ast?.figures_bad_lines ?? []
}

/** 体检里落在附图书上的条目：block_id=figures/N → 对应卡片角标；其余 figures.* 规则（如 md_syntax）→ 顶部提示条 */
export function figureIssues(items: readonly PreflightItem[] | null | undefined) {
  const byNum = new Map<number, PreflightItem[]>()
  const loose: PreflightItem[] = []
  for (const it of items ?? []) {
    const m = it.block_id ? /^figures\/(\d+)$/.exec(it.block_id) : null
    if (m) {
      const n = Number(m[1])
      byNum.set(n, [...(byNum.get(n) ?? []), it])
    } else if (it.rule.startsWith('figures.') && it.book == null && it.block_id == null) loose.push(it)
  }
  return { byNum, loose }
}

/** 网格列数：移动端固定 1；桌面容器 ≥ 420px 两列（15 §4.5） */
export const TWO_COL_MIN = 420

export function gridCols(containerWidth: number, mobile: boolean): 1 | 2 {
  return !mobile && containerWidth >= TWO_COL_MIN ? 2 : 1
}
