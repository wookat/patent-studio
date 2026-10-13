import type { Settings } from '@/lib/types'
import type { FigureItem } from '@/types/figures'

export const FIG_FILE_RE = /^fig(\d+)\.(svg|emf|png)$/i

/** 浏览器能直接显示的 figs/ 后缀；emf 要用伴生文件（GET /figures 的 preview） */
export const FIG_INLINE_RE = /\.(svg|png|jpe?g|gif|bmp)$/i

/**
 * figs/ 里一个文件的预览来源：自身可直显 → 自身；否则 GET /figures 给的伴生 preview；都没有 → null（只能下载）。
 * figures 未加载（列表不属于当前案）时传 []。
 */
export function figPreviewName(name: string, figures: readonly Pick<FigureItem, 'name' | 'preview'>[]): string | null {
  if (FIG_INLINE_RE.test(name)) return name
  return figures.find((f) => f.name === name)?.preview ?? null
}

export interface FigFile {
  name: string
  /** 图号：有 GET /figures 时来自 docs/figures.md 行序（未编入 null）；否则从文件名 fig<N> 推断 */
  num: number | null
  ext: string
}

/**
 * figs/ 文件列表。传了 figures（GET /figures 已加载）时以它为准：图号按 figures.md 顺序，未编入的也列出（num=null，排最后）；
 * 未加载时退回 project.figs 里符合 fig<N>.(svg|emf|png) 的文件，图号从文件名推断。
 */
export function listFigFiles(figs: readonly string[], figures?: readonly Pick<FigureItem, 'name' | 'num' | 'ext'>[]): FigFile[] {
  if (figures && figures.length) {
    return figures
      .map((f) => ({ name: f.name, num: f.num, ext: f.ext.replace(/^\./, '').toLowerCase() }))
      .sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity) || a.name.localeCompare(b.name))
  }
  const out: FigFile[] = []
  for (const name of figs) {
    const m = FIG_FILE_RE.exec(name)
    if (!m) continue
    out.push({ name, num: Number(m[1]), ext: m[2].toLowerCase() })
  }
  return out.sort((a, b) => a.num! - b.num! || a.ext.localeCompare(b.ext))
}

/** figs/ 中由后端派生的内部格式（Word 嵌入用）：只作伴生时不在树中显示 */
export const INTERNAL_FIG_EXTS: ReadonlySet<string> = new Set(['emf', 'wmf'])

/**
 * 文件树 figs/ 下的资源行 = listFigFiles 去掉纯派生文件：emf / wmf 仅当它既未编入 figures.md、又没有可显示伴生（preview）时才隐藏；
 * 示例案 figures.md 直接引用 fig<N>.emf（伴生 png / svg 由后端归为同一项），这类主文件必须保留为一行、预览走伴生。
 */
export function visibleFigFiles(
  figs: readonly string[],
  figures?: readonly Pick<FigureItem, 'name' | 'num' | 'ext' | 'preview'>[],
): FigFile[] {
  const stem = (name: string) => name.replace(/\.[^.]+$/, '')
  if (figures && figures.length) {
    return listFigFiles(figs, figures).filter((f) => !INTERNAL_FIG_EXTS.has(f.ext) || f.num != null || !!figures.find((x) => x.name === f.name)?.preview)
  }
  const inlineStems = new Set(figs.filter((n) => FIG_INLINE_RE.test(n)).map(stem))
  return listFigFiles(figs).filter((f) => !INTERNAL_FIG_EXTS.has(f.ext) || !inlineStems.has(stem(f.name)))
}

const figRefRe = (n: number) => new RegExp(`图\\s*${n}(?!\\d)`, 'g')

/** content.md 中 `图N` 出现次数（不含 `图N0`、`图N1` 等更长图号） */
export function countFigureRefs(content: string, n: number): number {
  return content.match(figRefRe(n))?.length ?? 0
}

/** `图N` 首次出现的 1-based 行号；未引用返回 null */
export function firstFigureRefLine(lines: readonly string[], n: number): number | null {
  const re = new RegExp(`图\\s*${n}(?!\\d)`)
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1
  return null
}

/**
 * 文件树「附图」目录行的两口径标注（qa-07 / domain-05）：
 * 附图 N = 说明书附图块数（ast.figures，docs/figures.md 每行一块；/ast 未返回 → 「—」），资源 M = figs/ 图片文件数（不含派生 emf / wmf）。
 * 两数口径不同，可以不相等：title / aria 里逐一解释。
 */
export function figureNodeCaption(figureBlocks: number | null, resourceFiles: number): { text: string; explain: string; aria: string } {
  const n = figureBlocks === null ? '—' : String(figureBlocks)
  const text = `附图 ${n} · 资源 ${resourceFiles}`
  const nWhy = figureBlocks === null ? '附图数 = 说明书附图块数（正在解析）' : `附图 ${figureBlocks} = 说明书附图块数（附图书每行一块）`
  const mWhy = `资源 ${resourceFiles} = 已上传的图片文件数（同一图的多种格式算 1）`
  return {
    text,
    explain: `${nWhy}；${mWhy}。两个口径可不相等：附图块引用的文件未上传，或文件已上传但未编入附图书`,
    aria: `附图目录，${nWhy}，${mWhy}`,
  }
}

/** studio.json 相对默认设置改动的条目数（style 每键 1 项 + abstract_limit + sub_except；附图选择不计） */
export function settingsChangedCount(settings: Settings | null, defaults: Settings | null): number {
  if (!settings) return 0
  let n = Object.keys(settings.style ?? {}).length
  if (settings.abstract_limit !== (defaults?.abstract_limit ?? 300)) n++
  const subDefault = defaults?.sub_except ?? ['tsf_guard', 'on_matured']
  const sub = settings.sub_except ?? subDefault
  if (sub.length !== subDefault.length || sub.some((w, i) => w !== subDefault[i])) n++
  return n
}
