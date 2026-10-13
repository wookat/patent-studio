import type { Diagnostic } from '@/lib/types'

export interface ReplaceFix {
  from: string
  to: string
}

const QUOTE_L = '[「『“"\'《〈]'
const QUOTE_R = '[」』”"\'》〉]'
const PATTERNS: RegExp[] = [
  // 把「X」改为「Y」 / 将「X」改成「Y」 / 把「X」替换为「Y」
  new RegExp(`[把将]\\s*${QUOTE_L}([^」』”"'》〉]+)${QUOTE_R}\\s*(?:改为|改成|替换为|换成|修改为)\\s*${QUOTE_L}([^」』”"'》〉]+)${QUOTE_R}`),
  // 把 X 改为 Y（无引号；X/Y 不含空白与标点）
  /[把将]\s*([^\s「」，。；：、]+?)\s*(?:改为|改成|替换为|换成|修改为)\s*([^\s「」，。；：、]+)/,
  // 「X」→「Y」
  new RegExp(`${QUOTE_L}([^」』”"'》〉]+)${QUOTE_R}\\s*(?:→|->|=>)\\s*${QUOTE_L}([^」』”"'》〉]+)${QUOTE_R}`),
]

/**
 * 从 fix 文案里解析「把 X 改为 Y」形式的替换；解析不到 → null（只能作为建议展示）。
 * 后端 lint.py 目前的 fix 多为原则性说明（如「从属权利要求只能引用编号比自身小、且已存在的权利要求」），解析不到属正常。
 */
export function parseReplaceFix(fix: Diagnostic['fix'] | null): ReplaceFix | null {
  if (typeof fix !== 'string' || !fix) return null
  for (const re of PATTERNS) {
    const m = re.exec(fix)
    if (m && m[1] && m[2] && m[1] !== m[2]) return { from: m[1], to: m[2] }
  }
  return null
}

const FORWARD_REF_ID = /^claims\.forward_ref#(\d+)$/
const FORWARD_REF_FRAG = /（(权利要求\s*(\d+))）\s*$/

/**
 * 后端 lint 的 fix 多为原则性说明，前端对可机判的诊断补充具体替换（docs/ux/07 §2.1 原型「改为「权利要求5」」）：
 *   claims.forward_ref#N（从属项 N 引用了在后 / 不存在 / 自身的单一权项）→ 改引紧邻的在前项 N-1。
 * 仅在消息末尾的引用片段是单一「权利要求M」时给出（区间 / 列表引用不猜）；否则 null。
 * 后端直接给出机器可读 `replace`（terms.alias，09 §4）时优先用它，不再解析文案。
 */
export function deriveReplaceFix(d: Pick<Diagnostic, 'id' | 'message' | 'fix' | 'replace'>): ReplaceFix | null {
  if (d.replace && d.replace.from && d.replace.from !== d.replace.to) return { from: d.replace.from, to: d.replace.to }
  const parsed = parseReplaceFix(d.fix)
  if (parsed) return parsed
  const own = FORWARD_REF_ID.exec(d.id)
  const frag = FORWARD_REF_FRAG.exec(d.message)
  if (!own || !frag) return null
  const target = Number(own[1]) - 1
  if (target < 1 || target === Number(frag[2])) return null
  return { from: frag[1], to: `权利要求${target}` }
}

export interface AppliedFix {
  content: string
  line: number
}

/**
 * 在 content 第 line 行（1-based）内把 from 替换为 to（仅首个匹配）。
 * 该行不含 from → null（不做任何修改，调用方回退到「复制建议」）。
 */
export function applyReplaceFix(content: string, line: number, fix: ReplaceFix): AppliedFix | null {
  const lines = content.split('\n')
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return null
  const cur = lines[idx]
  const at = cur.indexOf(fix.from)
  if (at < 0) return null
  lines[idx] = cur.slice(0, at) + fix.to + cur.slice(at + fix.from.length)
  return { content: lines.join('\n'), line }
}

/** 一键修复能否直接应用：fix 可解析为替换、行号已知、且该行确实含 X */
export function canApplyFix(d: Diagnostic, content: string): ReplaceFix | null {
  const rf = deriveReplaceFix(d)
  if (!rf || d.line == null) return null
  return applyReplaceFix(content, d.line, rf) ? rf : null
}

/** 复制全部：把诊断列表序列化为纯文本（粘给同事 / issue） */
export function formatDiagnostics(items: Diagnostic[]): string {
  return items
    .map((d) => {
      const loc = d.line != null ? `content.md:${d.line}` : d.source
      const head = `[${d.severity}] ${d.message} (${[loc, d.section].filter(Boolean).join(' · ')})`
      const tail = [typeof d.fix === 'string' && d.fix && `  建议：${d.fix}`, d.detail && d.detail.split('\n').map((l) => `  ${l}`).join('\n')].filter(Boolean)
      return [head, ...tail].join('\n')
    })
    .join('\n')
}
