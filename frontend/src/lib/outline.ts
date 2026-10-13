import type { Ast, AstClaim, AstFigure, BookName, DescriptionBlock, DescriptionPart } from '@/types/ast'
import type { OutlineNode } from './types'

/**
 * AST → 大纲（docs/plan/04-r1-design.md §5.6）。纯适配：不再解析 Markdown，唯一解析器在后端 `/ast`。
 * 节点 id = AST 块 id（`claims/3`、`description/发明内容/技术方案`、`figures/2`）；书级根节点用 `abstract` / `claims` / `description`。
 * 行号一律换算成全文 1-based（`books[book].offset + lines.start`），供 gotoLine / 光标定位直接使用。
 */

/** 实施细则第 20 条要求的说明书章节（“六章节”中的“名称”即 `# ` 标题） */
export const REQUIRED_SECTIONS = ['技术领域', '背景技术', '发明内容', '附图说明', '具体实施方式'] as const

/** 默认展开的章节（其余章节默认折叠到二级） */
export const DEFAULT_OPEN_PARTS: readonly DescriptionPart[] = ['disclosure', 'mode-for-invention']

export const CLAIM_TEXT_MAX = 24

export interface LineRange {
  /** 全文 1-based */
  line: number
  /** 全文 1-based，闭区间 */
  end: number
}

export interface ClaimItem extends LineRange {
  /** AST 块 id（`claims/3`） */
  id: string
  num: number
  /** 首句截断（去掉前导编号） */
  text: string
  /** 首段原文（去掉前导编号） */
  full: string
  dependent: boolean
  /** 引用目标（展开、去重、升序） */
  refs: number[]
  /** 前向 / 自引 / 不存在的引用 */
  badRefs: number[]
}

export type LeafKind = 'equation' | 'table' | 'figure'

export interface LeafItem {
  id: string
  kind: LeafKind
  line: number
  label: string
  /** 图：文件名；表：段号 `[0051]`；公式：原文标号 */
  tag: string | null
  /** PDF 定位锚（表 / 公式 anchor_para_no）；无则 null */
  paraNo: number | null
}

export interface SubsectionItem extends LineRange {
  id: string
  name: string
  leaves: LeafItem[]
}

export interface SectionItem extends LineRange {
  id: string
  name: string
  part: DescriptionPart
  /** 章节内首个 / 末个段号 */
  firstPara: number | null
  lastPara: number | null
  subsections: SubsectionItem[]
  /** 直接挂在章节下（不属于任何小节）的图 / 表 / 公式 */
  leaves: LeafItem[]
}

export interface OutlineModel {
  title: { text: string; line: number } | null
  abstract: LineRange | null
  claims: (LineRange & { items: ClaimItem[] }) | null
  description:
    | (LineRange & {
        sections: SectionItem[]
        /** 说明书正文段数（末段号） */
        paragraphs: number
        /** `### ` 之前的图 / 表 / 公式 */
        leaves: LeafItem[]
      })
    | null
  /** 任一块 id → 大纲节点 id（段落归所属小节 / 章节；图题注段归图叶子） */
  nodeOfBlock: Map<string, string>
}

export const EMPTY_OUTLINE: OutlineModel = { title: null, abstract: null, claims: null, description: null, nodeOfBlock: new Map() }

/* ---------------- 工具 ---------------- */

const CLAIM_NUM_RE = /^\s*\d+\s*[.．、,，]?\s*/

/** 首句：到第一个 。；：, 或 CLAIM_TEXT_MAX 字为止 */
export function firstSentence(text: string, max = CLAIM_TEXT_MAX): string {
  const t = text.trim()
  const cut = t.search(/[。；;：:]/)
  const head = cut >= 0 ? t.slice(0, cut) : t
  return head.length > max ? `${head.slice(0, max)}…` : head
}

const uniqSorted = (nums: number[]) => [...new Set(nums)].sort((a, b) => a - b)

const bookRange = (ast: Ast, book: BookName): LineRange => {
  const b = ast.books[book]
  return { line: b.offset, end: b.offset + b.length }
}

