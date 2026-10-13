// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStudio } from '@/store'
import type { BuildOutcome } from '@/lib/types'
import type { PdfBlockIndex, PdfLocateResult, PdfLocateSel } from '@/lib/pdfIndex'
import { PDF_LOCATE_ARTIFACT_LABEL, PDF_LOCATE_FAIL_LABEL } from '@/types/focus'
import type { PdfLocateFail } from '@/types/focus'
import { closeBlockEditor, getBlockEditorRequest } from '@/components/block-editor/state'
import goldenMethod from '../../../../../backend/tests/golden/ast_method.json'
import type { Ast } from '@/types/ast'
import { bookOfBlockId, hitFromTextSpan, installPdfIndex, locatePdfHit, pdfDoubleClick, pdfTargetOf, resetPdfIndex } from '../pdfFocus'

const methodAst = goldenMethod as unknown as Ast

const URL_A = '/api/p/1/build/out.pdf'

/** 假索引：locate 按脚本返回；页尺寸 A4 */
function fakeIndex(script: (sel: PdfLocateSel) => PdfLocateResult, kind: PdfBlockIndex['kind'] = 'struct'): PdfBlockIndex {
  return {
    kind,
    byBlock: new Map([['description/技术领域/p0001', { page: 2, mcids: ['p1'], rects: [{ x: 70, y: 700, width: 300, height: 12 }] }]]),
    byMcid: new Map([['p1', 'description/技术领域/p0001']]),
    bookOfPage: (page) => (page === 1 ? 'claims' : page === 4 ? 'figures' : 'description'),
    pageSize: () => ({ width: 595, height: 842 }),
    locate: script,
  }
}

function fresh() {
  useStudio.setState({
    lastOk: { ok: true } as unknown as BuildOutcome,
    stale: false,
    lastOkEditAt: 100,
    contentEditedAt: 50,
    focus: null,
    project: null,
    pdfLocateFail: null,
    pdfLocateCandidates: [],
    toasts: [],
  } as never)
}

/** 文字层 DOM：<div data-page=2><div class=react-pdf__Page__textContent><span class=markedContent id=p1><span role=presentation>…</span></span></div></div> */
function textLayer(page: number, text: string, mcid?: string) {
  const pageEl = document.createElement('div')
  pageEl.dataset.page = String(page)
  const layer = document.createElement('div')
  layer.className = 'react-pdf__Page__textContent'
  let parent: HTMLElement = layer
  if (mcid) {
    const mc = document.createElement('span')
    mc.className = 'markedContent'
    mc.id = mcid
    layer.appendChild(mc)
    parent = mc
  }
  const span = document.createElement('span')
  span.setAttribute('role', 'presentation')
  span.textContent = text
  parent.appendChild(span)
  pageEl.appendChild(layer)
  document.body.appendChild(pageEl)
  return span
}

