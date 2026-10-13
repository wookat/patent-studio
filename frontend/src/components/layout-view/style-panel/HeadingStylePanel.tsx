import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Label } from '@/components/ui/label'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FONT_SUGGESTIONS, mergeStyle, ptName } from '@/lib/style'
import type { Style } from '@/lib/types'
import { deepClone } from '@/lib/utils'
import { useStudio } from '@/store'
import {
  DEFAULT_HEADINGS,
  HEADING_ALIGNS,
  HEADING_NUMBERINGS,
  SIZE_OPTIONS,
  headingVars,
  readHeadings,
  resolveHeading,
  useStyleEdit,
  type HeadingAlign,
  type HeadingLevel,
  type HeadingNumbering,
  type HeadingsStyle,
} from '@/store/styleEdit'
import { applyPreview, defaultPreviewRoots } from './preview'
import './style-panel.css'

/**
 * 标题样式面板（docs/plan/22 决策 3；prep-kernel 契约 style.headings.{section,subsection}）：
 * 章节标题 / 小节标题 各自 字体 / 字号 / 加粗 / 对齐（left|center）/ 编号（none|cn|arabic）。
 * 实时预览：把 --ps-h3-* / --ps-h4-* 内联到 `.ps-layout`（style.css 变量块的同一选择器，后写覆盖）并给 `.ps-paper` 设 data-h3/h4-numbering；
 * 关闭 / 保存后清除内联，改由后端 style.css（PUT /settings → bumpStyleCss 重取）接管。保存写 style.headings.*；「重置为默认」写回 null/false/left/none。
 * 只依赖 store（useStyleEdit.panelOpen 控制开合；FormatBar「样式…」打开）。
 */
export interface HeadingStylePanelProps {
  /** 预览目标（默认 document 内全部 .ps-layout） */
  previewRoots?: () => HTMLElement[]
}

const LEVEL_LABEL: Record<HeadingLevel, string> = { section: '章节标题（###）', subsection: '小节标题（####）' }
const ALIGN_LABEL: Record<HeadingAlign, string> = { left: '左对齐', center: '居中' }
const NUMBERING_LABEL: Record<HeadingLevel, Record<HeadingNumbering, string>> = {
  section: { none: '无', cn: '一、二、', arabic: '1. 2.' },
  subsection: { none: '无', cn: '1. 2.', arabic: '1.1 1.2' },
}
const NUMBERING_SAMPLE: Record<HeadingLevel, Record<HeadingNumbering, string>> = {
  section: { none: '', cn: '一、', arabic: '1. ' },
  subsection: { none: '', cn: '1. ', arabic: '1.1 ' },
}
const INHERIT = '__inherit__'
const LEVEL_OPTIONS = (['section', 'subsection'] as const).map((v) => ({ value: v, label: v === 'section' ? '章节标题' : '小节标题' }))

export function HeadingStylePanel({ previewRoots = defaultPreviewRoots }: HeadingStylePanelProps) {
  const open = useStyleEdit((s) => s.panelOpen)
  const closePanel = useStyleEdit((s) => s.closePanel)
  const settings = useStudio((s) => s.settings)
  const defaults = useStudio((s) => s.defaults)
  const eff = useMemo(() => (defaults ? mergeStyle(defaults, settings?.style) : null), [defaults, settings?.style])
  const dirtyRef = useRef(false)
  const [ask, setAsk] = useState(false)
  useBeforeUnload(() => open && dirtyRef.current)
  const requestClose = () => (dirtyRef.current ? setAsk(true) : closePanel())
  if (!eff) return null
  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      {open && <PanelForm eff={eff} previewRoots={previewRoots} onRequestClose={requestClose} onDirty={(d) => (dirtyRef.current = d)} />}
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); closePanel() }} />
    </Dialog>
  )
}

