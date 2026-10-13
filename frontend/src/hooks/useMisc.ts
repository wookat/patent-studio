import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useStudio, DESKTOP_QUERY } from '@/store'

export function useMediaQuery(q: string) {
  const subscribe = useCallback(
    (cb: () => void) => {
      // jsdom 等无 matchMedia 的环境直接退订
      if (typeof window.matchMedia !== 'function') return () => {}
      const mq = window.matchMedia(q)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    [q],
  )
  return useSyncExternalStore(subscribe, () => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false))
}

/** 桌面断点（02 §1：≥1024 三栏；<1024 移动壳）；常量定义在 store/ui（openBottom 等动作也要用） */
export { DESKTOP_QUERY }
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY)

/** ui.theme + prefers-color-scheme → 当前是否深色 */
export function useIsDark() {
  const theme = useStudio((s) => s.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** 「已复制」短暂反馈：markCopied(v) 置值并在 resetMs 后自动清空；再次 markCopied 清掉旧定时器，组件卸载时清理挂起 */
export function useCopied<T = boolean>(resetMs = 1500): readonly [T | null, (v: T) => void] {
  const [copied, setCopied] = useState<T | null>(null)
  const timer = useRef<number>(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const markCopied = useCallback(
    (v: T) => {
      window.clearTimeout(timer.current)
      setCopied(v)
      timer.current = window.setTimeout(() => setCopied(null), resetMs)
    },
    [resetMs],
  )
  return [copied, markCopied]
}
