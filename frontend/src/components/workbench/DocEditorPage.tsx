import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AlertCircle, Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EditorView } from 'prosemirror-view'
import { ApiError } from '@/lib/api/net'
import { PageChrome } from '@/components/shell/PageChrome'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BookEditor } from '@/components/layout-view/editor/BookEditor'
import { Paper } from '@/components/layout-view/Paper'
import { StructureDialogs } from '@/components/block-model/dialogs'
import { fromBookDoc } from '@/components/layout-view/doc/fromBookDoc'
import { useStudio } from '@/store'
import { EMPTY_CONTENT_REF, workbenchApi, type DocumentAstResult } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { WorkingCopy } from '@/workbench/types'
import type { Ast } from '@/types/ast'
import { ErrorPanel } from './WorkbenchPage'
import '../layout-view/layout-view.css'

const BOOK_LABEL: Record<string, string> = { abstract: '摘要', claims: '权利要求书', description: '说明书' }

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return '需要登录后才能编辑文稿。'
    if (e.status === 403) return '当前账号没有本案件的写入权限。'
    if (e.status === 409) return '版本已变化，请重新加载文稿后再保存。'
    if (e.status === 422 && e.detail) return e.detail.line ? `${e.detail.message}（第 ${e.detail.line} 行）` : e.detail.message
    return e.detail?.message ?? e.message
  }
  return e instanceof Error ? e.message : '保存失败'
}

/**
 * B12 平台文稿编辑器页（#/edit/<caseId>/<docId>）：旧三书块编辑器（layout-view BookEditor + Paper 壳 +
 * block-model 结构对话框）重接新 /api/v1——工作副本乐观锁自动保存（useBookSave 600ms 空闲 / 失焦 flush）
 * 与「提交 revision」。AST 由 POST /documents/{id}/ast 提供：单书正文在后端包成三书合一 content.md
 * 形状过 kernel.parse_ast，块行号经 ast.books[book].offset 对齐；useStudio.pid 借用 docId 满足
 * BookEditor 的案卷闸（不影响本路由外的页面，卸载时还原）。
 */
