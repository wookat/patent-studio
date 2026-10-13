import type { Settings, Style } from '@/lib/types'
import { getPath } from '@/lib/utils'
import { mergeStyle, ptName } from '@/lib/style'

/**
 * 设置项声明（03 §3.8 / design.md §4 设置⇄builder 映射）。
 * 每项 = 标签 + 一句说明 + 控件类型；style 项按路径读写 settings.style（diff 后只存差异），
 * 顶层项（abstract_limit / sub_except / 附图）直接读写 Settings 字段。JSON 结构与后端完全一致。
 */
export type GroupId = 'page' | 'fonts' | 'paragraph' | 'headerfooter' | 'figures' | 'table' | 'advanced'

interface ItemBase {
  id: string
  label: string
  desc: string
  /** 额外搜索词（拼音/别名） */
  keywords?: string
}

export interface NumberItem extends ItemBase {
  kind: 'number'
  path: string[]
  min: number
  max: number
  step: number
  unit: string
  /** 值 → 附加提示（如 12 → 小四） */
  hint?: (v: number) => string
  /** 候选预设组合框（可选可输）：字号 pt 档 */
  presets?: 'size'
}

export interface TextItem extends ItemBase {
  kind: 'text'
  path: string[]
  /** 输入建议（候选组合框，可选可输） */
  suggestions?: boolean
  mono?: boolean
  /** 校验：返回错误文案或 null */
  validate?: (v: string) => string | null
}

export interface SwitchItem extends ItemBase {
  kind: 'switch'
  path: string[]
}

/** 顶层字段项：由 SettingsContent 里的专用控件渲染 */
export interface CustomItem extends ItemBase {
  kind: 'abstract_limit' | 'sub_except' | 'figures_book'
}

export type Item = NumberItem | TextItem | SwitchItem | CustomItem
export type StyleItem = NumberItem | TextItem | SwitchItem

export interface Group {
  id: GroupId
  title: string
  /** 标题右侧摘要（原型「边距 · 页眉 · 页脚 · 横线」） */
  summary: string
  items: Item[]
  /** 默认是否展开 */
  open: boolean
}

const PART_LABELS: [keyof Style['header']['labels'], string][] = [
  ['claims', '权利要求书'], ['description', '说明书'], ['figures', '说明书附图'], ['abstract', '说明书摘要'], ['abstract_figure', '摘要附图'],
]

const num = (path: string[], label: string, desc: string, o: Omit<NumberItem, 'id' | 'kind' | 'path' | 'label' | 'desc'>): NumberItem =>
  ({ kind: 'number', id: path.join('.'), path, label, desc, ...o })
const text = (path: string[], label: string, desc: string, o: Partial<TextItem> = {}): TextItem =>
  ({ kind: 'text', id: path.join('.'), path, label, desc, ...o })

const mm = { min: 5, max: 60, step: 1, unit: 'mm' }
const pt = { min: 0, max: 48, step: 1, unit: 'pt' }
const fontSize = { min: 5, max: 48, step: 0.5, unit: 'pt', hint: (v: number) => ptName(v), presets: 'size' as const }
const eighth = { min: 0, max: 48, step: 1, unit: '⅛pt', hint: (v: number) => `${v / 8} pt` }

