/** 轨道 E · 一键转专利契约（docs/plan/09 §3.3；backend/app/convert/*） */

export const CONVERT_EXTS = ['docx', 'pdf', 'md', 'txt'] as const
export type ConvertExt = (typeof CONVERT_EXTS)[number]

/** 转换输入上限：镜像 backend app/convert/extract.py MAX_BYTES（20MB） */
export const CONVERT_MAX_BYTES = 20 * 1024 * 1024

/** 交底书问卷（docs/plan/03 B7）：全部可选，空字段不进提示词 */
export interface Questionnaire {
  problem?: string
  prior_art_defects?: string
  solution_steps?: string
  key_params?: string
  effects?: string
  figures?: string
}

export const QUESTIONNAIRE_FIELDS: readonly { key: keyof Questionnaire; label: string }[] = [
  { key: 'problem', label: '要解决的问题' },
  { key: 'prior_art_defects', label: '现有技术缺陷' },
  { key: 'solution_steps', label: '方案步骤' },
  { key: 'key_params', label: '关键参数' },
  { key: 'effects', label: '效果' },
  { key: 'figures', label: '附图' },
]

/** 目标：新建案卷，或写入当前案卷的草稿版本（history commit，不覆盖工作区） */
export type ConvertTarget = 'new' | { pid: string }

/** 输入来源：本地文件，或某案卷 attachments/ 内现有文件（POST 带 attachment_pid + attachment，不重新上传） */
export interface ConvertAttachment {
  pid: string
  name: string
  size: number
}

/** job.result（kind='convert'） */
export interface ConvertResult {
  new_pid?: string
  draft_sha?: string
  report: {
    warnings: string[]
    terms: { name: string; aliases?: string[] }[]
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  }
}
