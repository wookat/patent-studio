import { useCallback } from 'react'
import { Loader2, PencilLine } from 'lucide-react'
import { PdfFindBar, usePdfFindState } from '@/components/preview/PdfFindBar'
import { PdfPreview } from '@/components/preview/PdfPreview'
import { PdfToolbarMobileControls } from '@/components/preview/PdfToolbar'
import { StaleBanner } from '@/components/preview/StaleBanner'
import { PreviewEmpty } from '@/components/preview/PreviewEmpty'
import { LayoutView } from '@/components/layout-view'
import { Button } from '@/components/ui/button'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { useStudio, selectPdfUrl, type MobilePreviewKind } from '@/store'

const KIND_OPTIONS: readonly SegmentedOption<MobilePreviewKind>[] = [
  { value: 'pdf', label: 'PDF', 'data-testid': 'mpv-kind-pdf' },
  { value: 'layout', label: '版面', 'data-testid': 'mpv-kind-layout' },
]

/**
 * 移动「预览」Tab（05 §3.19 / S10c；06 §2）：首行 44 = Segmented md『PDF ｜ 版面』（ui.mobilePreviewKind，持久化）；
 * PDF 时第二行 44 = PdfToolbarMobileControls（查找 · 页码 Input lg · 适宽 · − +，36 控件 + touch-hit），与 PdfToolbar 共用适宽/缩放逻辑；
 * 构建在顶栏 primary、控制台在 MoreSheet，ModeSwitch 不重复。chrome = 44 + 44 + 44 + 56 = 188。
 * - pdf：StaleBanner + 真实 PdfPreview（DOCX→LibreOffice→pdf.js，纸面恒白），长按 ≥600ms → PdfLongPressSheet（MobileShell 挂载）。
 * - layout：只读 <LayoutView mode="readonly"/>；右下 44 浮动「在源码中编辑」（gotoLine → 编辑 Tab）。
 */
export function MobilePreview() {
  const kind = useStudio((s) => s.mobilePreviewKind)
  const setKind = useStudio((s) => s.setMobilePreviewKind)
  const cursorLine = useStudio((s) => s.cursor.line)
  const gotoLine = useStudio((s) => s.gotoLine)
  const pdf = kind === 'pdf'

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-paper-canvas" data-testid="preview-pane" data-variant="mobile" data-kind={kind}>
      <div className="flex h-mobile-topbar shrink-0 items-center gap-group-m border-b bg-app px-page-m" data-testid="mpv-toolbar">
        <Segmented size="md" options={KIND_OPTIONS} value={kind} onValueChange={setKind} aria-label="预览内容" data-testid="mpv-kind" className="shrink-0 py-0" />
      </div>
      {pdf ? (
        <>
          <PdfToolbarMobileControls />
          <MobilePdf />
        </>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <LayoutView className="h-full min-h-0 overflow-auto" mode="readonly" />
          <Button size="md" variant="secondary" className="absolute bottom-3 right-3 shadow-md" data-testid="mpv-edit-source" onClick={() => gotoLine(cursorLine)}>
            <PencilLine aria-hidden />
            在源码中编辑
          </Button>
        </div>
      )}
    </div>
  )
}

function MobilePdf() {
  const pdfUrl = useStudio(selectPdfUrl)
  const phase = useStudio((s) => s.phase)
  const elapsedMs = useStudio((s) => s.elapsedMs)
  const setPageInfo = useStudio((s) => s.setPageInfo)
  const markPreviewShown = useStudio((s) => s.markPreviewShown)
  const zoom = useStudio((s) => s.zoom)
  const fs = usePdfFindState()

  const onSwap = useCallback(
    (url: string) => {
      if (url === pdfUrl) markPreviewShown(url)
    },
    [pdfUrl, markPreviewShown],
  )

  return (
    <>
      <StaleBanner />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <PdfPreview url={pdfUrl} zoom={zoom} capToContainer onPageInfo={setPageInfo} onSwap={onSwap} find={fs.active ? fs.find : null} onFindResult={fs.onFindResult} />
        <PdfFindBar
          query={fs.find.query}
          current={fs.find.current}
          total={fs.total}
          onQuery={fs.onQuery}
          onStep={fs.onStep}
          className="left-2 right-2 top-2 [&_input]:min-w-0 [&_input]:flex-1"
        />
        {!pdfUrl && (
          <div className="absolute inset-0 bg-app">
            <PreviewEmpty />
          </div>
        )}
        {phase === 'building' && (
          <div
            className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-elevated px-2.5 py-1.5 text-xs text-fg shadow-md"
            data-testid="building-overlay"
            aria-live="polite"
          >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            构建中… {(elapsedMs / 1000).toFixed(1)} s
          </div>
        )}
      </div>
    </>
  )
}
