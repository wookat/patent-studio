import { req } from './net'
import type { AttachmentsResponse } from '@/types/attachments'

export const attachmentsApi = {
  getAttachments: (id: string, signal?: AbortSignal) =>
    req<AttachmentsResponse>(`/api/projects/${encodeURIComponent(id)}/attachments`, { signal }),
  uploadAttachments: (id: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    return req<AttachmentsResponse>(`/api/projects/${encodeURIComponent(id)}/attachments`, { method: 'POST', body: form })
  },
  deleteAttachment: (id: string, name: string) =>
    req<AttachmentsResponse>(`/api/projects/${encodeURIComponent(id)}/attachments/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  seedIntakeTemplate: (id: string) =>
    req<AttachmentsResponse>(`/api/projects/${encodeURIComponent(id)}/attachments/seed-intake`, { method: 'POST' }),
  attachmentUrl: (id: string, name: string, download = false) =>
    `/api/projects/${encodeURIComponent(id)}/attachments/${encodeURIComponent(name)}${download ? '?download=1' : ''}`,
  /** R2.5 体检（05-r2 §3.2）：不传 content/settings 时后端用磁盘上的 */
}