export const GROUPS: Group[] = [
  {
    id: 'page', title: '页面', summary: '尺寸 · 边距 · 页眉页脚距离', open: true,
    items: [
      num(['page', 'width_cm'], '纸张宽度', 'A4 = 21.0 cm', { min: 10, max: 50, step: 0.1, unit: 'cm' }),
      num(['page', 'height_cm'], '纸张高度', 'A4 = 29.7 cm', { min: 10, max: 60, step: 0.1, unit: 'cm' }),
      num(['page', 'margin_top_mm'], '上边距', 'CNIPA 规定 25 mm', { ...mm, keywords: 'margin 页边距' }),
      num(['page', 'margin_bottom_mm'], '下边距', 'CNIPA 规定 15 mm', mm),
      num(['page', 'margin_left_mm'], '左边距', 'CNIPA 规定 25 mm（装订侧）', mm),
      num(['page', 'margin_right_mm'], '右边距', 'CNIPA 规定 15 mm', mm),
      num(['page', 'header_distance_cm'], '页眉距顶', '页眉文字到纸张顶边的距离', { min: 0, max: 5, step: 0.1, unit: 'cm' }),
      num(['page', 'footer_distance_cm'], '页脚距底', '页脚编号/年份到纸张底边的距离', { min: 0, max: 5, step: 0.1, unit: 'cm' }),
    ],
  },
  {
    id: 'fonts', title: '字体与字号', summary: '正文 · 标题 · 页眉页脚 · 段号', open: true,
    items: [
      text(['fonts', 'body_cjk'], '正文中文字体', '宋体（SimSun）；Linux 缺字体时由 fontconfig 回退 Noto Serif CJK', { suggestions: true }),
      text(['fonts', 'heading_cjk'], '标题/页眉/页脚中文字体', '黑体（SimHei）', { suggestions: true }),
      text(['fonts', 'ascii'], '西文字体', '正文中的英文与数字，默认 Times New Roman', { suggestions: true }),
      text(['fonts', 'label_ascii'], '页眉页脚西文字体', '页眉/页脚/段号中的西文，默认 SimHei', { suggestions: true }),
      text(['fonts', 'mono'], '伪代码等宽字体', '默认 Courier New', { suggestions: true }),
      num(['sizes', 'body'], '正文字号', '默认小四 12 pt；影响页数', fontSize),
      num(['sizes', 'title'], '发明名称字号', '默认四号 14 pt', fontSize),
      num(['sizes', 'section_heading'], '一级标题字号', '### 章节标题，默认 12 pt', fontSize),
      num(['sizes', 'subsection_heading'], '二级标题字号', '#### 小节标题，默认 12 pt', fontSize),
      num(['sizes', 'para_number'], '段号字号', '[0001] 样式，默认 10.5 pt', fontSize),
      num(['sizes', 'header'], '页眉字号', '默认四号 14 pt', fontSize),
      num(['sizes', 'footer'], '页脚编号/年份字号', '默认 9 pt', fontSize),
      num(['sizes', 'page_number'], '页码字号', '默认五号 10.5 pt', fontSize),
      num(['sizes', 'table'], '表格文字字号', '默认五号 10.5 pt', fontSize),
      num(['sizes', 'equation'], '公式字号', '默认 12 pt', fontSize),
      num(['sizes', 'code'], '伪代码字号', '默认五号 10.5 pt', fontSize),
    ],
  },
  {
    id: 'paragraph', title: '段落与行距', summary: '行距 · 缩进 · 段后', open: false,
    items: [
      num(['paragraph', 'line_spacing'], '行距（倍）', '正文/权项/公式/伪代码共用，默认 1.3', { min: 1, max: 3, step: 0.05, unit: '×' }),
      num(['paragraph', 'first_indent_pt'], '首行缩进', '默认 24 pt（两字）', { min: 0, max: 72, step: 1, unit: 'pt' }),
      num(['paragraph', 'space_after', 'body'], '正文段后', '默认 6 pt', pt),
      num(['paragraph', 'space_after', 'title'], '发明名称后', '默认 12 pt', pt),
      num(['paragraph', 'space_after', 'section_heading'], '一级标题后', '默认 8 pt', pt),
      num(['paragraph', 'space_after', 'subsection_heading'], '二级标题后', '默认 6 pt', pt),
      num(['paragraph', 'space_after', 'claim_inner'], '权项内分段', '同一权项内步骤之间，默认 4 pt', pt),
      num(['paragraph', 'space_after', 'claim_last'], '权项末段', '权项之间的间距，默认 8 pt', pt),
      num(['paragraph', 'space_after', 'figure_caption'], '图题后', '默认 12 pt', pt),
      num(['paragraph', 'space_after', 'table_label'], '表题后', '默认 2 pt', pt),
      num(['paragraph', 'space_after', 'table_gap'], '表后', '默认 6 pt', pt),
      num(['paragraph', 'space_after', 'equation_cell'], '公式单元段后', '默认 3 pt', pt),
    ],
  },
  {
    id: 'headerfooter', title: '页眉与页脚', summary: '文字 · 编码 · 年份 · 横线', open: false,
    items: [
      ...PART_LABELS.map(([k, label]) => text(['header', 'labels', k], `${label} 页眉文字`, '该部分每页顶部居中的标题', {
        validate: (v) => (v.trim() ? null : '不能为空'),
      })),
      num(['header', 'spacing_short'], '页眉字间距（≤3 字）', '单位 twips/20，默认 130', { min: 0, max: 400, step: 10, unit: '' }),
      num(['header', 'spacing_long'], '页眉字间距（>3 字）', '单位 twips/20，默认 90', { min: 0, max: 400, step: 10, unit: '' }),
      num(['header', 'rule_sz'], '页眉横线粗细', '单位 1/8 pt，8 = 1 pt', eighth),
      num(['header', 'rule_space'], '页眉横线与文字间距', '默认 6 pt', { min: 0, max: 31, step: 1, unit: 'pt' }),
      ...PART_LABELS.map(([k, label]) => text(['footer', 'codes', k], `${label} 编号`, '页脚左侧表格编号 100001–100005', {
        mono: true, keywords: '编码 100001 100002 100003 100004 100005',
        validate: (v) => (/^\d{6}$/.test(v.trim()) ? null : '应为 6 位数字'),
      })),
      text(['footer', 'year_text'], '页脚年份文字', '页脚右侧，与表格编号同行，默认 2023.03', { validate: (v) => (v.trim() ? null : '不能为空') }),
      num(['footer', 'rule_sz'], '页脚横线粗细', '单位 1/8 pt，8 = 1 pt', eighth),
      num(['footer', 'rule_space'], '页脚横线与文字间距', '默认 3 pt', { min: 0, max: 31, step: 1, unit: 'pt' }),
    ],
  },
  {
    id: 'figures', title: '附图', summary: '顺序 · 宽度 · 摘要图 → 附图书', open: true,
    items: [
      {
        kind: 'figures_book', id: 'figures_book', label: '附图顺序与宽度',
        desc: '真源是 docs/figures.md（W4-C）：图号按顺序生成，宽度单位 cm（页面可用宽度约 17 cm）；在「附图书」里拖排序、拖宽度手柄、设摘要图，或直接编辑该文件',
        keywords: 'fig 图 宽度 spec abstract 摘要附图 figures.md',
      },
    ],
  },
  {
    id: 'table', title: '表格', summary: '默认样式 · 线宽', open: false,
    items: [
      { kind: 'switch', id: 'table.defaults.三线', path: ['table', 'defaults', '三线'], label: '三线表', desc: 'content.md 未写明时的默认值' },
      { kind: 'switch', id: 'table.defaults.重复表头', path: ['table', 'defaults', '重复表头'], label: '跨页重复表头', desc: 'content.md 未写明时的默认值' },
      { kind: 'switch', id: 'table.defaults.段号居左', path: ['table', 'defaults', '段号居左'], label: '表格段号居左', desc: 'content.md 未写明时的默认值' },
      num(['table', 'cell_space_after'], '单元格段后', '默认 2 pt', pt),
      num(['table', 'rule_outer_sz'], '表外框线粗细', '三线表顶/底线，单位 1/8 pt', { ...eighth, min: 2 }),
      num(['table', 'rule_head_sz'], '表头线粗细', '三线表表头下线，单位 1/8 pt', { ...eighth, min: 2 }),
    ],
  },
  {
    id: 'advanced', title: '高级', summary: '摘要上限 · 下标例外 · 公式', open: false,
    items: [
      { kind: 'abstract_limit', id: 'abstract_limit', label: '摘要字数上限', desc: '超过则构建报错（含标点），默认 300', keywords: 'abstract limit 校验' },
      { kind: 'sub_except', id: 'sub_except', label: '下标解析例外 sub_except', desc: '含下划线但不应解析为下标的标识符（如 tsf_guard）', keywords: '下划线 subscript' },
      num(['equation', 'side_cm'], '公式左右留白', '公式表格两侧留白，默认 2.2 cm', { min: 0, max: 6, step: 0.1, unit: 'cm' }),
    ],
  },
]

