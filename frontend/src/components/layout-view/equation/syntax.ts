/**
 * 公式源码的前端校验 / 辅助（16 §6）。权威解析只有后端 omml.py；这里只做「提交前就能发现」的检查：
 * 会破坏 `$$…$$ 标号` 行结构的是错误（阻止提交），omml.py 子集之外的写法是提醒（可提交，预览会显示后端结果）。
 */
export interface EquationIssue {
  level: 'error' | 'warn'
  message: string
}

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSE = new Set(Object.values(OPEN))
/** omml.py _SUB_RE：_x / _{…} / _[…] / _检索 等 */
const SUB_RE = /_(\{[^}]+\}|\[[^\]]+\]|检索|基线|锚|修|[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)/y

export function lintEquation(source: string): EquationIssue[] {
  const out: EquationIssue[] = []
  const s = source.trim()
  if (!s) return out
  if (/\r|\n/.test(s)) out.push({ level: 'error', message: '公式必须单行（$$…$$ 独立成行）' })
  if (s.includes('$$')) out.push({ level: 'error', message: '源码不能含 $$' })

  const stack: string[] = []
  let unbalanced = false
  for (const ch of s) {
    if (ch in OPEN) stack.push(OPEN[ch])
    else if (CLOSE.has(ch)) {
      if (stack.pop() !== ch) unbalanced = true
    }
  }
  if (unbalanced || stack.length) out.push({ level: 'warn', message: '括号不配对：( ) [ ] { } 需成对' })

  if (/\\[A-Za-z]+/.test(s)) out.push({ level: 'warn', message: '内核是线性语法，不支持 LaTeX 命令（可用「转为线性」）' })
  if (/\^/.test(s)) out.push({ level: 'warn', message: '不支持上标 ^（内核只做下标 _）' })
  if (/(^|\()\s*\/|\/\s*(\)|$)/.test(s)) out.push({ level: 'warn', message: '分式 / 两侧需有内容，如 a/b 或 (a+b)/(c)' })
  if (/√\s*$/.test(s)) out.push({ level: 'warn', message: '根式 √ 后需有内容，如 √x 或 √(a+b)' })

  for (let i = s.indexOf('_'); i >= 0; i = s.indexOf('_', i + 1)) {
    SUB_RE.lastIndex = i
    if (!SUB_RE.exec(s)) {
      out.push({ level: 'warn', message: '下标 _ 后需紧跟字母数字或 {…}，如 x_t、Σ_{i∈S}' })
      break
    }
  }
  return out
}

export const hasErrors = (issues: EquationIssue[]) => issues.some((i) => i.level === 'error')

const LATEX_SYMBOLS: [RegExp, string][] = [
  [/\\cdot(?![A-Za-z])/g, '·'],
  [/\\times(?![A-Za-z])/g, '×'],
  [/\\pm(?![A-Za-z])/g, '±'],
  [/\\div(?![A-Za-z])/g, '÷'],
  [/\\neq?(?![A-Za-z])/g, '≠'],
  [/\\approx(?![A-Za-z])/g, '≈'],
  [/\\leq?(?![A-Za-z])/g, '≤'],
  [/\\geq?(?![A-Za-z])/g, '≥'],
  [/\\(?:to|rightarrow)(?![A-Za-z])/g, '→'],
  [/\\in(?![A-Za-z])/g, '∈'],
  [/\\infty(?![A-Za-z])/g, '∞'],
  [/\\partial(?![A-Za-z])/g, '∂'],
  [/\\nabla(?![A-Za-z])/g, '∇'],
  [/\\odot(?![A-Za-z])/g, '⊙'],
  [/\\mid(?![A-Za-z])/g, '∣'],
  [/\\alpha(?![A-Za-z])/g, 'α'],
  [/\\beta(?![A-Za-z])/g, 'β'],
  [/\\gamma(?![A-Za-z])/g, 'γ'],
  [/\\delta(?![A-Za-z])/g, 'δ'],
  [/\\epsilon(?![A-Za-z])/g, 'ε'],
  [/\\theta(?![A-Za-z])/g, 'θ'],
  [/\\lambda(?![A-Za-z])/g, 'λ'],
  [/\\mu(?![A-Za-z])/g, 'μ'],
  [/\\pi(?![A-Za-z])/g, 'π'],
  [/\\rho(?![A-Za-z])/g, 'ρ'],
  [/\\sigma(?![A-Za-z])/g, 'σ'],
  [/\\tau(?![A-Za-z])/g, 'τ'],
  [/\\phi(?![A-Za-z])/g, 'φ'],
  [/\\omega(?![A-Za-z])/g, 'ω'],
  [/\\Delta(?![A-Za-z])/g, 'Δ'],
  [/\\Sigma(?![A-Za-z])/g, 'Σ'],
  [/\\Omega(?![A-Za-z])/g, 'Ω'],
  [/\\sum(?![A-Za-z])/g, 'Σ'],
  [/\\left|\\right/g, ''],
  [/\\[,;!: ]/g, ' '],
]

/** 读取从 `{` 开始的平衡组，返回 [内容, 结束下标(含 })]；不平衡 → null */
function group(s: string, at: number): [string, number] | null {
  if (s[at] !== '{') return null
  let depth = 0
  for (let i = at; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return [s.slice(at + 1, i), i]
  }
  return null
}

/** 常见 LaTeX → 内核线性语法（best-effort 文本替换，非解析器；结果交给后端预览验证） */
export function fromLatex(latex: string): string {
  let s = latex.trim()
  for (let guard = 0; guard < 50; guard++) {
    const m = /\\(frac|sqrt)\s*/.exec(s)
    if (!m) break
    const a = group(s, m.index + m[0].length)
    if (!a) break
    if (m[1] === 'sqrt') {
      s = s.slice(0, m.index) + `√(${fromLatex(a[0])})` + s.slice(a[1] + 1)
      continue
    }
    const b = group(s, a[1] + 1)
    if (!b) break
    s = s.slice(0, m.index) + `(${fromLatex(a[0])})/(${fromLatex(b[0])})` + s.slice(b[1] + 1)
  }
  for (const [re, to] of LATEX_SYMBOLS) s = s.replace(re, to)
  return s.replace(/\s{2,}/g, ' ').trim()
}

export const looksLikeLatex = (source: string) => /\\[A-Za-z]+/.test(source)
