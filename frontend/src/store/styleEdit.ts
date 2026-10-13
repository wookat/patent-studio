import { create } from 'zustand'
import type { Style, StyleOverride } from '@/lib/types'
import { deepClone } from '@/lib/utils'
import { useStudio } from '@/store'

/**
 * W9 决策 3：字体 / 字号 / 标题样式是**段落样式**（studio.json.style），不是选区级格式（CNIPA DTD 无选区字体语法）。
 * 本切片是独立 zustand store（不改 store/index.ts）：把「当前段落样式 → style 叶子」的映射与 headings 契约（prep-kernel
 * style.headings.section|subsection = {font,size,bold,align,numbering}）集中在一处，写回统一走既有 project.saveSettings（乐观 + 600ms 防抖
 * PUT /settings + 失败回滚）→ flushSettings → layoutView.bumpStyleCss（重新 GET /style.css，PDF 由 enqueue('settings') 重建）。
 */

export type HeadingLevel = 'section' | 'subsection'
export type HeadingAlign = 'left' | 'center'
export type HeadingNumbering = 'none' | 'cn' | 'arabic'
export const HEADING_ALIGNS: readonly HeadingAlign[] = ['left', 'center']
export const HEADING_NUMBERINGS: readonly HeadingNumbering[] = ['none', 'cn', 'arabic']

/** 与后端 style.py DEFAULT_STYLE["headings"][level] 同形；font/size 为 null 表示继承 fonts.heading_cjk / sizes.*_heading */
export interface HeadingStyle {
  font: string | null
  size: number | null
  bold: boolean
  align: HeadingAlign
  numbering: HeadingNumbering
}
export type HeadingsStyle = Record<HeadingLevel, HeadingStyle>

export const DEFAULT_HEADING: HeadingStyle = { font: null, size: null, bold: false, align: 'left', numbering: 'none' }
export const DEFAULT_HEADINGS: HeadingsStyle = { section: { ...DEFAULT_HEADING }, subsection: { ...DEFAULT_HEADING } }

const HEADING_SIZE_KEY: Record<HeadingLevel, 'section_heading' | 'subsection_heading'> = {
  section: 'section_heading',
  subsection: 'subsection_heading',
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** style.headings 覆盖（可能缺失 / 部分）→ 完整 HeadingsStyle（未覆盖处取默认） */
export function readHeadings(style: StyleOverride | undefined): HeadingsStyle {
  const h = style && isObj(style.headings) ? style.headings : {}
  const pick = (level: HeadingLevel): HeadingStyle => {
    const o = isObj(h[level]) ? h[level] : {}
    return {
      font: typeof o.font === 'string' && o.font ? o.font : null,
      size: typeof o.size === 'number' && Number.isFinite(o.size) ? o.size : null,
      bold: typeof o.bold === 'boolean' ? o.bold : DEFAULT_HEADING.bold,
      align: o.align === 'center' ? 'center' : 'left',
      numbering: o.numbering === 'cn' || o.numbering === 'arabic' ? o.numbering : 'none',
    }
  }
  return { section: pick('section'), subsection: pick('subsection') }
}

/** 解析继承后的实值（与后端 heading_style 同规则）：font null → fonts.heading_cjk；size null → sizes.section_heading|subsection_heading */
export function resolveHeading(level: HeadingLevel, h: HeadingStyle, eff: Style): { font: string; size: number; bold: boolean; align: HeadingAlign; numbering: HeadingNumbering } {
  return { ...h, font: h.font ?? eff.fonts.heading_cjk, size: h.size ?? eff.sizes[HEADING_SIZE_KEY[level]] }
}

/** 段落样式（FormatBar 下拉项）→ 字体 / 字号落在 style 的哪个叶子 */
export type ParagraphStyleName = 'paragraph' | 'section' | 'subsection' | 'claim' | 'table-caption' | 'figure-caption' | 'equation'

export interface ParagraphStyleTarget {
  label: string
  /** 字体叶子；null = 该样式无独立字体（跟随正文） */
  font: { group: 'fonts'; key: keyof Style['fonts'] } | { group: 'headings'; level: HeadingLevel } | null
  /** 字号叶子 */
  size: { group: 'sizes'; key: keyof Style['sizes'] } | { group: 'headings'; level: HeadingLevel }
  /** 下拉内的「应用于全文所有〈…〉」提示 */
  scope: string
}

/**
 * 与内核 builder 的落点一致：正文 / 权项 / 图题 共用 fonts.body_cjk + sizes.body（builder.para 默认字号），表题 sizes.table，
 * 公式 sizes.equation；章节 / 小节标题走 style.headings.*（prep-kernel heading_style 继承 fonts.heading_cjk / sizes.*_heading）。
 */
export const PARAGRAPH_STYLES: Record<ParagraphStyleName, ParagraphStyleTarget> = {
  paragraph: { label: '正文', font: { group: 'fonts', key: 'body_cjk' }, size: { group: 'sizes', key: 'body' }, scope: '全文所有正文段落（含权项、图题）' },
  section: { label: '章节标题', font: { group: 'headings', level: 'section' }, size: { group: 'headings', level: 'section' }, scope: '全文所有章节标题（###）' },
  subsection: { label: '小节标题', font: { group: 'headings', level: 'subsection' }, size: { group: 'headings', level: 'subsection' }, scope: '全文所有小节标题（####）' },
  claim: { label: '权项', font: { group: 'fonts', key: 'body_cjk' }, size: { group: 'sizes', key: 'body' }, scope: '全文所有正文段落（权项与正文共用字体字号）' },
  'table-caption': { label: '表题', font: { group: 'fonts', key: 'body_cjk' }, size: { group: 'sizes', key: 'table' }, scope: '全文所有表格（表题与表内文字共用字号）' },
  'figure-caption': { label: '图题', font: { group: 'fonts', key: 'body_cjk' }, size: { group: 'sizes', key: 'body' }, scope: '全文所有正文段落（图题与正文共用字体字号）' },
  equation: { label: '公式', font: null, size: { group: 'sizes', key: 'equation' }, scope: '全文所有公式' },
}
export const PARAGRAPH_STYLE_NAMES = Object.keys(PARAGRAPH_STYLES) as ParagraphStyleName[]

/** 当前有效值（override 叠默认）里读某段落样式的字体 / 字号 */
export function paragraphStyleValue(name: ParagraphStyleName, override: StyleOverride | undefined, eff: Style): { font: string | null; size: number } {
  const t = PARAGRAPH_STYLES[name]
  const headings = readHeadings(override)
  const font = !t.font ? null : t.font.group === 'fonts' ? eff.fonts[t.font.key] : resolveHeading(t.font.level, headings[t.font.level], eff).font
  const size = t.size.group === 'sizes' ? eff.sizes[t.size.key] : resolveHeading(t.size.level, headings[t.size.level], eff).size
  return { font, size }
}

/** 纯函数：把字体 / 字号写进 style override 的对应叶子，返回新 override（不改入参） */
export function applyParagraphStyle(override: StyleOverride | undefined, name: ParagraphStyleName, patch: { font?: string; size?: number }): StyleOverride {
  const out = deepClone((override ?? {}) as Record<string, unknown>)
  const t = PARAGRAPH_STYLES[name]
  const setLeaf = (path: string[], v: unknown) => {
    let cur = out
    for (const k of path.slice(0, -1)) {
      if (!isObj(cur[k])) cur[k] = {}
      cur = cur[k] as Record<string, unknown>
    }
    cur[path[path.length - 1]] = v
  }
  if (patch.font !== undefined && t.font) {
    if (t.font.group === 'fonts') setLeaf(['fonts', t.font.key], patch.font)
    else setLeaf(['headings', t.font.level, 'font'], patch.font)
  }
  if (patch.size !== undefined) {
    if (t.size.group === 'sizes') setLeaf(['sizes', t.size.key], patch.size)
    else setLeaf(['headings', t.size.level, 'size'], patch.size)
  }
  return out as StyleOverride
}

/** 纯函数：写 style.headings（整份两级；与默认相同的级别仍写入，后端 validate_headings 接受完整对象） */
export function applyHeadings(override: StyleOverride | undefined, headings: HeadingsStyle): StyleOverride {
  const out = deepClone((override ?? {}) as Record<string, unknown>)
  const same = (a: HeadingStyle, b: HeadingStyle) => JSON.stringify(a) === JSON.stringify(b)
  if (same(headings.section, DEFAULT_HEADING) && same(headings.subsection, DEFAULT_HEADING)) delete out.headings
  else out.headings = { section: { ...headings.section }, subsection: { ...headings.subsection } }
  return out as StyleOverride
}

/** 与后端 style_css.render_vars 同名的标题变量（--ps-h3-* = section，--ps-h4-* = subsection），供面板实时预览内联覆盖 */
export function headingVars(headings: HeadingsStyle, eff: Style): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [level, prefix] of [['section', '--ps-h3'], ['subsection', '--ps-h4']] as const) {
    const r = resolveHeading(level, headings[level], eff)
    out[`${prefix}-font`] = r.font
    out[`${prefix}-size`] = `${r.size}pt`
    out[`${prefix}-weight`] = r.bold ? 'bold' : 'normal'
    out[`${prefix}-align`] = r.align
    out[`${prefix}-numbering`] = r.numbering
  }
  return out
}