export const ALL_ITEMS: Item[] = GROUPS.flatMap((g) => g.items)
/* ======================= 07 §2.1 设置面板：7 个逻辑页（SettingsNav） ======================= */
export type PageId = 'page' | 'fonts' | 'headerfooter' | 'figures' | 'lint' | 'build' | 'appearance' | 'templates' | 'integrations'

/** 由 UI/build store 读写的偏好项（不进 settings JSON；SettingsContent 里专用控件渲染） */
export interface PrefItem extends ItemBase {
  kind: 'pref'
  pref: 'auto_build' | 'debounce_ms' | 'zoom_default' | 'theme' | 'editor_font_size' | 'ui_density'
  /** 本轮无 store 字段：禁用并标「下一轮」 */
  pending?: boolean
}

export type RowItem = Item | PrefItem

/** 表单行：单项，或多项合成一行（页边距 2×2 网格） */
export interface Row {
  id: string
  label: string
  desc: string
  items: RowItem[]
  /** 合成行各项的前缀（左/上/右/下） */
  prefixes?: string[]
  keywords?: string
}

export interface Section {
  title?: string
  rows: Row[]
}

export interface Page {
  id: PageId
  title: string
  sections: Section[]
  /** 整页由专用组件渲染（R9 模板 / R7 集成），无 rows、不参与搜索与已改计数 */
  custom?: 'templates' | 'integrations'
}

