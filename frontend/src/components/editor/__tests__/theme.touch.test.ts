// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { chromeTheme } from '../theme'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
  document.body.replaceChildren()
})

function injectedCss() {
  return [...document.head.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n')
}

describe('chromeTheme 触控密度（06 §2 源码视图）', () => {
  it('桌面规则不变：.cm-line 0 12px 0 6px、行号 0 10px 0 4px；触控下 gutter 12 / 正文左 12 右 16 由 [data-density=touch] 祖先限定', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    view = new EditorView({ state: EditorState.create({ doc: 'a\nb', extensions: [lineNumbers(), chromeTheme(false)] }), parent })
    const css = injectedCss()
    // 主题 scope 类 = view.dom 上那枚出现在「.cm-patent-math」规则里的 ͼ 类（ͼ1 是 CodeMirror 基础样式）
    const scope = view.dom.className.split(' ').find((c) => /^ͼ/.test(c) && css.includes(`.${c} .cm-patent-math`))!
    expect(scope).toBeTruthy()

    // 桌面（无 touch 祖先）——原值原样存在，未被覆盖
    expect(css).toMatch(new RegExp(`\\.${scope} \\.cm-line \\{[^}]*padding: 0 12px 0 6px`))
    expect(css).toMatch(new RegExp(`\\.${scope} \\.cm-lineNumbers \\.cm-gutterElement \\{[^}]*padding: 0 10px 0 4px`))

    // 触控——规则以 :where([data-density=touch]) 为前缀，只有移动壳（MobileShell / Sheet 注入）下生效
    const touchGutter = css.match(new RegExp(`:where\\(\\[data-density=touch\\]\\) \\.${scope} \\.cm-lineNumbers \\.cm-gutterElement \\{[^}]*\\}`))?.[0] ?? ''
    expect(touchGutter).toContain('padding: 0 var(--gap-card-m)')
    const touchLine = css.match(new RegExp(`:where\\(\\[data-density=touch\\]\\) \\.${scope} \\.cm-line \\{[^}]*\\}`))?.[0] ?? ''
    expect(touchLine).toContain('padding: 0 var(--pad-page-m) 0 var(--gap-card-m)')
    // 触控规则排在桌面规则之后（同特异性，后者胜出）
    expect(css.indexOf(touchLine)).toBeGreaterThan(css.indexOf('padding: 0 12px 0 6px'))
  })
})
