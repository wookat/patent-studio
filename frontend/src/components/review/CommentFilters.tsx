import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CommentFilter, CommentSource, CommentStatusFilter } from '@/store/comments'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'open', label: '未解决', 'data-testid': 'review-filter-open' },
  { value: 'resolved', label: '已解决', 'data-testid': 'review-filter-resolved' },
  { value: 'all', label: '全部', 'data-testid': 'review-filter-all' },
] as const satisfies readonly { value: CommentStatusFilter; label: string; 'data-testid': string }[]

const SOURCE_LABEL: Record<CommentSource | 'all', string> = { all: '全部来源', human: '成员', ai: 'AI', client: '客户' }

export interface CommentFiltersProps {
  filter: CommentFilter
  setCommentFilter: (patch: Partial<CommentFilter>) => void
  authors: readonly { key: string; name: string }[]
  desktop: boolean
  padX: string
}

/** 批注筛选条：状态 Segmented + 来源/按人双 Select（comments 非空时才挂载） */
export function CommentFilters({ filter, setCommentFilter, authors, desktop, padX }: CommentFiltersProps) {
  return (
    <div className={cn('flex flex-col gap-1.5 pb-2', padX)} data-testid="review-filters">
      <Segmented
        size={desktop ? 'sm' : 'md'}
        aria-label="批注状态筛选"
        className="w-full"
        options={STATUS_OPTIONS}
        value={filter.status}
        onValueChange={(status) => setCommentFilter({ status })}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={filter.source} onValueChange={(source) => setCommentFilter({ source: source as CommentSource | 'all' })}>
          <SelectTrigger size={desktop ? 'sm' : 'lg'} aria-label="来源筛选" data-testid="review-filter-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['all', 'human', 'ai', 'client'] as const).map((v) => (
              <SelectItem key={v} value={v} data-testid={`review-filter-source-${v}`}>{SOURCE_LABEL[v]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter.author ?? 'all'} onValueChange={(author) => setCommentFilter({ author: author === 'all' ? null : author })}>
          <SelectTrigger size={desktop ? 'sm' : 'lg'} aria-label="按人筛选" data-testid="review-filter-author">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有人</SelectItem>
            {authors.map((a) => (
              <SelectItem key={a.key} value={a.key} data-testid={`review-filter-author-${a.key}`}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
