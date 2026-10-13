import { useMemo } from 'react'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify, { type Config as PurifyConfig } from 'dompurify'
import hljs from 'highlight.js/lib/core'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import 'katex/dist/katex.min.css'

/* 语言子集控体积——未注册的围栏语言降级 plaintext；token 色走 index.css 自绘 hljs-* → 深浅主题自动跟随 */
const LANGS = { plaintext, python, javascript, typescript, json, bash, xml, css, yaml, sql, java, c, cpp }
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mjs: 'javascript',
  py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', html: 'xml', vue: 'xml',
  'c++': 'cpp', 'c#': 'cpp', golang: 'bash', kotlin: 'java', text: 'plaintext', '': 'plaintext',
}

marked.use(markedKatex({ throwOnError: false, nonStandard: false }))
marked.setOptions({ gfm: true, breaks: true })
marked.use({
  renderer: {
    code({ text, lang }) {
      const l = LANG_ALIAS[(lang ?? '').toLowerCase()] ?? (lang && hljs.getLanguage(lang) ? lang : 'plaintext')
      const html = l === 'plaintext' ? escapeHtml(text) : hljs.highlight(text, { language: l, ignoreIllegals: true }).value
      return `<pre><code class="hljs language-${l}">${html}</code></pre>`
    },
  },
})

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* 渲染的是模型输出——外部图片会变成追踪 beacon、表单/iframe 纯属越权面；链接新页签隔离。
   input 放行但 hook 强制收敛为 disabled checkbox：GFM `- [x]` 任务清单的框由此存活，别种 input 不得存活 */
const PURIFY = {
  FORBID_TAGS: ['img', 'style', 'form', 'select', 'textarea', 'iframe', 'object', 'embed', 'video', 'audio', 'button'],
} satisfies PurifyConfig

let hooked = false
function ensureHook() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
    if (node.tagName === 'INPUT') {
      const t = node.getAttribute('type')
      if (t !== 'checkbox') node.remove()
      else {
        node.setAttribute('disabled', '')
        for (const a of Array.from(node.attributes)) {
          if (!['type', 'checked', 'disabled'].includes(a.name)) node.removeAttribute(a.name)
        }
      }
    }
  })
}

/** assistant 消息 markdown 渲染：marked(+GFM/KaTeX/hljs) → DOMPurify → .ai-md（index.css 排版） */
export function Markdown({ text }: { text: string }) {
  ensureHook()
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false }) as string
    return DOMPurify.sanitize(raw, PURIFY)
  }, [text])
  return <div className="ai-md" dangerouslySetInnerHTML={{ __html: html }} />
}
