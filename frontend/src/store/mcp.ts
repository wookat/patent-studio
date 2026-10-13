import { ApiError, api } from '@/lib/api'
import type { Pat, PatCreated } from '@/lib/types'
import type { Slice } from './types'

/**
 * R7 MCP 集成（docs/plan/10 §3.4 / §7.1）：个人访问令牌。
 * AUTH=off 时后端 PAT 三条路由 501 → `patsUnavailable=true`，「集成」页只显示本机 stdio/HTTP 接法。
 * 案卷审计日志已迁移 TanStack Query（IntegrationsPage `useQuery['mcpAudit',pid,limit]`：缓存/竞态/失效一体接管）。
 */
export interface McpSlice {
  pats: Pat[]
  patsLoading: boolean
  patsUnavailable: boolean
  /** 刚创建的令牌（明文只此一次），用户关掉提示后置 null */
  newPat: PatCreated | null

  loadPats(): Promise<void>
  createPat(name: string): Promise<PatCreated | null>
  revokePat(patId: string): Promise<void>
  dismissNewPat(): void
  resetMcp(): void
}

export const mcpSlice: Slice<McpSlice> = (set, get) => ({
  pats: [],
  patsLoading: false,
  patsUnavailable: false,
  newPat: null,
  loadPats: async () => {
    if (get().authStatus === 'off') {
      set({ pats: [], patsLoading: false, patsUnavailable: true })
      return
    }
    set({ patsLoading: true })
    try {
      set({ pats: await api.pats(), patsLoading: false, patsUnavailable: false })
    } catch (e) {
      set({ patsLoading: false, patsUnavailable: e instanceof ApiError && e.status === 501 })
    }
  },
  createPat: async (name) => {
    try {
      const p = await api.createPat(name)
      set((s) => ({ pats: [p, ...s.pats], newPat: p }))
      return p
    } catch (e) {
      get().toast(e instanceof Error ? e.message : '创建令牌失败', 'error')
      return null
    }
  },
  revokePat: async (patId) => {
    await api.revokePat(patId)
    set((s) => ({ pats: s.pats.filter((p) => p.id !== patId) }))
  },
  dismissNewPat: () => set({ newPat: null }),
  resetMcp: () => set({ pats: [], patsLoading: false, patsUnavailable: false, newPat: null }),
})
