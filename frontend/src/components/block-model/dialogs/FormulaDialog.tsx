import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Label } from '@/components/ui/label'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { Textarea } from '@/components/ui/textarea'
import { MathML } from '../blocks'
import { keepEscapeLocal } from './state'
import { SYMBOL_GROUPS, insertAt, type SymbolItem } from './formula'
import { useMathmlPreview } from '@/components/layout-view/equation/useMathmlPreview'

interface Props {
  open: boolean
  initial: string
  onSubmit(source: string): void
  onClose(): void
  onCloseAutoFocus?(e: Event): void
}

/**
 * 公式对话框（06 §5.3）：源码输入 + POST /api/mathml 实时预览（useMathmlPreview：300ms 防抖 + AbortController）
 * + 常用符号面板。预览用浏览器原生 <math>（blocks.tsx MathML），不引入 MathJax/KaTeX。
 * 提交只交回 $$…$$ 内文，标号（（1））由内核 / 调用方保留，本对话框不编辑。
 * 宿主每次打开以 key 重挂，内部状态从 initial 起算。
 */
export function FormulaDialog({ open, initial, onSubmit, onClose, onCloseAutoFocus }: Props) {
  const [source, setSource] = useState(initial)
  const [ask, setAsk] = useState(false)
  const shown = useMathmlPreview(source, open)
  const area = useRef<HTMLTextAreaElement>(null)
  const pendingCursor = useRef<number | null>(null)

  const trimmed = source.trim()
  const dirty = source !== initial
  useBeforeUnload(() => open && dirty)
  const requestClose = () => (dirty ? setAsk(true) : onClose())

  useEffect(() => {
    const el = area.current
    const c = pendingCursor.current
    if (el && c != null) {
      pendingCursor.current = null
      el.focus()
      el.setSelectionRange(c, c)
    }
  }, [source])

  const insertSymbol = (item: SymbolItem) => {
    const el = area.current
    const start = el?.selectionStart ?? source.length
    const end = el?.selectionEnd ?? source.length
    const r = insertAt(source, start, end, item)
    pendingCursor.current = r.cursor
    setSource(r.text)
  }

  const canSubmit = trimmed.length > 0

  const submit = () => {
    if (!canSubmit) return
    onSubmit(trimmed)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent
        className="max-w-2xl"
        data-testid="formula-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
        onKeyDown={(e) => {
          keepEscapeLocal(e)
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{initial ? '编辑公式' : '插入公式'}</DialogTitle>
          <DialogDescription>
            线性写法：<code>a/b</code> 分式、<code>√x</code> 根式、<code>Σ_{'{'}i=1{'}'}</code> 求和、<code>x_i</code> 下标；公式编号由内核生成，不在此填写。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="formula-source">公式源码</Label>
            <Textarea
              ref={area}
              id="formula-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={3}
              spellCheck={false}
              autoFocus
              className="font-mono"
              placeholder="例如：ŷ_t = (1−w_t)·f_e(x_t) + w_t·f_cov(x_t, z_t)"
              data-testid="formula-source"
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-sm font-medium">常用符号</span>
            <div className="flex flex-col gap-1.5" data-testid="formula-symbols">
              {SYMBOL_GROUPS.map((g) => (
                <div key={g.title} role="group" aria-label={g.title} className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 w-14 shrink-0 text-xs text-fg-muted">{g.title}</span>
                  {g.items.map((it) => (
                    <Button
                      key={it.name}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 min-w-7 px-1.5 font-mono text-sm"
                      aria-label={it.name}
                      title={it.name}
                      onClick={() => insertSymbol(it)}
                    >
                      {it.label ?? it.insert}
                    </Button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">预览</span>
              <span className="text-xs text-fg-muted" aria-live="polite" data-testid="formula-preview-status">
                {shown.status === 'loading' && '渲染中…'}
                {shown.status === 'error' && `预览失败：${shown.message}`}
                {shown.status === 'idle' && !trimmed && '输入源码后实时预览'}
              </span>
            </div>
            <div
              className="min-h-14 overflow-x-auto rounded-sm border bg-sunken/40 px-3 py-2 text-center text-base"
              data-testid="formula-preview"
            >
              {trimmed ? <MathML mathml={shown.mathml} source={trimmed} /> : <span className="text-fg-muted">—</span>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit} title="Ctrl+Enter" data-testid="formula-submit">
            {initial ? '保存公式' : '插入公式'}
          </Button>
        </DialogFooter>
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
    </Dialog>
  )
}
