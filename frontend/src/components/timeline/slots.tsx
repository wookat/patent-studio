import { registerRailItem } from '@/lib/slots'
import { CaseTimelineDrawer } from './CaseTimelineDrawer'

/** 「案件」时间线入口挂到 Rail 槽位（prep lib/slots.registerRailItem，不改 shell/**）；由 review/ReviewPanel.tsx 副作用引入 */
let installed = false
export function installTimelineSlots() {
  if (installed) return
  installed = true
  registerRailItem({ id: 'case-timeline', render: ({ compact }) => <CaseTimelineDrawer compact={compact} /> }, 10)
}

installTimelineSlots()
