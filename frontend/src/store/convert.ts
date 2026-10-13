import { ApiError, api } from '@/lib/api'
import type { AiJob } from '@/types/ai'
import type { ConvertAttachment, ConvertResult, ConvertTarget, Questionnaire } from '@/types/convert'
import type { Slice } from './types'

export type ConvertStep = 'pick' | 'questionnaire' | 'running' | 'done' | 'error'

/**
 * 轨道 E · 一键转专利（docs/plan/09 §5.1 / §6.4）：向导态 + 后台任务。
 * 任务帧进 convertJob（独立仓，不进 ai.jobs）——convert→新建案卷时 job.pid 是新案 id，pid 守卫会丢它全部帧，
 * 故按 convertJobId 认领而非按 pid 过滤；结果（new_pid / draft_sha）由 ConvertDialog 读 job.result 呈现
 * 「打开新案卷」/「预览 diff 后采纳」。
 */
export interface ConvertSlice {
  convertStep: ConvertStep
  convertFile: File | null
  /** 与 convertFile 二选一：文件树附件行「转为专利」进来时的来源 */
  convertAttachment: ConvertAttachment | null
  questionnaire: Questionnaire
  convertTarget: ConvertTarget
  /** 用户在对话框内明示勾选「本次上传内容将发送到 AI 中转站」 */
  convertAiAck: boolean
  convertJobId: string | null
  /** 当前转换任务的最新帧（upsertJob 按 convertJobId 路由到此，与 pid 无关） */
  convertJob: AiJob | null
  convertError: string | null
  convertUnavailable: boolean

  setConvertFile(file: File | null): void
  setConvertAttachment(att: ConvertAttachment | null): void
  setQuestionnaire(patch: Partial<Questionnaire>): void
  setConvertTarget(target: ConvertTarget): void
  setConvertAiAck(ack: boolean): void
  setConvertStep(step: ConvertStep): void
  /** POST /api/projects/convert（multipart）→ 202 job；501 → convertUnavailable */
  startConvert(): Promise<AiJob | null>
  resetConvert(): void
}

export const convertSlice: Slice<ConvertSlice> = (set, get) => ({
  convertStep: 'pick',
  convertFile: null,
  convertAttachment: null,
  questionnaire: {},
  convertTarget: 'new',
  convertAiAck: false,
  convertJobId: null,
  convertJob: null,
  convertError: null,
  convertUnavailable: false,

  setConvertFile: (file) => set({ convertFile: file, convertAttachment: null, convertError: null }),
  setConvertAttachment: (att) => set({ convertAttachment: att, convertFile: null, convertError: null }),
  setQuestionnaire: (patch) => set({ questionnaire: { ...get().questionnaire, ...patch } }),
  setConvertTarget: (target) => set({ convertTarget: target }),
  setConvertAiAck: (ack) => set({ convertAiAck: ack }),
  setConvertStep: (step) => set({ convertStep: step }),
  startConvert: async () => {
    const { convertFile, convertAttachment, questionnaire, convertTarget, convertAiAck } = get()
    const source = convertFile ?? convertAttachment
    if (!source || !convertAiAck) return null
    set({ convertStep: 'running', convertError: null })
    try {
      const job = await api.convert(source, questionnaire, convertTarget, convertAiAck)
      // 先立 id 再入帧：upsertJob 按 convertJobId 路由到 convertJob——
      // target='new' 时 job.pid 已是新案 id，晚到顺序会被外案守卫全丢（批37 D2）
      set({ convertJobId: job.id, convertJob: job })
      get().upsertJob(job)
      get().watchJob(job.id)
      return job
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ convertStep: 'error', convertError: msg, convertUnavailable: e instanceof ApiError && e.status === 501 })
      return null
    }
  },
  resetConvert: () => {
    set({ convertStep: 'pick', convertFile: null, convertAttachment: null, questionnaire: {}, convertTarget: 'new', convertAiAck: false,
      convertJobId: null, convertJob: null, convertError: null, convertUnavailable: false })
  },
})

/** 当前转换任务（convertJob 独立仓——convert→新案的 job.pid≠本案，ai.jobs 内没有它）及其结果 */
export const selectConvertJob = (s: { convertJob: AiJob | null }) => s.convertJob
export const selectConvertResult = (s: { convertJob: AiJob | null }): ConvertResult | null => {
  const j = s.convertJob
  return j?.status === 'done' && j.result ? (j.result as unknown as ConvertResult) : null
}
