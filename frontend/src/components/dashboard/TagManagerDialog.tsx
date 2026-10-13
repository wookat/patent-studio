import { useState, type FormEvent } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { TAG_COLORS, type Tag } from '@/types/case'

export interface TagManagerDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

function ColorSwatches({ value, onChange, name }: { value: string; onChange(c: string): void; name: string }) {
  return (
    <fieldset className="flex flex-wrap gap-1.5 border-0 p-0">
      <legend className="sr-only">颜色</legend>
      {TAG_COLORS.map((c) => (
        <label key={c} className="relative">
          <input type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} className="peer sr-only" aria-label={`颜色 ${c}`} />
          <span
            className="block size-5 cursor-pointer rounded-full ring-offset-2 ring-offset-panel peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring"
            style={{ backgroundColor: c }}
            aria-hidden
          />
        </label>
      ))}
    </fieldset>
  )
}

function TagEditor({ initial, onSave, onCancel, existing }: { initial?: Tag; onSave(t: Tag): Promise<boolean>; onCancel(): void; existing: string[] }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? TAG_COLORS[existing.length % TAG_COLORS.length])
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  const dup = trimmed !== initial?.name && existing.includes(trimmed)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed || dup) return
    setBusy(true)
    const ok = await onSave({ name: trimmed, color })
    setBusy(false)
    if (ok) onCancel()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-sm border bg-sunken p-2" aria-label={initial ? `编辑标签 ${initial.name}` : '新建标签'}>
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="标签名"
          aria-label="标签名"
          aria-invalid={dup || undefined}
          className="h-8"
          maxLength={20}
          data-testid="tag-name"
        />
        <Button type="submit" size="sm" disabled={busy || !trimmed || dup} aria-label="保存" title="保存" data-testid="tag-save">
          <Check aria-hidden />
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} aria-label="取消" title="取消">
          <X aria-hidden />
        </Button>
      </div>
      <ColorSwatches value={color} onChange={setColor} name={`color-${initial?.name ?? 'new'}`} />
      {dup && <p className="text-xs text-danger-fg">已有同名标签</p>}
    </form>
  )
}

/**
 * 机构标签管理（13 §6.1；Overleaf 左栏 Tags 的「New tag / Edit / Delete」）：仅超管 / auth=off。
 * 写入走 store.saveTag / deleteTag（PUT /api/tags/...），删除标签会把它从所有案卷摘掉，故二次确认。
 */
export function TagManagerDialog({ open, onOpenChange }: TagManagerDialogProps) {
  const tags = useStudio((s) => s.tags)
  const saveTag = useStudio((s) => s.saveTag)
  const deleteTag = useStudio((s) => s.deleteTag)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const names = tags.map((t) => t.name)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="TagManagerDialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>管理标签</DialogTitle>
          <DialogDescription>机构级标签，所有案卷共用；删除标签会从相关案卷上移除。</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto" aria-label="标签列表">
          {tags.length === 0 && editing !== 'new' && <li className="px-1 py-2 text-sm text-fg-muted">暂无标签</li>}
          {tags.map((t) => (
            <li key={t.name}>
              {editing === t.name ? (
                <TagEditor initial={t} existing={names} onSave={(nt) => saveTag(nt, t.name)} onCancel={() => setEditing(null)} />
              ) : (
                <div className={cn('flex h-9 items-center gap-2 rounded-sm px-1', confirmDel === t.name && 'bg-danger-bg')}>
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm" title={t.name}>{t.name}</span>
                  {confirmDel === t.name ? (
                    <>
                      <span className="text-xs text-danger-fg">确认删除？</span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          if (await deleteTag(t.name)) setConfirmDel(null)
                        }}
                        data-testid={`tag-delete-confirm-${t.name}`}
                      >
                        删除
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" aria-label={`编辑 ${t.name}`} title={`编辑 ${t.name}`} onClick={() => setEditing(t.name)} data-testid={`tag-edit-${t.name}`}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`删除 ${t.name}`} title={`删除 ${t.name}`} onClick={() => setConfirmDel(t.name)} data-testid={`tag-delete-${t.name}`}>
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
          {editing === 'new' && (
            <li>
              <TagEditor existing={names} onSave={(nt) => saveTag(nt)} onCancel={() => setEditing(null)} />
            </li>
          )}
        </ul>
        {editing !== 'new' && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing('new')} data-testid="tag-new">
            <Plus aria-hidden /> 新建标签
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
