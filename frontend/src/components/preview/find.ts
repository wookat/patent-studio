import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface PdfFind {
  query: string
  /** 当前命中序号（0-based） */
  current: number
}

/** 一页的文字项：str 与 react-pdf customTextRenderer 收到的 itemIndex 一一对应 */
export interface PageText {
  items: string[]
  /** 各项基线距页顶的比例（0 顶 → 1 底），用于把命中滚到视口中央 */
  yFrac: number[]
}

export interface Match {
  page: number // 1-based
  item: number
  start: number
  yFrac: number
}

interface RawItem {
  str: string
  transform: number[]
}

/** 提取整份 PDF 的文字项（pdf.js getTextContent；22 页约 100 ms，结果缓存在槽里） */
export async function extractPageTexts(doc: PDFDocumentProxy): Promise<PageText[]> {
  const out: PageText[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const h = page.getViewport({ scale: 1 }).height
    const tc = await page.getTextContent()
    const items: string[] = []
    const yFrac: number[] = []
    for (const it of tc.items as RawItem[]) {
      items.push(it.str ?? '')
      yFrac.push(Math.min(1, Math.max(0, 1 - (it.transform?.[5] ?? 0) / h)))
    }
    out.push({ items, yFrac })
  }
  return out
}

/** 不区分大小写，按文字项逐项匹配（与高亮一致；跨项的命中不计） */
export function findMatches(texts: PageText[], query: string): Match[] {
  const q = query.toLowerCase()
  if (!q) return []
  const res: Match[] = []
  texts.forEach((pg, pi) => {
    pg.items.forEach((str, ii) => {
      const s = str.toLowerCase()
      let from = 0
      for (;;) {
        const at = s.indexOf(q, from)
        if (at < 0) break
        res.push({ page: pi + 1, item: ii, start: at, yFrac: pg.yFrac[ii] })
        from = at + q.length
      }
    })
  })
  return res
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 把文字项渲染成带 <mark> 的 HTML；currentStart 为当前命中在本项中的起点（-1 表示无） */
export function highlightHtml(str: string, query: string, currentStart: number): string {
  const q = query.toLowerCase()
  if (!q) return esc(str)
  const s = str.toLowerCase()
  let html = ''
  let from = 0
  for (;;) {
    const at = s.indexOf(q, from)
    if (at < 0) break
    html += esc(str.slice(from, at))
    const cls = at === currentStart ? ' class="pdf-find-current"' : ''
    html += `<mark${cls}>${esc(str.slice(at, at + q.length))}</mark>`
    from = at + q.length
  }
  return html + esc(str.slice(from))
}
