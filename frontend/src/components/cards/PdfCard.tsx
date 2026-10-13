import { PreviewPane } from '@/components/preview/PreviewPane'

/**
 * PDF 卡片（§4.1）：全案 PDF = 现有 <PreviewPane/>（含 PdfToolbar / 查找条 / 控制台切换），不改其内部，单实例。
 * 与 ui.pdfLocate / doc.cursor 的联动已在 PreviewPane 内部，卡片无额外逻辑。
 */
export function PdfCard() {
  return (
    <div className="h-full min-h-0" data-testid="card-pdf">
      <PreviewPane />
    </div>
  )
}
