/**
 * 案卷标识（网址 /p/<id> 与后端目录名）自动生成：用户只填案号 / 发明名称，不再面对「目录名（id）」。
 * 字符集与后端 projects.ID_RE 一致（字母 / 数字 / 下划线 / 连字符 / 中文），其余字符折成「-」。
 */
const ILLEGAL = /[^A-Za-z0-9_\-\u4e00-\u9fff]+/g
const MAX_ID = 64

export function slugCaseId(raw: string, max = MAX_ID): string {
  return raw
    .trim()
    .replace(ILLEGAL, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 无案号也无名称时的兜底：案卷-20260903-0855 */
export function fallbackCaseId(now: Date = new Date()): string {
  return `案卷-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`
}

export interface SuggestCaseIdInput {
  caseNo?: string
  title?: string
  /** 已有案卷 id：撞名时追加 -2 / -3 … */
  existing?: Iterable<string>
  now?: Date
}

/** 内部案号优先（P2026-0042 本来就是唯一编号）→ 发明名称前 24 字 → 日期兜底；再对已有 id 去重 */
export function suggestCaseId({ caseNo = '', title = '', existing = [], now }: SuggestCaseIdInput): string {
  const base = slugCaseId(caseNo) || slugCaseId(title, 24) || fallbackCaseId(now)
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const cand = `${base.slice(0, MAX_ID - 1 - String(n).length)}-${n}`
    if (!taken.has(cand)) return cand
  }
}

/** 与后端 ID_RE 同一校验，供自定义标识输入框即时提示 */
export function isValidCaseId(id: string): boolean {
  return /^[A-Za-z0-9_\-\u4e00-\u9fff]{1,64}$/.test(id) && id !== '.' && id !== '..'
}
