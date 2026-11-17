import { useEffect, type ComponentType } from 'react'
import type { EditorView } from 'prosemirror-view'
import { Bold, Plus, Subscript, Superscript } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { BookName } from '@/types/ast'
import { templatesFor } from '@/components/block-model/toolbar/insert'
import { insertBlock, isMarkActive, toggleMarkCmd, type MarkName } from './commands'
import { runOnView, useEditorTick } from './useEditorTick'
import './toolbar.css'

/**
 * 常驻格式工具条（克制批次 S3：13 → 4）：加粗 · 下标 · 上标 · 插入。
 * - 段落样式 / 字体 / 字号 / 标题样式 → 排版设置（⌘,）；斜体 / 下划线仍有 Ctrl+I / Ctrl+U 热键；
 *   撤销 / 重做 → 「编辑」菜单（edit-undo / edit-redo）；删除块 → 「编辑」菜单「删除当前块」。
 * - 只依赖 `view: EditorView | null` + store：BookEditor 集成时 `<FormatBar view={view} />` 放在纸面滚动容器内顶部（sticky）。
 * - 按钮状态随光标 / 选区：活动 mark（aria-pressed）。
 */
export interface FormatBarProps {
  view: EditorView | null
  className?: string
  /**
   * 提供时「插入」不再弹自己的下拉，而是交给宿主（LayoutView 的 `/` 菜单：含附图… / 公式编辑器，按当前块锚定），
   * 使版面视图里只有一个「插入」入口；按钮沿用宿主的 testid `layout-insert`。
   */
  onInsert?: () => void
  insertOpen?: boolean
}

const MARKS: { name: MarkName; label: string; shortcut: string; icon: ComponentType<{ className?: string }> }[] = [
  { name: 'strong', label: '加粗', shortcut: 'Ctrl+B', icon: Bold },
  { name: 'subscript', label: '下标', shortcut: 'Ctrl+,', icon: Subscript },
  { name: 'superscript', label: '上标', shortcut: 'Ctrl+.', icon: Superscript },
]

export function FormatBar({ view, className, onInsert, insertOpen = false }: FormatBarProps) {
  const bump = useEditorTick(view)
  const blockTemplates = useStudio((s) => s.blockTemplates)
  const blockTemplatesError = useStudio((s) => s.blockTemplatesError)
  const loadBlockTemplates = useStudio((s) => s.loadBlockTemplates)

  useEffect(() => {
    if (!blockTemplates) void loadBlockTemplates().catch(() => undefined)
  }, [blockTemplates, loadBlockTemplates])

  const state = view?.state ?? null
  const book = (state?.doc.attrs.book as BookName | null) ?? null
  const templates = templatesFor(blockTemplates, book)
  const disabled = !view || !view.editable

  return (
    <div role="toolbar" aria-label="格式" aria-orientation="horizontal" data-testid="format-bar" className={cn('ps-format-bar', className)}>
      <div className="ps-format-bar__group">
        {MARKS.map(({ name, label, shortcut, icon: Icon }) => (
          <Toggle
            key={name}
            size="sm"
            aria-label={`${label}（${shortcut}）`}
            title={`${label} ${shortcut}`}
            data-testid={`format-mark-${name}`}
            pressed={!!state && isMarkActive(state, name)}
            disabled={disabled}
            onPressedChange={() => runOnView(view, toggleMarkCmd(name), bump)}
          >
            <Icon />
          </Toggle>
        ))}
      </div>

      <div className="ps-format-bar__group">
        {onInsert ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="插入块"
            data-testid="layout-insert"
            aria-haspopup="listbox"
            aria-expanded={insertOpen}
            aria-controls={insertOpen ? 'ps-slash-menu' : undefined}
            onClick={onInsert}
          >
            <Plus />
            插入
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="插入块" data-testid="format-insert" disabled={disabled || (!templates.length && !blockTemplatesError)}>
                <Plus />
                插入
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {blockTemplatesError && (
                <DropdownMenuItem data-testid="format-insert-retry" onSelect={() => void loadBlockTemplates()}>
                  块模板加载失败：{blockTemplatesError}——重试
                </DropdownMenuItem>
              )}
              {templates.map((t) => (
                <DropdownMenuItem key={t.kind} onSelect={() => runOnView(view, insertBlock(t), bump)}>
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
