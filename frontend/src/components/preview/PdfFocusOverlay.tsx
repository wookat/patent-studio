import { registerPdfOverlay, type PdfOverlayProps } from '@/lib/slots'
import { useStudio } from '@/store'
import { pdfTargetOf, usePdfIndexState } from './pdfFocus'
import './pdf-focus.css'

/**
 * 每页浮层（slots.registerPdfOverlay）：当前 Focus 命中本页时画包围盒（struct：逐行 rects）或页级高亮（heuristic）。
 * key 带 seq：同块连点两次也重放闪烁。
 */
export function PdfFocusOverlay({ page, width, height, url, active }: PdfOverlayProps) {
  const focus = useStudio((s) => s.focus)
  const { index, url: indexUrl } = usePdfIndexState()
  if (!active || !focus || indexUrl !== url) return null
  const t = pdfTargetOf(index, focus)
  if (!t || t.page !== page) return null
  const sx = t.size ? width / t.size.width : 0
  const sy = t.size ? height / t.size.height : 0
  const rects = t.rects.length && sx && sy ? t.rects : []
  return (
    <div className="pdf-focus-layer" data-testid="pdf-focus-overlay" data-page={page} data-kind={rects.length ? 'rects' : 'page'} aria-hidden>
      {rects.length ? (
        rects.map((r, i) => (
          <div
            key={`${focus.seq}-${i}`}
            className="pdf-focus-rect"
            data-testid="pdf-focus-rect"
            style={{
              left: r.x * sx - 3,
              top: r.y * sy - 2,
              width: r.width * sx + 6,
              height: r.height * sy + 4,
            }}
          />
        ))
      ) : (
        <div key={focus.seq} className="pdf-focus-page" data-testid="pdf-focus-page" />
      )}
    </div>
  )
}

registerPdfOverlay('three-view.focus', PdfFocusOverlay)
