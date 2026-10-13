import { abstractNearThreshold } from '@/lib/abstractLimit'
import { acceptCritic } from '@/components/layout-view/review/criticParse'
import type { Diagnostic } from '@/lib/types'

/** 与后端 lint 同 id，合并时 client 覆盖 lint 的同名条目（05 §3） */
export const ABSTRACT_LIMIT_ID = 'abstract.limit'
/** 接近上限预警（仅前端；后端 lint 只在越界时报 error） */
export const ABSTRACT_NEAR_LIMIT_ID = 'abstract.near_limit'
export const ABSTRACT_IDS = [ABSTRACT_LIMIT_ID, ABSTRACT_NEAR_LIMIT_ID]

const ABSTRACT_HEADING = /^#{1,3}\s*摘要\s*$/
const ANY_HEADING = /^#{1,3}\s/

export interface AbstractStat {
  chars: number
  limit: number
  /** `## 摘要` 所在行（1-based），无摘要为 null */
  headingLine: number | null
  /** 摘要正文首个非空行（1-based），无正文时回落到标题行 */
  bodyLine: number | null
}

/** 摘要字数：含标点、不含空白、标记符不计（接受后文本——与 store selectAbstractLive / patent_studio.kernel 规则一致） */
export function abstractStat(content: string, limit: number): AbstractStat {
  const lines = content.split('\n')
  const start = lines.findIndex((l) => ABSTRACT_HEADING.test(l))
  if (start < 0) return { chars: 0, limit, headingLine: null, bodyLine: null }
  let chars = 0
  let bodyLine: number | null = null
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (ANY_HEADING.test(l)) break
    const stripped = acceptCritic(l).replace(/\s+/g, '')
    if (!stripped) continue
    if (bodyLine == null) bodyLine = i + 1
    chars += stripped.length
  }
  return { chars, limit, headingLine: start + 1, bodyLine: bodyLine ?? start + 1 }
}

/**
 * 超限 → source='client' 的 error（abstract.limit，覆盖后端同名条目）；
 * 接近上限（≥ 95%，默认 285/300）→ warning（abstract.near_limit，原型「摘要接近字数上限」条目）；否则 null。
 */
export function abstractDiagnostic(content: string, limit: number): Diagnostic | null {
  const st = abstractStat(content, limit)
  if (st.chars > limit) {
    return {
      id: ABSTRACT_LIMIT_ID,
      severity: 'error',
      source: 'client',
      message: `摘要超过 ${limit} 字（当前 ${st.chars}）`,
      line: st.bodyLine,
      section: '摘要',
      fix: `删减至 ${limit} 字以内，摘要字数含标点、不含空白`,
    }
  }
  if (st.chars >= abstractNearThreshold(limit)) {
    return {
      id: ABSTRACT_NEAR_LIMIT_ID,
      severity: 'warning',
      source: 'client',
      message: `摘要接近字数上限：当前 ${st.chars} 字，上限 ${limit} 字，还可写 ${limit - st.chars} 字`,
      line: st.bodyLine,
      section: '摘要',
      fix: `超限时构建会失败；可精简摘要，或在「排版设置 › 校验规则」调整上限（当前 ${limit}）`,
    }
  }
  return null
}
