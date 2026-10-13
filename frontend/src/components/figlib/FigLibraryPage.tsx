import { ChevronLeft, ChevronRight, Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OrgShell } from '@/components/dashboard/OrgShell'
import { PageHeader } from '@/components/ui/page-header'
import { req } from '@/lib/api/net'
import { cn } from '@/lib/utils'

interface LibFig {
  file: string
  patent: string
  fig: string
  kind: string
  caption: string
  title: string
  page: number
}
interface LibPatent {
  id: string
  title: string
  caps: number
}
interface Manifest {
  patents: LibPatent[]
  figures: LibFig[]
}

const imgUrl = (f: LibFig) => `/api/figlib/img/${f.file.split('/').map(encodeURIComponent).join('/')}`

/** 附图图库页 #/figlib：真实专利附图分类浏览（1021 张逐张扒取标注）。 */
export function FigLibraryPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    req<Manifest>('/api/figlib')
      .then(setManifest)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const kinds = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of manifest?.figures ?? []) m.set(f.kind, (m.get(f.kind) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [manifest])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (manifest?.figures ?? []).filter(
      (f) =>
        (kind === null || f.kind === kind) &&
        (!s ||
          f.caption.toLowerCase().includes(s) ||
          f.patent.toLowerCase().includes(s) ||
          f.title.toLowerCase().includes(s) ||
          `图${f.fig}`.includes(s)),
    )
  }, [manifest, kind, q])

  const summary = manifest
    ? `${manifest.patents.length} 篇专利 · ${manifest.figures.length} 张附图 · ${kinds.length} 类`
    : '加载中…'

  return (
    <OrgShell name="figlib" title="附图图库" current="figlib" mobile={false}>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-panel" aria-label="附图图库">
        <PageHeader
          size="lg"
          title="附图图库"
          description={`真实 CN 专利附图分类参考库——${summary}`}
          className="bg-panel py-4 md:py-4"
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜题注 / 专利号 / 图号"
                aria-label="搜索图库"
                className="h-8 w-56 rounded-md border border-border bg-panel pl-8 pr-2 text-sm text-fg-strong outline-none focus:border-fg-strong"
              />
            </div>
          }
        />
        <div className="flex min-h-0 flex-1">
          <aside className="w-44 shrink-0 overflow-y-auto border-r border-border px-2 py-2" aria-label="图型分类">
            <button
              onClick={() => setKind(null)}
              className={cn(
                'mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm',
                kind === null ? 'bg-accent font-medium text-fg-strong' : 'text-fg-muted hover:bg-accent/60',
              )}
            >
              全部
              <span className="text-2xs tabular-nums text-fg-muted">{manifest?.figures.length ?? ''}</span>
            </button>
            {kinds.map(([k, n]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  'mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm',
                  kind === k ? 'bg-accent font-medium text-fg-strong' : 'text-fg-muted hover:bg-accent/60',
                )}
              >
                {k}
                <span className="text-2xs tabular-nums text-fg-muted">{n}</span>
              </button>
            ))}
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto p-4" data-testid="figlib-grid-wrap">
            {error && <p className="text-sm text-red-600">图库加载失败：{error}</p>}
            {!error && shown.length === 0 && manifest && <p className="text-sm text-fg-muted">无匹配附图</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3" data-testid="figlib-grid">
              {shown.map((f, i) => (
                <button
                  key={f.file}
                  onClick={() => setOpen(i)}
                  className="group overflow-hidden rounded-md border border-border bg-panel text-left hover:border-fg-strong"
                  title={f.caption}
                >
                  <div className="flex h-36 items-center justify-center bg-white">
                    <img
                      src={imgUrl(f)}
                      alt={f.caption || `${f.patent} 图${f.fig}`}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="border-t border-border px-2 py-1.5">
                    <p className="line-clamp-2 text-2xs leading-snug text-fg-strong">{f.caption || '（未配题注）'}</p>
                    <p className="mt-0.5 text-2xs text-fg-muted">
                      {f.patent} · 图{f.fig} · {f.kind}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
      {open !== null && shown[open] && (
        <Lightbox key={shown[open].file} fig={shown[open]} index={open} total={shown.length} onNav={(d) => setOpen((v) => (v === null ? null : v + d))} onClose={() => setOpen(null)} />
      )}
    </OrgShell>
  )
}

/** 原图全貌灯箱：滚轮缩放（0.3–8×）、拖拽平移、←→ 键翻页、Esc 关闭。 */
function Lightbox({ fig, index, total, onNav, onClose }: { fig: LibFig; index: number; total: number; onNav: (d: number) => void; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onNav(-1)
      if (e.key === 'ArrowRight') onNav(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNav])

  const zoom = useCallback((d: number) => setScale((s) => Math.min(8, Math.max(0.3, s * d))), [])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label={`${fig.patent} 图${fig.fig}`}
      onClick={onClose}
    >
      <div className="flex items-center gap-2 px-4 py-2 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{fig.patent} · 图{fig.fig}</span>
          <span className="ml-2 text-white/70">{fig.kind}</span>
          <span className="ml-2 text-2xs text-white/50">{index + 1} / {total}</span>
        </p>
        <button onClick={() => zoom(1 / 1.25)} aria-label="缩小" className="rounded p-1.5 hover:bg-white/20"><ZoomOut className="size-4" /></button>
        <button onClick={() => zoom(1.25)} aria-label="放大" className="rounded p-1.5 hover:bg-white/20"><ZoomIn className="size-4" /></button>
        <button onClick={() => index > 0 && onNav(-1)} disabled={index <= 0} aria-label="上一张" className="rounded p-1.5 hover:bg-white/20 disabled:opacity-30"><ChevronLeft className="size-5" /></button>
        <button onClick={() => index < total - 1 && onNav(1)} disabled={index >= total - 1} aria-label="下一张" className="rounded p-1.5 hover:bg-white/20 disabled:opacity-30"><ChevronRight className="size-5" /></button>
        <button onClick={onClose} aria-label="关闭" className="rounded p-1.5 hover:bg-white/20"><X className="size-5" /></button>
      </div>
      <div
        className="flex min-h-0 flex-1 cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15) }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (drag.current) setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y })
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <img
          src={imgUrl(fig)}
          alt={fig.caption}
          draggable={false}
          className="max-h-[85vh] max-w-[92vw] select-none bg-white object-contain"
          style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${scale})` }}
        />
      </div>
      {fig.caption && (
        <p className="truncate px-4 pb-2 text-center text-2xs text-white/70" onClick={(e) => e.stopPropagation()}>
          {fig.caption} —— {fig.title}
        </p>
      )}
    </div>
  )
}
