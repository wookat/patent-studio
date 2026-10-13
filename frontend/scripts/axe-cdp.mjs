#!/usr/bin/env node
/**
 * axe-cdp：同 shot-cdp 参数，在每个 路由 × 视口 × 主题 页面注入 axe-core 并运行 → frontend/shots/axe.json。
 * serious / critical 违规总数 > 0 → 退出码 1；moderate / minor 只打印。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES, VIEWPORTS, connectBrowser, evaluate, navigate, openPage, parseArgs, resolvePid, setTheme, setViewport } from './cdp-lib.mjs'

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const opts = parseArgs(process.argv.slice(2))
const outDir = resolve(opts.out ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'shots'))
mkdirSync(outDir, { recursive: true })

const pid = await resolvePid(opts)
const routes = ROUTES.filter((r) => !opts.routes || opts.routes.includes(r.name)).filter((r) => pid || !r.hash.includes('{pid}'))

const browser = await connectBrowser()
const results = []
let serious = 0
try {
  for (const route of routes) {
    for (const vpName of opts.viewports) {
      const vp = VIEWPORTS[vpName]
      for (const theme of opts.themes) {
        const page = await openPage(browser)
        try {
          await setViewport(page, vp)
          await setTheme(page, theme)
          const url = `${opts.base.replace(/\/$/, '')}/${route.hash.replace('{pid}', pid ?? '')}`
          await navigate(page, url)
          await page.send('Runtime.evaluate', { expression: axeSource })
          const r = await evaluate(page, `axe.run(document, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: true } } }).then(r => ({ violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map(n => n.target.join(' ')) })) }))`)
          const sc = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
          serious += sc.length
          results.push({ route: route.name, viewport: vpName, theme, url, violations: r.violations })
          console.log(`${sc.length ? '✗' : '✓'} ${route.name.padEnd(10)} ${vpName.padEnd(7)} ${theme.padEnd(5)}  violations=${r.violations.length} serious/critical=${sc.length}`)
          for (const v of sc) console.log(`    - [${v.impact}] ${v.id}: ${v.help} @ ${v.nodes[0] ?? ''}`)
        } finally {
          await page.closeTarget()
        }
      }
    }
  }
} finally {
  browser.close()
}
writeFileSync(resolve(outDir, 'axe.json'), JSON.stringify(results, null, 2))
if (serious > 0) {
  console.error(`\naxe: ${serious} 处 serious/critical 违规，详见 shots/axe.json`)
  process.exit(1)
}
