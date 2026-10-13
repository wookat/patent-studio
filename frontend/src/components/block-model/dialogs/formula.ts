/**
 * 公式对话框的纯函数：内核独立成行公式语法 `$$源码$$ 标号`（标号可选，与 serialize_block 的 equation 分支一致）。
 * 线性语法见 backend/patent_docx/omml.py 模块注释：a/b 分式、Σ_{…} 求和、√x 根式、_x 下标、( ) [ ] { } 定界符。
 */
export const formulaMarkdown = (source: string, label: string | null = null) =>
  `$$${source.trim()}$$` + (label ? ` ${label}` : '')

export interface SymbolItem {
  /** 插入到光标处的文本 */
  insert: string
  /** 按钮显示；缺省 = insert */
  label?: string
  /** 无障碍名称 / title */
  name: string
  /** 插入后光标相对 insert 起点的偏移（缺省放到末尾） */
  cursor?: number
}

export interface SymbolGroup {
  title: string
  items: SymbolItem[]
}

const greek = (pairs: [string, string][]): SymbolItem[] => pairs.map(([ch, name]) => ({ insert: ch, name }))

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    title: '结构',
    items: [
      { insert: '()/()', label: 'a/b', name: '分式', cursor: 1 },
      { insert: '√()', label: '√x', name: '根式', cursor: 2 },
      { insert: 'Σ_{}', label: 'Σ', name: '求和（下限）', cursor: 3 },
      { insert: '_{}', label: 'x_i', name: '下标', cursor: 2 },
      { insert: '()', label: '( )', name: '圆括号', cursor: 1 },
      { insert: '[]', label: '[ ]', name: '方括号', cursor: 1 },
      { insert: '{}', label: '{ }', name: '花括号', cursor: 1 },
    ],
  },
  {
    title: '运算',
    items: greek([
      ['·', '点乘'],
      ['×', '乘号'],
      ['±', '正负号'],
      ['−', '减号'],
      ['÷', '除号'],
      ['=', '等于'],
      ['≠', '不等于'],
      ['≈', '约等于'],
      ['≤', '小于等于'],
      ['≥', '大于等于'],
      ['→', '右箭头'],
      ['∈', '属于'],
      ['∞', '无穷'],
      ['∂', '偏导'],
      ['∇', '梯度'],
      ['⊙', '逐元素乘'],
      ['∣', '竖线'],
    ]),
  },
  {
    title: '希腊字母',
    items: greek([
      ['α', 'alpha'],
      ['β', 'beta'],
      ['γ', 'gamma'],
      ['δ', 'delta'],
      ['ε', 'epsilon'],
      ['θ', 'theta'],
      ['λ', 'lambda'],
      ['μ', 'mu'],
      ['π', 'pi'],
      ['ρ', 'rho'],
      ['σ', 'sigma'],
      ['τ', 'tau'],
      ['φ', 'phi'],
      ['ω', 'omega'],
      ['Δ', 'Delta'],
      ['Σ', 'Sigma'],
      ['Ω', 'Omega'],
    ]),
  },
]

/** 在 [start, end) 选区处插入符号，返回新文本与新光标位置 */
export function insertAt(text: string, start: number, end: number, item: SymbolItem): { text: string; cursor: number } {
  const next = text.slice(0, start) + item.insert + text.slice(end)
  return { text: next, cursor: start + (item.cursor ?? item.insert.length) }
}
