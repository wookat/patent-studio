import { useEffect, useState, type CSSProperties } from 'react'
import { api } from '@/lib/api'
import type { StyleOverride } from '@/lib/types'
import { useStudio } from '@/store'

/**
 * GET /api/projects/{pid}/style.css（D1）→ 注入 <style> 的文本；null = 用 layout-view.css 里的默认变量。
 * 重取时机：pid / styleCssVersion（layoutView slice，保存设置后 +1）/ 一次成功构建（排版参数已落盘 → PDF 与版面同步换样式）。
 * 501（D1 未实现）与其它失败一律回退默认，不打扰用户；切换 pid 时上一案的 CSS 不串用。
 */
export function useStyleCss(pid: string | null): string | null {
  const version = useStudio((s) => s.styleCssVersion)
  const lastOk = useStudio((s) => s.lastOk)
  const [got, setGot] = useState<{ pid: string; css: string | null }>({ pid: '', css: null })
  useEffect(() => {
    if (!pid) return
    const ac = new AbortController()
    api
      .styleCss(pid, ac.signal)
      .then((css) => setGot({ pid, css }))
      .catch(() => {
        if (!ac.signal.aborted) setGot({ pid, css: null })
      })
    return () => ac.abort()
  }, [pid, version, lastOk])
  return pid && got.pid === pid ? got.css : null
}

/** settings.style 叶子 → CSS 变量（与 style_css.STYLE_CSS_VARS 同名同单位，只列版面视图会用到的） */
const VARS: readonly [group: keyof StyleOverride & string, key: string, cssVar: string, unit: '' | 'pt' | 'cm' | 'mm'][] = [
  ['fonts', 'body_cjk', '--ps-font-body-cjk', ''],
  ['fonts', 'ascii', '--ps-font-body-ascii', ''],
  ['fonts', 'heading_cjk', '--ps-font-heading-cjk', ''],
  ['fonts', 'label_ascii', '--ps-font-heading-ascii', ''],
  ['fonts', 'mono', '--ps-font-mono', ''],
  ['sizes', 'body', '--ps-size-body', 'pt'],
  ['sizes', 'title', '--ps-size-title', 'pt'],
  ['sizes', 'section_heading', '--ps-size-h1', 'pt'],
  ['sizes', 'subsection_heading', '--ps-size-h2', 'pt'],
  ['sizes', 'header', '--ps-size-header', 'pt'],
  ['sizes', 'para_number', '--ps-size-para-no', 'pt'],
  ['sizes', 'table', '--ps-size-table', 'pt'],
  ['sizes', 'equation', '--ps-size-eq', 'pt'],
  ['sizes', 'code', '--ps-size-code', 'pt'],
  ['paragraph', 'line_spacing', '--ps-line-height', ''],
  ['paragraph', 'first_indent_pt', '--ps-first-indent', 'pt'],
  ['page', 'width_cm', '--ps-page-w', 'cm'],
  ['page', 'height_cm', '--ps-page-h', 'cm'],
  ['page', 'margin_top_mm', '--ps-margin-t', 'mm'],
  ['page', 'margin_bottom_mm', '--ps-margin-b', 'mm'],
  ['page', 'margin_left_mm', '--ps-margin-l', 'mm'],
  ['page', 'margin_right_mm', '--ps-margin-r', 'mm'],
  ['page', 'header_distance_cm', '--ps-header-distance', 'cm'],
]

/**
 * 客端未保存的 settings.style 覆盖 → 内联 CSS 变量（只含被覆盖的叶子），叠在 style.css / 默认值之上：
 * 设置面板改字号 → 纸面立刻变，不等保存 + 重取 style.css。字体名加引号；数值带单位。
 */
export function styleVars(style: StyleOverride | undefined): CSSProperties {
  const out: Record<string, string> = {}
  if (!style) return out
  for (const [group, key, cssVar, unit] of VARS) {
    const g = style[group]
    if (!g || typeof g !== 'object') continue
    const v = (g as Record<string, unknown>)[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[cssVar] = `${v}${unit}`
    else if (typeof v === 'string' && v) out[cssVar] = unit ? v : `'${v.replace(/'/g, '')}'`
  }
  return out
}
