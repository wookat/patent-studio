import { useState } from 'react'
import { Check, Edit3, FileText, LoaderCircle, Save } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/net'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { workbenchApi } from '@/workbench/api'
import type { Document, WorkingCopy } from '@/workbench/types'
import { workbenchKeys } from '@/workbench/queries'

export function WorkingCopyEditor({ document }: { document: Document }) {
  const queryClient = useQueryClient()
  const [copy, setCopy] = useState<WorkingCopy | null>(null)
  const [edited, setEdited] = useState<string | null>(null)
  const contentKey = [...workbenchKeys.documents(document.id), 'working-copy-content', copy?.id ?? 'none'] as const
  const open = useMutation({
    mutationFn: () => workbenchApi.openWorkingCopy(document.id, document.current_revision_id),
    onSuccess: (next) => { setCopy(next); setEdited(null) },
  })
  const copyContent = useQuery({
    queryKey: contentKey,
    queryFn: ({ signal }) => workbenchApi.workingCopyContent(copy!.id, signal),
    enabled: Boolean(copy),
  })
  const content = edited ?? copyContent.data ?? ''
  const dirty = edited !== null && edited !== copyContent.data
  const save = useMutation({
    mutationFn: () => {
      if (!copy) throw new Error('请先打开工作副本')
      return workbenchApi.saveWorkingCopyContent(copy.id, copy.version, content)
    },
    onSuccess: (next) => {
      setCopy(next)
      queryClient.setQueryData(contentKey, content)
      setEdited(null)
    },
  })
  const commit = useMutation({
    mutationFn: () => {
      if (!copy) throw new Error('请先打开工作副本')
      return workbenchApi.commitWorkingCopy(copy.id, copy.version)
    },
    onSuccess: () => {
      setEdited(null)
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.documents(document.case_id) })
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.revisions(document.id) })
    },
  })
  const failure = open.error ?? copyContent.error ?? save.error ?? commit.error
  const failureText = failure instanceof ApiError && failure.status === 409
    ? '版本已变化或被提交屏障拦截，请重新打开工作副本后再保存。'
    : failure instanceof ApiError && failure.status === 401
      ? '需要登录后才能编辑工作副本。'
      : failure instanceof ApiError && failure.status === 403
        ? '当前账号没有本案件的写入权限。'
        : failure instanceof Error ? failure.message : null
  return <section className="rounded-lg border border-border bg-panel p-4" data-testid="working-copy-editor">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><FileText className="size-4 text-fg-icon" aria-hidden /><h2 className="font-semibold text-fg-strong">工作副本编辑器</h2><span className="text-xs text-fg-muted">{document.book}</span></div><div className="flex gap-2">{copy && <><Button size="sm" variant="secondary" loading={save.isPending} onClick={() => void save.mutateAsync()}><Save aria-hidden />保存</Button><Button size="sm" loading={commit.isPending} disabled={dirty || save.isPending} onClick={() => void commit.mutateAsync()}><Check aria-hidden />提交 revision</Button></>}{!copy && <Button size="sm" onClick={() => void open.mutateAsync()} loading={open.isPending}><Edit3 aria-hidden />打开工作副本</Button>}</div></div>
    {!copy ? <p className="text-sm text-fg-muted">基于当前 revision 打开一个可恢复的个人工作副本。保存和提交都会经过服务端版本检查。</p> : copyContent.isLoading ? <div className="flex items-center gap-2 py-8 text-sm text-fg-muted"><LoaderCircle className="size-4 animate-spin" />加载内容…</div> : <Textarea aria-label="工作副本文稿" value={content} onChange={(event) => setEdited(event.target.value)} className="min-h-72 font-mono text-sm" />}
    {commit.isSuccess && <p className="mt-2 text-sm text-ok-fg" role="status">已提交为新 revision，进入待审队列。</p>}
    {failureText && <p className="mt-2 text-sm text-danger-fg" role="alert">{failureText}</p>}
  </section>
}
