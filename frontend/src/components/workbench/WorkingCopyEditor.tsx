import { useState } from 'react'
import { Check, Edit3, FileText, LoaderCircle, Save, Wifi, WifiOff } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/net'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { workbenchApi } from '@/workbench/api'
import type { Document, WorkingCopy } from '@/workbench/types'
import { workbenchKeys } from '@/workbench/queries'
import { applyTextDiff, useWorkingCopyCollab, LOCAL_ORIGIN } from '@/workbench/collab'

function collabBadge(status: string, peers: number): { text: string; tone: 'ok' | 'warn' | 'info' | 'danger' } {
  switch (status) {
    case 'connected':
      return { text: peers > 0 ? `协同已连接 · ${peers} 人在线` : '协同已连接', tone: 'ok' }
    case 'reconnecting':
      return { text: '断线重连中…', tone: 'warn' }
    case 'connecting':
      return { text: '协同连接中…', tone: 'info' }
    default:
      return { text: '本地模式', tone: 'danger' }
  }
}

export function WorkingCopyEditor({ document, websocketPolyfill }: { document: Document; websocketPolyfill?: typeof WebSocket }) {
  const queryClient = useQueryClient()
  const [copy, setCopy] = useState<WorkingCopy | null>(null)
  const [edited, setEdited] = useState<string | null>(null)
  const me = useQuery({ queryKey: workbenchKeys.me(), queryFn: ({ signal }) => workbenchApi.me(signal), retry: false })
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
  const collab = useWorkingCopyCollab(copy?.id ?? null, {
    user: me.data ? { name: me.data.display_name || '协作者', uid: me.data.id } : undefined,
    seedContent: copyContent.data ?? null,
    WebSocketPolyfill: websocketPolyfill,
  })
  const live = collab.synced && collab.status === 'connected' && collab.session !== null
  const collabActive = collab.session !== null && collab.status !== 'off'
  // 协同在线时展示 Y.Text 快照；未同步/不可用时展示 REST 内容 + 本地缓冲
  const content = live && collab.content !== null ? collab.content : (edited ?? copyContent.data ?? '')
  const dirty = content !== (copyContent.data ?? '')
  const onEdit = (value: string) => {
    if (live && collab.session) applyTextDiff(collab.session.text, value, LOCAL_ORIGIN)
    else setEdited(value)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!copy) throw new Error('请先打开工作副本')
      const next = await workbenchApi.saveWorkingCopyContent(copy.id, copy.version, content)
      if (collabActive) await workbenchApi.flushCollab(copy.id)
      return next
    },
    onSuccess: (next) => {
      setCopy(next)
      queryClient.setQueryData(contentKey, content)
      setEdited(null)
      collab.session?.ackFlush()
    },
  })
  const commit = useMutation({
    mutationFn: async () => {
      if (!copy) throw new Error('请先打开工作副本')
      let next = copy
      if (dirty) next = await workbenchApi.saveWorkingCopyContent(copy.id, copy.version, content)
      if (collabActive) await workbenchApi.flushCollab(next.id)
      return workbenchApi.commitWorkingCopy(next.id, next.version)
    },
    onSuccess: () => {
      setEdited(null)
      collab.session?.ackFlush()
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.documents(document.case_id) })
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.revisions(document.id) })
    },
  })
  const failure = open.error ?? copyContent.error ?? save.error ?? commit.error
  const barrierReasons = failure instanceof ApiError && Array.isArray((failure.detail as unknown as { detail?: unknown } | null)?.detail)
    ? ((failure.detail as unknown as { detail: unknown[] }).detail.map(String))
    : []
  const failureText = failure instanceof ApiError && failure.status === 409
    ? (barrierReasons.length ? `提交被阻断：${barrierReasons.join('；')}` : '版本已变化或被提交屏障拦截，请重新打开工作副本后再保存。')
    : failure instanceof ApiError && failure.status === 401
      ? '需要登录后才能编辑工作副本。'
      : failure instanceof ApiError && failure.status === 403
        ? '当前账号没有本案件的写入权限。'
        : failure instanceof Error ? failure.message : null
  const pending = save.isPending || commit.isPending
  const badge = copy ? collabBadge(collab.status, collab.peers) : null
  return <section className="rounded-lg border border-border bg-panel p-4" data-testid="working-copy-editor">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><FileText className="size-4 text-fg-icon" aria-hidden /><h2 className="font-semibold text-fg-strong">工作副本编辑器</h2><span className="text-xs text-fg-muted">{document.book}</span>{badge && <Badge tone={badge.tone} data-testid="collab-status">{collab.status === 'connected' ? <Wifi className="mr-1 inline size-3" aria-hidden /> : collab.status === 'off' ? <WifiOff className="mr-1 inline size-3" aria-hidden /> : null}{badge.text}</Badge>}</div><div className="flex gap-2">{copy && <><Button size="sm" variant="secondary" loading={save.isPending} onClick={() => void save.mutateAsync()}><Save aria-hidden />{collabActive ? '保存并同步' : '保存'}</Button><Button size="sm" loading={commit.isPending} disabled={pending || (!dirty && collab.unflushed === 0)} onClick={() => void commit.mutateAsync()}><Check aria-hidden />{collab.unflushed > 0 ? '同步并提交 revision' : '提交 revision'}</Button></>}{!copy && <Button size="sm" onClick={() => void open.mutateAsync()} loading={open.isPending}><Edit3 aria-hidden />打开工作副本</Button>}</div></div>
    {!copy ? <p className="text-sm text-fg-muted">基于当前 revision 打开一个可恢复的个人工作副本。保存和提交都会经过服务端版本检查。</p> : copyContent.isLoading ? <div className="flex items-center gap-2 py-8 text-sm text-fg-muted"><LoaderCircle className="size-4 animate-spin" />加载内容…</div> : <Textarea aria-label="工作副本文稿" value={content} onChange={(event) => onEdit(event.target.value)} className="min-h-72 font-mono text-sm" />}
    {copy && collab.unflushed > 0 && <p className="mt-2 text-xs text-warn-fg" data-testid="collab-pending">有 {collab.unflushed} 批协同更改尚未同步到工作副本；保存或提交前将自动 flush。</p>}
    {commit.isSuccess && <p className="mt-2 text-sm text-ok-fg" role="status">已提交为新 revision，进入待审队列。</p>}
    {failureText && <p className="mt-2 text-sm text-danger-fg" role="alert">{failureText}</p>}
  </section>
}
