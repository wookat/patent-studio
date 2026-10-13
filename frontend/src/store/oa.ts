import { ApiError, api, isNotImplemented } from '@/lib/api'
import type { AgentJob } from '@/types/agent'
import type { AiJob } from '@/types/ai'
import type { OaAnswer, OaItem } from '@/types/oa'
import type { OaRound, OaRoundIn } from '@/types/oa'
import type { Slice } from './types'

/**
 * 轨道 E · OA 答复工作台（docs/plan/09 §5.1 / §6.5）：控制台「OA」tab 的状态。
 * 拆条是确定性接口（同步）；答复是后台任务（ai.jobs kind='oa_answer'），完成后 answers 从 job.result 取；
 * 权项修改以 CriticMarkup 写入 claims（E5 用 patchBlock / setContent），不直接改写。
 */
export interface OaSlice {
  oaText: string
  oaItems: OaItem[]
  oaWarnings: string[]
  oaParsing: boolean
  oaAnswers: Record<string, OaAnswer>
  oaJobId: string | null
  oaError: string | null
  oaUnavailable: boolean
  oaActiveItemId: string | null
  /** W5 R-OA-05 多轮历史（GET …/oa/rounds；oa-import-backend 落地前 501 → oaRoundsUnavailable） */
  oaRounds: OaRound[]
  oaRoundsLoading: boolean
  oaRoundsUnavailable: boolean
  oaActiveRoundId: string | null
  /** 最近一次 S7 争辩稿任务（jobId / 意见 id），供 OA 面板显示进行中 */
  oaArgueJobId: string | null
  oaArgueItemId: string | null
  /** 批71：答复要点编辑草稿——OaAnswerCard 随控制台页签切换/面板关闭卸载，本地态草稿随实例死；
     存 store 按 itemId 认领，重开同条目恢复编辑态（卸载丢草稿族收口） */
  oaAnswerDraft: { itemId: string; text: string } | null

  setOaText(text: string): void
  parseOa(): Promise<void>
  /** W5 R-OA-01：上传通知书 PDF（文字层）→ POST …/oa/parse multipart；结果与文本拆条同形 */
  parseOaPdf(file: File): Promise<void>
  /** 重建拆条工作集（GET …/oa/items）：刷新/重开面板时把 items.json + 已存答复灌回——D-OA-1 刷新即丢修复 */
  loadOaItems(pid: string): Promise<void>
  loadOaRounds(pid: string): Promise<void>
  createOaRound(body: OaRoundIn): Promise<OaRound | null>
  deleteOaRound(rid: string): Promise<boolean>
  /** R35-01：延期申请（1|2 月，后端累计 ≤2 超限 409）；成功后同步轮次并重拉期限 */
  extendOaRound(rid: string, months: 1 | 2): Promise<boolean>
  /** R35-01：标记已答复（filed_on=递交日）；成功后同步轮次并重拉期限（期限置 done） */
  fileOaRound(rid: string, filedOn: string): Promise<boolean>
  setOaActiveRound(id: string | null): void
  /** W5 R-OA-03：对某条意见运行 S7（agent heavy）→ Proposal 进 AI 面板「建议」tab；不直接写源 */
  argueOaItem(itemId: string): Promise<AgentJob | null>
  /** itemIds 缺省 = 全部；成功返回 202 job */
  answerOa(itemIds?: string[]): Promise<AiJob | null>
  /** job 完成后由 OaPanel 调用：把 result.answers 装进 oaAnswers */
  setOaAnswers(answers: OaAnswer[]): void
  /** 用户改要点：PUT …/oa/answers/{item_id} 落盘（导出读盘上版本），成功后写回 oaAnswers（保留 applied） */
  saveOaPoints(itemId: string, points: string[]): Promise<boolean>
  markOaApplied(itemId: string): void
  setOaActiveItem(id: string | null): void
  /** null 清除（保存/取消/放弃后）；非 null 即该条目处于编辑态 */
  setOaAnswerDraft(d: { itemId: string; text: string } | null): void
  resetOa(): void
}

