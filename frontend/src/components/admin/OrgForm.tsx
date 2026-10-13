import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Org } from '@/types/account'

export interface OrgFormProps {
  org: Org | null
  unavailable: boolean
  onSave(name: string): Promise<boolean>
}

/** 机构名称（17 §3.3；`.studio/org.json`）：单字段表单，保存后顶栏 / 登录页副标题显示 */
export function OrgForm({ org, unavailable, onSave }: OrgFormProps) {
  const uid = useId()
  const [name, setName] = useState(org?.name ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = name.trim() !== (org?.name ?? '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onSave(name.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form data-slot="OrgForm" data-testid="org-form" className="flex flex-wrap items-end gap-2" onSubmit={(e) => void submit(e)}>
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={`${uid}-name`}>机构名称</Label>
        <Input id={`${uid}-name`} value={name} maxLength={64} placeholder="例：某某知识产权代理事务所" disabled={unavailable} onChange={(e) => setName(e.target.value)} data-testid="org-name" />
      </div>
      <Button type="submit" variant="outline" disabled={!dirty || busy || unavailable} data-testid="org-save">
        {busy ? '保存中…' : '保存'}
      </Button>
      {unavailable && (
        <p className="basis-full text-xs text-fg-muted" data-testid="org-unavailable">
          机构接口尚未实现（501）
        </p>
      )}
    </form>
  )
}
