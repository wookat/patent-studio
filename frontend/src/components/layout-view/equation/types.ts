/**
 * 公式编辑器契约（D2，16 §6）：源文本框 + 符号面板（block-model/dialogs/FormulaDialog 的 SYMBOL_GROUPS）+ 后端 MathML 预览（api.mathml）。
 * 引擎 = 后端 omml.to_mathml（与 DOCX 同一 tokenizer）；不引 MathLive / KaTeX；语法子集 = `x_t` `a/b` `√x` `Σ_{…}`。
 * 提交 = serialize.equationLine(source, label) → POST /blocks/{id}。
 */
export interface EquationEditorProps {
  open: boolean
  /** 线性源（`$$` 之间）与编号原文（`（1）`，可空） */
  initial: { source: string; label: string }
  /** 桌面 popover 锚点元素；375 用底部 sheet，忽略 */
  anchor: HTMLElement | null
  variant: 'popover' | 'sheet'
  /** 返回 true 才关编辑器；false = 写回失败（块被改/离线），保持打开留内容 */
  onSubmit(next: { source: string; label: string }): boolean | Promise<boolean>
  onClose(): void
  /** 脏态上报（宿主守卫宿主驱动的换目标/卸载，批68） */
  onDirty?(dirty: boolean): void
}

/** 面板顶部语法帮助——只列 omml.py 支持的写法 */
export const EQUATION_SYNTAX_HELP = ['x_t 下标', 'a/b 分式', '√x 根式', 'Σ_{i∈S} 求和', '( ) [ ] { } 定界符'] as const
