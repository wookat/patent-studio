import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { PdfFind } from './find'

/**
 * 查找状态（临时，不入 store）：由 PreviewPane / MobilePreview 持有，同时喂给 PdfPreview（高亮 + 滚动）与 PdfFindBar（输入 + 计数）。
 * 查找条关闭时清空查询，避免桌面↔移动重挂后带着旧查询打开。
 * `ui.pdfLocate`（大纲点击 → PDF 定位）不开查找条：把查询喂给 PdfPreview 高亮首个命中；此后打开查找条即沿用该查询，编辑正文后清除。
 * `active` = 查找条打开或定位高亮生效，PdfPreview 的 find 以它为门。
 */
export function usePdfFindState() {
  const open = useStudio((s) => s.pdfFindOpen)
  const locate = useStudio((s) => s.pdfLocate)
  const [find, setFind] = useState<PdfFind>({ query: '', current: 0 })
  const [total, setTotal] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevLocate, setPrevLocate] = useState(locate)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setFind({ query: '', current: 0 })
      setTotal(0)
    }
  }
  if (locate !== prevLocate) {
    setPrevLocate(locate)
    if (locate) setFind({ query: locate.query, current: 0 })
    else if (!open) {
      setFind({ query: '', current: 0 })
      setTotal(0)
    }
  }
  const onQuery = useCallback((query: string) => setFind({ query, current: 0 }), [])
  const onStep = useCallback(
    (dir: 1 | -1) => setFind((f) => (total ? { ...f, current: (f.current + dir + total) % total } : f)),
    [total],
  )
  return { open, active: open || locate !== null, find, total, onQuery, onStep, onFindResult: setTotal }
}

interface Props {
  query: string
  current: number
  total: number
  onQuery: (q: string) => void
  onStep: (dir: 1 | -1) => void
  className?: string
}

/**
 * PDF 内查找条（浮在 PDF 区右上角，Overleaf/浏览器 Ctrl+F 范式；bg-elevated r-md sh-md，Input sm + ghost icon-xs）：
 * 输入即高亮全部命中；Enter / ↓ 下一个，Shift+Enter / ↑ 上一个，Esc 关闭并清除高亮。
 */
export function PdfFindBar({ query, current, total, onQuery, onStep, className }: Props) {
  const open = useStudio((s) => s.pdfFindOpen)
  const setOpen = useStudio((s) => s.setPdfFindOpen)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      input.current?.focus()
      input.current?.select()
    }
  }, [open])

  if (!open) return null
  const shown = total ? `${Math.min(total, current + 1)} / ${total}` : query.trim() ? '无结果' : ''

  return (
    <div
      role="search"
      aria-label="在 PDF 中查找"
      className={cn(
        'absolute right-6 top-2 z-sticky flex items-center gap-1 rounded-md bg-elevated p-1 shadow-md',
        className,
      )}
      data-testid="pdf-find"
    >
      <Input
        ref={input}
        type="search"
        size="sm"
        value={query}
        placeholder="在 PDF 中查找"
        aria-label="查找文字"
        className="w-40"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onStep(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
          }
        }}
        data-testid="pdf-find-input"
      />
      <span className="min-w-14 px-1 text-center text-2xs tabular text-fg-muted" aria-live="polite" data-testid="pdf-find-count">
        {shown}
      </span>
      <Button variant="ghost" size="icon-xs" disabled={total < 2} onClick={() => onStep(-1)} aria-label="上一个" title="上一个（Shift+Enter）">
        <ChevronUp aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-xs" disabled={total < 2} onClick={() => onStep(1)} aria-label="下一个" title="下一个（Enter）">
        <ChevronDown aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)} aria-label="关闭查找" title="关闭（Esc）">
        <X aria-hidden />
      </Button>
    </div>
  )
}
