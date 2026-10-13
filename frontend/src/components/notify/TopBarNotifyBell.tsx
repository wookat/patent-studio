import { NotifyBell } from './NotifyBell'
import { useNotifyBellVisible } from './useNotifyBellVisible'

/** 顶栏铃铛：门槛见 useNotifyBellVisible（authed 且后端非 501 才渲染/轮询）。 */
export function TopBarNotifyBell({ compact }: { compact?: boolean }) {
  const visible = useNotifyBellVisible()
  if (!visible) return null
  return <NotifyBell compact={compact} />
}
