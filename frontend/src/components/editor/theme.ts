import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'

/**
 * Markdown 语法着色全部走设计 token（07 §2 / prototype-c `--cm-*`），浅/深色由 `.dark` 下的变量切换。
 * 标题：加粗、前景色、不放大（与原型 `.ln .h` 一致，行高恒定 19.2px）。
 */
export const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', color: 'var(--color-fg)' },
  { tag: tags.heading2, fontWeight: '700', color: 'var(--color-fg)' },
  { tag: tags.heading3, fontWeight: '700', color: 'var(--color-fg)' },
  { tag: tags.heading4, fontWeight: '700', color: 'var(--color-fg)' },
  { tag: tags.heading, fontWeight: '700', color: 'var(--color-fg)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.monospace, color: 'var(--color-ok-fg)' },
  { tag: tags.processingInstruction, color: 'var(--color-fg-muted)' },
  { tag: tags.quote, color: 'var(--color-fg-muted)' },
  { tag: tags.link, textDecoration: 'underline' },
])

/**
 * 专利 Markdown 专有着色（lang-markdown 不认识的部分），只装饰可视区：
 *  - `$$…$$` 独立公式行（含尾随「（N）」编号）→ cm-patent-math（原型 --cm-math 琥珀）
 *  - 行首权项号 `N.` → cm-patent-claim-num（原型 --cm-kw 蓝）
 *  - `权利要求N[至M]` 引用 → cm-patent-claim-ref（蓝 + 点线下划线）
 */
const PATENT_RE =
  /(^\$\$.*\$\$\s*(?:[（(]\d+[)）])?\s*$)|(^\d+\s*[.．、])|(权利要求\s*\d+(?:\s*(?:至|到|~|～|-|–|—)\s*\d+)?(?:\s*(?:或|和|及|与|、|,|，)\s*\d+)*)/g
const mathMark = Decoration.mark({ class: 'cm-patent-math' })
const claimNumMark = Decoration.mark({ class: 'cm-patent-claim-num' })
const claimRefMark = Decoration.mark({ class: 'cm-patent-claim-ref' })
const patentMatcher = new MatchDecorator({
  regexp: PATENT_RE,
  decoration: (m) => (m[1] ? mathMark : m[2] ? claimNumMark : claimRefMark),
})

export const patentSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = patentMatcher.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = patentMatcher.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

/**
 * 编辑器铬件（背景、gutter、选区、面板）— 同一份 token 主题，dark 标志只影响 CodeMirror 内建的 &dark 样式。
 * 尺寸对照 prototype-c `.cm/.ln`：12px / 19.2px（index.css --editor-*）、gutter ≈ 50px = 诊断列 14 + 行号列 36（22 最小宽 + 4/10 内边距）、
 * 活动行 --muted（浅 #f4f5f6 / 深 #2f3a4c）、行号 --muted-foreground（浅 n7 / 深 n4，对 card 底 ≥4.5:1）。
 */
export function chromeTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': { backgroundColor: 'var(--color-panel)', color: 'var(--color-fg)' },
      '.cm-content': { caretColor: 'var(--color-fg)', padding: '4px 0 12px' },
      '.cm-line': { padding: '0 12px 0 6px' },
      '.cm-gutters': {
        backgroundColor: 'var(--color-panel)',
        color: 'var(--color-fg-muted)',
        border: 'none',
        fontSize: 'var(--editor-font-size)',
      },
      '.cm-lineNumbers .cm-gutterElement': { minWidth: '22px', padding: '0 10px 0 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
      // 触控（06 §3）：行号栏左内边距与行号→正文间距 12（--gap-card-m），正文右侧留页边 16；桌面不受影响
      ':where([data-density=touch]) & .cm-lineNumbers .cm-gutterElement': { padding: '0 var(--gap-card-m)' },
      ':where([data-density=touch]) & .cm-line': { padding: '0 var(--pad-page-m) 0 var(--gap-card-m)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--color-sunken)' },
      '.cm-activeLine': { backgroundColor: 'var(--color-sunken)' },
      '.cm-patent-math': { color: 'var(--color-warn-fg)' },
      '.cm-patent-claim-num': { color: 'var(--color-info-fg)', fontWeight: '600' },
      '.cm-patent-claim-ref': {
        color: 'var(--color-info-fg)',
        textDecorationLine: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: '3px',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in oklch, var(--color-primary) 22%, transparent) !important',
      },
      '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklch, var(--color-primary) 14%, transparent)' },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'color-mix(in oklch, var(--color-primary) 20%, transparent)',
        outline: '1px solid color-mix(in oklch, var(--color-primary) 40%, transparent)',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-fg)' },
      '.cm-panels': { backgroundColor: 'var(--color-app)', color: 'var(--color-fg)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--color-border)' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-border)' },
      '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--color-warn-dot) 45%, transparent)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, var(--color-warn-dot) 80%, transparent)' },
      '.cm-textfield': {
        backgroundColor: 'var(--color-panel)',
        color: 'var(--color-fg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
      },
      '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--color-panel)',
        color: 'var(--color-fg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
      },
      '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--color-hover)' },
      '.cm-panel.cm-search': { fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-sm)', padding: '6px 8px' },
      '.cm-panel.cm-search input, .cm-panel.cm-search button': { margin: '2px 4px 2px 0' },
      '.cm-panel.cm-search label': { fontSize: 'var(--fs-xs)' },
      '.cm-panel.cm-search [name=close]': { color: 'var(--color-fg-muted)' },
      '.cm-placeholder': {
        color: 'var(--color-fg-muted)',
        fontFamily: 'var(--font-ui)',
        pointerEvents: 'none',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--color-elevated)',
        color: 'var(--color-fg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
      },
    },
    { dark },
  )
}

/** 语法着色：token 版 markdown 样式 + 专利专有着色 + 内建兜底（深色用 oneDark 的调色） */
export function syntaxTheme(dark: boolean): Extension {
  return [
    syntaxHighlighting(mdHighlight),
    patentSyntax,
    syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true }),
  ]
}

/** 查找/替换面板中文化 */
export const zhPhrases: Record<string, string> = {
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全选',
  'match case': '区分大小写',
  'by word': '全词匹配',
  regexp: '正则',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'Go to line': '跳转到行',
  go: '跳转',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'on line': '在行',
  // 折叠槽 / 折叠占位（gutter title、占位 aria-label/title、折叠命令的 announce）
  'Fold line': '折叠本节',
  'Unfold line': '展开本节',
  'folded code': '已折叠的代码',
  unfold: '展开',
  'Folded lines': '已折叠行',
  'Unfolded lines': '已展开行',
  to: '至',
  // 其余可触达的屏读/提示文案
  'Control character': '控制字符',
  'Selection deleted': '已删除所选',
  Completions: '补全项',
}
