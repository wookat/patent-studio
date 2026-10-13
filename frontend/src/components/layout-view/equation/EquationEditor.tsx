import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { MathML } from '@/components/block-model/blocks'
import { SYMBOL_GROUPS, insertAt, type SymbolItem } from '@/components/block-model/dialogs/formula'
import { cn } from '@/lib/utils'
import { EQUATION_SYNTAX_HELP, type EquationEditorProps } from './types'
import { fromLatex, hasErrors, lintEquation, looksLikeLatex } from './syntax'
import { useMathmlPreview } from './useMathmlPreview'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'

/**
 * 公式编辑器（D2，16 §6）：FormulaDialog 的演进 —— 源文本框 + 符号面板 + 后端 MathML 预览 + 编号框。
 * 桌面 variant=popover 锚在公式块下方；375 variant=sheet 底部抽屉，按钮 ≥40px。
 * 提交交回 { source, label }，宿主用 equationLine(source, label) 落 `$$…$$ （N）` → POST /blocks/{id}。
 * 不引 MathLive / KaTeX：内核线性语法与 LaTeX 不同构（16 §6 实测），预览就是内核的 MathML。
 */
export function EquationEditor({ open, initial, anchor, variant, onSubmit, onClose, onDirty }: EquationEditorProps) {
  if (!open) return null
  return <Editor key={`${initial.source}::${initial.label}`} initial={initial} anchor={anchor} variant={variant} onSubmit={onSubmit} onClose={onClose} onDirty={onDirty} />
}

type EditorProps = Omit<EquationEditorProps, 'open'>

const SYNTAX_ID = 'ps-eq-syntax'
const POPOVER_W = 560

