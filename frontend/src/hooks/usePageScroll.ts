import { useLayoutEffect, useRef } from 'react'
import { pageScroll, savePageScroll } from '@/lib/pageScroll'

/**
 * 页级滚动复原（台账 / 期限中心 / 通知中心共用）：找到页内真正的滚动器后先写回上次离开的位置，
 * 此后跟随 scroll 事件持续记录；卸载清理时再记一笔兜底。
 * 写入时机是 scroll 事件而非卸载瞬间——卸载清理跑时 ref / DOM 可能已 detach，此时读不到位置
 * （EquationNodeView 的 scrollMemo 同一先例）。key 由调用方细分（如 `dashboard:list` / `dashboard:board`，
 * 视图切换时按旧 key 记、按新 key 恢复）；resolve 每次现取——骨架/列表换元素后重挂监听。
 */
export function usePageScroll(key: string, ready: boolean, resolve: () => HTMLElement | null): void {
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve
  useLayoutEffect(() => {
    const el = resolveRef.current()
    if (!el || !ready) return
    const s = pageScroll(key)
    if (s) {
      el.scrollTop = s.top
      el.scrollLeft = s.left
    }
    const onScroll = () => savePageScroll(key, el)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      onScroll()
      el.removeEventListener('scroll', onScroll)
    }
    // resolve 是调用方的稳定 ref 读取，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key])
}
