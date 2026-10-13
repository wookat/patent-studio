import { useEffect, useState, type ComponentType } from 'react'
import type { EditorView } from 'prosemirror-view'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ListOrdered,
  PanelTop,
  Rows3,
  Ruler,
  Split,
  SquareSplitVertical,
  StickyNote,
  TableColumnsSplit,
  TableRowsSplit,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { applyCaptionNote, canRunTableCommand, parseColWidths, setColWidths, tableCommand, tableNote, tableOptionState } from './commands'
import './table.css'

/**
 * 表格工具条（D2，16 §5；Typora 悬浮工具条 + Word 表格设计页签子集）。
 * 只暴露内核能落源码的操作：加/删行列、竖向合并、拆分、三线、重复表头、段号居左、列宽；无横向合并、无列对齐（content.py 不支持）。
 * 命令来自 prosemirror-tables：addRowBefore/After addColumnBefore/After deleteRow deleteColumn mergeCells splitCell。
 */
export type TableCommand =
  | 'row-before' | 'row-after' | 'col-before' | 'col-after' | 'delete-row' | 'delete-col'
  | 'merge-down' | 'split'
  | 'three-line' | 'repeat-header' | 'num-left' | 'col-widths' | 'caption-note'

export interface TableToolbarProps {
  view: EditorView | null
  /** 桌面：浮在表上方；375：底部工具栏二级行 */
  variant: 'floating' | 'mobile'
  onCommand?(cmd: TableCommand): void
}

interface Item {
  cmd: Exclude<TableCommand, 'col-widths' | 'caption-note'>
  label: string
  icon: ComponentType<{ className?: string }>
}

const STRUCTURE: Item[] = [
  { cmd: 'row-before', label: '上方加行', icon: ArrowUpToLine },
  { cmd: 'row-after', label: '下方加行', icon: ArrowDownToLine },
  { cmd: 'col-before', label: '左侧加列', icon: ArrowLeftToLine },
  { cmd: 'col-after', label: '右侧加列', icon: ArrowRightToLine },
  { cmd: 'delete-row', label: '删除行', icon: TableRowsSplit },
  { cmd: 'delete-col', label: '删除列', icon: TableColumnsSplit },
  { cmd: 'merge-down', label: '向下合并', icon: SquareSplitVertical },
  { cmd: 'split', label: '拆分单元格', icon: Split },
]

const OPTIONS: (Item & { attr: 'three_line' | 'repeat_header' | 'num_left' })[] = [
  { cmd: 'three-line', attr: 'three_line', label: '三线表', icon: Rows3 },
  { cmd: 'repeat-header', attr: 'repeat_header', label: '重复表头', icon: PanelTop },
  { cmd: 'num-left', attr: 'num_left', label: '段号居左', icon: ListOrdered },
]

/** 订阅 view 的选区 / 文档变化（不改 EditorView props：D3 拥有 dispatchTransaction） */
function useEditorTick(view: EditorView | null): () => void {
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  useEffect(() => {
    if (!view) return
    const dom = view.dom
    for (const ev of ['keyup', 'mouseup', 'input', 'focus']) dom.addEventListener(ev, bump)
    document.addEventListener('selectionchange', bump)
    return () => {
      for (const ev of ['keyup', 'mouseup', 'input', 'focus']) dom.removeEventListener(ev, bump)
      document.removeEventListener('selectionchange', bump)
    }
  }, [view])
  return bump
}

