import { useId, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { TRANSITION_COLOR, cn } from '@/lib/utils'
import type { NumberItem, TextItem } from './schema'

export interface ComboOpt { label: string; value: string; font?: string }

/* ---------- 一体式组合框壳：边框包输入+单位+▼钮成单控件，焦点环落在壳上 ---------- */
function ComboShell({ invalid, disabled, children }: { invalid?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'relative flex h-md-control w-full items-center rounded-md border bg-panel px-3',
        'in-data-[density=touch]:h-lg-control',
        invalid ? 'border-danger-fg' : 'border-border-strong hover:border-fg-subtle',
        'focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-1 focus-within:outline-ring',
        disabled && 'cursor-not-allowed border-border bg-sunken',
        TRANSITION_COLOR,
      )}
      aria-invalid={invalid || undefined}
    >
      {children}
    </div>
  )
}

/* ---------- 组合框公共件：可输可选——输入照常，▼/↓ 开候选，↑↓ 选、Enter 定、Esc 收 ---------- */
function useCombo<T extends { label: string; value: string }>(draft: string, options: T[] | undefined) {
  const [open, setOpenState] = useState(false)
  const [active, setActive] = useState(-1)
  // dirty=false 显全单（▼/↓ 开单所见即全档）；开单后再输入才按草稿过滤
  const [dirty, setDirty] = useState(false)
  const listId = useId()
  const shown = useMemo(() => {
    if (!options) return []
    if (!dirty) return options
    const q = draft.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [draft, dirty, options])
  const setOpen = (v: boolean) => {
    setOpenState(v)
    if (v) { setDirty(false); setActive(-1) }
  }
  const onKey = (e: React.KeyboardEvent, pick: (o: T) => void) => {
    if (!options?.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0) } else setActive((a) => Math.min(a + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      if (open) { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    } else if (e.key === 'Enter' && open && active >= 0 && shown[active]) {
      e.preventDefault()
      pick(shown[active])
      setOpen(false)
    } else if (e.key === 'Escape' && open) {
      // 防穿透：宿主面板按 defaultPrevented 判定，缺标会把设置抽屉连带关掉
      e.preventDefault()
      setOpen(false)
    }
  }
  return { open, setOpen, active, setActive, listId, shown, onKey, markDirty: () => setDirty(true) }
}

function ComboList<T extends { label: string; value: string; font?: string }>({
  listId, shown, active, onPick, onHover,
}: {
  listId: string
  shown: T[]
  active: number
  onPick: (o: T) => void
  onHover: (i: number) => void
}) {
  return (
    <ul
      id={listId}
      role="listbox"
      className="absolute inset-x-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
      // 阻止 blur 先一步关单——点击项仍能选中
      onMouseDown={(e) => e.preventDefault()}
    >
      {shown.length === 0 && <li className="px-2.5 py-1.5 text-2xs text-fg-muted">无匹配项</li>}
      {shown.map((o, i) => (
        <li
          key={o.value}
          id={`${listId}-opt-${i}`}
          role="option"
          aria-selected={i === active}
          className={cn('flex cursor-pointer items-baseline justify-between gap-2 px-2.5 py-1.5 text-sm', i === active && 'bg-primary-soft')}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(o)}
        >
          <span className="truncate" style={o.font ? { fontFamily: o.font } : undefined}>{o.label}</span>
          {o.label !== o.value && <span className="shrink-0 text-2xs tabular-nums text-fg-muted">{o.value}</span>}
        </li>
      ))}
    </ul>
  )
}

function ComboButton({ open, onClick, ariaLabel, disabled }: { open: boolean; onClick: () => void; ariaLabel: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={ariaLabel}
      disabled={disabled}
      // 先 mousedown 防 blur——否则输入框失焦关单后 click 又把单重开
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-accent hover:text-fg disabled:opacity-40"
    >
      <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
    </button>
  )
}

/* ---------- 高亮匹配文字 ---------- */
export function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warn-bg px-0.5 text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/* ---------- 数字输入：带单位 + 范围校验，非法值红边不写回；可带前缀（页边距 左/上/右/下） ---------- */
export function NumberField({
  item, value, onCommit, className, ariaLabel, prefix, disabled, options,
}: {
  item: Pick<NumberItem, 'min' | 'max' | 'step' | 'unit' | 'hint'>
  value: number
  onCommit: (v: number) => void
  className?: string
  ariaLabel: string
  prefix?: string
  disabled?: boolean
  /** 预设候选：可选可输组合框（字号 pt 预设等） */
  options?: ComboOpt[]
}) {
  const [draft, setDraft] = useState(String(value))
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    setDraft(String(value))
  }

  const parsed = draft.trim() === '' ? NaN : Number(draft)
  const invalid = Number.isNaN(parsed) || parsed < item.min || parsed > item.max
  const hint = !invalid && item.hint ? item.hint(parsed) : ''

  const pick = (o: ComboOpt) => {
    setDraft(o.value)
    const n = Number(o.value)
    if (!Number.isNaN(n) && n >= item.min && n <= item.max && n !== value) {
      setSynced(n)
      onCommit(n)
    }
  }
  const combo = useCombo(draft, options)

  return (
    <div className={cn('flex min-w-0 max-w-full flex-col items-end gap-0.5', className)}>
      <div className={cn('w-30 max-w-full', options && 'w-36')}>
        <ComboShell invalid={invalid} disabled={disabled}>
          {prefix && <span className="mr-1.5 shrink-0 text-xs text-fg-muted">{prefix}</span>}
          <Input
            type="number"
            inputMode="decimal"
            step={item.step}
            min={item.min}
            max={item.max}
            value={draft}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            role={options ? 'combobox' : undefined}
            aria-expanded={options ? combo.open : undefined}
            aria-controls={options && combo.open ? combo.listId : undefined}
            aria-activedescendant={options && combo.open && combo.active >= 0 ? `${combo.listId}-opt-${combo.active}` : undefined}
            onChange={(e) => {
              const s = e.target.value
              setDraft(s)
              combo.markDirty()
              const n = s.trim() === '' ? NaN : Number(s)
              if (!Number.isNaN(n) && n >= item.min && n <= item.max && n !== value) {
                setSynced(n)
                onCommit(n)
              }
            }}
            onKeyDown={(e) => combo.onKey(e, pick)}
            onBlur={() => {
              combo.setOpen(false)
              if (invalid) {
                setDraft(String(value))
              }
            }}
            className={cn(
              'h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-right tabular-nums shadow-none outline-none',
              'hover:border-transparent focus-visible:outline-none disabled:bg-transparent',
              '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            )}
          />
          <span className="ml-1.5 shrink-0 text-2xs text-fg-muted">{item.unit}</span>
          {options && (
            <ComboButton
              open={combo.open}
              ariaLabel={`${ariaLabel} 候选`}
              disabled={disabled}
              onClick={() => combo.setOpen(!combo.open)}
            />
          )}
          {combo.open && (
            <ComboList
              listId={combo.listId}
              shown={combo.shown}
              active={combo.active}
              onPick={(o) => { pick(o); combo.setOpen(false) }}
              onHover={combo.setActive}
            />
          )}
        </ComboShell>
      </div>
      {invalid ? (
        <span className="text-2xs text-danger-fg" role="alert">范围 {item.min}–{item.max}{item.unit && ` ${item.unit}`}</span>
      ) : hint ? (
        <span className="text-2xs text-fg-muted">{hint}</span>
      ) : null}
    </div>
  )
}

/* ---------- 文本输入：可带组合框候选与校验 ---------- */
export function TextField({
  item, value, onCommit, options, ariaLabel, disabled,
}: {
  item: Pick<TextItem, 'suggestions' | 'mono' | 'validate'>
  value: string
  onCommit: (v: string) => void
  /** 候选字体等：可选可输组合框（item.suggestions 时由调用方传入） */
  options?: ComboOpt[]
  ariaLabel: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    setDraft(value)
  }
  const err = item.validate ? item.validate(draft) : null
  const pick = (o: ComboOpt) => {
    setDraft(o.value)
    if (o.value !== value) {
      setSynced(o.value)
      onCommit(o.value)
    }
  }
  const combo = useCombo(draft, item.suggestions ? options : undefined)
  return (
    <div className="flex min-w-0 max-w-full flex-col items-end gap-0.5">
      <div className={cn('w-40 max-w-full', item.suggestions && options && 'w-48')}>
        <ComboShell invalid={!!err} disabled={disabled}>
          <Input
            value={draft}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-invalid={!!err || undefined}
            role={item.suggestions && options ? 'combobox' : undefined}
            aria-expanded={item.suggestions && options ? combo.open : undefined}
            aria-controls={item.suggestions && options && combo.open ? combo.listId : undefined}
            aria-activedescendant={item.suggestions && options && combo.open && combo.active >= 0 ? `${combo.listId}-opt-${combo.active}` : undefined}
            onChange={(e) => {
              const s = e.target.value
              setDraft(s)
              combo.markDirty()
              const e2 = item.validate ? item.validate(s) : null
              if (!e2 && s !== value) {
                setSynced(s)
                onCommit(s)
              }
            }}
            onKeyDown={(e) => combo.onKey(e, pick)}
            onBlur={() => {
              combo.setOpen(false)
              if (err) setDraft(value)
            }}
            className={cn(
              'h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 shadow-none outline-none',
              'hover:border-transparent focus-visible:outline-none disabled:bg-transparent',
              item.mono && 'font-mono tabular-nums',
            )}
            // 字体字段：按当前字体名实时预览渲染（非法名浏览器自动回退）
            style={item.suggestions ? { fontFamily: draft } : undefined}
          />
          {item.suggestions && options && (
            <ComboButton
              open={combo.open}
              ariaLabel={`${ariaLabel} 候选`}
              disabled={disabled}
              onClick={() => combo.setOpen(!combo.open)}
            />
          )}
          {item.suggestions && options && combo.open && (
            <ComboList
              listId={combo.listId}
              shown={combo.shown}
              active={combo.active}
              onPick={(o) => { pick(o); combo.setOpen(false) }}
              onHover={combo.setActive}
            />
          )}
        </ComboShell>
      </div>
      {err && <span className="text-2xs text-danger-fg" role="alert">{err}</span>}
    </div>
  )
}

export function SwitchField({ value, onCommit, ariaLabel, disabled }: { value: boolean; onCommit: (v: boolean) => void; ariaLabel: string; disabled?: boolean }) {
  return <Switch checked={value} onCheckedChange={onCommit} aria-label={ariaLabel} disabled={disabled} />
}
