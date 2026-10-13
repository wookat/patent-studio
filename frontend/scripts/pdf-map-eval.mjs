#!/usr/bin/env node
/**
 * pdf-map-eval：两案（examples/method、examples/system）PDF ↔ AST 配对命中率（docs/plan/21-w5-spec.md §5.3 验收）。
 *
 * 每案：后端内核 build_patent_ex → docx；app.lo.docx_to_pdf 各转一份 tagged（unoserver UseTaggedPDF）与 plain PDF；
 * parse_ast 得 AST；再用 src/lib/pdfIndex.ts（vite 打成临时 ESM）分别建 struct / heuristic 索引，统计：
 *   - body：说明书带段号的块（paragraph / table / code）在 byBlock 中有页的比例；
 *   - claims：权项在 byBlock 中有页且页属于权利要求书的比例；
 *   - footer3：说明书页脚日期「2023.03」/ 页码等不得配到 claims/3（任一页在说明书页范围内 locate 到权项即算失败）。
 * 阈值：struct body ≥ 98%、claims 100%；heuristic body/claims ≥ 93%。任一不达 → 退出码 1。
 *
 * 用法（需 unoserver 在线，UNOSERVER_URL 默认 http://127.0.0.1:2003）：
 *   node frontend/scripts/pdf-map-eval.mjs examples/method examples/system [--out frontend/shots/pdf-map-eval.json]
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(here, '..')
const repoDir = resolve(frontendDir, '..')
const backendDir = resolve(repoDir, 'backend')

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outFile = outIdx >= 0 ? resolve(args.splice(outIdx, 2)[1]) : resolve(frontendDir, 'shots', 'pdf-map-eval.json')
const cases = args.length ? args : ['examples/method', 'examples/system']

const THRESH = { struct: { body: 0.98, claims: 1 }, heuristic: { body: 0.93, claims: 0.93 } }

const PY = `
import json, os, sys
sys.path.insert(0, os.getcwd())
from app.projects import ProjectStore, normalize_settings
from app.lo import docx_to_pdf, last_tagged, last_backend
from patent_docx import critic
from patent_docx.ast import parse_ast
from patent_docx.builder import build_patent_ex
case, out = sys.argv[1], sys.argv[2]
store = ProjectStore(os.path.dirname(case)); pid = os.path.basename(case)
p = store.get(pid)
content = critic.accept(store.read_content(pid))
s = normalize_settings(p.settings, store.list_figs(p.dir))
ast = parse_ast(content, s, figures=store.load_figures(p.dir))
cfg = store.build_config(p, out=os.path.join(out, 'out.docx'), content_md=os.path.join(case, 'content.md'))
build_patent_ex(cfg)
os.makedirs(os.path.join(out, 'tagged')); os.makedirs(os.path.join(out, 'plain'))
tagged = docx_to_pdf(cfg['out'], os.path.join(out, 'tagged'), tagged=True)
info = {'tagged_pdf': tagged, 'pdf_tagged': last_tagged(), 'backend': last_backend()}
info['plain_pdf'] = docx_to_pdf(cfg['out'], os.path.join(out, 'plain'))
json.dump({'ast': ast, **info}, open(os.path.join(out, 'case.json'), 'w', encoding='utf-8'), ensure_ascii=False)
`

async function bundleIndex(tmp) {
  const { build } = await import('vite')
  await build({
    configFile: false,
    logLevel: 'error',
    root: frontendDir,
    resolve: { alias: { '@': resolve(frontendDir, 'src') } },
    build: {
      lib: { entry: resolve(frontendDir, 'src/lib/pdfIndex.ts'), formats: ['es'], fileName: () => 'pdfIndex.mjs' },
      outDir: tmp,
      emptyOutDir: false,
      minify: false,
      target: 'node22',
    },
  })
  return import(pathToFileURL(resolve(tmp, 'pdfIndex.mjs')).href)
}

function rate(hit, total) {
  return total ? hit / total : 1
}

function evaluate(ast, index, claimsPages) {
  const bodyIds = ast.description.filter((b) => b.kind === 'paragraph' ? b.para_no !== null : b.kind === 'table' || b.kind === 'code').map((b) => b.id)
  const bodyHit = bodyIds.filter((id) => index.byBlock.has(id))
  const claimIds = ast.claims.map((c) => c.id)
  const claimHit = claimIds.filter((id) => {
    const e = index.byBlock.get(id)
    return e && index.bookOfPage(e.page) === 'claims'
  })
  return {
    kind: index.kind,
    body: { total: bodyIds.length, hit: bodyHit.length, rate: rate(bodyHit.length, bodyIds.length), missing: bodyIds.filter((id) => !bodyHit.includes(id)) },
    claims: { total: claimIds.length, hit: claimHit.length, rate: rate(claimHit.length, claimIds.length), missing: claimIds.filter((id) => !claimHit.includes(id)) },
    claimsPages,
  }
}

/** 说明书页脚「2023.03」与页码「3」都不得 locate 到 claims/3 */
async function footerGuard(doc, index) {
  const bad = []
  for (let n = 1; n <= doc.numPages; n++) {
    if (index.bookOfPage(n) === 'claims') continue
    for (const text of ['3.', '2023.03', '3']) {
      const r = index.locate({ page: n, text })
      if ('blockId' in r && r.blockId.startsWith('claims/')) bad.push({ page: n, text, blockId: r.blockId })
    }
  }
  return bad
}

