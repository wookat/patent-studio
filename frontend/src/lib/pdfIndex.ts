import { stripForMatch } from '@/components/preview/locate'
import type { Ast, BookName } from '@/types/ast'
import type { PdfLocateFail } from '@/types/focus'

/**
 * PdfBlockIndex（docs/plan/21-w5-spec.md §5.3）：把内核 PDF 的页 / 文字项 / 结构树配对到 AST block_id，
 * 三视图 Focus 的 PDF 侧靶点。两种模式：
 *
 * - struct：tagged PDF（build.py 预览构建 tagged=True → LibreOffice UseTaggedPDF）。按页读 getStructTree()，
 *   Document 直属的 P / Table / Figure 为一「单元」，单元下 MCID（`p23R_mc4`）经 getTextContent({includeMarkedContent})
 *   拿到各自文字项；首个非空文字为段号 `[0013]` → 说明书段（表题 / 表注 / 表本体段号都归表块），权利要求书页上为 `3.` → 权项 3，
 *   章节标题 → section；Table 内含 Formula → 按标号 `（7）`/ anchor_para_no 归公式块；无编号单元 = 上一块的续页续段；
 *   页眉页脚是未标记文字（无 MCID）与 Artifact，归 generated。
 * - heuristic：普通 PDF，复用 preview/locate.ts 的段号锚 / 去标记文本比对，页级配对；权项 `N.` 只在权利要求书页范围内认，
 *   避免说明书页脚日期「2023.03」/「3.」误配权项 3。
 *
 * 坐标：rects 为 scale=1 视口坐标（左上原点，单位 pt），PdfPreview 叠加层按当前缩放比例换算。
 */

export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfBlockEntry {
  /** 块首次出现的页（1-based） */
  page: number
  /** struct 模式：块的全部 MCID（含续页）；heuristic 模式为 [] */
  mcids: string[]
  /** `page` 页内该块的行包围盒（struct：逐行；heuristic：段号 / 编号所在行） */
  rects: PdfRect[]
}

export interface PdfLocateSel {
  page: number
  /** 点击 / 选区文字（通常一整行） */
  text: string
  /** react-pdf customTextRenderer 的 itemIndex（页内文字项序号） */
  itemIndex?: number
  /** 文字层 `.markedContent` 元素 id（struct 模式最准） */
  mcid?: string
}

export type PdfLocateResult = { blockId: string; line: number } | { fail: PdfLocateFail }

/** 页属于哪一书；figures = 说明书附图 / 摘要附图页 */
export type PageBook = BookName | 'figures'

export interface PdfBlockIndex {
  kind: 'struct' | 'heuristic'
  byBlock: Map<string, PdfBlockEntry>
  /** MCID → block_id（struct 模式；heuristic 为空） */
  byMcid: Map<string, string>
  /** 页 → 书（页眉判定）；未知返回 null */
  bookOfPage(page: number): PageBook | null
  /** 页尺寸（scale=1，pt）；叠加层用它把 rects 换算到当前渲染宽度 */
  pageSize(page: number): { width: number; height: number } | null
  locate(sel: PdfLocateSel): PdfLocateResult
}

/* ------------------------------------------------------------------ pdf.js 最小形状（便于测试注入假文档） */

export interface PdfTextItemLike {
  str?: string
  type?: string
  id?: string
  transform?: number[]
  width?: number
  height?: number
}

export interface PdfStructNodeLike {
  role?: string
  type?: string
  id?: string
  children?: PdfStructNodeLike[]
}

export interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number }
  getTextContent(o?: { includeMarkedContent?: boolean }): Promise<{ items: PdfTextItemLike[] }>
  getStructTree(): Promise<PdfStructNodeLike | null>
}

export interface PdfDocLike {
  numPages: number
  getPage(n: number): Promise<PdfPageLike>
}

/* ------------------------------------------------------------------ 页眉 → 书 */

const HEADERS: [RegExp, PageBook][] = [
  [/说\s*明\s*书\s*摘\s*要/, 'abstract'],
  [/摘\s*要\s*附\s*图/, 'figures'],
  [/权\s*利\s*要\s*求\s*书/, 'claims'],
  [/说\s*明\s*书\s*附\s*图/, 'figures'],
  [/说\s*明\s*书/, 'description'],
]