/** 只在面板打开期间挂载：起草取挂载时已保存值（打开期间他人改设置不打断编辑） */
function PanelForm({ eff, previewRoots, onRequestClose, onDirty }: { eff: Style; previewRoots: () => HTMLElement[]; onRequestClose: () => void; onDirty: (dirty: boolean) => void }) {
  const initialLevel = useStyleEdit((s) => s.panelLevel)
  const closePanel = useStyleEdit((s) => s.closePanel)
  const commitHeadings = useStyleEdit((s) => s.commitHeadings)
  const savedStyle = useStudio((s) => s.settings?.style)
  const toast = useStudio((s) => s.toast)

  const saved = useMemo(() => readHeadings(savedStyle), [savedStyle])
  const [level, setLevel] = useState<HeadingLevel>(initialLevel)
  const [draft, setDraft] = useState<HeadingsStyle>(() => deepClone(saved))
  const [busy, setBusy] = useState(false)

  useEffect(() => applyPreview(previewRoots(), draft, eff), [draft, eff, previewRoots])

  const h = draft[level]
  const resolved = resolveHeading(level, h, eff)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_HEADINGS)

  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])
  const patch = (p: Partial<HeadingsStyle[HeadingLevel]>) => setDraft((d) => ({ ...d, [level]: { ...d[level], ...p } }))
  const previewStyle = headingVars(draft, eff) as CSSProperties

  const save = async () => {
    setBusy(true)
    const ok = await commitHeadings(draft)
    setBusy(false)
    if (!ok) {
      toast('标题样式未保存', 'error')
      return
    }
    toast('标题样式已保存', 'success')
    closePanel()
  }

  const fonts = h.font && !FONT_SUGGESTIONS.includes(h.font) ? [h.font, ...FONT_SUGGESTIONS] : FONT_SUGGESTIONS
  const sizes = h.size && !SIZE_OPTIONS.includes(h.size) ? [...SIZE_OPTIONS, h.size].sort((a, b) => a - b) : SIZE_OPTIONS

  return (
    <DialogContent size="md" data-testid="heading-style-panel" onEscapeKeyDown={(e) => busy && e.preventDefault()} onPointerDownOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>标题样式</DialogTitle>
          <DialogDescription>作用于全文所有{LEVEL_LABEL[level]}；保存后同步到版面、DOCX 与 PDF。</DialogDescription>
        </DialogHeader>

        <Segmented aria-label="标题级别" options={LEVEL_OPTIONS} value={level} onValueChange={setLevel} data-testid="heading-level" />

        <div className="ps-heading-panel__grid">
          <Label htmlFor="heading-font">字体</Label>
          <Select value={h.font ?? INHERIT} onValueChange={(v) => patch({ font: v === INHERIT ? null : v })}>
            <SelectTrigger id="heading-font" size="sm" data-testid="heading-font">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>沿用标题字体（{eff.fonts.heading_cjk}）</SelectItem>
              {fonts.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label htmlFor="heading-size">字号</Label>
          <Select value={h.size ? String(h.size) : INHERIT} onValueChange={(v) => patch({ size: v === INHERIT ? null : Number(v) })}>
            <SelectTrigger id="heading-size" size="sm" data-testid="heading-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>沿用默认（{resolveHeading(level, { ...h, size: null }, eff).size} pt）</SelectItem>
              {sizes.map((pt) => (
                <SelectItem key={pt} value={String(pt)}>
                  {pt} pt {ptName(pt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label htmlFor="heading-bold">加粗</Label>
          <div className="flex items-center gap-2">
            <Checkbox id="heading-bold" checked={h.bold} onCheckedChange={(c) => patch({ bold: c === true })} data-testid="heading-bold" />
            <Label htmlFor="heading-bold" className="text-xs text-fg-muted">
              DOCX run.bold / 版面 font-weight
            </Label>
          </div>

          <span id="heading-align-label">对齐</span>
          <Segmented
            aria-label="对齐"
            options={HEADING_ALIGNS.map((a) => ({ value: a, label: ALIGN_LABEL[a] }))}
            value={h.align}
            onValueChange={(align) => patch({ align })}
            data-testid="heading-align"
          />

          <span id="heading-numbering-label">编号</span>
          <Segmented
            aria-label="编号"
            options={HEADING_NUMBERINGS.map((n) => ({ value: n, label: NUMBERING_LABEL[level][n] }))}
            value={h.numbering}
            onValueChange={(numbering) => patch({ numbering })}
            data-testid="heading-numbering"
          />
        </div>

        <div className="ps-heading-panel__preview" style={previewStyle} aria-label="预览" data-testid="heading-preview">
          <p className="ps-heading-panel__preview-h" data-level={level}>
            {NUMBERING_SAMPLE[level][h.numbering]}
            {level === 'section' ? '具体实施方式' : '实施例一'}
          </p>
          <p className="text-xs text-fg-muted">
            {resolved.font} · {resolved.size} pt {ptName(resolved.size)} · {resolved.bold ? '加粗' : '常规'} · {ALIGN_LABEL[resolved.align]}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setDraft(deepClone(DEFAULT_HEADINGS))} disabled={busy || isDefault} data-testid="heading-reset">
            <RotateCcw />
            重置为默认
          </Button>
          <Button variant="outline" size="sm" onClick={onRequestClose} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !dirty} data-testid="heading-save">
            保存
          </Button>
        </DialogFooter>
    </DialogContent>
  )
}
