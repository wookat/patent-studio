import { ApiError, api } from '@/lib/api'
import { attachmentReject, type AttachmentItem, type AttachmentsResponse } from '@/types/attachments'
import type { Slice } from './types'

/**
 * W4-C attachments/（docs/plan/15-w4c-figures-files-design.md §3.2 / §4.1）。
 * 列表 = GET /attachments；上传 / 删除成功后以响应整表覆盖。
 * 后端 501（C2 未落地）→ attachmentsUnavailable=true，文件树 attachments/ 节点显示占位、不弹 toast（与 ast slice 同策略）。
 * 预览目标 previewAttachment 由文件树点击设置，AttachmentPreview 面板读它；不持久化。
 */
export interface AttachmentsSlice {
  attachments: AttachmentItem[]
  attachmentsLoading: boolean
  attachmentsError: string | null
  attachmentsUnavailable: boolean
  attachmentsPid: string | null
  /** 正在预览的附件名（attachments/ 内）；null = 关闭预览 */
  previewAttachment: string | null

  loadAttachments(pid: string): Promise<AttachmentItem[] | null>
  /** 前端先按白名单 / 50 MB 预校验（attachmentReject），全部通过才发一次 multipart；任一被拒 toast 并不上传 */
  uploadAttachments(files: File[]): Promise<boolean>
  deleteAttachment(name: string): Promise<boolean>
  /** W19 批3：内置交底书模板进 attachments/；已存在 → info toast（不覆盖发明人可能已填写的版本） */
  seedIntakeTemplate(): Promise<boolean>
  setPreviewAttachment(name: string | null): void
  resetAttachments(): void
}

let attAbort: AbortController | null = null

export const attachmentsSlice: Slice<AttachmentsSlice> = (set, get) => {
  const apply = (r: AttachmentsResponse) => set({ attachments: r.items, attachmentsError: null, attachmentsUnavailable: false })
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof ApiError && e.status === 501) set({ attachmentsUnavailable: true, attachmentsError: msg })
    else get().toast(msg, 'error')
    return false
  }

  return {
    attachments: [],
    attachmentsLoading: false,
    attachmentsError: null,
    attachmentsUnavailable: false,
    attachmentsPid: null,
    previewAttachment: null,

    loadAttachments: async (pid) => {
      attAbort?.abort()
      const ctrl = new AbortController()
      attAbort = ctrl
      set({ attachmentsLoading: true, attachmentsPid: pid })
      try {
        const r = await api.getAttachments(pid, ctrl.signal)
        if (ctrl.signal.aborted) return null
        set({ attachments: r.items, attachmentsLoading: false, attachmentsError: null, attachmentsUnavailable: false })
        return r.items
      } catch (e) {
        if (ctrl.signal.aborted) return null
        const msg = e instanceof Error ? e.message : String(e)
        set({ attachmentsLoading: false, attachmentsError: msg, attachmentsUnavailable: e instanceof ApiError && e.status === 501 })
        return null
      } finally {
        if (attAbort === ctrl) attAbort = null
      }
    },

    uploadAttachments: async (files) => {
      const pid = get().pid
      if (!pid || files.length === 0) return false
      for (const f of files) {
        const why = attachmentReject(f)
        if (why) {
          get().toast(`${f.name}：${why}`, 'error')
          return false
        }
      }
      try {
        const r = await api.uploadAttachments(pid, files)
        if (get().pid && get().pid !== pid) return true
        apply(r)
        return true
      } catch (e) {
        return fail(e)
      }
    },

    deleteAttachment: async (name) => {
      const pid = get().pid
      if (!pid) return false
      try {
        const r = await api.deleteAttachment(pid, name)
        if (get().pid && get().pid !== pid) return true
        apply(r)
        if (get().previewAttachment === name) set({ previewAttachment: null })
        return true
      } catch (e) {
        return fail(e)
      }
    },

    seedIntakeTemplate: async () => {
      const pid = get().pid
      if (!pid) return false
      try {
        const r = await api.seedIntakeTemplate(pid)
        if (get().pid && get().pid !== pid) return true
        apply(r)
        get().toast('交底书模板已生成，可在附件中预览或下载发给发明人')
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          get().toast('交底书模板已存在，未重复生成', 'info')
          return true
        }
        return fail(e)
      }
    },

    setPreviewAttachment: (name) => {
      if (get().previewAttachment !== name) set({ previewAttachment: name })
    },

    resetAttachments: () => {
      attAbort?.abort()
      attAbort = null
      set({
        attachments: [], attachmentsLoading: false, attachmentsError: null, attachmentsUnavailable: false,
        attachmentsPid: null, previewAttachment: null,
      })
    },
  }
}
