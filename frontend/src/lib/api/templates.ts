import { P, req } from './net'
import type { Settings, Template, TemplateIn } from '../types'

export const templatesApi = {
  templates: () => req<Template[]>('/api/templates'),
  template: (name: string) => req<Template>(`/api/templates/${encodeURIComponent(name)}`),
  createTemplate: (t: TemplateIn) => req<Template>('/api/templates', { method: 'POST', body: JSON.stringify(t) }),
  updateTemplate: (name: string, t: TemplateIn) =>
    req<Template>(`/api/templates/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(t) }),
  deleteTemplate: (name: string) => req<void>(`/api/templates/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  applyTemplate: (id: string, name: string) =>
    req<{ settings: Settings }>(`${P(id)}/templates/apply`, { method: 'POST', body: JSON.stringify({ name }) }),

  // ---- W4-A 案件台账（docs/plan/13 §3；A1 落地前写接口返回 501） ----
}
