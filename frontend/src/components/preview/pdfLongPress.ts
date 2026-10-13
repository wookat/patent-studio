import type { BookName } from '@/types/ast'

/** 移动长按 500ms（R-MOB-05）：PdfPreview 只广播（含命中块所属书），底部 Sheet（mobile/PdfLongPressSheet）监听后写 ui.pdfLongPress */
export const PDF_LONG_PRESS_EVENT = 'ps:pdf-longpress'
export interface PdfLongPressDetail {
  x: number
  y: number
  page: number
  text: string
  blockId: string | null
  book: BookName | null
  line: number | null
}
