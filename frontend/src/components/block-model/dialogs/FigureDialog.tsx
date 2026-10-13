import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import { keepEscapeLocal } from './state'

interface Props {
  open: boolean
  onSubmit(markdown: string): void
  onClose(): void
  onCloseAutoFocus?(e: Event): void
}

const WIDTH_CM = 17

/**
 * 内嵌图对话框（W18）：从 figs/ 图库挑图 → 说明书中插入 `![alt](figs/x){width=N}` 行；
 * 不占图号（编号见附图书），递交 XML 导出时自动剔除。
 */
export function FigureDialog({ open, onSubmit, onClose, onCloseAutoFocus }: Props) {
  const figures = useStudio((s) => s.figures)
  const pid = useStudio((s) => s.pid)
  const figsV = useStudio((s) => s.figsVersion)
  const [file, setFile] = useState('')
  const [alt, setAlt] = useState('')
  const [width, setWidth] = useState('15')
  const [ask, setAsk] = useState(false)

  const dirty = !!(file || alt || width !== '15')
  useBeforeUnload(() => open && dirty)
  const requestClose = () => (dirty ? setAsk(true) : onClose())

  const w = Number(width)
  const badWidth = !Number.isFinite(w) || w <= 0 || w > WIDTH_CM
  const ok = !!file && !badWidth

  const submit = () => {
    if (!ok) return
    onSubmit(`![${alt}](figs/${file}){width=${w}}`)
    onClose()
  }

  const picked = figures.find((f) => f.name === file)

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus} onKeyDown={keepEscapeLocal}>
          <DialogHeader>
            <DialogTitle>插入内嵌图</DialogTitle>
            <DialogDescription>从附图库选一张图嵌入说明书当前位置；不入「图 N」编号，递交 XML 时自动剔除。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="inline-fig-file">图件</Label>
              <Select value={file} onValueChange={setFile}>
                <SelectTrigger id="inline-fig-file">
                  <SelectValue placeholder={figures.length ? '选择 figs/ 图件…' : 'figs/ 暂无图件'} />
                </SelectTrigger>
                <SelectContent>
                  {figures.map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {picked?.preview && pid ? (
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <img src={api.figUrl(pid, picked.preview, figsV)} alt={alt || picked.name} className="mx-auto max-h-40 object-contain" />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="inline-fig-alt">替代文字 / 题注</Label>
              <Input id="inline-fig-alt" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="如：图1 系统架构示意（仅显示用，不参与图号）" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inline-fig-width">宽度（cm，≤{WIDTH_CM}）</Label>
              <Input
                id="inline-fig-width"
                type="number"
                min={1}
                max={WIDTH_CM}
                step={0.5}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
              {badWidth && width !== '' ? <p className="text-xs text-destructive">宽度需为 0–{WIDTH_CM} cm 的数字</p> : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={requestClose}>
              取消
            </Button>
            <Button onClick={submit} disabled={!ok}>
              插入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={onClose} />
    </>
  )
}
