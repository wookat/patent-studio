#!/usr/bin/env node
/**
 * shot-cdp：路由 × 视口(1440/375) × 主题(light/dark) → PNG（frontend/shots/<route>-<vp>-<theme>.png）+ console.json（每页 error/warning）。
 * 用法：make dev 已起后 `node scripts/shot-cdp.mjs [--routes home,workbench,ds] [--viewports desktop,mobile] [--themes light,dark] [--pid <id>] [--out shots]`
 * 退出码：任何页面有 console error / 未捕获异常 → 1（截图仍会写出）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES, VIEWPORTS, connectBrowser, evaluate, navigate, openPage, parseArgs, resolvePid, setTheme, setViewport } from './cdp-lib.mjs'

const opts = parseArgs(process.argv.slice(2))
const outDir = resolve(opts.out ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'shots'))
mkdirSync(outDir, { recursive: true })

const pid = await resolvePid(opts)
const routes = ROUTES.filter((r) => !opts.routes || opts.routes.includes(r.name)).filter((r) => pid || !r.hash.includes('{pid}'))
if (!pid) console.warn('未能解析案卷 id（--pid / STUDIO_PID / GET /api/projects），跳过 workbench / deliver')

const browser = await connectBrowser()
const report = []
let failed = false
try {
  for (const route of routes) {
    for (const vpName of opts.viewports) {
      const vp = VIEWPORTS[vpName]
      if (!vp) throw new Error(`未知视口 ${vpName}`)
      for (const theme of opts.themes) {
        const page = await openPage(browser)
        try {
          await setViewport(page, vp)
          await setTheme(page, theme)
          const url = `${opts.base.replace(/\/$/, '')}/${route.hash.replace('{pid}', pid ?? '')}`
          await navigate(page, url)
          const title = await evaluate(page, 'document.title')
          const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
          const file = resolve(outDir, `${route.name}-${vpName}-${theme}.png`)
          writeFileSync(file, Buffer.from(shot.data, 'base64'))
          const errors = page.console.filter((c) => c.level !== 'warning')
          if (errors.length) failed = true
          report.push({ route: route.name, viewport: vpName, theme, url, title, file, console: page.console })
          console.log(`${errors.length ? '✗' : '✓'} ${route.name.padEnd(10)} ${vpName.padEnd(7)} ${theme.padEnd(5)} → ${file}${errors.length ? `  (${errors.length} console error)` : ''}`)
        } finally {
          await page.closeTarget()
        }
      }
    }
  }
} finally {
  browser.close()
}
writeFileSync(resolve(outDir, 'console.json'), JSON.stringify(report, null, 2))
if (failed) {
  console.error('\n存在 console error / 异常，详见 shots/console.json')
  process.exit(1)
}
