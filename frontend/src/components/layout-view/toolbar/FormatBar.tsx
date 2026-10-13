import { useEffect, useState, type ComponentType } from 'react'
import type { EditorView } from 'prosemirror-view'
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history'
import { Bold, Italic, Palette, Plus, Redo2, Subscript, Superscript, Trash2, Underline, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { FONT_SUGGESTIONS, mergeStyle, ptName } from '@/lib/style'
import { cn } from '@/lib/utils'
import { selectCanEditStyle, useStudio } from '@/store'
import { PARAGRAPH_STYLES, PARAGRAPH_STYLE_NAMES, SIZE_OPTIONS, paragraphStyleValue, useStyleEdit, type ParagraphStyleName } from '@/store/styleEdit'
import type { BookName } from '@/types/ast'
import { templatesFor } from '@/components/block-model/toolbar/insert'
import {
  TEXT_BLOCK_KINDS,
  currentBlockKind,
  insertBlock,
  isMarkActive,
  kindAllowedIn,
  setBlockKind,
  toggleMarkCmd,
  type MarkName,
  type TextBlockKind,
} from './commands'
import { styleNameOf } from './geometry'
import { runOnView, useEditorTick } from './useEditorTick'
import './toolbar.css'

/**
 * 常驻格式工具条（docs/plan/22 决策 2；Word「开始」页签子集）：段落样式 ▾ · 字体 ▾ · 字号 ▾ · B I U x₂ x² · 插入 ▾ · 撤销 / 重做 · 样式…
 * - 只依赖 `view: EditorView | null` + store：BookEditor 集成时 `<FormatBar view={view} />` 放在纸面滚动容器内顶部（sticky）。
 * - 字体 / 字号作用于**当前段落样式**（改 studio.json.style，经既有 PUT /settings + 重取 style.css），下拉内明示范围并弹确认；
 *   reviewer / viewer（selectCanEditStyle=false）字体 / 字号 / 「样式…」禁用并 title 说明，不再走到确认框（W9 domain-04 / qa-03 / ux-03）。
 * - 按钮状态随光标 / 选区：活动 mark（aria-pressed）、当前样式名（Select value）、撤销 / 重做深度。
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
  /** 提供时显示「删除」钮——删除当前选中块（docs/plan/06 §5.5 工具条入口）；deleteReason 非空 = 禁用并以 title 说明原因 */
  onDeleteBlock?: () => void
  deleteReason?: string | null
}

const MARKS: { name: MarkName; label: string; shortcut: string; icon: ComponentType<{ className?: string }> }[] = [
  { name: 'strong', label: '加粗', shortcut: 'Ctrl+B', icon: Bold },
  { name: 'em', label: '斜体', shortcut: 'Ctrl+I', icon: Italic },
  { name: 'underline', label: '下划线', shortcut: 'Ctrl+U', icon: Underline },
  { name: 'subscript', label: '下标', shortcut: 'Ctrl+,', icon: Subscript },
  { name: 'superscript', label: '上标', shortcut: 'Ctrl+.', icon: Superscript },
]

const sizeLabel = (pt: number) => `${pt} pt${ptName(pt) ? ` ${ptName(pt)}` : ''}`

type Pending = { name: ParagraphStyleName; font?: string; size?: number }

/** reviewer / viewer 不可改段落样式（与服务端 PUT /settings 403 同口径）；提示挂在禁用控件的 title 与包裹层 */
const STYLE_DENIED = '审阅者不可改样式（需 editor 及以上角色）'