export function DocEditorPage({ caseId, docId }: { caseId: string; docId: string }) {
  const queryClient = useQueryClient()
  const document = useQuery({ queryKey: [...workbenchKeys.all, 'document', docId], queryFn: ({ signal }) => workbenchApi.document(docId, signal), retry: false })
  const caseItem = useQuery({ queryKey: workbenchKeys.case(caseId), queryFn: ({ signal }) => workbenchApi.case(caseId, signal), retry: false })
  const [copy, setCopy] = useState<WorkingCopy | null>(null)
  const copyRef = useRef<WorkingCopy | null>(null)
  const [parsed, setParsed] = useState<DocumentAstResult | null>(null)
  const [astStale, setAstStale] = useState(false)
  const [bootError, setBootError] = useState<unknown>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [committing, setCommitting] = useState(false)
  const viewRef = useRef<EditorView | null>(null)

  const doc = document.data
  const book = doc?.book

  // 开工作副本 → flush 协同残余 → 读正文 → 取 AST（一次引导；docId 变化时整页重挂）
  useEffect(() => {
    if (!doc) return
    let alive = true
    const prevPid = useStudio.getState().pid
    useStudio.setState({ pid: doc.id })
    void (async () => {
      try {
        // 优先恢复本人最近的工作副本（刷新/重进不丢未提交草稿）；没有才开新的
        const existing = await workbenchApi.workingCopies(doc.id)
        const wc =
          existing[0] ??
          (await workbenchApi.openWorkingCopy(doc.id, doc.current_revision_id, doc.current_revision_id ? undefined : EMPTY_CONTENT_REF))
        try {
          await workbenchApi.flushCollab(wc.id)
        } catch {
          /* 协同未启用 / 房间不存在时不阻断打开 */
        }
        const text = await workbenchApi.workingCopyContent(wc.id)
        const next = await workbenchApi.documentAst(doc.id, text)
        if (!alive) return
        copyRef.current = wc
        setCopy(wc)
        setParsed(next)
      } catch (e) {
        if (alive) setBootError(e)
      }
    })()
    return () => {
      alive = false
      useStudio.setState({ pid: prevPid })
    }
  }, [doc])

  const save = useCallback(
    async (md: string): Promise<boolean> => {
      const c = copyRef.current
      if (!c || conflict) return false
      try {
        const next = await workbenchApi.saveWorkingCopyContent(c.id, c.version, md)
        copyRef.current = next
        setCopy(next)
        setSaveError(null)
        try {
          setParsed(await workbenchApi.documentAst(docId, md))
          setAstStale(false)
        } catch (e) {
          // 落盘已成功但结构暂不可解析（如未闭合 $$）：保留旧 AST 标记 stale，编辑器照 BookEditor 既有语义续编
          if (e instanceof ApiError && e.status === 422) {
            setAstStale(true)
            setSaveError(`已保存；结构提示：${errorText(e)}`)
          } else {
            throw e
          }
        }
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setConflict(true)
        setSaveError(errorText(e))
        return false
      }
    },
    [docId, conflict],
  )

  const commit = useCallback(async () => {
    const view = viewRef.current
    if (!view || committing) return
    setCommitting(true)
    try {
      // 先把未落盘输入保存掉（绕过 600ms 空闲调度，直接序列化当前 doc）
      const md = fromBookDoc(view.state.doc)
      if (!(await save(md))) return
      const c = copyRef.current
      if (!c) return
      await workbenchApi.commitWorkingCopy(c.id, c.version)
      setCommitted(true)
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.documents(caseId) })
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.revisions(docId) })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true)
      setSaveError(errorText(e))
    } finally {
      setCommitting(false)
    }
  }, [save, committing, caseId, docId, queryClient])

  const ast: Ast | null = parsed?.ast ?? null
  const content = parsed?.content ?? ''
  const title = `文稿编辑器${doc ? ` · ${BOOK_LABEL[doc.book] ?? doc.book}` : ''}`
  return (
    <PageChrome
      name="doc-editor"
      title={title}
      description={caseItem.data ? `${caseItem.data.case_key} · ${caseItem.data.title}` : undefined}
      width="full"
      backHref={`#/workbench?view=case&case=${encodeURIComponent(caseId)}`}
      backLabel="返回案件空间"
      actions={
        <>
          {conflict && <Badge tone="danger">版本冲突</Badge>}
          {astStale && !conflict && <Badge tone="warn">结构待解析</Badge>}
          {committed && <Badge tone="ok">已生成新修订</Badge>}
          <Button
            size="sm"
            loading={committing}
            disabled={!copy || conflict || committed}
            onClick={() => void commit()}
            data-testid="doc-editor-commit"
          >
            <Check aria-hidden />
            提交 revision
          </Button>
        </>
      }
    >
      {document.isLoading || (doc && !parsed && !bootError) ? (
        <div className="flex items-center gap-2 py-16 text-sm text-fg-muted" data-testid="doc-editor-loading">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          正在打开工作副本…
        </div>
      ) : bootError || document.error ? (
        <ErrorPanel error={bootError ?? document.error} onRetry={() => window.location.reload()} />
      ) : doc && parsed && ast && book ? (
        <>
          {conflict && (
            <Alert variant="danger" className="mx-auto mb-3 max-w-3xl" data-testid="doc-editor-conflict">
              <AlertCircle aria-hidden />
              <AlertTitle className="flex items-center justify-between gap-3">
                <span>检测到并发修改：当前工作副本版本已过期，请重新加载文稿后继续编辑。</span>
                <Button size="xs" variant="secondary" onClick={() => window.location.reload()}>
                  <RefreshCw aria-hidden />
                  重新加载
                </Button>
              </AlertTitle>
            </Alert>
          )}
          {saveError && !conflict && (
            <p className="mx-auto mb-3 max-w-3xl text-sm text-danger-fg" role="alert" data-testid="doc-editor-save-error">
              {saveError}
            </p>
          )}
          {committed && (
            <p className="mx-auto mb-3 max-w-3xl text-sm text-ok-fg" role="status" data-testid="doc-editor-committed">
              已提交为新 revision。
            </p>
          )}
          <div className="ps-layout-body" data-testid="doc-editor-body">
            <div className="ps-pages" data-testid="ps-pages" style={{ '--ps-scale': 1 } as CSSProperties}>
              <Paper part={book}>
                {book === 'abstract' && <h1 className="ps-title ps-h">{ast.title.text}</h1>}
                {book === 'description' && <h2 className="ps-h ps-title">{ast.title.text}</h2>}
                <div className={book === 'claims' ? 'ps-claims' : undefined} data-testid={book === 'claims' ? 'ps-claims' : undefined}>
                  <BookEditor
                    key={`${doc.id}:${book}`}
                    book={book}
                    ast={ast}
                    content={content}
                    astStale={astStale}
                    mode="edit"
                    onSave={save}
                    onView={(v) => {
                      viewRef.current = v
                    }}
                    data-testid={`ps-book-${book}`}
                  />
                </div>
              </Paper>
            </div>
          </div>
          <StructureDialogs />
        </>
      ) : null}
    </PageChrome>
  )
}
