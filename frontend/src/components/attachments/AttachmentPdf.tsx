import { useEffect, useState } from 'react'
import { Document, Page } from 'react-pdf'
import '@/lib/pdfjs'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { Loader2 } from 'lucide-react'
import { withFetchTimeout } from '@/lib/api'

/**
 * attachments/ 里 pdf 的预览正文：react-pdf 全部页纵向排列，页宽随容器（≤ 794px = A4 @ 96dpi）。
 * 单独成模块并由 AttachmentPreview `lazy()` 引入：pdf.js 需要 DOMMatrix，jsdom 没有；面板注册表（layout/panels）
 * import AttachmentPreview 时不能顺带把 pdf.js 拉进测试环境。
 */
export default function AttachmentPdf({ url }: { url: string }) {
  const [pages, setPages] = useState(0)
  const [width, setWidth] = useState<number | undefined>(undefined)
  // 自取字节再喂 react-pdf（与 PdfPreview 同形）：pdf.js 内建 fetch 不受 AbortSignal 管，半开连接会无限转圈
  const [file, setFile] = useState<{ data: Uint8Array } | null>(null)
  const [loadErr, setLoadErr] = useState(false)
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(url, { signal: withFetchTimeout(ctrl.signal), cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        setFile({ data: new Uint8Array(await r.arrayBuffer()) })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoadErr(true)
      })
    return () => ctrl.abort()
  }, [url])
  return (
    <div
      className="flex flex-col items-center gap-3 p-3"
      ref={(el) => {
        if (el) {
          const w = Math.min(794, Math.max(120, el.clientWidth - 24))
          if (w !== width) setWidth(w)
        }
      }}
    >
      <Document
        file={file}
        onLoadSuccess={(d) => setPages(d.numPages)}
        loading={<Loader2 className="size-5 animate-spin text-fg-muted" aria-label="加载中" />}
        error={<p className="text-xs text-danger-fg">PDF 加载失败</p>}
        noData={loadErr ? <p className="text-xs text-danger-fg">PDF 加载失败</p> : <Loader2 className="size-5 animate-spin text-fg-muted" aria-label="加载中" />}
      >
        {Array.from({ length: pages }, (_, i) => (
          <div key={i} className="mb-3 shadow-sm">
            <Page
              pageNumber={i + 1}
              width={width}
              renderAnnotationLayer={false}
              error={
                <p className="text-xs text-fg-muted" role="alert" data-testid="attachment-pdf-page-error">
                  第 {i + 1} 页渲染失败
                </p>
              }
            />
          </div>
        ))}
      </Document>
      {pages > 0 && <span className="text-xs text-fg-muted tabular">{pages} 页</span>}
    </div>
  )
}
