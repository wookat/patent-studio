/** attachments/ 白名单（docs/plan/12 §4.4；15 §3.2）；与 backend/app/domain/projects.py ATTACHMENT_EXTS 同步 */
export const ATTACHMENT_EXTS = ['.pdf', '.docx', '.doc', '.md', '.txt', '.png', '.jpg', '.zip'] as const
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024

/** 预览方式：pdf → react-pdf；image → <img>；text（md/txt）→ 文本；docx/zip → 只下载 */
export type AttachmentKind = 'pdf' | 'docx' | 'text' | 'image' | 'zip'

/** `GET /api/projects/{pid}/attachments` items[] 元素 */
export interface AttachmentItem {
  /** 文件名 = id（attachments/ 平铺一层） */
  name: string
  /** 小写后缀，如 ".pdf" */
  ext: string
  /** bytes */
  size: number
  /** ISO 8601 */
  mtime: string
  kind: AttachmentKind
  /** GET 原文件（inline）；加 `?download=1` 变 attachment */
  url: string
}

export interface AttachmentsResponse {
  items: AttachmentItem[]
}

/** 前端预校验（后端同规则再校一次）：返回 null 表示可上传 */
export function attachmentReject(f: { name: string; size: number }): string | null {
  const ext = /\.[^.]+$/.exec(f.name)?.[0]?.toLowerCase() ?? ''
  if (!(ATTACHMENT_EXTS as readonly string[]).includes(ext)) return `不支持的附件类型 ${ext || '(无扩展名)'}`
  if (f.size > ATTACHMENT_MAX_BYTES) return `超过 ${Math.floor(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB（${(f.size / 1024 / 1024).toFixed(1)} MB）`
  return null
}
