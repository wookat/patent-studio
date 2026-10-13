import { RefreshCw, Share2 } from 'lucide-react'
import { initialOf, labelText } from '@/collab/colors'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { lineChipLabel } from '@/lib/diagLocation'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio, selectOnlineCount, type CollabPeer, type CollabStatus } from '@/store'

/**
 * 顶栏「分享 · N 在线」（docs/plan/14 §6.3 D10）：Overleaf 顶栏 Share 的位置 → openCollabCenter('members') 打开协作者中心抽屉。
 * 样式 = ghost md（与顶栏右侧其余入口一致，不再描边）；在线人数只在这里显示（状态栏 auth=on 时不重复）。
 * 左侧叠 ≤3 个在线协作者头像（原 PresenceBar：对方广播的 peer.color / initialOf，点头像跳到对方所在行）；
 * N = 去重({我} ∪ peers)（14 D4），协同 off / 不可用时只显示「分享」。重连中图标转圈、tooltip 带状态。
 * auth=off 时不渲染（无成员 / 链接概念）。
 */
const STATUS_LABEL: Record<Exclude<CollabStatus, 'off'>, string> = {
  connecting: '连接协同…',
  connected: '协同已连接',
  reconnecting: '重连中…',
}

const MAX_AVATARS = 3

export function ShareButton({ className }: { className?: string }) {
  const status = useStudio((s) => s.authStatus)
  const pid = useStudio((s) => s.pid)
  const openCollabCenter = useStudio((s) => s.openCollabCenter)
  const collabStatus = useStudio((s) => s.collabStatus)
  const readonly = useStudio((s) => s.collabReadonly)
  const error = useStudio((s) => s.collabError)
  const peers = useStudio((s) => s.peers)
  const gotoLine = useStudio((s) => s.gotoLine)
  const online = useStudio(selectOnlineCount)
  if (status !== 'authed') return null

  const collabOn = online !== null && collabStatus !== 'off'
  const statusLabel = collabOn ? (readonly ? '只读' : STATUS_LABEL[collabStatus]) : null
  const tip = ['分享：协作者 / 链接 / 访问记录', statusLabel && (error ? `${statusLabel}（${error}）` : statusLabel)].filter(Boolean).join(' · ')
  const shown = collabOn ? peers.slice(0, MAX_AVATARS) : []
  const Icon = collabOn && collabStatus === 'reconnecting' ? RefreshCw : Share2

  return (
    <div className={cn('flex shrink-0 items-center gap-1.5', className)} data-slot="ShareButton" data-testid="share-entry">
      {shown.length > 0 && (
        <ul className="flex items-center" aria-label={`在线协作者 ${peers.length} 人`} data-testid="presence-avatars">
          {shown.map((p) => (
            <li key={p.id} className="-ml-1.5 first:ml-0">
              <PeerAvatar peer={p} onGoto={gotoLine} />
            </li>
          ))}
        </ul>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn('inline-flex h-md-control shrink-0 items-center gap-1.5 rounded-md px-2.5 text-base font-medium tabular-nums text-fg-muted transition-colors hover:bg-hover hover:text-fg-strong disabled:opacity-50 motion-reduce:transition-none data-[status=reconnecting]:text-warn-fg', FOCUS_RING)}
            onClick={() => openCollabCenter('members')}
            disabled={!pid}
            aria-haspopup="dialog"
            data-testid="share-button"
            data-status={collabOn ? (readonly ? 'readonly' : collabStatus) : 'off'}
          >
            <Icon className={cn('size-4', collabOn && collabStatus === 'reconnecting' && 'animate-spin motion-reduce:animate-none')} aria-hidden />
            <span className="hidden xl:inline">分享</span>
            {collabOn && (
              <span data-testid="share-online">
                <span className="hidden xl:inline"> · </span>
                {online} 在线
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function PeerAvatar({ peer, onGoto }: { peer: CollabPeer; onGoto(line: number): void }) {
  const ast = useStudio((s) => s.ast)
  const color = peer.color
  const title = peer.readonly ? `${peer.name}（只读）` : peer.name
  const tip = peer.line != null ? `${title} · ${lineChipLabel(peer.line, ast)}` : title
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={peer.line == null}
          onClick={() => peer.line != null && onGoto(peer.line)}
          className={cn('flex size-xs-control items-center justify-center rounded-full border-2 border-panel text-2xs font-semibold disabled:cursor-default', FOCUS_RING)}
          style={{ backgroundColor: color, color: labelText(color) }}
          aria-label={tip}
          data-testid="presence-avatar"
        >
          {initialOf(peer.name)}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
