import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FileText, FileUp, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FOCUS_RING, cn } from '@/lib/utils'
import { CONVERT_EXTS } from '@/types/convert'
import { useStudio } from '@/store'
import { fmtBytes } from '@/lib/format'
import { PREVIEW_CHARS, fileExt, isTextExt, validateConvertFile } from './convertUtils'

const ACCEPT = CONVERT_EXTS.map((e) => `.${e}`).join(',')

/**
 * 向导第 ① 步：拖入 / 选择文件 + 抽取预览。
 * md / txt 在前端直接读文本预览；docx / pdf 的抽取（python-docx / pypdf）在后台任务内进行，此处只展示元信息。
 */
export function PickStep() {
  const file = useStudio((s) => s.convertFile)
  const attachment = useStudio((s) => s.convertAttachment)
  const setConvertFile = useStudio((s) => s.setConvertFile)
  const setConvertAttachment = useStudio((s) => s.setConvertAttachment)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loaded, setLoaded] = useState<{ file: File; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const preview = file && loaded?.file === file ? loaded.text : null

  useEffect(() => {
    if (!file || !isTextExt(fileExt(file.name))) return
    let alive = true
    void file.text().then((t) => {
      if (alive) setLoaded({ file, text: t.replace(/\r\n?/g, '\n') })
    })
    return () => {
      alive = false
    }
  }, [file])

  const pick = (f: File | undefined) => {
    if (!f) return
    const err = validateConvertFile(f)
    setError(err)
    setConvertFile(err ? null : f)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files[0])
  }

  return (
    <div className="flex flex-col gap-3" data-testid="convert-step-pick">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label="选择论文或技术交底书文件"
        onChange={(e) => pick(e.target.files?.[0])}
        data-testid="convert-file-input"
      />
      {attachment ? (
        <div className="flex items-start gap-3 rounded-sm border bg-sunken p-3" data-testid="convert-attachment-info">
          <Paperclip className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={attachment.name}>{attachment.name}</p>
            <p className="text-xs text-fg-muted">
              本案附件 · .{fileExt(attachment.name)} · {fmtBytes(attachment.size)} · 直接读取，不重新上传
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="移除文件" title="移除文件" onClick={() => setConvertAttachment(null)} data-testid="convert-file-remove">
            <X />
          </Button>
        </div>
      ) : file ? (
        <div className="flex items-start gap-3 rounded-sm border bg-sunken p-3" data-testid="convert-file-info">
          <FileText className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={file.name}>{file.name}</p>
            <p className="text-xs text-fg-muted">
              .{fileExt(file.name)} · {fmtBytes(file.size)}
              {!isTextExt(fileExt(file.name)) && ' · 文本由后台任务抽取（python-docx / pypdf）'}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="移除文件" title="移除文件" onClick={() => setConvertFile(null)} data-testid="convert-file-remove">
            <X />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-2 rounded-sm border-2 border-dashed p-6 text-center text-sm text-fg-muted transition-colors',
            'hover:border-brand-300 hover:bg-hover',
            FOCUS_RING,
            dragging && 'border-brand-300 bg-selected',
          )}
          data-testid="convert-dropzone"
          data-dragging={dragging || undefined}
        >
          <FileUp className="size-6" aria-hidden />
          <span className="font-medium text-fg">拖入文件，或点击选择</span>
          <span className="text-xs">支持 {CONVERT_EXTS.map((e) => `.${e}`).join(' / ')}</span>
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger-fg" data-testid="convert-file-error">{error}</p>
      )}
      {preview !== null && (
        <div className="flex flex-col gap-1" data-testid="convert-preview">
          <span className="text-xs font-medium text-fg-muted">抽取预览（前 {Math.min(preview.length, PREVIEW_CHARS)} 字）</span>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border bg-sunken p-2 font-mono text-xs leading-relaxed">
            {preview.slice(0, PREVIEW_CHARS)}{preview.length > PREVIEW_CHARS ? '\n…' : ''}
          </pre>
        </div>
      )}
    </div>
  )
}
