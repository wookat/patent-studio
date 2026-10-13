import type { Text } from '@codemirror/state'

/**
 * 光标所在章节（03 §1.2 E4）：从光标行向上找最近的 `# / ## / ###` 标题；
 * 在「权利要求书」内再定位到所在权项（`N.` 开头的块），产出如
 * 「摘要」「权利要求书 · 权项 2」「说明书 / 背景技术」「标题」。
 * 规则镜像 patent_docx/content.py：一级标题 = 发明名称，二级 = 三书，三级 = 说明书章节。
 * F2 的 lib/outline.ts 落地后可改为按 doc.outline 二分查找；此处保持无依赖。
 */

const H1 = /^#\s+/
const H2 = /^##\s+(.+?)\s*$/
const H3 = /^###\s+(.+?)\s*$/
const CLAIM = /^(\d+)\s*[.．、]/

export interface CursorSection {
  /** 二级章节名（摘要 / 权利要求书 / 说明书），标题区为「标题」，找不到为 null */
  part: string | null
  /** 三级章节名（说明书内） */
  sub: string | null
  /** 权项编号（权利要求书内） */
  claim: number | null
  /** 合成的人类可读标签 */
  label: string
}

export function sectionAt(doc: Text, lineNo: number): CursorSection {
  let part: string | null = null
  let sub: string | null = null
  let claim: number | null = null
  let sawH3 = false
  const n = Math.max(1, Math.min(lineNo, doc.lines))
  for (let i = n; i >= 1; i--) {
    const text = doc.line(i).text
    if (!text) continue
    const h2 = H2.exec(text)
    if (h2) {
      part = h2[1]
      break
    }
    if (!sawH3) {
      const h3 = H3.exec(text)
      if (h3) {
        sub = h3[1]
        sawH3 = true
        continue
      }
      if (claim == null) {
        const c = CLAIM.exec(text)
        if (c) claim = Number(c[1])
      }
    }
    if (H1.test(text)) {
      part = '标题'
      break
    }
  }
  if (part !== '权利要求书') claim = null
  if (part !== '说明书') sub = null
  let label = part ?? ''
  if (part === '权利要求书' && claim != null) label = `权利要求书 · 权项 ${claim}`
  else if (part === '说明书' && sub) label = `说明书 / ${sub}`
  return { part, sub, claim, label }
}
