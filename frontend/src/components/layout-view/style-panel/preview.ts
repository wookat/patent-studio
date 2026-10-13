import type { Style } from '@/lib/types'
import { headingVars, type HeadingsStyle } from '@/store/styleEdit'

export const HEADING_VAR_NAMES = ['--ps-h3-font', '--ps-h3-size', '--ps-h3-weight', '--ps-h3-align', '--ps-h3-numbering', '--ps-h4-font', '--ps-h4-size', '--ps-h4-weight', '--ps-h4-align', '--ps-h4-numbering'] as const

/**
 * 实时预览：把 --ps-h3-* / --ps-h4-* 内联到各 .ps-layout（与后端 style.css 变量块 `:root,.ps-layout{}` 同选择器，内联优先），
 * 并给其中 .ps-paper 设 data-h3-numbering / data-h4-numbering（style-panel.css 计数器编号）。headings=null 清除内联变量，
 * 编号恢复为 Paper 按已保存 settings 渲染的 data-*-numbering-base。返回清理函数。
 */
export function applyPreview(roots: HTMLElement[], headings: HeadingsStyle | null, eff: Style | null): () => void {
  const vars = headings && eff ? headingVars(headings, eff) : {}
  for (const root of roots) {
    for (const n of HEADING_VAR_NAMES) {
      const v = vars[n]
      if (v === undefined) root.style.removeProperty(n)
      else root.style.setProperty(n, v)
    }
    for (const paper of root.querySelectorAll<HTMLElement>('.ps-paper')) {
      if (headings) {
        paper.dataset.h3Numbering = headings.section.numbering
        paper.dataset.h4Numbering = headings.subsection.numbering
      } else {
        for (const k of ['h3Numbering', 'h4Numbering'] as const) {
          const base = paper.dataset[`${k}Base`]
          if (base === undefined) delete paper.dataset[k]
          else paper.dataset[k] = base
        }
      }
    }
  }
  return () => applyPreview(roots, null, null)
}

export const defaultPreviewRoots = () => Array.from(document.querySelectorAll<HTMLElement>('.ps-layout'))
