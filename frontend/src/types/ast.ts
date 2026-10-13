/**
 * 后端 AST 契约（手写，与 backend/patent_docx/ast_schema.json 逐字段对应；docs/plan/04-r1-design.md §3）。
 * 枚举常量与 schema 的一致性由 ./__tests__/ast.test.ts 断言。
 *
 * 坐标：块内 `lines` 为**书相对** 1-based 闭区间；全文行号 = `books[<book>].offset + line`。
 * 编号来源：`para_no` / `figures[].num` 是内核生成（结构预览灰显）；`num_written` / `label` / `role: table-caption` 是原文。
 */

export const AST_VERSION = 1 as const

export type BookName = 'abstract' | 'claims' | 'description'
export const BOOK_NAMES: readonly BookName[] = ['abstract', 'claims', 'description']

export interface Lines {
  start: number
  end: number
}

export interface BookInfo {
  /** `## <书名>` 标题行在 content.md 的行号 */
  offset: number
  /** 书正文行数 */
  length: number
}

export interface AstTitle {
  text: string
  /** 全文行号 */
  line: number
}

export const PARAGRAPH_ROLES = ['body', 'table-caption'] as const
export type ParagraphRole = (typeof PARAGRAPH_ROLES)[number]

export interface AstParagraph {
  id: string
  kind: 'paragraph'
  lines: Lines
  text: string
  /** 内核生成段号（[0001] → 1）；摘要段为 null */
  para_no: number | null
  role: ParagraphRole
}

export interface AstAbstract {
  id: 'abstract'
  kind: 'abstract'
  lines: Lines
  paragraphs: AstParagraph[]
  figure_num: number | null
}

export const CLAIM_KINDS = ['independent', 'dependent'] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]

export interface ClaimRef {
  text: string
  /** 已展开的目标权项号 */
  targets: number[]
  /** 或 / 任一项 */
  alternative: boolean
  seg: number
  start: number
  end: number
}

export const SEGMENT_KINDS = ['text', 'equation'] as const
export type SegmentKind = (typeof SEGMENT_KINDS)[number]

export interface ClaimSegment {
  id: string
  kind: SegmentKind
  text: string
  /** 书相对行号 */
  line: number
  mathml: string | null
}

export interface AstClaim {
  id: string
  kind: 'claim'
  lines: Lines
  /** 位置序号 */
  num: number
  /** 首段前导数字原文 */
  num_written: string | null
  claim_kind: ClaimKind
  category: string | null
  refs: ClaimRef[]
  charact: { seg: number; offset: number } | null
  segments: ClaimSegment[]
}

export const DESCRIPTION_PARTS = [
  'technical-field', 'background-art', 'disclosure', 'description-of-drawings', 'mode-for-invention', 'other',
] as const
export type DescriptionPart = (typeof DESCRIPTION_PARTS)[number]

export interface AstSection {
  id: string
  kind: 'section' | 'subsection'
  lines: Lines
  title: string
  part: DescriptionPart
}

export interface AstEquation {
  id: string
  kind: 'equation'
  lines: Lines
  /** $$…$$ 内文 */
  source: string
  /** 同行 $$ 之后的原文标号，如 （1） */
  label: string | null
  mathml: string | null
  anchor_para_no: number | null
}

export interface TableOptions {
  three_line: boolean
  repeat_header: boolean
  num_left: boolean
  col_widths: number[] | null
}

export interface NumberedText {
  text: string
  para_no: number
}

export interface AstTable {
  id: string
  kind: 'table'
  lines: Lines
  para_no: number
  rows: string[][]
  options: TableOptions
  caption_after: NumberedText | null
  note: NumberedText | null
}

export interface AstCode {
  id: string
  kind: 'code'
  lines: Lines
  para_no: number
  code_lines: string[]
}

export const DESCRIPTION_BLOCK_KINDS = ['section', 'subsection', 'paragraph', 'equation', 'table', 'code', 'figure'] as const
export type DescriptionBlockKind = (typeof DESCRIPTION_BLOCK_KINDS)[number]

/** 说明书内嵌图（W18）：`![alt](figs/file){width=N}` 独立行 → description 书 figure 块；只引用 figs/ 文件，不进 figures.md、不占图号 */
export interface AstInlineFigure {
  id: string
  kind: 'figure'
  lines: Lines
  file: string
  /** cm */
  width: number
  alt: string
  para_no: number
}

export type DescriptionBlock = AstSection | AstParagraph | AstEquation | AstTable | AstCode | AstInlineFigure

export interface AstFigure {
  id: string
  kind: 'figure'
  /** 第四书 docs/figures.md（W4-C）；不在 BookName 三书内 */
  book: 'figures'
  /** 内核按 docs/figures.md 行序生成 */
  num: number
  file: string
  /** cm */
  width: number
  /** figures.md 的 `![alt]`，只做显示与体检（figures.alt_mismatch）；无 figures.md 时 null */
  alt: string | null
  caption: string | null
  /** 说明书相对行号 */
  caption_line: number | null
}

/** docs/figures.md 中未解析成附图行的非空行（1-based 行号）；附图书顶部提示用 */
export interface FiguresBadLine {
  line: number
  text: string
}

export interface Ast {
  version: typeof AST_VERSION
  title: AstTitle
  books: Record<BookName, BookInfo>
  abstract: AstAbstract
  claims: AstClaim[]
  description: DescriptionBlock[]
  figures: AstFigure[]
  /** 无 figures.md / 客端临时 settings 路径 → []；旧样例 fixture 可能缺省 */
  figures_bad_lines?: FiguresBadLine[]
}

/** 任一带 `lines` 的块（结构预览 / 大纲 / 光标同步的最小公共形状） */
export type AstBlock = AstAbstract | AstClaim | DescriptionBlock

export interface BlockLocation {
  book: BookName
  block: AstBlock
}

/** 全文行号 → 块（按书 offset 折算为书相对行后在该书内线性查找；找不到返回 null） */
export function blockAtLine(ast: Ast, fullLine: number): BlockLocation | null {
  const rel = (book: BookName) => fullLine - ast.books[book].offset
  const a = rel('abstract')
  if (a >= ast.abstract.lines.start && a <= ast.abstract.lines.end) return { book: 'abstract', block: ast.abstract }
  const c = rel('claims')
  const claim = ast.claims.find((b) => c >= b.lines.start && c <= b.lines.end)
  if (claim) return { book: 'claims', block: claim }
  const d = rel('description')
  const block = ast.description.find((b) => d >= b.lines.start && d <= b.lines.end)
  return block ? { book: 'description', block } : null
}

/** 块 → 全文起始行（编辑器 gotoLine 用） */
export function blockFullLine(ast: Ast, loc: BlockLocation): number {
  return ast.books[loc.book].offset + loc.block.lines.start
}
