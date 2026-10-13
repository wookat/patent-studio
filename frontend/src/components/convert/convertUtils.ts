import { CONVERT_EXTS, CONVERT_MAX_BYTES, type ConvertExt } from '@/types/convert'

/** 文件扩展名（小写、不含点）；无扩展名返回 '' */
export function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function isConvertExt(ext: string): ext is ConvertExt {
  return (CONVERT_EXTS as readonly string[]).includes(ext)
}

/** 校验拖入 / 选择的文件；返回错误文案或 null */
export function validateConvertFile(file: File): string | null {
  const ext = fileExt(file.name)
  if (!isConvertExt(ext)) return `不支持的格式「.${ext || '?'}」：仅接受 ${CONVERT_EXTS.map((e) => `.${e}`).join(' / ')}`
  if (file.size === 0) return '文件为空'
  if (file.size > CONVERT_MAX_BYTES) return `文件过大：上限 ${CONVERT_MAX_BYTES / 1024 / 1024} MB（${(file.size / 1024 / 1024).toFixed(1)} MB）`
  return null
}

/** 抽取预览最多显示的字符数（纯文本类在前端直接读取；docx/pdf 由后台任务抽取） */
export const PREVIEW_CHARS = 1200

/** 文本类文件（md / txt）前端可直接预览；docx / pdf 只展示元信息 */
export function isTextExt(ext: string): boolean {
  return ext === 'md' || ext === 'txt'
}

/** 解析 history diff 的 unified 文本为带类别的行（镜像 HistoryPanel 的着色规则） */
export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx'

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

export function diffStats(diff: string): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const l of diff.split('\n')) {
    const k = classifyDiffLine(l)
    if (k === 'add') added++
    else if (k === 'del') deleted++
  }
  return { added, deleted }
}
