import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface UploadDropProps {
  /** <input accept>；attachments 用 ATTACHMENT_EXTS.join(',')，附图用 FIGURE_ACCEPT */
  accept: string
  onFiles(files: File[]): void | Promise<unknown>
  disabled?: boolean
  /** 按钮 / 拖放区文案 */
  label: string
  /** 空态说明（例如「拖文件到这里，或点击选择」） */
  hint?: string
  /** 只渲染一个小按钮（文件树行尾用）；默认渲染整块拖放区 */
  compact?: boolean
  className?: string
  children?: ReactNode
  testId?: string
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/**
 * 附图书 / 文件树共用的上传入口（15 §4.2；借鉴 Overleaf 文件树 Upload：拖到目录即上传、也可点击选文件）。
 * 无状态：把 File[] 交给 onFiles；校验 / 提示都在 slice 里（figures.uploadFigures / attachments.uploadAttachments）。
 */
export function UploadDrop({ accept, onFiles, disabled, label, hint, compact, className, children, testId }: UploadDropProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) void onFiles(files)
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setOver(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length) void onFiles(files)
  }
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e) || disabled) return
    e.preventDefault()
    if (!over) setOver(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
  }

  const inputEl = <input ref={input} type="file" multiple accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={pick} disabled={disabled} />

  if (compact) {
    return (
      <>
        <button
          type="button"
          className={cn('inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50', className)}
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={() => input.current?.click()}
          data-testid={testId}
        >
          <UploadCloud className="size-4" aria-hidden />
          {children}
        </button>
        {inputEl}
      </>
    )
  }

  return (
    <div
      data-slot="UploadDrop"
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-sm border border-dashed px-3 py-4 text-center text-xs text-fg-muted transition-colors',
        over && 'border-primary bg-primary-soft text-fg',
        disabled && 'opacity-50',
        className,
      )}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      data-testid={testId}
      data-drag-over={over || undefined}
    >
      <UploadCloud className="size-5" aria-hidden />
      <button type="button" className="font-medium text-primary underline-offset-2 hover:underline disabled:no-underline" disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      {hint && <span>{hint}</span>}
      {children}
      {inputEl}
    </div>
  )
}
