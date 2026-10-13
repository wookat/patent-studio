import { StateEffect, StateField, RangeSetBuilder, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view'
import type { Diagnostic, Severity } from '@/lib/types'

/**
 * 多诊断 gutter + 行装饰（03 §1.2 E2 / 01 §5 痛点 #14）：
 *  - 每行取最高 severity 画一枚标记（error 红点 ● / warning 黄三角 ▲ / info 蓝点，07 §2.1 与控制台同源），hover 显示该行全部消息；
 *  - error 行加浅底色 + 正文波浪下划线；warning 只加下划线。
 * 数据来自 store diagnostics.items（build / lint / client 三源合并后），由 Editor 通过 setDiagnostics 效果推入。
 */

export type LineDiagnostics = Map<number, Diagnostic[]>

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
const GLYPH: Record<Severity, string> = { error: '●', warning: '▲', info: '●' }

/** 按行分组（只保留能定位的条目）；同一行按 severity 排序 */
export function groupByLine(items: readonly Diagnostic[]): LineDiagnostics {
  const map: LineDiagnostics = new Map()
  for (const d of items) {
    if (d.line == null || d.line < 1) continue
    const arr = map.get(d.line)
    if (arr) arr.push(d)
    else map.set(d.line, [d])
  }
  for (const arr of map.values()) arr.sort((a, b) => RANK[a.severity] - RANK[b.severity])
  return map
}

export const setDiagnostics = StateEffect.define<LineDiagnostics>()

const lineMarks: Record<Severity, Decoration> = {
  error: Decoration.line({ class: 'cm-diag-line cm-diag-line-error' }),
  warning: Decoration.line({ class: 'cm-diag-line cm-diag-line-warning' }),
  info: Decoration.line({ class: 'cm-diag-line cm-diag-line-info' }),
}
const textMarks: Record<Severity, Decoration> = {
  error: Decoration.mark({ class: 'cm-diag-mark cm-diag-mark-error' }),
  warning: Decoration.mark({ class: 'cm-diag-mark cm-diag-mark-warning' }),
  info: Decoration.mark({ class: 'cm-diag-mark cm-diag-mark-info' }),
}

interface DiagState {
  byLine: LineDiagnostics
  deco: DecorationSet
}

function buildDecorations(byLine: LineDiagnostics, doc: { lines: number; line(n: number): { from: number; to: number } }): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const lines = [...byLine.keys()].filter((n) => n <= doc.lines).sort((a, b) => a - b)
  for (const n of lines) {
    const sev = byLine.get(n)![0].severity
    const l = doc.line(n)
    b.add(l.from, l.from, lineMarks[sev])
    if (l.to > l.from) b.add(l.from, l.to, textMarks[sev])
  }
  return b.finish()
}

/** 编辑时让诊断行号跟随文本位移（gutter 与行装饰保持同一行），直到下一轮 build/lint 刷新 */
function remapLines(byLine: LineDiagnostics, tr: Transaction): LineDiagnostics {
  const out: LineDiagnostics = new Map()
  const oldDoc = tr.startState.doc
  for (const [n, items] of byLine) {
    if (n > oldDoc.lines) continue
    const pos = tr.changes.mapPos(oldDoc.line(n).from, 1)
    const nn = tr.state.doc.lineAt(pos).number
    const prev = out.get(nn)
    if (prev) out.set(nn, [...prev, ...items].sort((a, b) => RANK[a.severity] - RANK[b.severity]))
    else out.set(nn, items)
  }
  return out
}