function claimItem(ast: Ast, c: AstClaim, nums: Set<number>): ClaimItem {
  const off = ast.books.claims.offset
  const raw = c.segments[0]?.text ?? ''
  const full = raw.replace(CLAIM_NUM_RE, '')
  const refs = uniqSorted(c.refs.flatMap((r) => r.targets))
  return {
    id: c.id,
    num: c.num,
    text: firstSentence(full),
    full,
    dependent: c.claim_kind === 'dependent',
    refs,
    badRefs: refs.filter((r) => r >= c.num || !nums.has(r)),
    line: off + c.lines.start,
    end: off + c.lines.end,
  }
}

const pad4 = (n: number) => `[${String(n).padStart(4, '0')}]`

function leafOf(block: DescriptionBlock, line: number, captionText: string | null): LeafItem | null {
  if (block.kind === 'equation') {
    const tail = block.id.slice(block.id.lastIndexOf('/') + 1)
    return { id: block.id, kind: 'equation', line, label: block.label ? `公式 ${block.label}` : `公式 ${tail}`, tag: block.label, paraNo: block.anchor_para_no }
  }
  if (block.kind === 'table') {
    const caption = captionText ?? block.caption_after?.text ?? null
    return { id: block.id, kind: 'table', line, label: caption ? firstSentence(caption) : `表格 ${pad4(block.para_no)}`, tag: pad4(block.para_no), paraNo: block.para_no }
  }
  return null
}

function figureLeaf(ast: Ast, f: AstFigure, fallbackLine: number): LeafItem {
  const line = f.caption_line !== null ? ast.books.description.offset + f.caption_line : fallbackLine
  return { id: f.id, kind: 'figure', line, label: f.caption ? `图${f.num} ${firstSentence(f.caption)}` : `图${f.num}`, tag: f.file, paraNo: null }
}

/* ---------------- 主适配 ---------------- */