/** 从页首几项文字判书（内核页眉：「说 明 书 摘 要」「权 利 要 求 书」「说 明 书」「说 明 书 附 图」「摘 要 附 图」） */
export function bookOfHeader(headerText: string): PageBook | null {
  for (const [re, book] of HEADERS) if (re.test(headerText)) return book
  return null
}

const ANCHOR_RE = /^\s*\[(\d{4})\]/
const CLAIM_NO_RE = /^\s*(\d{1,3})\s*[.．、](?!\d)/
/** 页眉带（页高比例）：未 tagged 的 PDF 没有「未标记文字」可辨页眉，用位置判 */
const HEADER_BAND = 0.08
const EQ_LABEL_RE = /[（(]\s*(\d{1,3})\s*[)）]\s*$/
const MIN_TEXT = 4

/* ------------------------------------------------------------------ AST 侧索引 */

interface AstIndex {
  /** 说明书段号 → block_id（表题 / 表注 / 表本体段号 → 表块；表题段本身也是 paragraph 块，取段块） */
  byParaNo: Map<number, string>
  byClaimNo: Map<number, string>
  bySectionTitle: Map<string, string>
  /** 公式标号（去括号）→ block_id */
  byEqLabel: Map<string, string>
  /** anchor_para_no → 公式 block_id 列表（按出现顺序） */
  eqByAnchor: Map<number, string[]>
  abstractParas: string[]
  lineOf: Map<string, number>
  bookOf: Map<string, BookName>
  /** 块去标记文本（heuristic 文本比对） */
  texts: { id: string; book: BookName; text: string }[]
}

function indexAst(ast: Ast): AstIndex {
  const ix: AstIndex = {
    byParaNo: new Map(),
    byClaimNo: new Map(),
    bySectionTitle: new Map(),
    byEqLabel: new Map(),
    eqByAnchor: new Map(),
    abstractParas: [],
    lineOf: new Map(),
    bookOf: new Map(),
    texts: [],
  }
  const put = (book: BookName, id: string, start: number, text: string) => {
    ix.lineOf.set(id, ast.books[book].offset + start)
    ix.bookOf.set(id, book)
    const t = stripForMatch(text)
    if (t) ix.texts.push({ id, book, text: t })
  }
  for (const p of ast.abstract.paragraphs) {
    ix.abstractParas.push(p.id)
    put('abstract', p.id, p.lines.start, p.text)
  }
  for (const c of ast.claims) {
    ix.byClaimNo.set(c.num, c.id)
    put('claims', c.id, c.lines.start, c.segments.map((s) => s.text).join(''))
  }
  for (const b of ast.description) {
    switch (b.kind) {
      case 'section':
      case 'subsection':
        ix.bySectionTitle.set(stripForMatch(b.title), b.id)
        put('description', b.id, b.lines.start, b.title)
        break
      case 'paragraph':
        if (b.para_no !== null) ix.byParaNo.set(b.para_no, b.id)
        put('description', b.id, b.lines.start, b.text)
        break
      case 'code':
        ix.byParaNo.set(b.para_no, b.id)
        put('description', b.id, b.lines.start, b.code_lines.join(''))
        break
      case 'table':
        ix.byParaNo.set(b.para_no, b.id)
        if (b.caption_after) ix.byParaNo.set(b.caption_after.para_no, b.id)
        if (b.note) ix.byParaNo.set(b.note.para_no, b.id)
        put('description', b.id, b.lines.start, b.rows.flat().join(''))
        break
      case 'equation':
        if (b.label) ix.byEqLabel.set(b.label.replace(/[\s（）()]/g, ''), b.id)
        if (b.anchor_para_no !== null) {
          const list = ix.eqByAnchor.get(b.anchor_para_no) ?? []
          list.push(b.id)
          ix.eqByAnchor.set(b.anchor_para_no, list)
        }
        put('description', b.id, b.lines.start, b.source)
        break
    }
  }
  return ix
}

/* ------------------------------------------------------------------ 页文字项 */

interface PageItem {
  /** 页内文字项序号（与 react-pdf itemIndex / find.ts items 对齐：只数带 str 的项） */
  index: number
  str: string
  mcid: string | null
  rect: PdfRect | null
}