const byId = (id: string): Item => ALL_ITEMS.find((it) => it.id === id)!
const single = (it: RowItem): Row => ({ id: it.id, label: it.label, desc: it.desc, items: [it], keywords: it.keywords })
const rows = (ids: string[]): Row[] => ids.map((id) => single(byId(id)))
const group = (gid: GroupId): Row[] => GROUPS.find((g) => g.id === gid)!.items.map(single)
const pref = (pref: PrefItem['pref'], label: string, desc: string, o: Partial<PrefItem> = {}): PrefItem => ({ kind: 'pref', id: `pref.${pref}`, pref, label, desc, ...o })

const MARGIN_IDS = ['page.margin_left_mm', 'page.margin_top_mm', 'page.margin_right_mm', 'page.margin_bottom_mm']

export const PAGES: Page[] = [
  {
    id: 'page', title: '页面与边距',
    sections: [
      {
        rows: [
          { id: 'page.margins', label: '页边距（mm）', desc: 'CNIPA 规定：左 25 / 上 25 / 右 15 / 下 15。改动会影响分页与页数。', items: MARGIN_IDS.map(byId), prefixes: ['左', '上', '右', '下'], keywords: 'margin 页边距' },
          ...rows(['page.width_cm', 'page.height_cm', 'page.header_distance_cm', 'page.footer_distance_cm']),
        ],
      },
      { title: '段落与行距', rows: group('paragraph') },
      { title: '公式', rows: rows(['equation.side_cm']) },
    ],
  },
  { id: 'fonts', title: '字体与字号', sections: [{ rows: group('fonts') }] },
  { id: 'headerfooter', title: '页眉与页脚', sections: [{ rows: group('headerfooter') }] },
  {
    id: 'figures', title: '附图与表格',
    sections: [{ title: '附图', rows: group('figures') }, { title: '表格', rows: group('table') }],
  },
  { id: 'lint', title: '校验规则', sections: [{ rows: rows(['abstract_limit', 'sub_except']) }] },
  {
    id: 'build', title: '构建与预览',
    sections: [{
      rows: [
        single(pref('auto_build', '自动构建', '编辑停止后自动重新生成 DOCX → PDF；关闭后需手动点「构建」。', { keywords: 'auto build 重建' })),
        single(pref('debounce_ms', '构建防抖', '停止输入多少毫秒后触发自动构建（默认 400 ms）。', { keywords: 'debounce 延迟' })),
        single(pref('zoom_default', '预览缩放默认', 'PDF 打开时的缩放方式：适宽 / 适页 / 100%。', { keywords: 'zoom 缩放 预览' })),
      ],
    }],
  },
  {
    id: 'appearance', title: '外观',
    sections: [{
      rows: [
        single(pref('theme', '主题', '浅色 / 深色 / 跟随系统；仅影响界面，不影响 PDF。', { keywords: 'theme dark light 深色 浅色' })),
        single(pref('editor_font_size', '编辑器字号', 'Markdown 编辑器文字大小（默认 12 px）；仅影响编辑器，不影响 PDF。', { keywords: 'editor font size 字号' })),
        single(pref('ui_density', 'UI 密度', '紧凑 / 舒适：影响列表行高与面板内边距，不影响 PDF。', { keywords: 'density 紧凑 舒适' })),
      ],
    }],
  },
  { id: 'templates', title: '模板', sections: [], custom: 'templates' },
  { id: 'integrations', title: '集成', sections: [], custom: 'integrations' },
]

