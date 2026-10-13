import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { diagLocationLabel } from '@/lib/diagLocation'
import { BOOK_LABELS } from '@/lib/docset'
import { useStudio } from '@/store'
import type { Ast } from '@/types/ast'
import type { FigureItem, FigureRef } from '@/types/figures'
import { figureLabel } from './figureModel'

/** 引用处的用户可读位置（权利要求 N / 说明书 · 段落 [NNNN]）；AST 未就位时退到书名 */
export function refLabel(r: FigureRef, ast: Ast | null): string {
  const label = diagLocationLabel({ line: r.line }, ast)
  return label === '全文' ? BOOK_LABELS[r.book] : label
}

export interface DeleteFigureDialogProps {
  figure: FigureItem | null
  /** 409 后由面板写入；非空即切到「被引用」列表态 */
  refs: FigureRef[]
  busy: boolean
  onConfirm(): void
  onGotoLine(line: number): void
  onClose(): void
}

/**
 * 删除守卫（设计 §6.2 删除行 / §5 figure-referenced）：先确认；后端 409 时同一对话框列出引用行（书 / 全文行 / 原文），
 * 点任一行 → gotoLine 并关闭，让作者先改正文再删。role=alertdialog，Esc / 遮罩 = 取消。
 */
export function DeleteFigureDialog({ figure, refs, busy, onConfirm, onGotoLine, onClose }: DeleteFigureDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const ast = useStudio((s) => s.ast)
  // 未编入（无图号）的文件被内嵌引用时用文件名当主语（W18），比「未编入」可读
  const label = figure ? (figure.num != null ? figureLabel(figure) : figure.name) : ''
  const blocked = refs.length > 0
  return (
    <Dialog open={figure !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        role="alertdialog"
        data-slot="DeleteFigureDialog"
        data-testid="figure-delete-dialog"
        data-state-refs={blocked ? 'blocked' : 'confirm'}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          confirmRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{blocked ? `${label} 仍被正文引用，不能删除` : `删除 ${label}？`}</DialogTitle>
          <DialogDescription>
            {blocked
              ? `以下 ${refs.length} 处引用了 ${label}。点击可跳到对应位置，改完再删；删除后图号会按顺序重排。`
              : `将删除图片文件 ${figure?.name ?? ''}${figure?.companions.length ? ` 及伴生文件 ${figure.companions.join('、')}` : ''}，并从说明书附图中去掉；此操作不可撤销。`}
          </DialogDescription>
        </DialogHeader>
        {blocked && (
          <ul aria-label="引用位置" className="max-h-64 divide-y overflow-y-auto rounded-sm border text-sm" data-testid="figure-refs">
            {refs.map((r, i) => (
              <li key={`${r.line}:${i}`}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-2.5 py-2 text-left outline-none hover:bg-hover focus-visible:bg-sunken"
                  onClick={() => onGotoLine(r.line)}
                  data-testid="figure-ref"
                >
                  <span className="shrink-0 text-xs text-fg-muted">{refLabel(r, ast)}</span>
                  <span className="min-w-0 flex-1 truncate" title={r.text}>{r.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="figure-delete-cancel">
            {blocked ? '关闭' : '取消'}
          </Button>
          {!blocked && (
            <Button ref={confirmRef} variant="danger" onClick={onConfirm} disabled={busy} data-testid="figure-delete-confirm">
              {busy && <Loader2 className="animate-spin" />}
              删除
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
