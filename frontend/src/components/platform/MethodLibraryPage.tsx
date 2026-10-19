import { useState } from 'react'
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookMarked, ChevronDown, LoaderCircle, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { queryClient } from '@/lib/query'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { MethodAsset } from '@/workbench/types'
import { ErrorPanel } from '@/components/workbench/WorkbenchPage'

/**
 * Z30 机构私有方法库（#/org/<orgId>/methods）。
 * 只收录人工录入的脱敏方法卡（method/expression）；非客户发明事实。
 * 检索视图仅展示已授权卡；撤销即刻移出；管理者可切换全状态审计视图。
 * 数据全部走 /api/v1 真实端点，不做本地假功能。
 */
export function MethodLibraryPage({ orgId }: { orgId: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MethodLibraryInner orgId={orgId} />
    </QueryClientProvider>
  )
}

const STATUS_LABEL: Record<string, string> = { draft: '待授权', authorized: '已授权', revoked: '已撤销' }
const STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn'> = { draft: 'warn', authorized: 'ok', revoked: 'neutral' }

function MethodLibraryInner({ orgId }: { orgId: string }) {
  const client = useQueryClient()
  const [q, setQ] = useState('')
  const [allStates, setAllStates] = useState(false)
  const [creating, setCreating] = useState(false)
  const me = useQuery({ queryKey: workbenchKeys.me(), queryFn: ({ signal }) => workbenchApi.me(signal), retry: false })
  const orgs = useQuery({ queryKey: workbenchKeys.organizations(), queryFn: ({ signal }) => workbenchApi.organizations(signal), retry: false })
  const memberships = useQuery({
    queryKey: workbenchKeys.memberships(orgId),
    queryFn: ({ signal }) => workbenchApi.memberships(orgId, signal),
    retry: false,
  })
  const assets = useQuery({
    queryKey: [...workbenchKeys.all, 'method-assets', orgId, q, allStates],
    queryFn: ({ signal }) => workbenchApi.methodAssets(orgId, q || undefined, allStates, signal),
    retry: false,
  })
  const myRole = memberships.data?.find((m) => m.principal_id === me.data?.id && m.status === 'active')?.role
  const manage = myRole === 'owner' || myRole === 'admin'
  const invalidate = () => client.invalidateQueries({ queryKey: [...workbenchKeys.all, 'method-assets', orgId] })

  if (assets.isError) return <div className="p-4"><ErrorPanel error={assets.error} onRetry={() => void assets.refetch()} /></div>
  return (
    <div className="mx-auto max-w-3xl p-4" data-testid="method-library">
      <div className="mb-3">
        <h2 className="text-base font-medium text-fg-strong">机构私有方法库</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          人工录入的脱敏方法卡（撰写方法/表达），非客户发明事实；仅「已授权」卡可被检索与引用，撤销即刻移出检索。
        </p>
        <p className="mt-0.5 text-2xs text-fg-muted">机构：{orgs.data?.find((o) => o.id === orgId)?.name ?? orgId}</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="ml-q">检索方法卡</label>
        <Input id="ml-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="检索标题或正文" className="max-w-xs" data-testid="ml-q" />
        {manage && (
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            <input type="checkbox" checked={allStates} onChange={(e) => setAllStates(e.target.checked)} data-testid="ml-all-states" />含待授权/已撤销
          </label>
        )}
        <span className="text-sm text-fg-muted" data-testid="ml-count">{assets.data?.length ?? 0} 张</span>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => setCreating((v) => !v)} data-testid="ml-create-open"><Plus aria-hidden />录入方法卡</Button>
      </div>
      {creating && <CreateCard orgId={orgId} onDone={() => { setCreating(false); invalidate() }} />}
      {assets.isLoading ? (
        <div className="flex min-h-32 items-center justify-center text-sm text-fg-muted" role="status"><LoaderCircle className="mr-2 size-4 animate-spin" />正在加载方法卡…</div>
      ) : (assets.data?.length ?? 0) === 0 ? (
        <EmptyState size="sm" icon={BookMarked} title="暂无可检索方法卡" reason={allStates ? '该机构还没有方法卡，点击「录入方法卡」新增。' : '没有已授权方法卡；新录入的卡须由机构管理者授权后才可检索。'} data-testid="ml-empty" />
      ) : (
        <ul className="space-y-2" data-testid="ml-list">
          {assets.data!.map((a) => (
            <AssetCard key={a.id} asset={a} manage={manage} onChanged={invalidate} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CreateCard({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const create = useMutation({
    mutationFn: () => workbenchApi.createMethodAsset(orgId, { title, body, source: 'manual' }),
    onSuccess: onDone,
  })
  return (
    <section className="mb-3 rounded-lg border border-border bg-panel p-3" data-testid="ml-create">
      <p className="mb-2 text-xs text-fg-muted">仅录入已脱敏的方法/表达，禁止粘贴客户案件事实或保密片段。</p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="方法卡标题" className="mb-2" data-testid="ml-create-title" />
      <textarea
        className="w-full rounded-md border border-border-strong bg-panel px-2 py-1.5 text-sm"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="方法步骤 / 表达要点（脱敏）"
        data-testid="ml-create-body"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={!title.trim() || !body.trim() || create.isPending} onClick={() => create.mutate()} data-testid="ml-create-submit">保存为待授权</Button>
        {create.isError && <span className="text-xs text-danger-fg" role="alert">保存失败</span>}
      </div>
    </section>
  )
}

function AssetCard({ asset, manage, onChanged }: { asset: MethodAsset; manage: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const authorize = useMutation({ mutationFn: () => workbenchApi.authorizeMethodAsset(asset.id), onSuccess: onChanged })
  const revoke = useMutation({ mutationFn: () => workbenchApi.revokeMethodAsset(asset.id), onSuccess: onChanged })
  const use = useMutation({ mutationFn: () => workbenchApi.useMethodAsset(asset.id, { note: note || undefined }), onSuccess: () => { setNote(''); onChanged() } })
  const uses = useQuery({
    queryKey: [...workbenchKeys.all, 'method-asset-uses', asset.id],
    queryFn: ({ signal }) => workbenchApi.methodAssetUses(asset.id, signal),
    enabled: open,
    retry: false,
  })
  const authorized = asset.status === 'authorized'
  return (
    <li className="rounded-lg border border-border bg-panel p-3" data-testid={`ml-asset-${asset.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg-strong">{asset.title}</span>
        <Badge tone={STATUS_TONE[asset.status] ?? 'neutral'}>{STATUS_LABEL[asset.status] ?? asset.status}</Badge>
        <span className="text-2xs text-fg-muted">来源：{asset.source === 'curated' ? '精选整理' : '人工录入'}</span>
        <div className="flex-1" />
        {manage && !authorized && asset.status !== 'revoked' && (
          <Button size="sm" variant="secondary" disabled={authorize.isPending} onClick={() => authorize.mutate()} data-testid={`ml-authorize-${asset.id}`}>授权</Button>
        )}
        {manage && authorized && (
          <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate()} data-testid={`ml-revoke-${asset.id}`}>撤销授权</Button>
        )}
        <button
          type="button"
          className={cn('flex items-center gap-0.5 text-2xs text-link hover:underline')}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid={`ml-uses-toggle-${asset.id}`}
        >
          使用记录<ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg">{asset.body}</p>
      {authorized && (
        <div className="mt-2 flex items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="引用备注（可选）" className="max-w-xs" data-testid={`ml-use-note-${asset.id}`} />
          <Button size="sm" variant="secondary" disabled={use.isPending} onClick={() => use.mutate()} data-testid={`ml-use-${asset.id}`}>记录使用</Button>
        </div>
      )}
      {open && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-fg-muted" data-testid={`ml-uses-${asset.id}`}>
          {uses.isLoading && <li>加载中…</li>}
          {(uses.data ?? []).map((u) => (
            <li key={u.id}>
              {new Date(u.used_at).toLocaleString('zh-CN')} · {u.principal_id.slice(0, 8)}…{u.case_id ? ` · 案 ${u.case_id.slice(0, 8)}…` : ''}{u.note ? ` · ${u.note}` : ''}
            </li>
          ))}
          {uses.data?.length === 0 && <li>尚无使用记录。</li>}
        </ul>
      )}
    </li>
  )
}