interface PageData {
  page: number
  width: number
  height: number
  book: PageBook | null
  items: PageItem[]
  /** 未标记（页眉页脚等）文字 */
  unmarked: string
  struct: PdfStructNodeLike | null
}

function itemRect(it: PdfTextItemLike, pageH: number): PdfRect | null {
  const t = it.transform
  const w = it.width ?? 0
  const h = it.height ?? 0
  if (!t || w <= 0 || h <= 0) return null
  return { x: t[4], y: pageH - t[5] - h, width: w, height: h }
}

async function readPage(doc: PdfDocLike, n: number, wantStruct: boolean): Promise<PageData> {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale: 1 })
  const h = vp.height
  const tc = await page.getTextContent({ includeMarkedContent: true })
  const items: PageItem[] = []
  let cur: string | null = null
  let depth = 0
  let marked = false
  for (const it of tc.items) {
    if (it.str === undefined) {
      if (it.type === 'beginMarkedContentProps') {
        cur = it.id ?? null
        depth++
        marked = true
      } else if (it.type === 'beginMarkedContent') {
        depth++
      } else if (it.type === 'endMarkedContent') {
        if (--depth <= 0) {
          depth = 0
          cur = null
        }
      }
      continue
    }
    items.push({ index: items.length, str: it.str, mcid: cur, rect: itemRect(it, h) })
  }
  // tagged：页眉页脚 = 未标记文字；否则 = 页顶带内的文字
  const unmarked = items
    .filter((i) => (marked ? !i.mcid : i.rect !== null && i.rect.y < h * HEADER_BAND))
    .map((i) => i.str)
    .join('')
  return {
    page: n,
    width: vp.width,
    height: h,
    book: bookOfHeader(unmarked || items.slice(0, 12).map((i) => i.str).join('')),
    items,
    unmarked,
    struct: wantStruct ? await page.getStructTree() : null,
  }
}

/** 把同一基线上的项合成行包围盒 */
function lineRects(items: PageItem[]): PdfRect[] {
  const rows: PdfRect[] = []
  for (const it of items) {
    if (!it.rect) continue
    const r = it.rect
    const mid = r.y + r.height / 2
    const row = rows.find((q) => Math.abs(q.y + q.height / 2 - mid) <= Math.max(2, q.height / 2))
    if (!row) {
      rows.push({ ...r })
      continue
    }
    const x2 = Math.max(row.x + row.width, r.x + r.width)
    const y2 = Math.max(row.y + row.height, r.y + r.height)
    row.x = Math.min(row.x, r.x)
    row.y = Math.min(row.y, r.y)
    row.width = x2 - row.x
    row.height = y2 - row.y
  }
  return rows
}

/* ------------------------------------------------------------------ struct 模式 */

interface Unit {
  role: string
  mcids: string[]
  hasFigure: boolean
  hasFormula: boolean
  artifact: boolean
}

function collectUnits(tree: PdfStructNodeLike | null): Unit[] {
  // Root → Document → [P | Table | Figure | Artifact …]；有些导出把块直接挂在 Root 下
  let level: PdfStructNodeLike[] = tree?.children ?? []
  if (level.length === 1 && level[0].role === 'Document') level = level[0].children ?? []
  const units: Unit[] = []
  for (const n of level) {
    const u: Unit = { role: n.role ?? '', mcids: [], hasFigure: false, hasFormula: false, artifact: n.role === 'Artifact' }
    const walk = (x: PdfStructNodeLike) => {
      if (x.type === 'content') {
        if (x.id) u.mcids.push(x.id)
        return
      }
      if (x.role === 'Figure') u.hasFigure = true
      if (x.role === 'Formula') u.hasFormula = true
      if (x.role === 'Artifact') u.artifact = true
      for (const c of x.children ?? []) walk(c)
    }
    walk(n)
    units.push(u)
  }
  return units
}

class Index implements PdfBlockIndex {
  byBlock = new Map<string, PdfBlockEntry>()
  byMcid = new Map<string, string>()
  /** 归 generated 的 MCID（Artifact / 无正文的图框） */
  generatedMcids = new Set<string>()
  figureMcids = new Set<string>()
  pages = new Map<number, PageData>()

  readonly kind: 'struct' | 'heuristic'
  readonly ast: AstIndex

