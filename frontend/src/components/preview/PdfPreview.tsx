import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import '@/lib/pdfjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { RefreshCw } from 'lucide-react'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { PreviewLoading } from './PreviewEmpty'
import { withFetchTimeout } from '@/lib/api'
import { diagLocationLabel } from '@/lib/diagLocation'
import { selectStale, useStudio } from '@/store'
import { type PageText, type PdfFind, extractPageTexts, findMatches, highlightHtml } from './find'
import { A4_RATIO, A4_WIDTH_PX } from './zoom'
import { usePdfOverlays } from '@/lib/slots'
import { useFocusConsumer } from '@/lib/focusSync'
import { PDF_LOCATE_FAIL_LABEL } from '@/types/focus'
import { BlockEditorHost } from '@/components/block-editor/BlockEditorHost'
import { createPdfGestures } from './gestures'
import { getPdfIndex, hitFromTextSpan, locatePdfHit, pdfDoubleClick, pdfLocateFailLabel, pdfTargetOf, usePdfBlockIndex, usePdfIndexState } from './pdfFocus'
import { PdfSelectionBar, type SelectionBarState } from './PdfSelectionBar'
import './PdfFocusOverlay'
import './pdf-focus.css'
import { PDF_LONG_PRESS_EVENT, type PdfLongPressDetail } from './pdfLongPress'
import type { Focus } from '@/types/focus'

/** 定位提示里的位置：「权利要求 3」「说明书 · 段落 [0012]」，不露 block id / 源码行号 */
function focusWhere(f: Focus): string {
  return diagLocationLabel({ line: f.line ?? null, blockId: f.blockId }, useStudio.getState().ast)
}

export { PDF_LONG_PRESS_EVENT, type PdfLongPressDetail } from './pdfLongPress'

const GAP = 16
/** 适页时给页底阴影/页码留出的余量 */
const PAD = 16
/** 视口上下各多渲染几页，滚动时不露白 */
const OVERSCAN = 1
/** 隐藏槽渲染/加载看门狗：超时未凑齐视口页 → 强制切前台（见 staging 交换 effect） */
const SWAP_TIMEOUT_MS = 20_000
const MIN_PAGE_WIDTH = 120
/** 容器窄于此宽度视为“窄容器”，缩放上限 = 容器宽（痛点 #13） */
const NARROW_CONTAINER = 480

interface Props {
  url: string | null
  /** 自定义缩放（1 = A4 实际尺寸 @96dpi）；fit 为 width/page 时忽略 */
  zoom: number
  /** 页宽上限 = 容器宽（移动端 / 窄容器，痛点 #13） */
  capToContainer?: boolean
  onPageInfo?: (info: { page: number; total: number }) => void
  /** 新 PDF 已替换到前台（视口内页面全部画完）时回调 */
  onSwap?: (url: string) => void
  /** PDF 内查找：query 为空则不高亮；current 为当前命中序号（0-based） */
  find?: PdfFind | null
  /** 查找结果总数（随 query / 前台 PDF 变化回报） */
  onFindResult?: (total: number) => void
  className?: string
}

interface Slot {
  url: string
  /** react-pdf 的 file 参数，对象引用保持稳定避免重复加载 */
  file: { data: Uint8Array }
  numPages: number
  doc?: PDFDocumentProxy
  /** 按页提取的文字项（查找用，首次查找时才提取） */
  texts?: PageText[]
}

interface Range {
  from: number // 1-based inclusive
  to: number
}

/**
 * 真实 PDF 分页预览（双缓冲 + 视口虚拟化）：
 *  - pdf.js 文字层开启：可选中/复制；双击一行反查 content.md 并定位；Ctrl+F 打开 PDF 内查找（高亮 + 上一个/下一个）；
 *  - 整份 PDF 一次 fetch 成字节（避免 pdf.js 分块 Range 请求多次往返），交给 react-pdf；
 *  - 两个"槽"交替：新 PDF 先在隐藏槽里加载并只渲染视口内的页，画完后瞬间切到前台，
 *    旧槽保持挂载直到下次复用，因此切换不闪白、不重排、滚动位置天然保持；
 *  - 只渲染视口 ± OVERSCAN 页，其余页为等高占位，21 页文档每次只画 3～4 页；
 *  - 缩放：适宽 / 适页 / 百分比（相对 A4 实际尺寸）；缩放变化按比例保留滚动位置（停在同一页）。
 */
