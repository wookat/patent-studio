import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import '@/lib/pdfjs'
import 'react-pdf/dist/Page/TextLayer.css'
import { CircleAlert, FileText } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { A4_RATIO, A4_WIDTH_PX } from '@/components/preview/zoom'
import { withFetchTimeout } from '@/lib/api'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'

const GAP = 16
const OVERSCAN = 1
const MIN_PAGE_WIDTH = 240
/** 1440 下适宽到 max-w 1280 会把 A4 放大近两倍；封顶到 A4 实际尺寸 ×1.1，仍居中 */
const MAX_PAGE_WIDTH = Math.round(A4_WIDTH_PX * 1.1)

interface Props {
  url: string
  /** meta.pdf_ready=false：后端尚无 PDF，显示空态而不发请求 */
  ready: boolean
  className?: string
  /** 视口顶部所在页 / 总页数（顶部 PDF 工具条显示） */
  onPage?: (current: number, total: number) => void
}

/**
 * 客户审阅页 PDF（21 §4.5）：真实 LibreOffice PDF（后端已加水印页脚），连续页、适宽、只渲染视口 ± 1 页；
 * pdf.js 文字层开启 → 拖选 / 长按出「有意见」（选区由 ClientReviewPage 监听）。无缩放工具条、无下载按钮（下载按 meta.allow_download 放在顶栏）。
 */
export function ClientPdfView({ url, ready, className, onPage }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(600)
  const [loaded, setLoaded] = useState<{ url: string; data: Uint8Array | null } | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [renderFailed, setRenderFailed] = useState<string | null>(null)
  const data = loaded?.url === url ? loaded.data : null
  const file = useMemo(() => (data ? { data } : null), [data])
  const failed = (loaded?.url === url && loaded.data === null) || renderFailed === url
  const [range, setRange] = useState({ from: 1, to: 1 + OVERSCAN * 2 })
  const [current, setCurrent] = useState(1)

  const pageWidth = Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, box))
  const pageHeight = Math.round(pageWidth * A4_RATIO)
  const stride = pageHeight + GAP

  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setBox(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(url, { signal: withFetchTimeout(ctrl.signal), cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = new Uint8Array(await res.arrayBuffer())
        if (!ctrl.signal.aborted) setLoaded({ url, data })
      } catch {
        if (!ctrl.signal.aborted) setLoaded({ url, data: null })
      }
    })()
    return () => ctrl.abort()
  }, [url, ready])

  const updateRange = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const first = Math.floor(el.scrollTop / stride) + 1
    const last = Math.floor((el.scrollTop + el.clientHeight) / stride) + 1
    setCurrent(Math.min(Math.max(1, Math.round((el.scrollTop + el.clientHeight / 3) / stride) + 1), Math.max(1, numPages)))
    setRange((r) => {
      const from = Math.max(1, first - OVERSCAN)
      const to = last + OVERSCAN
      return r.from === from && r.to === to ? r : { from, to }
    })
  }, [stride, numPages])

  useEffect(() => {
    updateRange()
  }, [updateRange, numPages])

  useEffect(() => {
    onPage?.(current, numPages)
  }, [onPage, current, numPages])

  const raf = useRef(0)
  const onScroll = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      updateRange()
    })
  }, [updateRange])

  const options = useMemo(() => ({}), [])

  if (!ready) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-paper-canvas', className)} data-testid="client-pdf-pending">
        <EmptyState icon={FileText} title="PDF 尚未生成" reason="代理师尚未构建本版 PDF，可先切到「版面」阅读，或稍后刷新。" />
      </div>
    )
  }

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      role="region"
      aria-label="PDF 审阅"
      tabIndex={0}
      className={cn('relative h-full overflow-y-auto overflow-x-hidden bg-paper-canvas p-page-m md:px-5 md:py-5', FOCUS_RING_INSET, className)}
      data-testid="client-pdf"
    >
      {failed ? (
        <Alert variant="danger" className="mx-auto w-fit" data-testid="client-pdf-failed">
          <CircleAlert aria-hidden />
          PDF 加载失败，请刷新重试
        </Alert>
      ) : !file ? (
        <div className="mx-auto flex flex-col gap-4" style={{ width: pageWidth }} data-testid="client-pdf-loading">
          <Skeleton className="bg-paper shadow-paper" style={{ height: pageHeight }} />
          <span className="sr-only" role="status">正在加载 PDF…</span>
        </div>
      ) : (
        <div className="mx-auto flex flex-col items-center" style={{ width: pageWidth }} data-testid="client-pdf-doc">
          <Document
            file={file}
            options={options}
            loading={null}
            error={<div className="p-6 text-sm text-danger-fg">PDF 加载失败</div>}
            onLoadSuccess={(doc) => setNumPages(doc.numPages)}
            onLoadError={() => setRenderFailed(url)}
            className="flex flex-col items-center"
          >
            {Array.from({ length: numPages }, (_, i) => {
              const n = i + 1
              const inRange = n >= range.from && n <= range.to
              return (
                <div key={n} style={{ width: pageWidth, height: pageHeight, marginBottom: GAP }} className="relative bg-paper text-paper-fg shadow-paper" data-page={n}>
                  {inRange && <Page pageNumber={n} width={pageWidth} renderAnnotationLayer={false} loading={null} />}
                  <span className="pointer-events-none absolute -bottom-4 right-0 text-2xs tabular-nums text-fg-muted">
                    {n} / {numPages}
                  </span>
                </div>
              )
            })}
          </Document>
        </div>
      )}
    </div>
  )
}