export function buildOutline(ast: Ast | null): OutlineModel {
  if (!ast) return EMPTY_OUTLINE
  const nodeOfBlock = new Map<string, string>()
  const out: OutlineModel = { title: ast.title.text ? { text: ast.title.text, line: ast.title.line } : null, abstract: null, claims: null, description: null, nodeOfBlock }

  if (ast.books.abstract.length > 0) {
    out.abstract = bookRange(ast, 'abstract')
    nodeOfBlock.set('abstract', 'abstract')
    for (const p of ast.abstract.paragraphs) nodeOfBlock.set(p.id, 'abstract')
  }

  if (ast.books.claims.length > 0) {
    const nums = new Set(ast.claims.map((c) => c.num))
    const items = ast.claims.map((c) => claimItem(ast, c, nums))
    for (const c of items) nodeOfBlock.set(c.id, c.id)
    out.claims = { ...bookRange(ast, 'claims'), items }
  }

  if (ast.books.description.length > 0) {
    const off = ast.books.description.offset
    const range = bookRange(ast, 'description')
    const sections: SectionItem[] = []
    const rootLeaves: LeafItem[] = []
    let sec: SectionItem | null = null
    let sub: SubsectionItem | null = null
    let paragraphs = 0
    let captionText: string | null = null
    const owner = () => sub?.id ?? sec?.id ?? 'description'
    const leaves = () => sub?.leaves ?? sec?.leaves ?? rootLeaves
    const closeSub = (endLine: number) => {
      if (sub) sub.end = endLine
      sub = null
    }
    const closeSec = (endLine: number) => {
      closeSub(endLine)
      if (sec) sec.end = endLine
      sec = null
    }
    const notePara = (n: number | null) => {
      if (n === null) return
      paragraphs = Math.max(paragraphs, n)
      if (sec) {
        if (sec.firstPara === null) sec.firstPara = n
        sec.lastPara = n
      }
    }

    for (const b of ast.description) {
      const line = off + b.lines.start
      if (b.kind === 'section') {
        closeSec(line - 1)
        sec = { id: b.id, name: b.title, part: b.part, line, end: range.end, firstPara: null, lastPara: null, subsections: [], leaves: [] }
        sections.push(sec)
        nodeOfBlock.set(b.id, b.id)
        captionText = null
        continue
      }
      if (b.kind === 'subsection') {
        closeSub(line - 1)
        sub = { id: b.id, name: b.title, line, end: range.end, leaves: [] }
        if (sec) sec.subsections.push(sub)
        nodeOfBlock.set(b.id, b.id)
        captionText = null
        continue
      }
      if (b.kind === 'paragraph') {
        notePara(b.para_no)
        captionText = b.role === 'table-caption' ? b.text : null
        nodeOfBlock.set(b.id, owner())
        continue
      }
      if (b.kind === 'code') {
        notePara(b.para_no)
        nodeOfBlock.set(b.id, owner())
        captionText = null
        continue
      }
      if (b.kind === 'table') {
        notePara(b.para_no)
        notePara(b.caption_after?.para_no ?? null)
        notePara(b.note?.para_no ?? null)
      }
      const leaf = leafOf(b, line, captionText)
      captionText = null
      if (leaf) {
        leaves().push(leaf)
        nodeOfBlock.set(b.id, leaf.id)
      }
    }
    closeSec(range.end)

    // 附图：按题注行挂到所属章节 / 小节；无题注行 → 附图说明章节（或首个章节）
    const drawings = sections.find((s) => s.part === 'description-of-drawings') ?? sections[0] ?? null
    for (const f of ast.figures) {
      const leaf = figureLeaf(ast, f, drawings?.line ?? range.line)
      const host = sections.find((s) => leaf.line >= s.line && leaf.line <= s.end) ?? drawings
      const hostSub = host?.subsections.find((s) => leaf.line >= s.line && leaf.line <= s.end)
      ;(hostSub?.leaves ?? host?.leaves ?? rootLeaves).push(leaf)
      nodeOfBlock.set(f.id, f.id)
      // 题注段（同一行的说明书段）归图叶子，光标落在题注上高亮该图
      if (f.caption_line !== null) {
        const cap = ast.description.find((b) => b.kind === 'paragraph' && b.lines.start === f.caption_line)
        if (cap) nodeOfBlock.set(cap.id, f.id)
      }
    }
    for (const s of sections) {
      s.leaves.sort((a, b) => a.line - b.line)
      for (const x of s.subsections) x.leaves.sort((a, b) => a.line - b.line)
    }
    rootLeaves.sort((a, b) => a.line - b.line)
    out.description = { ...range, sections, paragraphs, leaves: rootLeaves }
  }
  return out
}

/* ---------------- 光标 / 行定位 ---------------- */

/** 全文行 → 大纲节点 id（空行 / 书标题行归最近的前一个块所属节点；找不到返回 null） */
export function locateLine(ast: Ast | null, model: OutlineModel, fullLine: number): string | null {
  if (!ast) return null
  if (model.abstract && fullLine >= model.abstract.line && fullLine <= model.abstract.end) return 'abstract'
  if (model.claims && fullLine >= model.claims.line && fullLine <= model.claims.end) {
    let hit = 'claims'
    for (const c of model.claims.items) if (c.line <= fullLine) hit = c.id
    return hit
  }
  if (model.description && fullLine >= model.description.line && fullLine <= model.description.end) {
    const rel = fullLine - ast.books.description.offset
    let hit = 'description'
    for (const b of ast.description) {
      if (b.lines.start > rel) break
      hit = model.nodeOfBlock.get(b.id) ?? hit
    }
    return hit
  }
  return null
}

/** 光标行所属的说明书段号（[0001] → 1）；不在编号段内（标题 / 公式 / 空行 / 非说明书）返回 null */
export function paragraphAtLine(ast: Ast | null, fullLine: number): number | null {
  if (!ast) return null
  const rel = fullLine - ast.books.description.offset
  const b = ast.description.find((x) => rel >= x.lines.start && rel <= x.lines.end)
  if (!b) return null
  if (b.kind === 'paragraph' || b.kind === 'table' || b.kind === 'code') return b.para_no
  return null
}

