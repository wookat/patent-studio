import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { caseFieldsFromForm, todayISO } from '@/lib/caseForm'
import { isValidCaseId, suggestCaseId } from '@/lib/caseId'
import { useStudio } from '@/store'
import { LABEL_NEW_PROJECT } from '@/lib/copy'

/**
 * 案卷标识（网址 /p/<id>、后端目录名）折叠字段：默认只显示一行「案卷标识 · 自动生成」，展开后可改；
 * 新建 / 复制两个对话框共用，避免再出现「目录名（id）」这类内部字眼。
 */
export function CaseIdField({ id, value, auto, onChange }: { id: string; value: string; auto: boolean; onChange: (v: string) => void }) {
  const ok = isValidCaseId(value)
  return (
    <Collapsible className="rounded-md border border-border/60 bg-sunken/40 px-2.5 py-1.5 text-xs" data-testid={`${id}-field`}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-left text-fg-muted hover:text-fg">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-aria-expanded:rotate-90" aria-hidden />
        <span className="shrink-0">案卷标识</span>
        <span className="min-w-0 truncate font-mono text-fg" data-testid={`${id}-preview`} title={value || undefined}>
          {value || '—'}
        </span>
        {auto && <span className="ml-auto shrink-0 rounded-sm bg-panel px-1 py-px text-2xs text-fg-muted">自动生成</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1">
        <Label htmlFor={id} className="text-xs">
          用于网址与文件夹名，创建后不可改
        </Label>
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" aria-invalid={!ok || undefined} aria-describedby={`${id}-hint`} />
        <p id={`${id}-hint`} className={ok ? 'text-fg-muted' : 'text-danger-fg'}>
          {ok ? '默认由内部案号或发明名称生成；可用字母、数字、中文、下划线与连字符。' : '只能包含字母、数字、中文、下划线或连字符，最多 64 个字符。'}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * 新建案卷对话框：由 ui.dialog === 'create' 驱动（面板「新建案卷」/ 文件菜单 / MoreSheet 经 requestNavigation({type:'create-project'}) 打开）。
 * 13 §3.3：发明名称 + 台账字段（内部案号 / 客户 / 开案日期）随建随填；案卷标识（网址 / 目录名）由案号或名称自动生成，默认折叠，需要才改；
 * 责任人 = 创建者（后端 owner_user_id 默认），只展示；选人控件需机构成员目录接口（W4-B）。
 */
export function CreateProjectDialog() {
  const open = useStudio((s) => s.dialog === 'create')
  const closeDialog = useStudio((s) => s.closeDialog)
  const openDialog = useStudio((s) => s.openDialog)
  const createProject = useStudio((s) => s.createProject)
  const toast = useStudio((s) => s.toast)
  const user = useStudio((s) => s.user)
  const projects = useStudio((s) => s.projects)
  const parent = useStudio((s) => s.createParent)
  const [customId, setCustomId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [caseNo, setCaseNo] = useState('')
  const [client, setClient] = useState('')
  const [opened, setOpened] = useState(todayISO)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const setOpen = (v: boolean) => (v ? openDialog('create') : closeDialog())
  const autoId = suggestCaseId({
    caseNo,
    title,
    existing: projects.map((p) => p.id),
  })
  const id = customId ?? autoId
  const idOk = isValidCaseId(id)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parent ? '新建分案' : LABEL_NEW_PROJECT}</DialogTitle>
          <DialogDescription>
            {parent
              ? `自母案「${parent.title}」（${parent.pid}）分案；创建后两案在「案件信息 · 关联案」中自动互链。`
              : '填好发明名称与台账信息即可开始撰写；说明书、权利要求书、摘要与附图模板会自动准备好。'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setErr(null)
            try {
              const p = await createProject(id.trim(), title.trim(), caseFieldsFromForm({ caseNo, client, opened }), parent?.pid)
              toast(parent ? `已创建分案「${p.title || title.trim() || p.id}」，已与母案互链` : `已创建案卷「${p.title || title.trim() || p.id}」`, 'success')
              setOpen(false)
              setCustomId(null)
              setTitle('')
              setCaseNo('')
              setClient('')
              setOpened(todayISO())
            } catch (er) {
              setErr(er instanceof Error ? er.message : String(er))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="np-title">发明名称</Label>
            <Input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一种……方法及装置" autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="np-case-no">内部案号</Label>
              <Input id="np-case-no" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="例如 P2026-0042" data-testid="np-case-no" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-client">客户</Label>
              <Input id="np-client" value={client} onChange={(e) => setClient(e.target.value)} placeholder="委托人 / 申请人简称" data-testid="np-client" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-owner">责任人</Label>
              <Input id="np-owner" value={user ? user.display_name || user.email : '—'} readOnly aria-describedby="np-owner-hint" data-testid="np-owner" />
              <p id="np-owner-hint" className="text-xs text-fg-muted">
                {user ? '默认为创建者，可在面板改派' : '未启用账号，不记责任人'}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-opened">开案日期</Label>
              <Input id="np-opened" type="date" value={opened} onChange={(e) => setOpened(e.target.value)} data-testid="np-opened" />
            </div>
          </div>
          <CaseIdField id="np-id" value={id} auto={customId === null} onChange={(v) => setCustomId(v === autoId ? null : v)} />
          {err && <p className="text-sm text-danger-fg">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" disabled={busy || !idOk}>创建</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
