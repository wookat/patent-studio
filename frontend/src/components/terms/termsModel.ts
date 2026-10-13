import { editorCommands } from '@/components/editor/commands'
import { selectReadonly, useStudio } from '@/store'
import type { Term } from '@/types/terms'
import { MSG_READONLY } from '@/lib/copy'

export const EMPTY_TERM: Term = { name: '', aliases: [], en: null, definition: null, first_line: null }

/** 「别名1、别名2, alias3」→ 去重去空 */
export function parseAliases(s: string): string[] {
  return Array.from(new Set(s.split(/[,，、;；\n]/).map((x) => x.trim()).filter(Boolean)))
}

/** 本地校验（与后端 422 规则同：主名必填、别名不得等于主名、主名不得撞其他术语） */
export function validateTerm(t: Term, others: Term[]): string | null {
  if (!t.name.trim()) return '主名不能为空'
  if (t.aliases.includes(t.name)) return '别名不能与主名相同'
  if (others.some((o) => o.name === t.name)) return `已存在同名术语「${t.name}」`
  const clash = others.find((o) => o.aliases.includes(t.name) || t.aliases.some((a) => a === o.name || o.aliases.includes(a)))
  if (clash) return `与术语「${clash.name}」的主名 / 别名冲突`
  return null
}

/** 把一行里的首个 from 换成 to；编辑器未挂载时直接改 store.content（同样进入正常保存流程） */
export function applyTermReplace(line: number, from: string, to: string): boolean {
  const s = useStudio.getState()
  // editorCommands 之外还有 setContent 回填路径，只读角色在这里拦
  if (selectReadonly(s)) {
    s.toast(MSG_READONLY, 'info')
    return false
  }
  if (editorCommands.replaceLine(line, from, to)) return true
  const lines = s.content.split('\n')
  if (line < 1 || line > lines.length || !lines[line - 1].includes(from)) return false
  lines[line - 1] = lines[line - 1].replace(from, to)
  s.persistMergedContent(lines.join('\n'))
  return true
}
