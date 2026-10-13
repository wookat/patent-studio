import { useEffect } from 'react'
import { useStudio } from '@/store'

const COMMENTS_POLL_MS = 30_000

let viewCount = 0
let timer: number | null = null

/**
 * 批注视图生命周期：任一 ReviewBody 实例（Drawer / Rail / 伴随栏 / 375 Sheet）挂载期间
 * 30s 轮询一次——协作者 / 客户公开链接的新批注在会话内回流，不再要 reload。
 * 模块级计数 + 单一定时器（同 useHistoryViewLifecycle 模式：多实例并存不叠请求，全卸才停）。
 */
export function useCommentsViewLifecycle() {
  useEffect(() => {
    viewCount += 1
    if (timer === null) {
      timer = window.setInterval(() => {
        const { pid, loadComments } = useStudio.getState()
        /* 隐藏页签不轮询（notify.ts 同闸）：省请求，回到前台下一次 tick 自然补拉 */
        if (document.visibilityState === 'hidden') return
        if (pid) void loadComments(pid, true)
      }, COMMENTS_POLL_MS)
    }
    return () => {
      viewCount -= 1
      if (viewCount === 0 && timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
  }, [])
}
