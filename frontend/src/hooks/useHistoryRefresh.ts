import { useEffect, useRef } from 'react'
import { selectCollabActive, useStudio } from '@/store'

/** 协同在线时正文变化 → 服务端 0.8 s 去抖写回 + commit；客户端过这么久再拉列表（docs/plan/25 §3 方案 C） */
export const COLLAB_HISTORY_REFRESH_MS = 2000

/** 并挂的历史视图数：侧栏 + 伴随栏可同时挂同一 store——只在最后一个卸载时才清（R62-02） */
let historyViewCount = 0

/** 最后一个历史视图卸载时清空 slice；并存时互相不清（R62-02：否则关伴随栏会抹掉侧栏列表） */
export function useHistoryViewLifecycle(pid: string | null) {
  const resetHistory = useStudio((s) => s.resetHistory)
  useHistoryRefresh(pid)
  useEffect(() => {
    historyViewCount += 1
    return () => {
      historyViewCount -= 1
      if (historyViewCount === 0) resetHistory()
    }
  }, [resetHistory])
}

/**
 * 历史面板何时拉 `GET /history`（outline/HistoryPanel 与 review/HistoryBody 共用）：
 * - `saved` 变化（本地保存成功 / 恢复版本 / 服务端改写）立即拉；
 * - 协同在线时 `saved` 不随键入变化（正文由房间落盘），改为 `content` 变化后去抖拉——本端键入、远端同步、智能体改写都经 Y.Text 落到 content；
 * - 非协同下 content 每键都变，不作触发。
 */
export function useHistoryRefresh(pid: string | null) {
  const loadHistory = useStudio((s) => s.loadHistory)
  const saved = useStudio((s) => s.saved)
  const content = useStudio((s) => s.content)
  const live = useStudio(selectCollabActive)

  useEffect(() => {
    if (pid) void loadHistory(pid)
  }, [pid, saved, loadHistory])

  const seen = useRef(content)
  useEffect(() => {
    if (!pid || !live || content === seen.current) return
    seen.current = content
    const t = window.setTimeout(() => void loadHistory(pid), COLLAB_HISTORY_REFRESH_MS)
    return () => window.clearTimeout(t)
  }, [pid, live, content, loadHistory])
}
