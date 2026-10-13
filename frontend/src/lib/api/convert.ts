import { req } from './net'
import type { ImportDocxOpts } from './net'
import type { ImportResult, StyleSuggestion } from '../types'
import type { AiJob } from '@/types/ai'
import type { ConvertAttachment, ConvertTarget, Questionnaire } from '@/types/convert'

export const convertApi = {
  convert: (source: File | ConvertAttachment, questionnaire: Questionnaire, target: ConvertTarget, aiAck: boolean) => {
    const fd = new FormData()
    if (source instanceof File) fd.append('file', source)
    else {
      fd.append('attachment_pid', source.pid)
      fd.append('attachment', source.name)
    }
    fd.append('questionnaire', JSON.stringify(questionnaire))
    fd.append('target', target === 'new' ? 'new' : target.pid)
    fd.append('ai_ack', aiAck ? 'true' : 'false')
    return req<AiJob>('/api/projects/convert', { method: 'POST', body: fd })
  },

  /* ---- 轨道 E · OA 答复（09 §3.4）---- */
  importDocx: (file: File, opts: ImportDocxOpts = {}) => {
    const form = new FormData()
    form.append('file', file, file.name)
    if (opts.id) form.append('id', opts.id)
    if (opts.title) form.append('title', opts.title)
    form.append('apply_styles', String(opts.apply_styles ?? true))
    if (opts.style) form.append('style', JSON.stringify(opts.style))
    return req<ImportResult>('/api/projects/import/docx', { method: 'POST', body: form })
  },
  importDocxStyles: (file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return req<StyleSuggestion>('/api/import/docx/styles', { method: 'POST', body: form })
  },

  /* ---------- R9 模板预设（docs/plan/10 §6） ---------- */
}
