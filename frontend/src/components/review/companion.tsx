import { registerCompanionBody } from '@/lib/slots'
import { useStudio } from '@/store'
import { ReviewBody } from './ReviewBody'
import { HistoryCompanionBody } from './HistoryBody'

/**
 * W6 伴随栏正文注册（prep 契约 lib/slots.registerCompanionBody，不改 shell/CompanionHost）：
 * - `review`  → ReviewBody（修订建议卡 + 批注线程；桌面第 4 列 / 移动 Sheet 内自滚）
 * - `history` → HistoryCompanionBody（时间线 + diff）
 * 由 ./slots 副作用引入（ReviewPanel 静态导入 → 启动即注册）；重复引入幂等（同 id 只取最后一次）。
 */
function ReviewCompanionBody() {
  const pid = useStudio((s) => s.pid)
  return <ReviewBody key={pid ?? ''} pid={pid} />
}

registerCompanionBody('review', ReviewCompanionBody)
registerCompanionBody('history', HistoryCompanionBody)
