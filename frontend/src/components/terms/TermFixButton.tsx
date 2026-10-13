import { Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { lineChipLabel } from '@/lib/diagLocation'
import { selectReadonly, useStudio } from '@/store'
import type { Diagnostic } from '@/lib/types'
import { applyTermReplace } from './termsModel'
import { MSG_READONLY } from '@/lib/copy'

/**
 * 术语一致性诊断（`terms.alias#…`，后端随 lint 给出机器可读 `replace`）的一键修复：直接把该行别名改为主名。
 * 这是用户主动点击的确定性替换（非 AI），与控制台「改为「主名」」按钮同一路径（可撤销）。
 */
export function TermFixButton({ d, className }: { d: Diagnostic; className?: string }) {
  const toast = useStudio((s) => s.toast)
  const ast = useStudio((s) => s.ast)
  const readonly = useStudio(selectReadonly)
  if (!d.replace || d.line == null || d.replace.from === d.replace.to) return null
  const { from, to } = d.replace
  const line = d.line
  const where = lineChipLabel(line, ast)
  return (
    <Button
      size="xs"
      variant="secondary"
      className={className}
      disabled={readonly}
      title={readonly ? MSG_READONLY : undefined}
      aria-label={`${where}「${from}」改为「${to}」`}
      onClick={() => {
        if (applyTermReplace(line, from, to)) toast(`${where}已改为「${to}」`, 'success')
        else toast(`${where}未找到「${from}」，可能已修改`, 'error')
      }}
      data-testid="term-fix-button"
    >
      <Wand2 aria-hidden /> 改为「{to}」
    </Button>
  )
}