export const diagnosticsField = StateField.define<DiagState>({
  create: () => ({ byLine: new Map(), deco: Decoration.none }),
  update(value, tr) {
    let byLine = value.byLine
    let changed = false
    for (const e of tr.effects) {
      if (e.is(setDiagnostics)) {
        byLine = e.value
        changed = true
      }
    }
    if (!changed) {
      if (!tr.docChanged || !byLine.size) return value
      return { byLine: remapLines(byLine, tr), deco: value.deco.map(tr.changes) }
    }
    return { byLine, deco: buildDecorations(byLine, tr.state.doc) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

class DiagMarker extends GutterMarker {
  readonly items: Diagnostic[]
  constructor(items: Diagnostic[]) {
    super()
    this.items = items
  }
  override eq(other: DiagMarker) {
    if (other.items.length !== this.items.length) return false
    return this.items.every((d, i) => d.id === other.items[i].id && d.message === other.items[i].message && d.severity === other.items[i].severity)
  }
  override toDOM() {
    const sev = this.items[0].severity
    const wrap = document.createElement('span')
    wrap.className = `cm-diag-gutter cm-diag-gutter-${sev}`
    wrap.setAttribute('data-severity', sev)
    wrap.setAttribute('data-testid', 'diag-gutter-marker')
    wrap.tabIndex = -1
    const label = this.items.map((d) => `${d.severity === 'error' ? '错误' : d.severity === 'warning' ? '警告' : '提示'}：${d.message}`).join('\n')
    wrap.setAttribute('aria-label', label)
    wrap.setAttribute('role', 'img')

    const dot = document.createElement('span')
    dot.className = 'cm-diag-dot'
    dot.textContent = GLYPH[sev]
    wrap.appendChild(dot)
    if (this.items.length > 1) {
      const n = document.createElement('span')
      n.className = 'cm-diag-count'
      n.textContent = String(this.items.length)
      wrap.appendChild(n)
    }

    const tip = document.createElement('span')
    tip.className = 'cm-diag-tip'
    tip.setAttribute('role', 'tooltip')
    for (const d of this.items) {
      const row = document.createElement('span')
      row.className = `cm-diag-tip-row cm-diag-tip-${d.severity}`
      const icon = document.createElement('span')
      icon.className = 'cm-diag-tip-icon'
      icon.textContent = GLYPH[d.severity]
      const text = document.createElement('span')
      text.textContent = d.message
      row.appendChild(icon)
      row.appendChild(text)
      tip.appendChild(row)
    }
    wrap.appendChild(tip)
    return wrap
  }
}

const markerCache = new WeakMap<Diagnostic[], DiagMarker>()

export const diagnosticsGutter = gutter({
  class: 'cm-diag-gutter-col',
  lineMarker(view, line) {
    const { byLine } = view.state.field(diagnosticsField)
    if (!byLine.size) return null
    const n = view.state.doc.lineAt(line.from).number
    const items = byLine.get(n)
    if (!items) return null
    let m = markerCache.get(items)
    if (!m) {
      m = new DiagMarker(items)
      markerCache.set(items, m)
    }
    return m
  },
  lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setDiagnostics))),
  initialSpacer: () => spacer,
})

const spacer = new (class extends GutterMarker {
  override toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-diag-gutter'
    s.style.visibility = 'hidden'
    s.textContent = '●'
    return s
  }
})()

/** 跳转定位后的短暂高亮（scrollRequest / gotoLine） */
export const flashLine = StateEffect.define<number | null>()
const flashMark = Decoration.line({ class: 'cm-flash-line' })
export const flashLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashLine)) {
        if (e.value == null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none
        return Decoration.set([flashMark.range(tr.state.doc.line(e.value).from)])
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const diagTheme = EditorView.baseTheme({
  // 覆盖 .cm-gutter 的 overflow:hidden，否则 hover 提示被裁掉
  '.cm-gutter.cm-diag-gutter-col': { width: '14px', overflow: 'visible' },
  '.cm-diag-gutter': {
    position: 'relative',
    display: 'inline-block',
    width: '14px',
    textAlign: 'center',
    cursor: 'help',
    fontSize: '11px',
    lineHeight: 'inherit',
  },
  '.cm-diag-gutter-error .cm-diag-dot': { color: 'var(--danger-fg)' },
  '.cm-diag-gutter-warning .cm-diag-dot': { color: 'var(--warn-dot)' },
  '.cm-diag-gutter-info .cm-diag-dot': { color: 'var(--info-fg)' },
  '.cm-diag-count': {
    position: 'absolute',
    right: '-2px',
    top: '-2px',
    fontSize: '11px',
    lineHeight: '1',
    fontWeight: '700',
    color: 'var(--fg-muted)',
  },
  '.cm-diag-tip': {
    display: 'none',
    position: 'absolute',
    left: '18px',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 'var(--z-popover)',
    width: 'max-content',
    minWidth: '200px',
    maxWidth: '420px',
    padding: '6px 8px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-md)',
    fontFamily: 'var(--font-ui, var(--font-sans, system-ui))',
    fontSize: '12px',
    lineHeight: '16px',
    textAlign: 'left',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    pointerEvents: 'none',
  },
  '.cm-diag-gutter:hover .cm-diag-tip, .cm-diag-gutter:focus .cm-diag-tip': { display: 'block' },
  '.cm-diag-tip-row': { display: 'flex', gap: '6px', alignItems: 'flex-start' },
  '.cm-diag-tip-row + .cm-diag-tip-row': { marginTop: '4px' },
  '.cm-diag-tip-icon': { fontSize: '11px', lineHeight: '16px', flex: 'none' },
  '.cm-diag-tip-error .cm-diag-tip-icon': { color: 'var(--danger-fg)' },
  '.cm-diag-tip-warning .cm-diag-tip-icon': { color: 'var(--warn-dot)' },
  '.cm-diag-tip-info .cm-diag-tip-icon': { color: 'var(--info-fg)' },
  '.cm-diag-line-error': { backgroundColor: 'var(--danger-bg)' },
  '.cm-diag-mark': { textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
  '.cm-diag-mark-error': { textDecorationColor: 'var(--danger-fg)' },
  '.cm-diag-mark-warning': { textDecorationColor: 'var(--warn-dot)' },
  '.cm-diag-mark-info': { textDecorationColor: 'var(--info-fg)' },
  '.cm-flash-line': {
    backgroundColor: 'color-mix(in oklch, var(--brand-300) 45%, transparent)',
    transition: 'background-color 600ms ease',
  },
  '@media (prefers-reduced-motion: reduce)': { '.cm-flash-line': { transition: 'none' } },
})

export function diagnosticsExtension(): Extension {
  return [diagnosticsField, diagnosticsGutter, flashLineField, diagTheme]
}
