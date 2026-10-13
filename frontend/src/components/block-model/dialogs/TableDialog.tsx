import { useId, useState } from 'react'
import { Columns3, Minus, Plus, Rows3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { FOCUS_RING, cn } from '@/lib/utils'
import { keepEscapeLocal } from './state'
import {
  MERGE_UP,
  addCol,
  addRow,
  emptyTableSpec,
  removeCol,
  removeRow,
  tableMarkdown,
  tableProblem,
  toggleMergeUp,
  withCell,
  type TableSpec,
} from './table'

interface Props {
  open: boolean
  initial: TableSpec | null
  onSubmit(markdown: string): void
  onClose(): void
  onCloseAutoFocus?(e: Event): void
}

/**
 * 表格对话框（06 §5.3）：行列网格（原生 <table> + <input>）、表头、三线表 / 重复表头 / 段号居左、
 * ^^ 纵向合并、表题后置、表注；提交 tableMarkdown(spec)。段号由内核生成，不在此填写。
 * 宿主每次打开以 key 重挂，内部状态从 initial 起算。
 */
export function TableDialog({ open, initial, onSubmit, onClose, onCloseAutoFocus }: Props) {
  const [spec, setSpec] = useState<TableSpec>(() => initial ?? emptyTableSpec())
  const [ask, setAsk] = useState(false)
  const uid = useId()

  const dirty = JSON.stringify(spec) !== JSON.stringify(initial ?? emptyTableSpec())
  useBeforeUnload(() => open && dirty)
  const requestClose = () => (dirty ? setAsk(true) : onClose())

  const cols = spec.rows[0]?.length ?? 0
  const problem = tableProblem(spec)
  const markdown = tableMarkdown(spec)

  const submit = () => {
    if (problem) return
    onSubmit(markdown)
    onClose()
  }

  const option = (key: 'threeLine' | 'repeatHeader' | 'numLeft', label: string, hint: string) => {
    const id = `${uid}-${key}`
    return (
      <div className="flex items-center gap-2">
        <Switch id={id} checked={spec[key]} onCheckedChange={(v) => setSpec({ ...spec, [key]: v })} />
        <Label htmlFor={id} className="text-sm text-fg" title={hint}>
          {label}
        </Label>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent
        className="max-w-3xl"
        data-testid="table-dialog"
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
          <DialogTitle>{initial ? '编辑表格' : '插入表格'}</DialogTitle>
          <DialogDescription>
            首行为表头。单元格里填 <code>^^</code>（或点单元格右下角「合并」）表示与上一行同列合并。表格前的「表N」表题请作为普通段落写在表格之前。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-fg-muted">
              {spec.rows.length} 行 × {cols} 列
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSpec(addRow(spec))} aria-label="添加行">
                <Rows3 className="size-3.5" aria-hidden /> <Plus className="size-3" aria-hidden /> 行
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setSpec(removeRow(spec, spec.rows.length - 1))}
                disabled={spec.rows.length <= 2}
                aria-label="删除末行"
              >
                <Rows3 className="size-3.5" aria-hidden /> <Minus className="size-3" aria-hidden /> 行
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSpec(addCol(spec))} aria-label="添加列">
                <Columns3 className="size-3.5" aria-hidden /> <Plus className="size-3" aria-hidden /> 列
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setSpec(removeCol(spec, cols - 1))}
                disabled={cols <= 1}
                aria-label="删除末列"
              >
                <Columns3 className="size-3.5" aria-hidden /> <Minus className="size-3" aria-hidden /> 列
              </Button>
            </span>
          </div>

          <div className="max-h-[40vh] overflow-auto rounded-sm border">
            <table className="w-full border-collapse text-sm" data-testid="table-grid">
              <caption className="sr-only">表格内容编辑网格</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-8 border-b border-r bg-sunken/50 px-1 text-xs font-normal text-fg-muted">
                    <span className="sr-only">行号</span>
                  </th>
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c} scope="col" className="border-b bg-sunken/50 px-1 py-1 text-xs font-normal text-fg-muted">
                      列 {c + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spec.rows.map((row, r) => (
                  <tr key={r} className={cn(r === 0 && 'bg-sunken/30')}>
                    <th scope="row" className="border-r px-1 text-center text-xs font-normal text-fg-muted">
                      {r === 0 ? '表头' : r}
                    </th>
                    {row.map((cell, c) => {
                      const merged = cell === MERGE_UP
                      return (
                        <td key={c} className="relative border p-0">
                          <Input
                            aria-label={r === 0 ? `表头 第${c + 1}列` : `第${r}行 第${c + 1}列`}
                            value={cell}
                            onChange={(e) => setSpec(withCell(spec, r, c, e.target.value))}
                            className={cn(
                              'h-8 rounded-none border-0 shadow-none',
                              r === 0 && 'font-medium',
                              merged && 'text-fg-muted',
                            )}
                            placeholder={merged ? '' : r === 0 ? '表头' : ''}
                          />
                          {r > 0 && (
                            <button
                              type="button"
                              className={cn(
                                'absolute bottom-0 right-0 rounded-tl px-1 text-2xs leading-4 opacity-0 transition-opacity hover:bg-hover focus-visible:opacity-100 [td:hover>&]:opacity-100',
                              FOCUS_RING,
                                merged ? 'bg-primary/15 text-link opacity-100' : 'text-fg-muted',
                              )}
                              aria-pressed={merged}
                              aria-label={`第${r}行 第${c + 1}列 与上合并`}
                              title="与上一行同列合并（^^）"
                              onClick={() => setSpec(toggleMergeUp(spec, r, c))}
                            >
                              合并
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <legend className="sr-only">表格选项</legend>
            {option('threeLine', '三线表', '顶线 / 表头下线 / 底线，无竖线')}
            {option('repeatHeader', '重复表头', '跨页时自动重复表头行')}
            {option('numLeft', '段号居左', '段号纵向居中于表格左侧（授权案多数派版式）')}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-cap`}>表题后置（可选）</Label>
              <Input
                id={`${uid}-cap`}
                value={spec.captionAfter}
                onChange={(e) => setSpec({ ...spec, captionAfter: e.target.value })}
                placeholder="表1 xxx（置于表格之后）"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-note`}>表注（可选）</Label>
              <Input
                id={`${uid}-note`}
                value={spec.note}
                onChange={(e) => setSpec({ ...spec, note: e.target.value })}
                placeholder="注：……"
                data-testid="table-note"
              />
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-fg-muted">生成的源码</summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded-sm bg-sunken px-2 py-1 font-mono" data-testid="table-markdown">
              {markdown}
            </pre>
          </details>
        </div>

        <DialogFooter className="sm:items-center">
          {problem && (
            <span className="text-sm text-danger-fg sm:mr-auto" role="status">
              {problem}
            </span>
          )}
          <Button type="button" variant="outline" onClick={requestClose}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={!!problem} title="Ctrl+Enter" data-testid="table-submit">
            {initial ? '保存表格' : '插入表格'}
          </Button>
        </DialogFooter>
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
    </Dialog>
  )
}