export function FormatBar({ view, className, onInsert, insertOpen = false, onDeleteBlock, deleteReason = null }: FormatBarProps) {
  const bump = useEditorTick(view)
  const settings = useStudio((s) => s.settings)
  const defaults = useStudio((s) => s.defaults)
  const blockTemplates = useStudio((s) => s.blockTemplates)
  const blockTemplatesError = useStudio((s) => s.blockTemplatesError)
  const loadBlockTemplates = useStudio((s) => s.loadBlockTemplates)
  const toast = useStudio((s) => s.toast)
  const canStyle = useStudio(selectCanEditStyle)
  const commitParagraphStyle = useStyleEdit((s) => s.commitParagraphStyle)
  const openPanel = useStyleEdit((s) => s.openPanel)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!blockTemplates) void loadBlockTemplates().catch(() => undefined)
  }, [blockTemplates, loadBlockTemplates])

  const state = view?.state ?? null
  const kind = state ? currentBlockKind(state) : null
  const styleName = styleNameOf(kind)
  const book = (state?.doc.attrs.book as BookName | null) ?? null
  const eff = defaults ? mergeStyle(defaults, settings?.style) : null
  const value = styleName && eff ? paragraphStyleValue(styleName, settings?.style, eff) : null
  const templates = templatesFor(blockTemplates, book)
  const disabled = !view || !view.editable
  const styleHint = canStyle ? undefined : STYLE_DENIED
  const canUndo = !!state && undoDepth(state) > 0
  const canRedo = !!state && redoDepth(state) > 0

  const onStyle = (v: string) => {
    if (!state) return
    if (!runOnView(view, setBlockKind(v as TextBlockKind), bump)) toast('该块不能转换为此样式', 'info')
  }
  const confirmPending = async () => {
    if (!pending) return
    setBusy(true)
    const ok = await commitParagraphStyle(pending.name, { font: pending.font, size: pending.size })
    setBusy(false)
    setPending(null)
    // 保存失败（403 等）由 saveSettings 自己 toast 并回滚；这里只补「没开案子」这一种
    if (!ok && !useStudio.getState().pid) toast('样式未保存：请先打开案子', 'error')
    view?.focus()
  }

  const target = pending ? PARAGRAPH_STYLES[pending.name] : null
  const sizes = value && !SIZE_OPTIONS.includes(value.size) ? [...SIZE_OPTIONS, value.size].sort((a, b) => a - b) : SIZE_OPTIONS
  const fonts = value?.font && !FONT_SUGGESTIONS.includes(value.font) ? [value.font, ...FONT_SUGGESTIONS] : FONT_SUGGESTIONS

  return (
    <div role="toolbar" aria-label="格式" aria-orientation="horizontal" data-testid="format-bar" className={cn('ps-format-bar', className)}>
      <div className="ps-format-bar__group">
        <Select value={styleName ?? ''} onValueChange={onStyle} disabled={disabled || !kind}>
          <SelectTrigger size="sm" aria-label="段落样式" data-testid="format-style" className="w-28">
            <SelectValue placeholder="—">{styleName ? PARAGRAPH_STYLES[styleName].label : kind ? '—' : ''}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PARAGRAPH_STYLE_NAMES.map((n) => {
              const convertible = TEXT_BLOCK_KINDS.includes(n as TextBlockKind) && kindAllowedIn(book, n as TextBlockKind)
              return (
                <SelectItem key={n} value={n} disabled={!convertible}>
                  {PARAGRAPH_STYLES[n].label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <Select
          value={value?.font ?? ''}
          onValueChange={(font) => styleName && font !== value?.font && setPending({ name: styleName, font })}
          disabled={disabled || !canStyle || !styleName || !PARAGRAPH_STYLES[styleName].font}
        >
          <SelectTrigger size="sm" aria-label="字体（作用于当前段落样式）" title={styleHint} data-testid="format-font" data-denied={canStyle ? undefined : ''} className="w-32">
            <SelectValue placeholder="字体" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {styleName && <SelectLabel className="ps-format-bar__hint">应用于{PARAGRAPH_STYLES[styleName].scope}</SelectLabel>}
              <SelectSeparator />
              {fonts.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={value ? String(value.size) : ''}
          onValueChange={(v) => styleName && Number(v) !== value?.size && setPending({ name: styleName, size: Number(v) })}
          disabled={disabled || !canStyle || !styleName}
        >
          <SelectTrigger size="sm" aria-label="字号（作用于当前段落样式）" title={styleHint} data-testid="format-size" data-denied={canStyle ? undefined : ''} className="w-28">
            <SelectValue placeholder="字号" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {styleName && <SelectLabel className="ps-format-bar__hint">应用于{PARAGRAPH_STYLES[styleName].scope}</SelectLabel>}
              <SelectSeparator />
              {sizes.map((pt) => (
                <SelectItem key={pt} value={String(pt)}>
                  {sizeLabel(pt)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

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
        {onDeleteBlock && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="删除块"
            data-testid="layout-delete"
            disabled={disabled || !!deleteReason}
            title={deleteReason ?? undefined}
            onClick={onDeleteBlock}
          >
            <Trash2 />
            删除
          </Button>
        )}
      </div>

      <div className="ps-format-bar__group">
        <Button variant="ghost" size="icon-sm" aria-label="撤销（Ctrl+Z）" data-testid="format-undo" disabled={disabled || !canUndo} onClick={() => runOnView(view, undo, bump)}>
          <Undo2 />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="重做（Ctrl+Shift+Z）" data-testid="format-redo" disabled={disabled || !canRedo} onClick={() => runOnView(view, redo, bump)}>
          <Redo2 />
        </Button>
      </div>

      <div className="ps-format-bar__group">
        <Button
          variant="ghost"
          size="sm"
          aria-label="标题样式…"
          title={styleHint}
          data-testid="format-styles"
          disabled={!canStyle}
          onClick={() => openPanel(kind === 'subsection' ? 'subsection' : 'section')}
        >
          <Palette />
          样式…
        </Button>
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent size="sm" data-testid="format-confirm">
          <DialogHeader>
            <DialogTitle>应用于{target?.scope ?? ''}？</DialogTitle>
            <DialogDescription>
              {pending?.font !== undefined && `字体改为「${pending.font}」。`}
              {pending?.size !== undefined && `字号改为 ${sizeLabel(pending.size)}。`}
              字体 / 字号是段落样式，会应用于全文同类段落并同步到版面、DOCX 与 PDF；CNIPA XML 不含字体信息。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPending(null)} disabled={busy}>
              取消
            </Button>
            <Button size="sm" onClick={() => void confirmPending()} disabled={busy} data-testid="format-confirm-apply">
              应用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