const tmp = mkdtempSync(resolve(tmpdir(), 'pdf-map-eval-'))
const report = { generated_at: new Date().toISOString(), cases: {}, pass: true }
try {
  const { buildPdfBlockIndex } = await bundleIndex(tmp)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  for (const c of cases) {
    const caseDir = resolve(repoDir, c)
    const out = resolve(tmp, c.replace(/[\\/]/g, '_'))
    mkdirSync(out, { recursive: true })
    execFileSync('uv', ['run', 'python', '-', caseDir, out], { cwd: backendDir, input: PY, stdio: ['pipe', 'inherit', 'inherit'] })
    const info = JSON.parse(readFileSync(resolve(out, 'case.json'), 'utf-8'))
    const entry = { pdf_tagged: info.pdf_tagged, backend: info.backend }
    for (const [mode, file, tagged] of [['struct', info.tagged_pdf, info.pdf_tagged], ['heuristic', info.plain_pdf, false]]) {
      const doc = await getDocument({ url: pathToFileURL(file).href, useSystemFonts: true }).promise
      const index = await buildPdfBlockIndex(doc, info.ast, { tagged })
      const claimsPages = []
      for (let n = 1; n <= doc.numPages; n++) if (index.bookOfPage(n) === 'claims') claimsPages.push(n)
      const r = evaluate(info.ast, index, claimsPages)
      r.footer3_misses = await footerGuard(doc, index)
      const th = THRESH[mode]
      r.pass = r.kind === mode && r.body.rate >= th.body && r.claims.rate >= th.claims && r.footer3_misses.length === 0
      if (!r.pass) report.pass = false
      entry[mode] = r
      await doc.destroy()
    }
    report.cases[c] = entry
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(report, null, 2))
for (const [c, e] of Object.entries(report.cases)) {
  for (const mode of ['struct', 'heuristic']) {
    const r = e[mode]
    console.log(`${r.pass ? 'OK  ' : 'FAIL'} ${c} ${mode.padEnd(9)} body ${r.body.hit}/${r.body.total} (${(r.body.rate * 100).toFixed(1)}%)  claims ${r.claims.hit}/${r.claims.total} (${(r.claims.rate * 100).toFixed(1)}%)  footer3 ${r.footer3_misses.length}  kind=${r.kind}`)
  }
}
console.log(`→ ${outFile}`)
process.exit(report.pass ? 0 : 1)
