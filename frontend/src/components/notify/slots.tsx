import { DeadlinesCompanionActions, DeadlinesCompanionBody } from '@/components/deadlines/DeadlinesCompanion'
import { registerCompanionBody, registerTopBarItem } from '@/lib/slots'
import { TopBarNotifyBell } from './TopBarNotifyBell'
import { NotifyCompanionActions, NotifyCompanionBody } from './NotifyCompanion'

/**
 * 铃铛挂到 TopBar 槽位（prep lib/slots.registerTopBarItem，不改 shell/**）；后端 501 时由 TopBarNotifyBell 隐藏（23-w12 §4）。
 * 同时注册伴随栏正文 `notify` / `deadlines`（prep lib/slots.registerCompanionBody，不改 CompanionHost）。
 * 由 App.tsx 与 components/review/ReviewPanel.tsx 副作用引入，启动即注册；重复引入幂等。
 */
let installed = false
export function installNotifySlots() {
  if (installed) return
  installed = true
  registerTopBarItem({ id: 'notify-bell', render: ({ compact }) => <TopBarNotifyBell compact={compact} /> }, 30)
  registerCompanionBody('notify', NotifyCompanionBody, NotifyCompanionActions)
  registerCompanionBody('deadlines', DeadlinesCompanionBody, DeadlinesCompanionActions)
}

installNotifySlots()