export const ALL_ROWS: Row[] = PAGES.flatMap((p) => p.sections.flatMap((s) => s.rows))
/** item.id → 所在行 id（合成行内的项跳转到合成行） */
export const ROW_OF: Record<string, string> = Object.fromEntries(ALL_ROWS.flatMap((r) => r.items.map((it) => [it.id, r.id])))
export const PAGE_OF_ROW: Record<string, PageId> = Object.fromEntries(PAGES.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => [r.id, p.id]))))

export function isPrefItem(it: RowItem): it is PrefItem {
  return it.kind === 'pref'
}

/** 行匹配：行标签 / 说明 / 关键词，或行内任一项匹配 */
export function matchRow(r: Row, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return [r.label, r.desc, r.id, r.keywords ?? ''].some((t) => t.toLowerCase().includes(s)) || r.items.some((it) => matchItem(it, q))
}

export function isStyleItem(it: Item): it is StyleItem {
  return it.kind === 'number' || it.kind === 'text' || it.kind === 'switch'
}

/** 匹配搜索词：标签 / 说明 / id / 关键词 */
export function matchItem(it: RowItem, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return [it.label, it.desc, it.id, it.keywords ?? ''].some((t) => t.toLowerCase().includes(s))
}

export interface ChangedEntry {
  item: Item
  value: string
  defaultValue: string
}

const fmt = (v: unknown) => (typeof v === 'boolean' ? (v ? '开' : '关') : Array.isArray(v) ? v.join(', ') : String(v ?? ''))

/** 已修改项列表（style 项按叶子与默认比较；abstract_limit / sub_except 与默认设置比较；附图选择无默认，不计） */
export function listChanged(defaults: Style, settings: Settings, defaultSettings: Settings | null): ChangedEntry[] {
  const eff = mergeStyle(defaults, settings.style)
  const out: ChangedEntry[] = []
  for (const it of ALL_ITEMS) {
    if (isStyleItem(it)) {
      const v = getPath(eff, it.path)
      const d = getPath(defaults, it.path)
      if (JSON.stringify(v) !== JSON.stringify(d)) out.push({ item: it, value: fmt(v), defaultValue: fmt(d) })
    } else if (it.kind === 'abstract_limit') {
      const d = defaultSettings?.abstract_limit ?? 300
      if (settings.abstract_limit !== d) out.push({ item: it, value: String(settings.abstract_limit), defaultValue: String(d) })
    } else if (it.kind === 'sub_except') {
      const d = defaultSettings?.sub_except ?? ['tsf_guard', 'on_matured']
      if (JSON.stringify([...settings.sub_except].sort()) !== JSON.stringify([...d].sort())) out.push({ item: it, value: fmt(settings.sub_except), defaultValue: fmt(d) })
    }
  }
  return out
}