  constructor(kind: 'struct' | 'heuristic', ast: AstIndex) {
    this.kind = kind
    this.ast = ast
  }

  bookOfPage(page: number) {
    return this.pages.get(page)?.book ?? null
  }

  pageSize(page: number) {
    const p = this.pages.get(page)
    return p ? { width: p.width, height: p.height } : null
  }

  add(blockId: string, page: number, mcids: string[], items: PageItem[]) {
    for (const m of mcids) this.byMcid.set(m, blockId)
    const cur = this.byBlock.get(blockId)
    if (cur) {
      cur.mcids.push(...mcids)
      if (cur.page === page) cur.rects.push(...lineRects(items))
      return
    }
    this.byBlock.set(blockId, { page, mcids: [...mcids], rects: lineRects(items) })
  }

  result(blockId: string): PdfLocateResult {
    return { blockId, line: this.ast.lineOf.get(blockId) ?? 0 }
  }

  locate(sel: PdfLocateSel): PdfLocateResult {
    const pg = this.pages.get(sel.page)
    if (!pg) return { fail: 'nomatch' }
    if (pg.book === 'figures') return { fail: 'figure' }

    if (this.kind === 'struct') {
      const mcid = sel.mcid ?? (sel.itemIndex !== undefined ? (pg.items[sel.itemIndex]?.mcid ?? null) : null)
      if (mcid) {
        const id = this.byMcid.get(mcid)
        if (id) return this.result(id)
        if (this.figureMcids.has(mcid)) return { fail: 'figure' }
        if (this.generatedMcids.has(mcid)) return { fail: 'generated' }
      } else if (sel.itemIndex !== undefined && pg.items[sel.itemIndex] && !pg.items[sel.itemIndex].mcid) {
        return { fail: 'generated' }
      }
    }
    return this.locateByText(pg, sel.text)
  }

  /** 文本比对（heuristic 主路径；struct 模式 MCID 缺失时的兜底） */
  locateByText(pg: PageData, text: string): PdfLocateResult {
    const raw = text.trim()
    if (!raw) return { fail: 'short' }
    if (pg.unmarked && stripForMatch(pg.unmarked).includes(stripForMatch(raw)) && stripForMatch(raw).length >= 2) return { fail: 'generated' }

    const a = ANCHOR_RE.exec(raw)
    if (a && pg.book !== 'claims') {
      const id = this.ast.byParaNo.get(Number(a[1]))
      if (id) return this.result(id)
    }
    const c = CLAIM_NO_RE.exec(raw)
    if (c && pg.book === 'claims') {
      const id = this.ast.byClaimNo.get(Number(c[1]))
      if (id) return this.result(id)
    }
    const q = stripForMatch(raw.replace(ANCHOR_RE, '').replace(pg.book === 'claims' ? CLAIM_NO_RE : /$^/, ''))
    if (q.length < MIN_TEXT) return { fail: 'short' }
    const book = pg.book
    const hits = this.ast.texts.filter((t) => (book === null || t.book === book) && t.text.includes(q))
    if (hits.length === 1) return this.result(hits[0].id)
    if (hits.length > 1) return { fail: 'ambiguous' }
    return { fail: 'nomatch' }
  }

  ambiguousCandidates(text: string): { page: number; score: number }[] {
    const q = stripForMatch(text)
    const out: { page: number; score: number }[] = []
    for (const pg of this.pages.values()) {
      const n = pg.items.filter((i) => q && stripForMatch(i.str).includes(q)).length
      if (n) out.push({ page: pg.page, score: n })
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 3)
  }
}