beforeEach(() => {
  fresh()
  resetPdfIndex()
  closeBlockEditor()
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('hitFromTextSpan', () => {
  it('取所在页 / 整行文字 / MCID；不在页内返回 null', () => {
    const span = textLayer(2, '[0001]本发明涉及时间序列预测领域。', 'p1')
    expect(hitFromTextSpan(span)).toEqual({ page: 2, text: '[0001]本发明涉及时间序列预测领域。', mcid: 'p1' })
    const orphan = document.createElement('span')
    expect(hitFromTextSpan(orphan)).toBeNull()
  })
})

describe('locatePdfHit：六种失败码各自 toast + pdfLocateFail，成功写 Focus{source:pdf}', () => {
  const hit = { page: 2, text: '[0001]本发明涉及时间序列预测领域。', mcid: 'p1' }

  it('尚无成功构建 → generated', () => {
    useStudio.setState({ lastOk: null } as never)
    expect(locatePdfHit(hit, URL_A)).toEqual({ ok: false, fail: 'generated' })
    expect(useStudio.getState().pdfLocateFail).toBe('generated')
    expect(useStudio.getState().toasts.at(-1)?.text).toBe(PDF_LOCATE_FAIL_LABEL.generated)
  })

  it('PDF 落后于源码（stale）→ stale，且不写 Focus（禁定位）', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ blockId: 'description/技术领域/p0001', line: 3 })))
    useStudio.setState({ contentEditedAt: 999 } as never)
    expect(locatePdfHit(hit, URL_A)).toEqual({ ok: false, fail: 'stale' })
    expect(useStudio.getState().focus).toBeNull()
    expect(useStudio.getState().toasts.at(-1)?.text).toBe(PDF_LOCATE_FAIL_LABEL.stale)
  })

  it('索引尚未建好（url 不匹配）→ generated', () => {
    installPdfIndex('/other.pdf', fakeIndex(() => ({ blockId: 'x', line: 1 })))
    expect(locatePdfHit(hit, URL_A)).toEqual({ ok: false, fail: 'generated' })
  })

  it.each<PdfLocateFail>(['figure', 'ambiguous', 'short', 'nomatch'])('索引返回 %s → 同码 toast', (fail) => {
    installPdfIndex(URL_A, fakeIndex(() => ({ fail })))
    expect(locatePdfHit(hit, URL_A)).toEqual({ ok: false, fail })
    const s = useStudio.getState()
    expect(s.pdfLocateFail).toBe(fail)
    expect(s.toasts.at(-1)?.text).toBe(PDF_LOCATE_FAIL_LABEL[fail])
    expect(s.focus).toBeNull()
  })

  it('索引返回 generated（书名标题 / 页眉页脚）→ 文案是“版式生成文字”而非“PDF 尚未生成”', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ fail: 'generated' })))
    const r = locatePdfHit({ page: 1, text: '权 利 要 求 书' }, URL_A)
    expect(r).toMatchObject({ ok: false, fail: 'generated', label: PDF_LOCATE_ARTIFACT_LABEL })
    const s = useStudio.getState()
    expect(s.pdfLocateFail).toBe('generated')
    expect(s.toasts.at(-1)?.text).toBe(PDF_LOCATE_ARTIFACT_LABEL)
    expect(PDF_LOCATE_ARTIFACT_LABEL).not.toBe(PDF_LOCATE_FAIL_LABEL.generated)
  })

  it('全部六码文案互不相同且非空（用户可分辨）', () => {
    const labels = Object.values(PDF_LOCATE_FAIL_LABEL)
    expect(labels).toHaveLength(6)
    expect(new Set(labels).size).toBe(6)
    labels.forEach((l) => expect(l.length).toBeGreaterThan(3))
  })

  it('命中 → Focus{book, blockId, line, page, source:pdf}', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ blockId: 'description/技术领域/p0001', line: 12 })))
    const r = locatePdfHit(hit, URL_A)
    expect(r.ok).toBe(true)
    const f = useStudio.getState().focus!
    expect(f).toMatchObject({ book: 'description', blockId: 'description/技术领域/p0001', line: 12, page: 2, source: 'pdf' })
    expect(useStudio.getState().pdfLocateFail).toBeNull()
  })

  it('announce=false 只算不写（拖选浮条预判）', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ fail: 'nomatch' })))
    expect(locatePdfHit(hit, URL_A, false)).toEqual({ ok: false, fail: 'nomatch' })
    expect(useStudio.getState().toasts).toHaveLength(0)
    expect(useStudio.getState().pdfLocateFail).toBeNull()
  })

  it('bookOfBlockId：claims/ → claims，abstract → abstract，其余 description', () => {
    expect(bookOfBlockId('claims/3')).toBe('claims')
    expect(bookOfBlockId('abstract/p0001')).toBe('abstract')
    expect(bookOfBlockId('description/x/p0001')).toBe('description')
  })
})