export function TableToolbar({ view, variant, onCommand }: TableToolbarProps) {
  const bump = useEditorTick(view)
  const state = view?.state ?? null
  const opts = state ? tableOptionState(state) : null
  const noteNode = state ? tableNote(state) : null
  const [widthsOpen, setWidthsOpen] = useState(false)
  const [widthsText, setWidthsText] = useState('')
  const [capOpen, setCapOpen] = useState(false)
  const [capText, setCapText] = useState('')
  const [noteText, setNoteText] = useState('')

  const run = (cmd: Exclude<TableCommand, 'col-widths' | 'caption-note'>) => {
    if (view) {
      tableCommand(cmd)(view.state, view.dispatch, view)
      view.focus()
      bump()
    }
    onCommand?.(cmd)
  }

  const openWidths = () => {
    setWidthsText(opts?.col_widths?.join(',') ?? '')
    setWidthsOpen((o) => !o)
    setCapOpen(false)
  }

  const applyWidths = () => {
    if (!view) return
    const widths = parseColWidths(widthsText)
    if (widthsText.trim() && !widths) return
    setColWidths(widths)(view.state, view.dispatch)
    setWidthsOpen(false)
    view.focus()
    bump()
    onCommand?.('col-widths')
  }

  const openCap = () => {
    setCapText(opts?.caption_after ?? '')
    setNoteText((noteNode?.node.textContent ?? '').replace(/^注：/, ''))
    setCapOpen((o) => !o)
    setWidthsOpen(false)
  }

  const applyCap = () => {
    if (!view) return
    applyCaptionNote(capText, noteText)(view.state, view.dispatch)
    setCapOpen(false)
    view.focus()
    bump()
    onCommand?.('caption-note')
  }

  const can = (cmd: TableCommand) => !!state && canRunTableCommand(state, cmd)
  const mobile = variant === 'mobile'
  const size = mobile ? 'icon-xl' : 'icon-sm'
  const widthsInvalid = widthsText.trim() !== '' && !parseColWidths(widthsText)
  const widthsHint = opts ? `列宽（${opts.width} 列，逗号分隔的相对权重，空 = 清除）` : '列宽'
  const hasCapNote = !!opts?.caption_after || !!noteNode

  return (
    <div role="toolbar" aria-label="表格工具" data-testid="table-toolbar" data-variant={variant} className={cn('ps-table-toolbar', mobile && 'ps-table-toolbar--mobile')}>
      <div className="ps-table-toolbar__group" role="group" aria-label="行列">
        {STRUCTURE.map(({ cmd, label, icon: Icon }) => (
          <Button key={cmd} type="button" variant="ghost" size={size} title={label} aria-label={label} disabled={!can(cmd)} data-cmd={cmd} onClick={() => run(cmd)}>
            <Icon />
          </Button>
        ))}
      </div>
      <div className="ps-table-toolbar__group" role="group" aria-label="表格选项">
        {OPTIONS.map(({ cmd, attr, label, icon: Icon }) => (
          <Button
            key={cmd}
            type="button"
            variant="ghost"
            size={size}
            title={label}
            aria-label={label}
            aria-pressed={!!opts?.[attr]}
            disabled={!can(cmd)}
            data-cmd={cmd}
            data-state={opts?.[attr] ? 'on' : 'off'}
            onClick={() => run(cmd)}
          >
            <Icon />
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size={size}
          title="列宽"
          aria-label="列宽"
          aria-expanded={widthsOpen}
          aria-pressed={!!opts?.col_widths}
          disabled={!can('col-widths')}
          data-cmd="col-widths"
          data-state={opts?.col_widths ? 'on' : 'off'}
          onClick={openWidths}
        >
          <Ruler />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={size}
          title="表题 / 表注"
          aria-label="表题 / 表注"
          aria-expanded={capOpen}
          aria-pressed={hasCapNote}
          disabled={!can('caption-note')}
          data-cmd="caption-note"
          data-state={hasCapNote ? 'on' : 'off'}
          onClick={openCap}
        >
          <StickyNote />
        </Button>
      </div>
      {widthsOpen && opts && (
        <form
          className="ps-table-toolbar__widths"
          onSubmit={(e) => {
            e.preventDefault()
            applyWidths()
          }}
        >
          <Input
            aria-label={widthsHint}
            aria-invalid={widthsInvalid}
            placeholder={Array.from({ length: opts.width }, () => '1').join(',')}
            value={widthsText}
            autoFocus
            className={cn('h-9 w-40 text-sm', mobile && 'h-touch')}
            onChange={(e) => setWidthsText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setWidthsOpen(false)
            }}
          />
          <Button type="submit" size={mobile ? 'default' : 'sm'} variant="secondary" disabled={widthsInvalid}>
            应用
          </Button>
        </form>
      )}
      {capOpen && opts && (
        <form
          className="ps-table-toolbar__widths"
          onSubmit={(e) => {
            e.preventDefault()
            applyCap()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCapOpen(false)
          }}
        >
          <Input
            aria-label="表题后置"
            placeholder="表题后置（如：表1 试验结果，留空清除）"
            value={capText}
            autoFocus
            className={cn('h-9 w-44 text-sm', mobile && 'h-touch')}
            onChange={(e) => setCapText(e.target.value)}
            data-testid="table-caption-input"
          />
          <Input
            aria-label="表注"
            placeholder="表注（留空删除，无需写「注：」）"
            value={noteText}
            className={cn('h-9 w-44 text-sm', mobile && 'h-touch')}
            onChange={(e) => setNoteText(e.target.value)}
            data-testid="table-note-input"
          />
          <Button type="submit" size={mobile ? 'default' : 'sm'} variant="secondary" data-testid="table-capnote-apply">
            应用
          </Button>
        </form>
      )}
    </div>
  )
}