function Editor({ initial, anchor, variant, onSubmit, onClose, onDirty }: EditorProps) {
  const [source, setSource] = useState(initial.source)
  const [label, setLabel] = useState(initial.label)
  const area = useRef<HTMLTextAreaElement>(null)
  const pendingCursor = useRef<number | null>(null)
  const preview = useMathmlPreview(source, true)
  const issues = lintEquation(source)
  const trimmed = source.trim()
  const canSubmit = trimmed.length > 0 && !hasErrors(issues)
  const mobile = variant === 'sheet'

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

  // 草稿守卫（批67/68）：与 FormulaDialog 同族——Esc/取消/外点/抽屉隐式关 在脏态先 DiscardDialog 确认；脏态经 onDirty 上提宿主守卫换目标
  const dirty = source !== initial.source || label !== initial.label
  const [ask, setAsk] = useState(false)
  useBeforeUnload(() => dirty)
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])
  const requestClose = () => (dirty ? setAsk(true) : onClose())

  const submitting = useRef(false)
  const submit = () => {
    if (!canSubmit || submitting.current) return
    submitting.current = true
    void Promise.resolve(onSubmit({ source: trimmed, label: label.trim() }))
      .then((ok) => {
        submitting.current = false
        if (ok) onClose()
      })
      .catch(() => {
        submitting.current = false
      })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      requestClose()
    }
  }

  const body = (
    <div className="grid gap-3" onKeyDown={onKeyDown}>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ps-eq-source">公式源码</Label>
          {looksLikeLatex(source) && (
            <Button type="button" size="sm" variant="outline" className={cn(mobile && 'h-touch')} onClick={() => setSource(fromLatex(source))} data-testid="eq-from-latex">
              转为线性
            </Button>
          )}
        </div>
        <Textarea
          ref={area}
          id="ps-eq-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={mobile ? 2 : 3}
          spellCheck={false}
          autoFocus
          aria-describedby={SYNTAX_ID}
          aria-invalid={hasErrors(issues)}
          className="font-mono"
          placeholder="例如：ŷ_t = (1−w_t)·f_e(x_t) + w_t·f_cov(x_t, z_t)"
          data-testid="eq-source"
        />
        <p id={SYNTAX_ID} className="text-xs text-fg-muted">
          {EQUATION_SYNTAX_HELP.join(' · ')}
        </p>
        {issues.length > 0 && (
          <ul className="grid gap-0.5 text-xs" aria-live="polite" data-testid="eq-issues">
            {issues.map((i) => (
              <li key={i.message} className={i.level === 'error' ? 'text-danger-fg' : 'text-warn-fg'} data-level={i.level}>
                {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">常用符号</span>
        <div className={cn('flex flex-col gap-1.5', mobile && 'max-h-40 overflow-y-auto')} data-testid="eq-symbols">
          {SYMBOL_GROUPS.map((g) => (
            <div key={g.title} role="group" aria-label={g.title} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 w-14 shrink-0 text-xs text-fg-muted">{g.title}</span>
              {g.items.map((it) => (
                <Button
                  key={it.name}
                  type="button"
                  size={mobile ? 'lg' : 'xs'}
                  variant="secondary"
                  className={cn('px-1.5 font-mono text-sm', mobile ? 'h-touch min-w-touch' : 'min-w-xs-control')}
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
          <span className="text-xs text-fg-muted" aria-live="polite" data-testid="eq-preview-status">
            {preview.status === 'loading' && '渲染中…'}
            {preview.status === 'error' && `预览失败：${preview.message}`}
            {preview.status === 'idle' && !trimmed && '输入源码后实时预览'}
          </span>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-3 overflow-x-auto rounded-sm border border-border bg-sunken px-3 py-2 text-base" data-testid="eq-preview">
          <div className="flex-1 text-center">{trimmed ? <MathML mathml={preview.mathml} source={trimmed} /> : <span className="text-fg-muted">—</span>}</div>
          {label.trim() && <span className="shrink-0 text-sm text-fg-muted">{label.trim()}</span>}
        </div>
      </div>

      <div className={cn('flex items-end gap-2', mobile && 'flex-wrap')}>
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="ps-eq-label">编号</Label>
          <Input id="ps-eq-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="（1）" size={mobile ? 'xl' : 'sm'} className="w-full" data-testid="eq-label" />
        </div>
        <Button type="button" variant="secondary" className={cn(mobile && 'h-touch flex-1')} size={mobile ? 'lg' : 'sm'} onClick={requestClose}>
          取消
        </Button>
        <Button type="button" variant="soft" className={cn(mobile && 'h-touch flex-1')} size={mobile ? 'lg' : 'sm'} onClick={submit} disabled={!canSubmit} title="Ctrl+Enter" data-testid="eq-submit">
          {initial.source ? '保存公式' : '插入公式'}
        </Button>
      </div>
    </div>
  )

  if (mobile) {
    return (
      <>
        <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
        <Sheet open onOpenChange={(o) => !o && requestClose()}>
        <SheetContent side="bottom" hideClose className="ps-equation-editor gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="equation-editor" data-variant="sheet">
          <SheetHeader className="p-0 text-left">
            <SheetTitle>{initial.source ? '编辑公式' : '插入公式'}</SheetTitle>
            <SheetDescription className="sr-only">线性语法公式编辑，后端 MathML 预览</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
      <Popover anchor={anchor} onClose={requestClose} title={initial.source ? '编辑公式' : '插入公式'}>
        {body}
      </Popover>
    </>
  )
}

/**
 * 轻量 popover（无新依赖）：有 anchor 时 portal 到 body（dockview 面板带 transform / contain，fixed 定位必须逃出）并锚在其下方，
 * 空间不够则翻到上方；anchor=null 时就地渲染，由宿主摆放。Esc / 点外关闭。
 */
function Popover({ anchor, title, onClose, children }: { anchor: HTMLElement | null; title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const vw = window.innerWidth
      const w = Math.min(POPOVER_W, vw - 16)
      const r = anchor.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, vw - w - 8))
      const h = ref.current?.offsetHeight ?? 0
      const below = r.bottom + 8
      const preferred = below + h > window.innerHeight - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below
      const top = Math.max(8, Math.min(preferred, window.innerHeight - h - 8))
      setStyle({ position: 'fixed', top, left, width: w })
    }
    place()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (ref.current) ro?.observe(ref.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node) && !(anchor && anchor.contains(e.target as Node))) onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [anchor, onClose])

  const panel = (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      aria-describedby={SYNTAX_ID}
      data-testid="equation-editor"
      data-variant="popover"
      className={cn('ps-equation-editor z-popover max-h-[85vh] w-block-editor overflow-y-auto rounded-lg bg-elevated p-3 text-fg shadow-lg', !anchor && 'w-full max-w-[560px]')}
      style={style}
    >
      <div className="mb-2 text-sm font-medium text-fg-strong">{title}</div>
      {children}
    </div>
  )
  return anchor ? createPortal(panel, anchor.ownerDocument.body) : panel
}