function buildStruct(ix: Index, pages: PageData[]) {
  const a = ix.ast
  let prevBlock: string | null = null
  let prevBook: PageBook | null = null
  let abstractSeen = 0
  for (const pg of pages) {
    if (pg.book !== prevBook) prevBlock = null
    prevBook = pg.book
    let lastParaNo: number | null = null
    const byMcid = new Map<string, PageItem[]>()
    for (const it of pg.items) if (it.mcid) (byMcid.get(it.mcid) ?? byMcid.set(it.mcid, []).get(it.mcid)!).push(it)

    for (const u of collectUnits(pg.struct)) {
      const items = u.mcids.flatMap((m) => byMcid.get(m) ?? [])
      const text = items.map((i) => i.str).join('').trim()
      if (u.artifact) {
        for (const m of u.mcids) ix.generatedMcids.add(m)
        continue
      }
      if (pg.book === 'figures' || (u.hasFigure && !text)) {
        for (const m of u.mcids) ix.figureMcids.add(m)
        continue
      }
      let id: string | null = null
      if (pg.book === 'abstract') {
        // 摘要页：第一段是发明名称（title 无 block），其后依次为摘要段
        if (abstractSeen > 0) id = a.abstractParas[abstractSeen - 1] ?? null
        abstractSeen++
      } else if (pg.book === 'claims') {
        const m = CLAIM_NO_RE.exec(text)
        if (m) id = a.byClaimNo.get(Number(m[1])) ?? null
      } else {
        const m = ANCHOR_RE.exec(text)
        if (m) {
          lastParaNo = Number(m[1])
          id = a.byParaNo.get(lastParaNo) ?? null
        } else if (u.hasFormula || u.role === 'Table') {
          const lb = EQ_LABEL_RE.exec(text)
          if (lb) id = a.byEqLabel.get(lb[1]) ?? null
          // 表块段号在表体单元格里（num 列 / 首格），不一定在单元首文本
          const inner = !u.hasFormula ? /\[(\d{4})\]/.exec(text) : null
          if (!id && inner) id = a.byParaNo.get(Number(inner[1])) ?? null
          if (!id && u.hasFormula && lastParaNo !== null) {
            const list = a.eqByAnchor.get(lastParaNo) ?? []
            id = list.find((e) => !ix.byBlock.has(e)) ?? null
          }
        } else if (text) {
          id = a.bySectionTitle.get(stripForMatch(text)) ?? null
        }
      }
      if (!id && !text && !u.hasFormula) {
        for (const m of u.mcids) ix.generatedMcids.add(m)
        continue
      }
      const target = id ?? prevBlock
      if (!target) continue
      ix.add(target, pg.page, u.mcids, items)
      // 公式行后的无编号文字仍是所在段的续文，不归公式块
      if (id && !u.hasFormula) prevBlock = id
    }
  }
}

/* ------------------------------------------------------------------ heuristic 模式 */

function buildHeuristic(ix: Index, pages: PageData[]) {
  const a = ix.ast
  for (const pg of pages) {
    if (pg.book === 'figures') continue
    for (const it of pg.items) {
      const s = it.str.trim()
      if (!s) continue
      let id: string | null = null
      if (pg.book === 'claims') {
        const m = CLAIM_NO_RE.exec(s)
        if (m) id = a.byClaimNo.get(Number(m[1])) ?? null
      } else {
        const m = ANCHOR_RE.exec(s)
        if (m) id = a.byParaNo.get(Number(m[1])) ?? null
        else if (pg.book === 'description') id = a.bySectionTitle.get(stripForMatch(s)) ?? null
      }
      if (id && !ix.byBlock.has(id)) ix.byBlock.set(id, { page: pg.page, mcids: [], rects: it.rect ? [it.rect] : [] })
    }
  }
}

/* ------------------------------------------------------------------ 入口 */

export interface BuildPdfBlockIndexOptions {
  /** BuildResult.pdf_tagged；false 时不读结构树 */
  tagged: boolean
}

export async function buildPdfBlockIndex(doc: PdfDocLike, ast: Ast, opts: BuildPdfBlockIndexOptions): Promise<PdfBlockIndex> {
  const pages: PageData[] = []
  for (let n = 1; n <= doc.numPages; n++) pages.push(await readPage(doc, n, opts.tagged))
  const hasStruct = opts.tagged && pages.some((p) => (p.struct?.children?.length ?? 0) > 0)
  const ix = new Index(hasStruct ? 'struct' : 'heuristic', indexAst(ast))
  for (const p of pages) ix.pages.set(p.page, p)
  if (hasStruct) buildStruct(ix, pages)
  else buildHeuristic(ix, pages)
  return ix
}

/** 定位失败 = ambiguous 时给状态栏 / 候选弹层的页候选（≤3） */
export function pdfLocateCandidates(index: PdfBlockIndex, text: string): { page: number; score: number }[] {
  return index instanceof Index ? index.ambiguousCandidates(text) : []
}
