import { Suspense, lazy, useEffect, useState } from 'react'
import { Download, FileArchive, FileText, Loader2, Sparkles } from 'lucide-react'
import { withFetchTimeout } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AttachmentKind } from '@/types/attachments'

const AttachmentPdf = lazy(() => import('./AttachmentPdf'))

/** binary = 无伴生预览的 emf 等，只给下载 */
export type PreviewKind = AttachmentKind | 'binary'

export interface AttachmentPreviewProps {
  name: string
  kind: PreviewKind
  /** inline 原文件 URL（api.attachmentUrl / api.figUrl） */
  url: string
  /** 下载 URL；缺省 = url */
  downloadUrl?: string
  /** 提供时头部多一个「带入 Agent」动作（把该材料加入 AI 对话上下文 chip） */
  onAgent?: () => void
  className?: string
}

/**
 * 文件预览面板正文（15 §4.3；借鉴 Overleaf 点文件树条目在编辑区预览图片 / PDF / 文本）。
 * pdf → react-pdf 全部页纵向排列（AttachmentPdf，lazy；与 PdfPreview 同一 pdf.js worker）；image → <img>；text（md / txt）→ 等宽 <pre>；docx / zip → 只给下载。
 * figs/ 里的 svg / png 也走 kind=image；emf 由调用方换成伴生 png / svg 的 URL 再传进来。
 */
export function AttachmentPreview({ name, kind, url, downloadUrl, onAgent, className }: AttachmentPreviewProps) {
  return (
    <div data-slot="AttachmentPreview" data-kind={kind} className={cn('flex h-full min-h-0 flex-col', className)} data-testid="attachment-preview">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <span className="truncate font-medium" title={name}>{name}</span>
        {onAgent && (
          <button
            type="button"
            className="ml-auto inline-flex h-6 items-center gap-1 rounded px-1.5 text-fg-muted hover:bg-hover hover:text-fg in-data-[density=touch]:h-touch in-data-[density=touch]:min-w-touch in-data-[density=touch]:justify-center"
            onClick={onAgent}
            title="把该材料加入 AI 对话上下文（chip 可撤销，不自动发送）"
            data-testid="attachment-to-agent"
          >
            <Sparkles className="size-3.5" aria-hidden />带入 Agent
          </button>
        )}
        <a className={cn('inline-flex h-6 items-center gap-1 rounded px-1.5 text-fg-muted hover:bg-hover hover:text-fg in-data-[density=touch]:h-touch in-data-[density=touch]:min-w-touch in-data-[density=touch]:justify-center', !onAgent && 'ml-auto')} href={downloadUrl ?? url} download={name} data-testid="attachment-download">
          <Download className="size-3.5" aria-hidden />下载
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-sunken">
        {kind === 'image' && <ImageBody url={url} name={name} />}
        {kind === 'text' && <TextBody key={url} url={url} />}
        {kind === 'pdf' && (
          <Suspense fallback={<Spinner />}>
            <AttachmentPdf url={url} />
          </Suspense>
        )}
        {(kind === 'docx' || kind === 'zip' || kind === 'binary') && <DownloadOnly kind={kind} url={downloadUrl ?? url} name={name} />}
      </div>
    </div>
  )
}

function ImageBody({ url, name }: { url: string; name: string }) {
  /* 记坏掉的 url 而非布尔：换目标文件时自然复位回 <img>（推导期语义，无 effect） */
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const broken = brokenUrl === url
  return (
    <div className="flex min-h-full items-center justify-center p-3">
      {broken ? (
        <p className="text-xs text-fg-muted" role="alert" data-testid="attachment-image-broken">
          图片加载失败——可尝试用上方「下载」获取原文件。
        </p>
      ) : (
        <img src={url} alt={name} onError={() => setBrokenUrl(url)} className="max-h-full max-w-full rounded border bg-white object-contain shadow-sm" />
      )}
    </div>
  )
}

function TextBody({ url }: { url: string }) {
  const [state, setState] = useState<{ text: string } | { error: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(url, { signal: withFetchTimeout(ctrl.signal) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        setState({ text: await r.text() })
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
  }, [url, attempt])
  if (!state) return <Spinner />
  if ('error' in state)
    return (
      <p className="p-3 text-xs text-danger-fg">
        读取失败：{state.error}
        <Button size="xs" variant="link" className="px-1" onClick={() => { setState(null); setAttempt((a) => a + 1) }} data-testid="attachment-text-retry">重试</Button>
      </p>
    )
  return <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed" data-testid="attachment-text">{state.text}</pre>
}

const DOWNLOAD_LABEL = { docx: 'Word 文档', zip: '压缩包', binary: '该文件' } as const

function DownloadOnly({ kind, url, name }: { kind: 'docx' | 'zip' | 'binary'; url: string; name: string }) {
  const Icon = kind === 'zip' ? FileArchive : FileText
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-fg-muted" data-testid="attachment-download-only">
      <Icon className="size-8" aria-hidden />
      <p>{DOWNLOAD_LABEL[kind]}不在浏览器内预览</p>
      <a className="inline-flex h-8 items-center gap-1 rounded-sm border px-3 text-fg hover:bg-hover" href={url} download={name}>
        <Download className="size-3.5" aria-hidden />下载 {name}
      </a>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex h-24 items-center justify-center text-fg-muted">
      <Loader2 className="size-5 animate-spin" aria-hidden />
    </div>
  )
}
