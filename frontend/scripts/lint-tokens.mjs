#!/usr/bin/env node
/**
 * lint-tokens：W6 spec 05 §1 / §6 禁令 —— src/**\/*.{ts,tsx} 内禁止
 *   硬编码颜色 `#hex` / `rgb(` / `hsl(` / `oklch(`，像素级任意值 `text-[Npx]` / `p*-[Npx]` / `w-[Npx]` / `h-[Npx]`（含 min-h / max-h / size）/ `z-[N]`，
 *   10px 以下字号（`text-[9px]` `text-[10px]`、`fontSize: 10`、`text-[0.625rem]`），以及五档之外的控件高度类（h-10 = 40px 档已删除；用 h-xs/sm/md/lg/touch）。
 *   内联 style 色值（`style={{ color: '#…' }}` 等）由 hex/rgb/oklch 规则覆盖。
 * 白名单（只有 prep/integrate 可改本文件）：CSS（layout-view/*.css、preview/pdf-text-layer.css、index.css 不在扫描范围）、
 * 测试文件（夹具数据）、以及三处「用户数据调色板」（标签色 / 头像色 / 协同光标色是持久化的数据值，不是样式）。
 * 用法：node scripts/lint-tokens.mjs [--verbose]；违规退出码 1。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src')
const ALLOW_FILES = new Set([
  'types/case.ts', // TAG_COLORS：标签色是案卷数据（后端 cases.py 同表）
  'types/account.ts', // AVATAR_COLORS：头像色是账户数据
  'collab/colors.ts', // 协同光标色：yjs awareness 持久化到 peer 状态
])
const ALLOW_DIRS = ['__tests__/']
const RULES = [
  { id: 'hex', re: /#[0-9a-fA-F]{3,8}\b/g, why: '硬编码 hex 颜色 → 用语义 token（bg-primary / text-destructive / var(--…)）' },
  { id: 'rgb', re: /\b(?:rgb|hsl)a?\(/g, why: 'rgb()/hsl() → 语义 token' },
  { id: 'oklch', re: /\boklch\(/g, why: 'oklch() 只允许出现在 index.css' },
  { id: 'text-px', re: /(?<![\w-])text-\[\d+px\]/g, why: 'text-[Npx] → text-2xs/xs/sm/base/lg/xl/2xl' },
  { id: 'p-px', re: /(?<![\w-])p[xytblr]?-\[\d+px\]/g, why: 'p-[Npx] → 4px 栅格 p-1..12' },
  { id: 'w-px', re: /(?<![\w-])w-\[\d+px\]/g, why: 'w-[Npx] → 栅格 w-N 或语义宽度 w-side / w-drawer / max-w-dialog-*' },
  { id: 'z-num', re: /(?<![\w-])z-\[\d+\]|(?<![\w-])z-(?:10|20|30|40|50)\b/g, why: 'z-[N] / z-10.. → z-sticky / z-panel / z-overlay / z-popover / z-toast' },
  { id: 'h-px', re: /(?<![\w-])(?:min-|max-)?h-\[\d+px\]/g, why: 'h-[Npx] → 五档控件高 h-xs(24) h-sm(28) h-md(32) h-lg(36) h-touch(44) 或壳尺寸 h-topbar / h-statusbar / h-pdftb / h-row / h-panel-header' },
  { id: 'h-40', re: /(?<![\w-])(?:min-)?h-10(?![\w.-])/g, why: '40px 控件档已删除 → h-lg(36) 或 h-touch(44)；列表行用 h-row(40)' },
  { id: 'fs-min', re: /(?<![\w-])text-\[(?:[0-9]|10)px\]|(?<![\w-])text-\[0\.(?:5|5625|625)rem\]|\bfontSize:\s*['"]?(?:[0-9]|10)(?:px)?['"]?(?=[,\s}])/g, why: '最小字号 11px（禁 9 / 10px）→ text-2xs(11) / text-xs(12)' },
  { id: 'inline-color', re: /\b(?:color|background(?:Color)?|borderColor|fill|stroke):\s*['"](?!var\(|color-mix\(|transparent|currentColor|inherit|none)[^'"]+['"]/g, why: '内联 style 色值 → className 语义 token 或 style={{ color: "var(--…)" }}' },
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.tsx?$/.test(name)) yield p
  }
}

/** 去掉块注释与行注释（保留字符串里的 // 如 URL） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, (_, pre) => pre)
}

const verbose = process.argv.includes('--verbose')
const violations = []
let scanned = 0
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/')
  if (ALLOW_FILES.has(rel) || ALLOW_DIRS.some((d) => rel.includes(d)) || /\.test\.tsx?$/.test(rel)) continue
  scanned++
  const body = stripComments(readFileSync(file, 'utf8'))
  const lines = body.split('\n')
  lines.forEach((line, i) => {
    for (const r of RULES) {
      r.re.lastIndex = 0
      let m
      while ((m = r.re.exec(line))) violations.push({ file: rel, line: i + 1, rule: r.id, match: m[0], why: r.why })
    }
  })
}

if (violations.length) {
  for (const v of violations) console.error(`${v.file}:${v.line}  [${v.rule}] ${v.match}  — ${v.why}`)
  console.error(`\nlint-tokens: ${violations.length} 处违规（扫描 ${scanned} 个文件）`)
  process.exit(1)
}
if (verbose) console.log(`lint-tokens: 0 违规（扫描 ${scanned} 个文件）`)