/** 大纲节点 id → 全文首行 */
export function nodeLine(model: OutlineModel, id: string): number | null {
  if (id === 'abstract') return model.abstract?.line ?? null
  if (id === 'claims') return model.claims?.line ?? null
  if (id === 'description') return model.description?.line ?? null
  const c = model.claims?.items.find((x) => x.id === id)
  if (c) return c.line
  const d = model.description
  if (!d) return null
  for (const leaf of d.leaves) if (leaf.id === id) return leaf.line
  for (const s of d.sections) {
    if (s.id === id) return s.line
    for (const leaf of s.leaves) if (leaf.id === id) return leaf.line
    for (const x of s.subsections) {
      if (x.id === id) return x.line
      for (const leaf of x.leaves) if (leaf.id === id) return leaf.line
    }
  }
  return null
}

/** 节点的祖先 id（自根到父），供光标自动展开 */
export function ancestorsOf(model: OutlineModel, id: string): string[] {
  if (id.startsWith('claims/')) return ['claims']
  if (id === 'abstract' || id === 'claims' || id === 'description') return []
  const d = model.description
  if (!d) return []
  if (d.leaves.some((l) => l.id === id)) return ['description']
  for (const s of d.sections) {
    if (s.id === id) return ['description']
    if (s.leaves.some((l) => l.id === id)) return ['description', s.id]
    for (const x of s.subsections) {
      if (x.id === id) return ['description', s.id]
      if (x.leaves.some((l) => l.id === id)) return ['description', s.id, x.id]
    }
  }
  return []
}

/** 默认折叠的节点：发明内容 / 具体实施方式以外的章节，以及所有带叶子的小节（"折叠到二级"） */
export function defaultCollapsed(model: OutlineModel): Set<string> {
  const out = new Set<string>()
  for (const s of model.description?.sections ?? []) {
    if (!DEFAULT_OPEN_PARTS.includes(s.part) && (s.subsections.length || s.leaves.length)) out.add(s.id)
    for (const x of s.subsections) if (x.leaves.length) out.add(x.id)
  }
  return out
}

/** 折叠态 = 默认态 XOR 用户切换过（`ui.outlineCollapsedIds` 记录与默认相反的节点） */
export const isCollapsed = (defaults: Set<string>, toggled: readonly string[], id: string) => defaults.has(id) !== toggled.includes(id)

/* ---------------- store 节点树（状态栏「光标所在」路径用） ---------------- */

const sectionNode = (s: SectionItem): OutlineNode => ({
  id: s.id,
  kind: 'section',
  label: s.name,
  line: s.line,
  children: s.subsections.length ? s.subsections.map((x) => ({ id: x.id, kind: 'section' as const, label: x.name, line: x.line })) : undefined,
})

/** 将 OutlineModel 转成 store 承载的 OutlineNode 树（doc.outline）：标题 → 摘要 → 权利要求书/权项 → 说明书/章节/小节 */
export function toOutlineNodes(model: OutlineModel): OutlineNode[] {
  const nodes: OutlineNode[] = []
  if (model.title) nodes.push({ id: 'title', kind: 'title', label: model.title.text, line: model.title.line })
  if (model.abstract) nodes.push({ id: 'abstract', kind: 'abstract', label: '摘要', line: model.abstract.line })
  if (model.claims) {
    nodes.push({
      id: 'claims',
      kind: 'claims',
      label: '权利要求书',
      line: model.claims.line,
      children: model.claims.items.map((c) => ({ id: c.id, kind: 'claim' as const, label: String(c.num), line: c.line, ref: c.dependent && c.refs.length ? c.refs[0] : null })),
    })
  }
  if (model.description) {
    const present = new Map(model.description.sections.map((s) => [s.name, s]))
    const children: OutlineNode[] = []
    for (const name of REQUIRED_SECTIONS) {
      const s = present.get(name)
      children.push(s ? sectionNode(s) : { id: `description/${name}`, kind: 'section', label: name, line: model.description.line, missing: true })
    }
    for (const s of model.description.sections) {
      if ((REQUIRED_SECTIONS as readonly string[]).includes(s.name)) continue
      children.push(sectionNode(s))
    }
    children.sort((a, b) => a.line - b.line)
    nodes.push({ id: 'description', kind: 'description', label: '说明书', line: model.description.line, children })
  }
  return nodes
}