export function PdfPreview({ url, zoom, capToContainer = false, onPageInfo, onSwap, find, onFindResult, className }: Props) {
  // lib/slots.ts 注入点：功能单元 registerPdfOverlay 的页级浮层（仅渲染视口内页）
  const overlays = usePdfOverlays()
  const scroller = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 600, h: 800 })
  const [slots, setSlots] = useState<[Slot | null, Slot | null]>([null, null])
  const [active, setActive] = useState<0 | 1>(0)
  const [staging, setStaging] = useState<0 | 1 | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [range, setRange] = useState<Range>({ from: 1, to: 1 + OVERSCAN * 2 })
  const stagingRendered = useRef<Set<number>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const activeRef = useRef<0 | 1>(0)
  /** 服务端已剪掉的产物 url（另一 tab 的后续构建换了目录）：每个 url 只自动重建一次，避免 404 → 构建 → 404 循环 */
  const rebuiltFor = useRef<Set<string>>(new Set())
  /** 重挂后的滚动位置是否已恢复；恢复前不覆写 ui.previewScroll */
  const restored = useRef(false)

  const fit = useStudio((s) => s.zoomFit)
  const pageRequest = useStudio((s) => s.pageRequest)
  const consumePageRequest = useStudio((s) => s.consumePageRequest)
  const setEffectiveZoom = useStudio((s) => s.setEffectiveZoom)
  const setPreviewScroll = useStudio((s) => s.setPreviewScroll)
  const setPdfFindOpen = useStudio((s) => s.setPdfFindOpen)
  const ast = useStudio((s) => s.ast)
  const pdfTagged = useStudio((s) => s.lastOk?.pdf_tagged ?? false)
  const stale = useStudio(selectStale)
  const [selBar, setSelBar] = useState<SelectionBarState | null>(null)
  const [locateNote, setLocateNote] = useState('')
  // 批68：浮条批注草稿脏态（子组件经 onDirty 上报）时，宿主驱动的替换/卸载——点击空白关浮条、新拖选换锚——先 DiscardDialog 询问
  const [selDirty, setSelDirty] = useState(false)
  const [pendingSel, setPendingSel] = useState<(() => void) | null>(null)
  const guardSel = useCallback((act: () => void) => (selDirty ? setPendingSel(() => act) : act()), [selDirty])

  /* ---- 页宽：适宽 / 适页 / 百分比，窄容器时封顶（box 为 content-box，已扣除 p-4） ---- */
  const avail = Math.max(MIN_PAGE_WIDTH, box.w)
  let pageWidth: number
  if (fit === 'width') pageWidth = avail
  else if (fit === 'page') pageWidth = Math.min(avail, Math.floor((box.h - PAD) / A4_RATIO))
  else pageWidth = Math.round(A4_WIDTH_PX * zoom)
  const capped = capToContainer || box.w < NARROW_CONTAINER
  if (capped) pageWidth = Math.min(pageWidth, avail)
  pageWidth = Math.max(MIN_PAGE_WIDTH, pageWidth)
  const pageHeight = Math.round(pageWidth * A4_RATIO)
  const stride = pageHeight + GAP
  const overflowsX = pageWidth > avail

  useEffect(() => {
    setEffectiveZoom(Math.round((pageWidth / A4_WIDTH_PX) * 100) / 100)
  }, [pageWidth, setEffectiveZoom])

  const shown = slots[active]
  const numPages = shown?.numPages ?? 0

  /* ---- W5 三视图（21 §5）：前台 PDF → PdfBlockIndex；消费 Focus 翻页；单击 / 拖选 / 双击 / 长按 ---- */
  usePdfBlockIndex(shown?.doc, shown?.url ?? null, ast, pdfTagged)
  const indexState = usePdfIndexState()
  const indexReady = !!shown && indexState.url === shown.url && !!indexState.index
  const lastFocusBlock = useRef<string | null>(null)
  useFocusConsumer('pdf', indexReady, (f) => {
    const el = scroller.current
    const index = getPdfIndex(shown?.url ?? null)
    if (!el || !index) return
    // 对照锁下光标在同一块内移动不重新翻页；显式动作（大纲 / 问题 / 审阅）总是翻
    if (f.blockId === lastFocusBlock.current && (f.source === 'source' || f.source === 'layout')) return
    lastFocusBlock.current = f.blockId
    const t = pdfTargetOf(index, f)
    const page = t?.page ?? f.page
    if (!page) {
      setLocateNote('无对应 PDF 位置')
      return
    }
    const yFrac = t && t.rects.length && t.size ? t.rects[0].y / t.size.height : 0
    const top = (page - 1) * stride + yFrac * pageHeight - (yFrac ? el.clientHeight / 3 : 0)
    el.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
    setLocateNote(t ? `已定位第 ${page} 页${index.kind === 'heuristic' ? '（块级定位，近似）' : ''}` : `第 ${page} 页`)
  })

  const locateAt = useCallback(
    (target: HTMLElement, announce: boolean) => {
      const span = target.closest<HTMLElement>('.react-pdf__Page__textContent span')
      const hit = span ? hitFromTextSpan(span) : null
      if (!hit) return null
      const r = locatePdfHit(hit, shown?.url ?? null, announce)
      if (announce) {
        lastFocusBlock.current = r.ok ? r.focus!.blockId : lastFocusBlock.current
        setLocateNote(r.ok ? `已定位 ${focusWhere(r.focus!)} · 第 ${hit.page} 页` : pdfLocateFailLabel(r))
      }
      return { hit, r }
    },
    [shown?.url],
  )

  const gestures = useMemo(
    () =>
      createPdfGestures({
        click: (target) => {
          guardSel(() => {
            setSelBar(null)
            if (stale) {
              setLocateNote(PDF_LOCATE_FAIL_LABEL.stale)
              return
            }
            locateAt(target, true)
          })
        },
        select: (selection, anchor, x, y) => {
          const el = scroller.current
          const span = anchor.closest<HTMLElement>('.react-pdf__Page__textContent span')
          const hit = span ? hitFromTextSpan(span) : null
          const text = selection.toString().trim()
          if (!el || !hit || !text) return
          const box = el.getBoundingClientRect()
          // 浮岛锚点 = 选区包围盒顶部中点（取不到时退回指针位置）
          const rect = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
          const ax = rect && rect.width ? rect.left + rect.width / 2 : x
          const ay = rect && rect.height ? rect.top : y
          guardSel(() =>
            setSelBar({ x: ax - box.left + el.scrollLeft, y: ay - box.top + el.scrollTop, text, hit: { ...hit, text: text.length >= 4 ? text : hit.text } }),
          )
        },
        longPress: (target, x, y) => {
          const span = target.closest<HTMLElement>('.react-pdf__Page__textContent span')
          const hit = span ? hitFromTextSpan(span) : null
          if (!hit) return
          const r = stale ? null : locatePdfHit(hit, shown?.url ?? null, false)
          const detail: PdfLongPressDetail = {
            x,
            y,
            page: hit.page,
            text: hit.text,
            blockId: r?.focus?.blockId ?? null,
            book: r?.focus?.book ?? null,
            line: r?.focus?.line ?? null,
          }
          window.dispatchEvent(new CustomEvent<PdfLongPressDetail>(PDF_LONG_PRESS_EVENT, { detail }))
        },
      }),
    [locateAt, stale, shown?.url, guardSel],
  )
  useEffect(() => () => gestures.dispose(), [gestures])

  /* ---- 缩放/容器变化 → 按比例保留滚动位置（停在同一页同一处） ---- */
  const prevStride = useRef(stride)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && prevStride.current !== stride && prevStride.current > 0) {
      el.scrollTop = (el.scrollTop / prevStride.current) * stride
    }
    prevStride.current = stride
  }, [stride])

  /* ---- 视口 → 页范围 & 当前页 ---- */
  const updateRange = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const first = Math.floor(el.scrollTop / stride) + 1
    const last = Math.floor((el.scrollTop + el.clientHeight) / stride) + 1
    if (restored.current) setPreviewScroll(el.scrollTop / stride)
    setRange((r) => {
      const from = Math.max(1, first - OVERSCAN)
      const to = last + OVERSCAN
      return r.from === from && r.to === to ? r : { from, to }
    })
    if (numPages) {
      const page = Math.min(numPages, Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 3) / stride) + 1))
      onPageInfo?.({ page, total: numPages })
    }
  }, [stride, numPages, onPageInfo, setPreviewScroll])

  useEffect(() => {
    updateRange()
  }, [updateRange])

  /* ---- dock 换卡 / 重新挂回 DOM 会把 scrollTop 默默清零（不发 scroll 事件）：按 ui.previewScroll 回到原处并重算页范围 ---- */
  const restoreIfReset = useCallback(() => {
    const el = scroller.current
    if (!el || !restored.current || el.scrollTop !== 0) return
    const top = useStudio.getState().previewScroll * stride
    if (top < 1) return
    el.scrollTop = top
    updateRange()
  }, [stride, updateRange])
  const activePanelId = useStudio((s) => s.activePanelId)
  useEffect(() => {
    restoreIfReset()
  }, [activePanelId, restoreIfReset])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      const h = Math.round(e.contentRect.height)
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }))
      if (w > 0 && h > 0) restoreIfReset()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [restoreIfReset])

  const rafId = useRef(0)
  const onScroll = useCallback(() => {
    if (rafId.current) return
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0
      updateRange()
    })
  }, [updateRange])

  /* ---- 重挂后恢复滚动位置：首个槽页数就绪（占位块已撑开高度）时定位，再计算需渲染的页范围 ---- */
  useLayoutEffect(() => {
    if (restored.current) return
    const el = scroller.current
    const slot = staging !== null ? slots[staging] : null
    if (!el || !slot?.numPages) return
    restored.current = true
    const saved = useStudio.getState().previewScroll
    if (saved > 0) {
      el.scrollTop = saved * stride
      updateRange()
    }
  }, [slots, staging, stride, updateRange])

  /* ---- 页码跳转请求（PdfToolbar 页码输入 / ‹ ›） ---- */
  useEffect(() => {
    if (!pageRequest) return
    const el = scroller.current
    if (el && numPages) {
      const page = Math.min(numPages, Math.max(1, pageRequest.page))
      el.scrollTo({ top: (page - 1) * stride, behavior: 'auto' })
      consumePageRequest()
    }
  }, [pageRequest, numPages, stride, consumePageRequest])

  /* ---- url 变化：一次性下载到隐藏槽 ---- */
  useEffect(() => {
    if (!url) {
      abortRef.current?.abort()
      setSlots([null, null])
      setStaging(null)
      setFailed(null)
      return
    }
    if (shown?.url === url) return
    const ctrl = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ctrl
    void (async () => {
      try {
        const res = await fetch(url, { signal: withFetchTimeout(ctrl.signal), cache: 'no-store' })
        if (res.status === 404 && !rebuiltFor.current.has(url)) {
          rebuiltFor.current.add(url)
          useStudio.getState().enqueue('manual', true)
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = new Uint8Array(await res.arrayBuffer())
        if (ctrl.signal.aborted) return
        // 下载期间前台可能已切换，按完成时的前台选另一个槽
        const idx: 0 | 1 = activeRef.current === 0 ? 1 : 0
        stagingRendered.current = new Set()
        setSlots((s) => {
          const next: [Slot | null, Slot | null] = [s[0], s[1]]
          next[idx] = { url, file: { data }, numPages: 0 }
          return next
        })
        setStaging(idx)
        setFailed(null)
      } catch (e) {
        if (ctrl.signal.aborted) return
        setFailed(url)
        console.error('PDF 下载失败', e)
      }
    })()
    return () => ctrl.abort()
    // shown 故意不作依赖：只在 url 变化时触发下载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  /* ---- 隐藏槽视口内页面全部画完 → 切到前台 ---- */
  const trySwap = useCallback(
    (idx: 0 | 1) => {
      const slot = slots[idx]
      if (!slot || !slot.numPages) return
      const to = Math.min(slot.numPages, range.to)
      for (let p = range.from; p <= to; p++) if (!stagingRendered.current.has(p)) return
      activeRef.current = idx
      setActive(idx)
      setStaging(null)
      onSwap?.(slot.url)
    },
    [slots, range, onSwap],
  )

  // 页范围在滚动中变化时也重新判断（可能已全部画完）
  useEffect(() => {
    if (staging !== null) trySwap(staging)
  }, [staging, trySwap])

  // 交换看门狗：页 onRenderError / 渲染悬挂会让 stagingRendered 永远凑不齐 → staging 卡死、前台一直是旧槽
  // 或空槽（索引永不建立、双击恒「尚未生成」）。超时后强制交换——前台槽本就对视口内页惰性渲染。
  useEffect(() => {
    if (staging === null) return
    const t = setTimeout(() => {
      const slot = slots[staging]
      if (slot?.numPages) {
        console.warn('PDF 隐藏槽渲染超时，强制切前台', slot.url)
        activeRef.current = staging
        setActive(staging)
        setStaging(null)
        onSwap?.(slot.url)
      } else {
        // Document 都未加载出页数——放弃暂存并亮错误条（带「重新构建」入口）
        console.warn('PDF 隐藏槽加载超时', slot?.url)
        setStaging(null)
        if (slot) setFailed(slot.url)
      }
    }, SWAP_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [staging, slots, onSwap])

  /* ---- PDF 内查找：首次有 query 时提取前台文档全部文字项，命中高亮由 customTextRenderer 完成 ---- */
  const query = find?.query.trim() ?? ''
  useEffect(() => {
    const slot = shown
    if (!query || !slot?.doc || slot.texts) return
    let cancelled = false
    void extractPageTexts(slot.doc).then((texts) => {
      if (cancelled) return
      setSlots((s) => {
        const idx = s.findIndex((x) => x === slot)
        if (idx < 0) return s
        const next: [Slot | null, Slot | null] = [s[0], s[1]]
        next[idx] = { ...slot, texts }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [query, shown])

  const matches = useMemo(() => (query && shown?.texts ? findMatches(shown.texts, query) : []), [query, shown?.texts])
  const currentMatch = find && matches.length ? matches[Math.min(matches.length - 1, Math.max(0, find.current))] : null

  // 新 PDF 换到前台、文字尚未提取完时保持旧计数，不闪“无结果”
  const extracted = !query || !!shown?.texts
  useEffect(() => {
    if (extracted) onFindResult?.(query ? matches.length : 0)
  }, [matches, query, extracted, onFindResult])

  useEffect(() => {
    const el = scroller.current
    if (!el || !currentMatch) return
    const top = (currentMatch.page - 1) * stride + currentMatch.yFrac * pageHeight - el.clientHeight / 2
    el.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
  }, [currentMatch, stride, pageHeight])

  const textRenderer = useMemo(() => {
    if (!query) return undefined
    return ({ str, pageNumber, itemIndex }: { str: string; pageNumber: number; itemIndex: number }) =>
      highlightHtml(str, query, currentMatch && currentMatch.page === pageNumber && currentMatch.item === itemIndex ? currentMatch.start : -1)
  }, [query, currentMatch])

  /* ---- 双击 PDF 文字 → 定位并打开该块的 BlockEditor（只读角色由 BlockEditorHost 自己降为只看） ---- */
  const onDoubleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const r = pdfDoubleClick(e.target as HTMLElement, shown?.url ?? null, stale, { x: e.clientX, y: e.clientY })
      if (!r) return
      if (r.ok && r.focus) lastFocusBlock.current = r.focus.blockId
      setLocateNote(r.ok && r.focus ? `已定位 ${focusWhere(r.focus)}` : pdfLocateFailLabel(r))
    },
    [shown?.url, stale],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setPdfFindOpen(true)
      }
    },
    [setPdfFindOpen],
  )

  // LibreOffice 导出的 PDF 内嵌字体子集，无需外部 cMap；不引入 CDN 依赖以便离线/自托管。
  const options = useMemo(() => ({}), [])

  const renderSlot = (idx: 0 | 1) => {
    const slot = slots[idx]
    if (!slot) return null
    const isActive = idx === active
    const isStaging = idx === staging
    if (!isActive && !isStaging) return null
    return (
      <div
        key={idx}
        style={{ width: pageWidth }}
        className={cn('mx-auto flex flex-col items-center', !isActive && 'invisible absolute inset-x-0 top-4')}
        aria-hidden={!isActive}
        data-testid={isActive ? 'pdf-active' : 'pdf-staging'}
      >
        <Document
          file={slot.file}
          options={options}
          loading={null}
          error={isActive ? <PdfLoadError /> : null}
          onLoadSuccess={(doc) =>
            setSlots((s) => {
              if (s[idx] !== slot) return s
              const next: [Slot | null, Slot | null] = [s[0], s[1]]
              next[idx] = { ...slot, numPages: doc.numPages, doc }
              return next
            })
          }
          onLoadError={() => setFailed(slot.url)}
          className="flex flex-col items-center"
        >
          {Array.from({ length: slot.numPages }, (_, i) => {
            const n = i + 1
            const inRange = n >= range.from && n <= range.to
            return (
              <div
                key={n}
                style={{ width: pageWidth, height: pageHeight, marginBottom: GAP }}
                className="relative rounded-xs bg-paper text-paper-fg shadow-paper"
                data-page={n}
              >
                {inRange && (
                  <Page
                    pageNumber={n}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    customTextRenderer={textRenderer}
                    loading={null}
                    onRenderSuccess={() => {
                      if (idx !== staging) return
                      stagingRendered.current.add(n)
                      trySwap(idx)
                    }}
                    onRenderError={() => {
                      // 坏页算「画完」：留白也比整份 PDF 永不切换强
                      if (idx !== staging) return
                      stagingRendered.current.add(n)
                      trySwap(idx)
                    }}
                  />
                )}
                {inRange && overlays.map((Overlay, oi) => <Overlay key={oi} page={n} width={pageWidth} height={pageHeight} url={slot.url} active={isActive} />)}
              </div>
            )
          })}
        </Document>
      </div>
    )
  }

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => gestures.down(e)}
      onPointerMove={(e) => gestures.move(e)}
      onPointerUp={(e) => gestures.up(e)}
      onPointerCancel={() => gestures.cancel()}
      onKeyDown={onKeyDown}
      role="region"
      aria-label="PDF 预览"
      tabIndex={0}
      className={cn(
        'relative h-full overflow-y-auto bg-paper-canvas p-4',
                            FOCUS_RING_INSET,
        overflowsX && !capped ? 'overflow-x-auto' : 'overflow-x-hidden',
        className,
      )}
      data-testid="pdf-preview"
      data-zoom-fit={fit ?? 'custom'}
    >
      {renderSlot(0)}
      {renderSlot(1)}
      {selBar && (
        <PdfSelectionBar
          key={`${selBar.x},${selBar.y},${selBar.text.slice(0, 40)}`}
          sel={selBar}
          url={shown?.url ?? null}
          onClose={() => setSelBar(null)}
          onDirty={setSelDirty}
        />
      )}
      <DiscardDialog open={pendingSel !== null} onStay={() => setPendingSel(null)} onDiscard={() => {
        const act = pendingSel
        setPendingSel(null)
        act?.()
      }} />
      <BlockEditorHost />
      <span className="sr-only" role="status" aria-live="polite" data-testid="pdf-locate-status">
        {locateNote}
      </span>
      {!shown && url && failed !== url && <PreviewLoading pageWidth={pageWidth} />}
      {failed && failed === url && (
        <div
          role="alert"
          className="sticky bottom-2 mx-auto flex w-fit max-w-full items-center gap-2 rounded-md bg-elevated py-1 pl-3 pr-1 text-xs text-fg shadow-md"
          data-testid="pdf-load-failed"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-danger-dot" aria-hidden />
          <span>PDF 加载失败</span>
          <Button size="xs" variant="soft" data-testid="pdf-retry" onClick={() => useStudio.getState().enqueue('manual', true)}>
            <RefreshCw /> 重新构建
          </Button>
        </div>
      )}
    </div>
  )
}

/** react-pdf Document 解析失败时的页内提示（底部 sticky 条提供重建动作） */
function PdfLoadError() {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-fg-muted" data-testid="pdf-doc-error">
      <span className="size-1.5 shrink-0 rounded-full bg-danger-dot" aria-hidden />
      PDF 无法解析，请重新构建
    </div>
  )
}
