import { useEffect } from 'react'
import { useStudio } from '@/store'

/**
 * 铃铛「有收件人才出现」的统一门槛（23-w12 §4 / §7）：
 * - 仅 authStatus 'authed' 渲染并轮询——'off'（鉴权关闭）与 'anon' 时后端没有用户，GET /api/notify 永远是空列表
 *   （routes_notify）；'unknown'（StoreBootstrap 的 loadMe 尚未返回）不渲染也不轮询，避免首屏一闪、多发一次请求；
 * - 后端 501（notifyUnavailable）：功能未部署，不渲染。
 * 轮询由本 hook 持有（ref 计数与其他铃铛共用一个 timer），铃铛卸载后 501 结论仍保留。
 * 工作台顶栏、机构页顶栏、375 首页卡组三处铃铛共用，避免只堵一处。
 */
export function useNotifyBellVisible(): boolean {
  const unavailable = useStudio((s) => s.notifyUnavailable)
  const authed = useStudio((s) => s.authStatus === 'authed')
  const startNotifyPolling = useStudio((s) => s.startNotifyPolling)
  useEffect(() => (authed ? startNotifyPolling() : undefined), [authed, startNotifyPolling])
  return authed && !unavailable
}
