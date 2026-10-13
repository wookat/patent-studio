import { useEffect, useSyncExternalStore } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { buildPdfBlockIndex, pdfLocateCandidates, type PdfBlockIndex, type PdfLocateResult } from '@/lib/pdfIndex'
import { selectReadonly, selectStale, useStudio } from '@/store'
import { blockSource } from '@/store/blocks'
import type { Ast } from '@/types/ast'
import type { Focus, PdfLocateFail } from '@/types/focus'
import { PDF_LOCATE_ARTIFACT_LABEL, PDF_LOCATE_FAIL_LABEL } from '@/types/focus'
import { anchorFromElement, openBlockEditor } from '@/components/block-editor/state'
import { revealView } from '@/components/editor/ViewTabs'

/**
 * PDF 侧的定位状态（21 §5.1 / §5.2）：前台 PDF 的 PdfBlockIndex + 最近一次 PDF 定位结果。
 * 用模块级外部 store 而不是 zustand：索引持有整份 pdf.js 文本项，不该进持久化 / devtools 快照；
 * PdfPreview 建索引，PdfFocusOverlay（slots.registerPdfOverlay）与浮条按 url 读它。
 */

export interface PdfIndexState {
  /** 索引对应的 PDF url；与 PdfPreview 前台槽 url 相同才可用 */
  url: string | null
  index: PdfBlockIndex | null
  building: boolean
}

let state: PdfIndexState = { url: null, index: null, building: false }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => state

export function usePdfIndexState(): PdfIndexState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getPdfIndex(url: string | null): PdfBlockIndex | null {
  return url && state.url === url ? state.index : null
}

/** 测试 / 切案时清空 */
export function resetPdfIndex(): void {
  state = { url: null, index: null, building: false }
  emit()
}

/** 前台 PDF 的索引建好（或测试中直接给一个） */
export function installPdfIndex(url: string, index: PdfBlockIndex | null): void {
  state = { url, index, building: false }
  emit()
}

let buildSeq = 0

/** 索引构建超时：pdf.js doc 句柄被孤儿化时 promise 可永不 settle → building 恒真、双击恒「stale」 */
const INDEX_BUILD_TIMEOUT_MS = 60_000

/** 前台 PDF 文档就绪 → 建索引（tagged 由 BuildResult.pdf_tagged 决定；AST 变化时重建） */
export function usePdfBlockIndex(doc: PDFDocumentProxy | undefined, url: string | null, ast: Ast | null, tagged: boolean): void {
  useEffect(() => {
    if (!doc || !url || !ast) return
    const seq = ++buildSeq
    state = { url, index: state.url === url ? state.index : null, building: true }
    emit()
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('PdfBlockIndex 构建超时')), INDEX_BUILD_TIMEOUT_MS))
    void Promise.race([buildPdfBlockIndex(doc, ast, { tagged }), timeout])
      .then((index) => {
        if (seq === buildSeq) installPdfIndex(url, index)
      })
      .catch((e: unknown) => {
        if (seq !== buildSeq) return
        console.error('PdfBlockIndex 构建失败', e)
        // 同 url 有旧索引就留旧索引——比「无索引」强
        installPdfIndex(url, state.url === url ? state.index : null)
      })
  }, [doc, url, ast, tagged])
}

/* ------------------------------------------------------------------ PDF 点击 → Focus */

export interface PdfHit {
  page: number
  text: string
  mcid?: string
}