/** 常用字号（磅）：五号 10.5 起，含内核默认的 12（小四）/ 14（四号）等 */
export const SIZE_OPTIONS: readonly number[] = [9, 10.5, 12, 14, 15, 16, 18, 22]

export interface StyleEditState {
  /** 标题样式面板是否打开（FormatBar「样式…」/ 段落样式菜单打开） */
  panelOpen: boolean
  /** 面板初始聚焦的级别 */
  panelLevel: HeadingLevel
  /** 面板编辑中的实时预览（未保存）；null = 无预览 */
  preview: HeadingsStyle | null
  openPanel(level?: HeadingLevel): void
  closePanel(): void
  setPreview(h: HeadingsStyle | null): void
  /** 字体 / 字号下拉：改当前段落样式对应叶子 → saveSettings → flush → bumpStyleCss；无案子 / 无设置 → false */
  commitParagraphStyle(name: ParagraphStyleName, patch: { font?: string; size?: number }): Promise<boolean>
  /** 标题样式面板保存 */
  commitHeadings(headings: HeadingsStyle): Promise<boolean>
}

async function commitStyle(mutate: (style: StyleOverride | undefined) => StyleOverride): Promise<boolean> {
  const s = useStudio.getState()
  if (!s.pid || !s.settings) return false
  const before = s.settings
  s.saveSettings({ ...before, style: mutate(before.style) })
  await s.flushSettings()
  const after = useStudio.getState()
  // saveSettings 失败会回滚到 before（引用相等）
  if (after.pid === s.pid && after.settings === before) return false
  after.bumpStyleCss()
  return true
}

export const useStyleEdit = create<StyleEditState>()((set) => ({
  panelOpen: false,
  panelLevel: 'section',
  preview: null,
  openPanel: (level = 'section') => set({ panelOpen: true, panelLevel: level }),
  closePanel: () => set({ panelOpen: false, preview: null }),
  setPreview: (preview) => set({ preview }),
  commitParagraphStyle: (name, patch) => commitStyle((style) => applyParagraphStyle(style, name, patch)),
  commitHeadings: (headings) => commitStyle((style) => applyHeadings(style, headings)),
}))
