import { paraLabel } from '@/components/block-model/model'
import { cn } from '@/lib/utils'

/**
 * `[000N]` 段号徽标（16 §2 `.ps-para-no`）：值只来自 AST（内核 numbering 生成，前端不算号），灰色、不可选中、不可编辑。
 * 读屏文本用 sr-only 前缀（span 无角色时 aria-label 被 axe 判为 prohibited）。
 */
export function ParaNo({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn('ps-para-no', className)} contentEditable={false} data-generated="true" title="段号由内核生成">
      <span className="sr-only">生成段号 </span>
      {paraLabel(n)}
    </span>
  )
}