/** 从文字层 DOM 取命中：所在页、整行文字、marked-content id（tagged PDF） */
export function hitFromTextSpan(span: HTMLElement): PdfHit | null {
  const pageEl = span.closest<HTMLElement>('[data-page]')
  const page = Number(pageEl?.dataset.page)
  if (!page) return null
  const layer = span.closest<HTMLElement>('.react-pdf__Page__textContent')
  const rect = span.getBoundingClientRect()
  const mid = rect.top + rect.height / 2
  const tol = Math.max(2, rect.height / 2)
  // pdf.js 把一行切成多个短 span（中文常仅 1–4 字，同一行 top 有 ±0.1% 抖动）：取同一行全部 span 拼成整行
  const line = layer
    ? Array.from(layer.querySelectorAll<HTMLElement>('span[role="presentation"]'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0 && Math.abs(r.top + r.height / 2 - mid) <= tol)
        .sort((a, b) => a.r.left - b.r.left)
        .map(({ el }) => el.textContent ?? '')
        .join('')
    : ''
  const mc = span.closest<HTMLElement>('.markedContent')
  return { page, text: line.trim() || span.textContent?.trim() || '', mcid: mc?.id || undefined }
}

export interface PdfLocateOutcome {
  ok: boolean
  focus?: Focus
  fail?: PdfLocateFail
  /** 失败文案（与 toast 一致；版式生成文字的 generated 与“PDF 尚未生成”文案不同） */
  label?: string
}

export function pdfLocateFailLabel(r: PdfLocateOutcome): string {
  return r.label ?? PDF_LOCATE_FAIL_LABEL[r.fail ?? 'nomatch']
}

/**
 * PDF 命中 → 定位：stale / 无索引 → 失败码；成功写 Focus{source:'pdf'}（三视图同步），失败写 pdfLocateFail + toast 六码文案。
 * `announce=false` 时只算不写（拖选浮条先判可否再显示按钮）。
 */
export function locatePdfHit(hit: PdfHit, url: string | null, announce = true): PdfLocateOutcome {
  const s = useStudio.getState()
  const done = (fail: PdfLocateFail, candidates?: { page: number; score: number }[], label = PDF_LOCATE_FAIL_LABEL[fail]): PdfLocateOutcome => {
    if (announce) {
      s.setPdfLocateFail(fail, candidates)
      s.toast(label, 'info')
    }
    return label === PDF_LOCATE_FAIL_LABEL[fail] ? { ok: false, fail } : { ok: false, fail, label }
  }
  if (!s.lastOk || !url) return done('generated')
  if (selectStale(s)) return done('stale')
  const index = getPdfIndex(url)
  if (!index) return done(state.building ? 'stale' : 'generated')
  const r: PdfLocateResult = index.locate({ page: hit.page, text: hit.text, mcid: hit.mcid })
  if ('fail' in r) {
    if (r.fail === 'generated') return done(r.fail, undefined, PDF_LOCATE_ARTIFACT_LABEL)
    return done(r.fail, r.fail === 'ambiguous' ? pdfLocateCandidates(index, hit.text) : undefined)
  }
  const book = index.bookOfPage(hit.page)
  const focus: Omit<Focus, 'seq'> = {
    book: book && book !== 'figures' ? book : bookOfBlockId(r.blockId),
    blockId: r.blockId,
    line: r.line || undefined,
    page: hit.page,
    source: 'pdf',
  }
  if (announce) s.setFocus(focus)
  return { ok: true, focus: { ...focus, seq: s.focus?.seq ?? 0 } }
}

/**
 * 双击 PDF 文字：定位并打开该块的 BlockEditor（带打开时基线 base，服务端发现块被改 → 409 不静默覆盖）；
 * 只读角色不开编辑器——跳源码行 + info toast；stale 时只提示不定位。
 * 返回定位结果（null = 不在文字层上）。
 */
export function pdfDoubleClick(target: HTMLElement, url: string | null, stale: boolean, anchor: { x: number; y: number }): PdfLocateOutcome | null {
  if (stale) {
    useStudio.getState().toast(PDF_LOCATE_FAIL_LABEL.stale, 'info')
    return { ok: false, fail: 'stale' }
  }
  const span = target.closest<HTMLElement>('.react-pdf__Page__textContent span')
  const hit = span ? hitFromTextSpan(span) : null
  if (!hit || !span) return null
  const r = locatePdfHit(hit, url, true)
  if (r.ok && r.focus) {
    const s = useStudio.getState()
    if (selectReadonly(s)) {
      // 只读（viewer / collabReadonly）：有定位无编辑器——跳源码行并如实提示
      revealView('source', r.focus.book)
      s.toast('只读模式：已定位到该块，无法编辑', 'info')
      return r
    }
    const base = s.ast ? blockSource(s.ast, s.content, r.focus.blockId) : null
    if (s.ast && base === null) {
      // AST 在位而该块 blockSource 无解 = 定位到了不可块编辑的对象（扉页/附图等）——
      // 此时打开会在 BlockEditorHost 同 tick 被关，宁可如实提示；ast 未到则照常打开，host 会等 AST 落位再解
      s.toast('该块不支持块级编辑，已定位', 'info')
      return r
    }
    openBlockEditor({ blockId: r.focus.blockId, source: 'pdf', anchor: anchorFromElement(span, anchor), base: base ?? undefined })
  }
  return r
}

export function bookOfBlockId(id: string): Focus['book'] {
  if (id.startsWith('claims/')) return 'claims'
  if (id.startsWith('abstract')) return 'abstract'
  return 'description'
}

/** 三视图 Focus → PDF 页与包围盒（struct 有 rects；heuristic 只页级） */
export function pdfTargetOf(index: PdfBlockIndex | null, f: Focus | null): { page: number; rects: { x: number; y: number; width: number; height: number }[]; size: { width: number; height: number } | null } | null {
  if (!index || !f) return null
  const e = index.byBlock.get(f.blockId)
  if (!e) return null
  return { page: e.page, rects: index.kind === 'struct' ? e.rects : [], size: index.pageSize(e.page) }
}
