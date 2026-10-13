import { useCallback } from 'react'
import { ConsolePanel } from '@/components/console/ConsolePanel'
import { useIsDesktop } from '@/hooks/useMisc'
import { useStudio, selectPdfUrl } from '@/store'
import { PdfFindBar, usePdfFindState } from './PdfFindBar'
import { PdfPreview } from './PdfPreview'
import { PdfToolbar } from './PdfToolbar'
import { PreviewEmpty } from './PreviewEmpty'

/**
 * PDF 区（05 §3.6）= h-pdftb 32 PdfToolbar + 画布（bg-paper-canvas，暗色不刺眼；纸面 --paper 恒白）。
 * - pdfView==='pdf'：真实 PdfPreview（DOCX→LibreOffice→pdf.js）。构建失败时 selectPdfUrl 仍指向上次成功的 PDF → 旧页继续显示，
 *   不清空、不盖过期横幅；过期信息只在 PdfStatusText / 控制台角标 / 状态栏。
 * - pdfView==='logs'：正文被 ConsolePanel 替换，工具条右组隐藏、左组出现「返回预览」（Overleaf 屏 6 范式）。
 */
export function PreviewPane() {
  const desktop = useIsDesktop()
  const pdfUrl = useStudio(selectPdfUrl)
  const pdfView = useStudio((s) => s.pdfView)
  const setPageInfo = useStudio((s) => s.setPageInfo)
  const markPreviewShown = useStudio((s) => s.markPreviewShown)
  const zoom = useStudio((s) => s.zoom)
  const logs = desktop && pdfView === 'logs'
  const fs = usePdfFindState()

  const onSwap = useCallback(
    (url: string) => {
      if (url === pdfUrl) markPreviewShown(url)
    },
    [pdfUrl, markPreviewShown],
  )

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col bg-paper-canvas"
      data-testid="preview-pane"
      data-slot="PreviewPane"
      data-view={logs ? 'logs' : 'pdf'}
    >
      <PdfToolbar />
      <div className="relative min-h-0 min-w-0 flex-1">
        {logs ? (
          <ConsolePanel />
        ) : (
          <>
            <PdfPreview
              url={pdfUrl}
              zoom={zoom}
              capToContainer={!desktop}
              onPageInfo={setPageInfo}
              onSwap={onSwap}
              find={fs.active ? fs.find : null}
              onFindResult={fs.onFindResult}
            />
            <PdfFindBar query={fs.find.query} current={fs.find.current} total={fs.total} onQuery={fs.onQuery} onStep={fs.onStep} />
            {!pdfUrl && (
              <div className="absolute inset-0">
                <PreviewEmpty />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