export const oaSlice: Slice<OaSlice> = (set, get) => ({
  oaText: '',
  oaItems: [],
  oaWarnings: [],
  oaParsing: false,
  oaAnswers: {},
  oaJobId: null,
  oaError: null,
  oaUnavailable: false,
  oaActiveItemId: null,
  oaRounds: [],
  oaRoundsLoading: false,
  oaRoundsUnavailable: false,
  oaActiveRoundId: null,
  oaArgueJobId: null,
  oaArgueItemId: null,
  oaAnswerDraft: null,

  setOaText: (text) => set({ oaText: text }),
  parseOaPdf: async (file) => {
    const { pid, oaActiveRoundId } = get()
    if (!pid) return
    set({ oaParsing: true, oaError: null })
    try {
      const r = await api.oaParsePdf(pid, file, oaActiveRoundId ?? undefined)
      if (get().pid && get().pid !== pid) return
      set({ oaItems: r.items, oaWarnings: r.warnings, oaParsing: false, oaAnswers: {}, oaActiveItemId: r.items[0]?.id ?? null, oaText: '' })
      if (oaActiveRoundId) void get().loadOaRounds(pid)
    } catch (e) {
      set({ oaParsing: false, oaError: e instanceof Error ? e.message : String(e), oaUnavailable: isNotImplemented(e) })
    }
  },
  loadOaItems: async (pid) => {
    try {
      const r = await api.oaItems(pid)
      if (get().pid && get().pid !== pid) return
      /* 恢复语义=只填空白：会话内已有条目（新拆条/上次恢复）时，迟到的旧响应一律不得覆盖 */
      if (get().oaItems.length > 0) return
      set({
        oaItems: r.items,
        oaWarnings: r.warnings,
        /* 答复并回 oaAnswers（saveOaPoints 写回同键）；activeItemId 落回首条（与 parse 响应同口径） */
        oaActiveItemId: r.items.some((it) => it.id === get().oaActiveItemId) ? get().oaActiveItemId : r.items[0]?.id ?? null,
      })
      get().setOaAnswers(r.answers)
    } catch (e) {
      if (get().pid && get().pid !== pid) return
      // 501 视为功能未上线；其余失败（如 items.json 腐坏 422）落错误态而非静默成空列表
      set({ oaUnavailable: e instanceof ApiError && e.status === 501, oaError: e instanceof ApiError && e.status === 501 ? null : e instanceof Error ? e.message : String(e) })
    }
  },
  loadOaRounds: async (pid) => {
    set({ oaRoundsLoading: true })
    try {
      const r = await api.oaRounds(pid)
      if (get().pid && get().pid !== pid) return
      const rounds = [...r.rounds].sort((a, b) => a.created_at - b.created_at)
      set({ oaRounds: rounds, oaRoundsLoading: false, oaRoundsUnavailable: false,
        oaActiveRoundId: get().oaActiveRoundId && rounds.some((x) => x.id === get().oaActiveRoundId) ? get().oaActiveRoundId : rounds.at(-1)?.id ?? null })
    } catch (e) {
      set({ oaRoundsLoading: false, oaRoundsUnavailable: isNotImplemented(e) })
    }
  },
  createOaRound: async (body) => {
    const { pid } = get()
    if (!pid) return null
    try {
      const round = await api.createOaRound(pid, body)
      if (get().pid && get().pid !== pid) return round
      set({ oaRounds: [...get().oaRounds.filter((r) => r.id !== round.id), round], oaActiveRoundId: round.id, oaRoundsUnavailable: false })
      return round
    } catch (e) {
      if (isNotImplemented(e)) set({ oaRoundsUnavailable: true })
      else get().toast(`新建轮次失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return null
    }
  },
  deleteOaRound: async (rid) => {
    const { pid } = get()
    if (!pid) return false
    try {
      await api.deleteOaRound(pid, rid)
      if (get().pid && get().pid !== pid) return true
      const rounds = get().oaRounds.filter((r) => r.id !== rid)
      set({ oaRounds: rounds, oaActiveRoundId: get().oaActiveRoundId === rid ? rounds.at(-1)?.id ?? null : get().oaActiveRoundId })
      return true
    } catch (e) {
      get().toast(`删除轮次失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return false
    }
  },
  extendOaRound: async (rid, months) => {
    const { pid } = get()
    if (!pid) return false
    try {
      const round = await api.oaExtendRound(pid, rid, months)
      if (get().pid && get().pid !== pid) return true
      set({ oaRounds: get().oaRounds.map((r) => (r.id === round.id ? round : r)) })
      get().toast(`已申请延期 ${months} 个月，期限已顺延`)
      void get().loadDeadlines()
      return true
    } catch (e) {
      get().toast(`延期失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return false
    }
  },
  fileOaRound: async (rid, filedOn) => {
    const { pid } = get()
    if (!pid) return false
    try {
      const round = await api.updateOaRound(pid, rid, { filed_on: filedOn })
      if (get().pid && get().pid !== pid) return true
      set({ oaRounds: get().oaRounds.map((r) => (r.id === round.id ? round : r)) })
      get().toast(`已标记答复递交（${filedOn}），期限完成`)
      void get().loadDeadlines()
      return true
    } catch (e) {
      get().toast(`标记失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return false
    }
  },
  setOaActiveRound: (id) => {
    if (get().oaActiveRoundId !== id) set({ oaActiveRoundId: id })
  },
  argueOaItem: async (itemId) => {
    const { pid, oaActiveRoundId } = get()
    if (!pid) return null
    const job = await get().runScenario(pid, 's7', { oa_item_id: itemId, round_id: oaActiveRoundId ?? undefined })
    if (job && get().pid === pid) set({ oaArgueJobId: job.id, oaArgueItemId: itemId })
    return job
  },
  parseOa: async () => {
    const { pid, oaText } = get()
    if (!pid || !oaText.trim()) return
    set({ oaParsing: true, oaError: null })
    try {
      const r = await api.oaParse(pid, oaText)
      if (get().pid && get().pid !== pid) return
      set({ oaItems: r.items, oaWarnings: r.warnings, oaParsing: false, oaAnswers: {}, oaActiveItemId: r.items[0]?.id ?? null })
    } catch (e) {
      set({ oaParsing: false, oaError: e instanceof Error ? e.message : String(e),
        oaUnavailable: e instanceof ApiError && e.status === 501 })
    }
  },
  answerOa: async (itemIds) => {
    const { pid } = get()
    if (!pid || get().oaItems.length === 0) return null
    try {
      const job = await api.oaAnswer(pid, itemIds ?? null)
      if (get().pid && get().pid !== pid) return job
      get().upsertJob(job)
      get().watchJob(job.id)
      set({ oaJobId: job.id, oaError: null })
      return job
    } catch (e) {
      set({ oaError: e instanceof Error ? e.message : String(e), oaUnavailable: e instanceof ApiError && e.status === 501 })
      return null
    }
  },
  setOaAnswers: (answers) => {
    const map = { ...get().oaAnswers }
    for (const a of answers) map[a.item_id] = a
    set({ oaAnswers: map })
  },
  saveOaPoints: async (itemId, points) => {
    const { pid } = get()
    const prev = get().oaAnswers[itemId]
    if (!pid || !prev) return false
    try {
      const a = await api.oaUpdateAnswer(pid, itemId, points)
      set({ oaAnswers: { ...get().oaAnswers, [itemId]: { ...a, applied: prev.applied } } })
      return true
    } catch (e) {
      get().toast(`要点保存失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return false
    }
  },
  markOaApplied: (itemId) => {
    const a = get().oaAnswers[itemId]
    if (a) set({ oaAnswers: { ...get().oaAnswers, [itemId]: { ...a, applied: true } } })
  },
  setOaActiveItem: (id) => {
    if (get().oaActiveItemId !== id) set({ oaActiveItemId: id })
  },
  setOaAnswerDraft: (d) => set({ oaAnswerDraft: d }),
  resetOa: () => {
    set({ oaText: '', oaItems: [], oaWarnings: [], oaParsing: false, oaAnswers: {}, oaJobId: null, oaError: null,
      oaUnavailable: false, oaActiveItemId: null, oaRounds: [], oaRoundsLoading: false, oaRoundsUnavailable: false,
      oaActiveRoundId: null, oaArgueJobId: null, oaArgueItemId: null, oaAnswerDraft: null })
  },
})

export const selectOaJob = (s: { jobs: AiJob[]; oaJobId: string | null }) =>
  s.oaJobId ? s.jobs.find((j) => j.id === s.oaJobId) ?? null : null
