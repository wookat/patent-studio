import { ApiError, api } from '@/lib/api'
import type { Template, TemplateIn } from '@/lib/types'
import type { Slice } from './types'

/**
 * R9 模板预设（docs/plan/10 §6 / §7.1）：命名的 settings 预设（PROJECTS_DIR 同级 templates/*.json）。
 * 后端 501 期间 `templatesUnavailable=true`，「模板」页显示说明；`saveCurrentAsTemplate` 从 project.settings 取
 * style / sub_except / abstract_limit（附图选择不进模板）。`applyTemplate` 成功后以后端返回 settings 覆盖并触发重建。
 */
export interface TemplatesSlice {
  templates: Template[]
  templatesLoading: boolean
  templatesUnavailable: boolean
  templatesError: string | null

  loadTemplates(): Promise<void>
  saveCurrentAsTemplate(name: string, description?: string, overwrite?: boolean): Promise<Template | null>
  applyTemplate(pid: string, name: string): Promise<boolean>
  deleteTemplate(name: string): Promise<void>
  /** 导入 JSON（导出 = 直接下载 Template 对象）；`overwrite` 走 PUT 覆盖同名，否则 POST（同名 409） */
  importTemplate(t: TemplateIn, overwrite?: boolean): Promise<Template | null>
  resetTemplates(): void
}

export const templatesSlice: Slice<TemplatesSlice> = (set, get) => ({
  templates: [],
  templatesLoading: false,
  templatesUnavailable: false,
  templatesError: null,

  loadTemplates: async () => {
    set({ templatesLoading: true, templatesError: null })
    try {
      set({ templates: await api.templates(), templatesLoading: false, templatesUnavailable: false })
    } catch (e) {
      set({
        templatesLoading: false,
        templatesUnavailable: e instanceof ApiError && e.status === 501,
        templatesError: e instanceof Error ? e.message : '模板加载失败',
      })
    }
  },
  saveCurrentAsTemplate: async (name, description = '', overwrite = false) => {
    const st = get().settings
    if (!st) return null
    return get().importTemplate(
      {
        name,
        description,
        document_type: 'patent_cn_invention',
        settings: { style: st.style, sub_except: st.sub_except, abstract_limit: st.abstract_limit },
      },
      overwrite,
    )
  },
  importTemplate: async (t, overwrite = false) => {
    try {
      const saved = overwrite ? await api.updateTemplate(t.name, t) : await api.createTemplate(t)
      set((s) => ({ templates: [...s.templates.filter((x) => x.name !== saved.name), saved] }))
      get().toast(`模板「${saved.name}」已保存`)
      return saved
    } catch (e) {
      get().toast(e instanceof Error ? e.message : '保存模板失败', 'error')
      return null
    }
  },
  applyTemplate: async (pid, name) => {
    try {
      const r = await api.applyTemplate(pid, name)
      if (get().pid && get().pid !== pid) return true
      set({ settings: r.settings })
      get().enqueue('manual', true)
      get().toast(`已应用模板「${name}」`)
      return true
    } catch (e) {
      get().toast(e instanceof Error ? e.message : '应用模板失败', 'error')
      return false
    }
  },
  deleteTemplate: async (name) => {
    await api.deleteTemplate(name)
    set((s) => ({ templates: s.templates.filter((t) => t.name !== name) }))
  },
  resetTemplates: () => set({ templates: [], templatesLoading: false, templatesUnavailable: false, templatesError: null }),
})
