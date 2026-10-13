import { ApiError, api } from '@/lib/api'
import type { Term, TermCandidate, TermsUnifyResult } from '@/types/terms'
import type { Slice } from './types'

/**
 * 轨道 E · 术语表（docs/plan/09 §5.1）：<project>/terms.json 的前端镜像。
 * 术语一致性诊断由后端 lint() 随 terms 返回（id `terms.alias#…`，带 `replace`），前端不自己扫；
 * 一键统一走 POST /terms/unify → {critic_markdown, changed_lines}，由 TermsPanel 按改动行区间写入编辑器（CriticMarkup 建议，用户在审阅面板接受/拒绝）。
 */
export interface TermsSlice {
  terms: Term[]
  termsLoading: boolean
  termsSaving: boolean
  termsError: string | null
  /** 后端 501（E2 未落地）：面板显示占位 */
  termsUnavailable: boolean
  termsPid: string | null
  candidates: TermCandidate[]
  candidatesLoading: boolean
  /** 批71：术语行内编辑草稿（五字段表单）——TermsPanel 随侧栏视图切换/伴随栏换面板/导航抽屉关闭卸载，
     本地态草稿随实例死；存 store，键 = 'new' 或被编辑原术语名，重挂按键恢复（卸载丢草稿族收口） */
  termDraft: TermDraft | null

  loadTerms(pid: string): Promise<void>
  /** 整表保存（PUT）；422 → termsError（重名 / 别名撞主名） */
  saveTerms(terms: Term[]): Promise<boolean>
  upsertTerm(term: Term): Promise<boolean>
  removeTerm(name: string): Promise<boolean>
  extractTerms(opts?: { ai?: boolean }): Promise<void>
  /** 候选 → 术语表（不落盘，随后 saveTerms） */
  adoptCandidate(c: TermCandidate): Term
  /** 忽略候选（仅本地剔除，不落盘） */
  dismissCandidate(c: TermCandidate): void
  /** names 缺省 = 全部主名。POST …/terms/unify：只拿结果不写内容；写回由调用方（TermsPanel → aiModel.writeCriticLines）走编辑器事务 */
  unifyTerms(names?: string[]): Promise<TermsUnifyResult | null>
  /** null 清除（保存/取消/放弃后）；非 null 即该条目处于编辑态 */
  setTermDraft(d: TermDraft | null): void
  resetTerms(): void
}

/** 术语编辑表单草稿（字段即 TermEditor 的五个文本框原样，不解析） */
export interface TermDraft {
  /** 'new' 或编辑前的主名（改名时 key 仍是旧名，保存后表单随新名条目消失） */
  key: string
  name: string
  aliases: string
  en: string
  definition: string
  firstLine: string
}

export const termsSlice: Slice<TermsSlice> = (set, get) => ({
  terms: [],
  termsLoading: false,
  termsSaving: false,
  termsError: null,
  termsUnavailable: false,
  termsPid: null,
  candidates: [],
  candidatesLoading: false,
  termDraft: null,

  loadTerms: async (pid) => {
    set({ termsLoading: true, termsPid: pid })
    try {
      const terms = (await api.terms(pid)).terms
      if (get().pid && get().pid !== pid) return
      set({ terms, termsLoading: false, termsUnavailable: false, termsError: null })
    } catch (e) {
      // 501 → 功能未上线（unavailable 态）；其余（如 terms.json 腐坏 422）落错误态——静默吞成空表是数据丢失假象（R74-01）
      const unavailable = e instanceof ApiError && e.status === 501
      set({ termsLoading: false, termsUnavailable: unavailable, termsError: unavailable ? null : e instanceof Error ? e.message : String(e) })
    }
  },
  saveTerms: async (terms) => {
    const { pid } = get()
    if (!pid) return false
    set({ termsSaving: true, termsError: null })
    try {
      const next = (await api.putTerms(pid, terms)).terms
      if (get().pid && get().pid !== pid) return false
      set({ terms: next, termsSaving: false })
      // 词表变更使既有 lint 结果失效（terms.alias# 等诊断引用词名）——已有 lintRun 时自动重跑刷新
      if (get().lintRun) void get().runLint()
      return true
    } catch (e) {
      set({ termsSaving: false, termsError: e instanceof Error ? e.message : String(e),
        termsUnavailable: e instanceof ApiError && e.status === 501 })
      return false
    }
  },
  upsertTerm: (term) => {
    const terms = get().terms
    const next = terms.some((t) => t.name === term.name) ? terms.map((t) => (t.name === term.name ? term : t)) : [...terms, term]
    return get().saveTerms(next)
  },
  removeTerm: (name) => get().saveTerms(get().terms.filter((t) => t.name !== name)),
  extractTerms: async (opts = {}) => {
    const { pid, content } = get()
    if (!pid) return
    set({ candidatesLoading: true })
    try {
      const candidates = (await api.extractTerms(pid, { content, ai: opts.ai === true })).candidates
      if (get().pid && get().pid !== pid) return
      set({ candidates, candidatesLoading: false })
    } catch (e) {
      set({ candidatesLoading: false, termsUnavailable: e instanceof ApiError && e.status === 501 })
      if (!(e instanceof ApiError && e.status === 501)) get().toast(`术语抽取失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  },
  adoptCandidate: (c) => {
    const term: Term = {
      name: c.name, aliases: c.aliases ?? [], en: c.en ?? null, definition: c.definition ?? null, first_line: c.lines[0] ?? null,
    }
    set({ candidates: get().candidates.filter((x) => x.name !== c.name) })
    return term
  },
  dismissCandidate: (c) => set({ candidates: get().candidates.filter((x) => x.name !== c.name) }),
  unifyTerms: async (names) => {
    const { pid, content } = get()
    if (!pid) return null
    try {
      return await api.unifyTerms(pid, { content, names })
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) set({ termsUnavailable: true })
      else get().toast(`术语统一失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return null
    }
  },
  setTermDraft: (d) => set({ termDraft: d }),
  resetTerms: () => {
    set({ terms: [], termsLoading: false, termsSaving: false, termsError: null, termsUnavailable: false, termsPid: null,
      candidates: [], candidatesLoading: false, termDraft: null })
  },
})

/** 术语一致性诊断条数（Rail「术语」徽标；诊断来自 diagnostics.items） */
export const selectTermIssueCount = (s: { items: { id: string }[] }) => s.items.filter((d) => d.id.startsWith('terms.')).length
