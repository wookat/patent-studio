import { useCallback } from 'react'
import { pdfQueryForBlock } from '@/components/preview/locate'
import { locateSourceLine } from '@/components/problems/locateSource'
import type { Severity } from '@/lib/types'
import { useStudio } from '@/store'
import { blockAtLine, blockFullLine, type Ast, type BookName } from '@/types/ast'
import type { ClaimNode, PreflightItem } from '@/types/preflight'
import { FOCUS_RING, FOCUS_RING_INSET, cn } from '@/lib/utils'

/** 规则 id → 人话名（docs/plan/05-r2-figures-preflight-design.md §4）；未知规则回退到 id */
export const RULE_LABEL: Record<string, string> = {
  'abstract.limit': '摘要超字数',
  'claims.structure': '权项独/从结构',
  'claims.forward_ref': '从属权项前向引用',
  'claims.multi_not_alternative': '多引未用择一',
  'claims.multi_multi': '多引多',
  'claims.cycle': '权项循环引用',
  'claims.gradient': '从权无梯度',
  'claims.unsupported_term': '权项术语无说明书支持',
  'equation.no_lead': '公式前无正文段',
  'figures.ref_missing': '引用了不存在的图',
  'figures.drawings_unfiled': '附图说明的图尚无文件',
  'figures.unreferenced': '图未被引用',
  'figures.caption_missing': '图缺题注',
  'figures.caption_dup': '同图号重复声明',
  'spec.meta_wording': '说明书含存疑措辞',
  'numerals.inconsistent': '附图标记同号不同名',
  'numerals.legend_conflict': '图例标记定义冲突',
}
export const ruleLabel = (rule: string) => RULE_LABEL[rule] ?? rule

export const SEVERITY_LABEL: Record<Severity, string> = { error: '错误', warning: '警告', info: '提示' }
export const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info']

/** 可点击定位的整行按钮（问题条目 / 表格里的行号）；移动端触控目标由 in-data-[variant=mobile] 放大 */
export const LOCATE_ROW = cn('flex w-full text-left hover:bg-sunken', FOCUS_RING_INSET)
/** 表格内的行号按钮 */
export const LINE_BTN = cn(
  'inline-flex h-5 items-center rounded px-1 font-mono text-xs tabular-nums text-primary-text hover:bg-primary-soft hover:underline in-data-[variant=mobile]:h-8 in-data-[variant=mobile]:px-2 in-data-[variant=mobile]:text-sm',
  FOCUS_RING,
)

/** 权项树上用红色标出的规则（多引多 / 循环 / 前向 / 结构） */
const CLAIM_RED_RULES = new Set(['claims.cycle', 'claims.forward_ref', 'claims.structure', 'claims.multi_multi'])
export const claimTone = (node: ClaimNode): 'error' | 'warning' | null =>
  node.issues.length === 0 ? null : node.issues.some((r) => CLAIM_RED_RULES.has(r)) ? 'error' : 'warning'

/** 森林里从根出发到不了的从属权项（前向 / 循环引用把它们挂不上树） */
export function orphanClaims(nodes: ClaimNode[]): ClaimNode[] {
  const byNum = new Map(nodes.map((n) => [n.num, n]))
  const seen = new Set<number>()
  const walk = (num: number) => {
    if (seen.has(num)) return
    seen.add(num)
    for (const c of byNum.get(num)?.children ?? []) walk(c)
  }
  for (const n of nodes) if (n.kind === 'independent') walk(n.num)
  return nodes.filter((n) => !seen.has(n.num))
}

export interface RuleGroup {
  rule: string
  severity: Severity
  items: PreflightItem[]
}

/** 问题按规则分组，组按严重度（error → warning → info）再按首次出现顺序排 */
export function groupByRule(items: PreflightItem[]): RuleGroup[] {
  const map = new Map<string, RuleGroup>()
  for (const it of items) {
    const g = map.get(it.rule)
    if (g) g.items.push(it)
    else map.set(it.rule, { rule: it.rule, severity: it.severity, items: [it] })
  }
  const groups = Array.from(map.values())
  groups.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  return groups
}

/** 结构视图要滚到的块：`figures/N` 取题注段（附图不是块）；其余 id 本身就是块 id；无 block_id 时按全文行反查 */
export function resolveBlockId(ast: Ast | null, blockId: string | null, line: number | null): string | null {
  if (!ast) return blockId
  if (blockId?.startsWith('figures/')) {
    const fig = ast.figures.find((f) => f.id === blockId)
    const cap = fig && fig.caption_line !== null ? ast.description.find((b) => b.kind === 'paragraph' && b.lines.start === fig.caption_line) : undefined
    return cap?.id ?? null
  }
  if (blockId) return blockId
  if (line === null) return null
  return blockAtLine(ast, line)?.block.id ?? null
}

/** 块 id → 全文起始行（支持性表点「权N」时没有行号，从 AST 反查） */
export function lineForBlock(ast: Ast, id: string): number | null {
  if (ast.abstract.id === id) return blockFullLine(ast, { book: 'abstract', block: ast.abstract })
  const claim = ast.claims.find((c) => c.id === id)
  if (claim) return blockFullLine(ast, { book: 'claims', block: claim })
  const block = ast.description.find((b) => b.id === id)
  return block ? blockFullLine(ast, { book: 'description', block }) : null
}

/** 书名前缀的块 id（`claims/3` `description/p12` `abstract`）→ 书；`figures/N` / 未知 → null */
export function bookOfBlock(id: string | null | undefined): BookName | null {
  if (!id) return null
  const head = id.split('/')[0]
  return head === 'abstract' || head === 'claims' || head === 'description' ? head : null
}

/**
 * 体检条目 / 树节点 / 表格行的统一定位（domain-02）：
 * 源码行 → locateSourceLine（revealView('source', book) + Focus{book,line}：源码卡片打开对应书并把该行滚到中央闪烁）
 * + setActiveBlock(id,'outline') + locateInPdf(pdfQueryForBlock)。
 * book 优先取体检条目自带的 `book`，没有则从块 id 前缀 / AST / content 反查；`figures/N` 的 PDF 查找词直接用 pdfQueryForBlock（题注段号）。
 */
/** 与 usePreflightLocate 同体的非 hook 版（R56-02：`?focus=` 深链等 hash 消费方在 React 外调用） */
export function preflightLocate(line: number | null, blockId: string | null, book: BookName | null = null) {
  const s = useStudio.getState()
  if (line === null && blockId && s.ast) line = lineForBlock(s.ast, blockId)
  const ast = s.ast
  const id = resolveBlockId(ast, blockId, line)
  if (line !== null) locateSourceLine({ book: book ?? bookOfBlock(blockId) ?? bookOfBlock(id), line, blockId: id, source: 'problems' })
  if (id) s.setActiveBlock(id, 'outline')
  const target = blockId ?? id
  if (!ast || !target) return
  const q = pdfQueryForBlock(ast, target)
  if (q) s.locateInPdf(q)
}

export function usePreflightLocate() {
  return useCallback((line: number | null, blockId: string | null, book: BookName | null = null) => {
    preflightLocate(line, blockId, book)
  }, [])
}