describe('pdfDoubleClick：双击定位并打开 BlockEditor', () => {
  it('命中 → openBlockEditor({blockId, source:pdf, anchor})', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ blockId: 'description/技术领域/p0001', line: 12 })))
    const span = textLayer(2, '[0001]本发明涉及时间序列预测领域。', 'p1')
    const r = pdfDoubleClick(span, URL_A, false, { x: 30, y: 40 })
    expect(r?.ok).toBe(true)
    // anchor 带点击点 + 被点行 / 所在页的包围盒（jsdom 无版面，rect 全 0）
    expect(getBlockEditorRequest()).toEqual({
      blockId: 'description/技术领域/p0001',
      source: 'pdf',
      anchor: { x: 30, y: 40, rect: { left: 0, top: 0, width: 0, height: 0 } },
    })
  })

  it('R67-01 只读角色：命中 → 不开编辑器，改跳源码视图 + info toast', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ blockId: 'description/技术领域/p0001', line: 12 })))
    useStudio.setState({ project: { role: 'viewer' } } as never)
    const span = textLayer(2, '[0001]本发明涉及时间序列预测领域。', 'p1')
    const r = pdfDoubleClick(span, URL_A, false, { x: 30, y: 40 })
    expect(r?.ok).toBe(true)
    expect(getBlockEditorRequest()).toBeNull()
    expect(useStudio.getState().focus?.blockId).toBe('description/技术领域/p0001')
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('只读模式')
    expect(useStudio.getState().activeBook).toBe('description')
  })

  it('stale → 只 toast 不定位不打开', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ blockId: 'description/技术领域/p0001', line: 12 })))
    const span = textLayer(2, '[0001]本发明涉及时间序列预测领域。', 'p1')
    expect(pdfDoubleClick(span, URL_A, true, { x: 0, y: 0 })).toEqual({ ok: false, fail: 'stale' })
    expect(getBlockEditorRequest()).toBeNull()
    expect(useStudio.getState().toasts.at(-1)?.text).toBe(PDF_LOCATE_FAIL_LABEL.stale)
  })

  it('B38-D1 AST 在位而 blockSource 无解（不可块编辑对象）→ 不开编辑器 + info toast', () => {
    installPdfIndex(URL_A, fakeIndex(() => ({ blockId: 'title/t0', line: 1 })))
    useStudio.setState({ ast: methodAst, content: 'x', saved: 'x' } as never)
    const span = textLayer(2, '一种时间序列预测方法', 'p1')
    const r = pdfDoubleClick(span, URL_A, false, { x: 30, y: 40 })
    expect(r?.ok).toBe(true)
    // 定位照常写 Focus，但不发 openBlockEditor——发了会在 host 同 tick 被关（B38-D1）
    expect(getBlockEditorRequest()).toBeNull()
    expect(useStudio.getState().focus?.blockId).toBe('title/t0')
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('不支持块级编辑')
  })

  it('不在文字层上 → null；定位失败 → 不打开', () => {
    expect(pdfDoubleClick(document.body, URL_A, false, { x: 0, y: 0 })).toBeNull()
    installPdfIndex(URL_A, fakeIndex(() => ({ fail: 'nomatch' })))
    const span = textLayer(2, '页眉', undefined)
    expect(pdfDoubleClick(span, URL_A, false, { x: 0, y: 0 })).toEqual({ ok: false, fail: 'nomatch' })
    expect(getBlockEditorRequest()).toBeNull()
  })
})

describe('pdfTargetOf：Focus → 页 + 包围盒', () => {
  it('struct：byBlock 的 rects；heuristic：只页级（rects 空）；无索引 / 无 Focus → null', () => {
    const f = { book: 'description' as const, blockId: 'description/技术领域/p0001', page: 2, source: 'source' as const, seq: 1 }
    const struct = fakeIndex(() => ({ fail: 'nomatch' }))
    expect(pdfTargetOf(struct, f)).toEqual({ page: 2, rects: [{ x: 70, y: 700, width: 300, height: 12 }], size: { width: 595, height: 842 } })
    const heur = fakeIndex(() => ({ fail: 'nomatch' }), 'heuristic')
    heur.byBlock.set('description/技术领域/p0001', { page: 3, mcids: [], rects: [] })
    expect(pdfTargetOf(heur, f)).toMatchObject({ page: 3, rects: [] })
    expect(pdfTargetOf(null, f)).toBeNull()
    expect(pdfTargetOf(struct, null)).toBeNull()
  })
})
