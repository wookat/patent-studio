import { BookOpen } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LINT_RULES } from '@/components/problems/lintRules'
import type { Diagnostic } from '@/lib/types'
import { cn } from '@/lib/utils'
import { findRule } from './consoleUtils'

const SEVERITY_LABEL: Record<Diagnostic['severity'], string> = { error: '错误', warning: '警告', info: '提示' }
const SOURCE_LABEL: Record<Diagnostic['source'], string> = { build: '构建（排版内核）', lint: '形式检查（lint）', boundary: '编号边界（手写了内核生成的编号）', client: '编辑器即时规则' }

/** 「查看规则说明」：lintRules 目录里对应条目 + 该诊断的 id / 来源 / 建议 */
export function RuleDialog({ item, open, onOpenChange }: { item: Diagnostic; open: boolean; onOpenChange: (o: boolean) => void }) {
  const rule = findRule(item.id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="rule-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="size-4" aria-hidden />
            {rule ? rule.name : '规则说明'}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{rule ? rule.id : item.id}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-fg-muted">级别</dt>
          <dd className={cn(item.severity === 'error' && 'text-danger-fg', item.severity === 'warning' && 'text-warn-fg', item.severity === 'info' && 'text-info')}>
            {SEVERITY_LABEL[item.severity]}
          </dd>
          <dt className="text-fg-muted">来源</dt>
          <dd>{SOURCE_LABEL[item.source]}</dd>
          {rule && (
            <>
              <dt className="text-fg-muted">规则</dt>
              <dd>{rule.desc || rule.name}</dd>
            </>
          )}
          <dt className="text-fg-muted">本条</dt>
          <dd>{item.message}</dd>
          {typeof item.fix === 'string' && (
            <>
              <dt className="text-fg-muted">建议</dt>
              <dd>{item.fix}</dd>
            </>
          )}
        </dl>
        {!rule && (
          <p className="text-xs text-fg-muted">
            该诊断不属于 {LINT_RULES.length} 条可自动判定的形式规则目录（docs/ux/05-architecture.md §4.1）；以「本条」与「原始日志」为准。
          </p>
        )}
        <p className="text-xs text-fg-muted">形式检查只覆盖可机判项；支持性 / 清楚性 / 新颖性等实体问题需人工审校。</p>
      </DialogContent>
    </Dialog>
  )
}
