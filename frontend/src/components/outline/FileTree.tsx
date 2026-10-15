import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { fmtBytes } from '@/lib/format'
import { BookImage, Download, FilePlus2, FileText, FolderOpen, Image, Paperclip, Sparkles, Trash2 } from 'lucide-react'
import { BOOK_NAMES, type BookName } from '@/types/ast'
import { UploadDrop } from '@/components/figure-book/UploadDrop'
import { figureReject, splitFiles } from '@/components/figure-book/figureFiles'
import { FIGURE_ACCEPT } from '@/components/figures/figureModel'
import { DeleteAttachmentDialog } from '@/components/attachments/DeleteAttachmentDialog'
import { gotoSourceLine } from '@/components/problems/locateSource'
import { api } from '@/lib/api'
import { makePanelId, selectCanEditStyle, selectDirty, useStudio } from '@/store'
import { ATTACHMENT_EXTS, ATTACHMENT_MAX_BYTES, type AttachmentItem } from '@/types/attachments'
import { CONVERT_EXTS } from '@/types/convert'
import type { FigureItem } from '@/types/figures'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TreeRow } from './TreeRow'
import { PlatformDocsGroup } from '@/components/platform/PlatformDocs'
import { treeKeyDown } from './treeKeys'
import { countFigureRefs, figureNodeCaption, firstFigureRefLine, visibleFigFiles } from './fileTreeUtils'

const ATTACHMENT_ACCEPT = ATTACHMENT_EXTS.join(',')
const ATTACHMENT_MAX_MB = Math.floor(ATTACHMENT_MAX_BYTES / 1024 / 1024)


const HOVER_BTN = cn(
  'hidden size-5 shrink-0 items-center justify-center rounded-xs text-fg-muted hover:bg-active hover:text-fg-strong',
  'group-hover:inline-flex group-focus-within:inline-flex',
)

/** 内部实现文件（05 §3.4：作者视角的文件树不显示）：排版设置 studio.json 经 Rail「排版设置」/ 文件菜单进入 */
const NO_ATTACHMENTS: AttachmentItem[] = []
const NO_FIGURES: FigureItem[] = []

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/**
 * 目录级拖放上传（Overleaf「拖到目录即上传」）：包住目录行 + 子列表，文件拖到任何一行都算拖到该目录。
 * 只对 dataTransfer.types 含 Files 的拖拽响应，不干扰树内文本选择 / 其它拖拽。
 */
function DropDir({ onFiles, disabled, testId, children }: { onFiles(files: File[]): void; disabled?: boolean; testId: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  const accept = (e: DragEvent) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    setOver(true)
  }
  return (
    <div
      data-testid={testId}
      data-dropping={over || undefined}
      className={cn('rounded-sm', over && 'bg-selected ring-1 ring-inset ring-primary')}
      onDragEnter={accept}
      onDragOver={accept}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        setOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) onFiles(files)
      }}
    >
      {children}
    </div>
  )
}

/** 三书分开存（R1 B1）：docs/<book>.md；content.md 仍是编辑器打开的装配镜像 */
const BOOK_FILES: Record<BookName, { file: string; label: string }> = {
  abstract: { file: 'abstract.md', label: '摘要' },
  claims: { file: 'claims.md', label: '权利要求书' },
  description: { file: 'description.md', label: '说明书' },
}

/**
 * 209 侧栏上半：案卷文件树（07 §2.1 屏 10；R1 04 §5.6 三书）。
 * - docs/abstract.md · claims.md · description.md：点击 = 跳到该书 `## ` 标题行（ast.books[book].offset），大纲随光标高亮该书首块；
 *   R1 编辑器仍编辑全文 content.md，不切换内容（R4 多卡片后每书单独打开）；/ast 未返回时置灰
 * - figs/（W4-C，15 §4.3）：行尾「上传」「附图书」；文件拖到目录 / 任一子行即上传（前端先按 FIGURE_ACCEPT 拒掉非图文件）；
 *   每文件点击 → 预览（previewFig + 打开 `file` 面板），图号来自 GET /figures（figures.md 行序；未编入 → 「未编入」），右侧显示 `图N` 引用次数，
 *   hover 「→」跳到首个引用行（未引用 → toast）；目录行右侧「附图 N · 资源 M」两口径并列（qa-07 / domain-05：N = ast.figures 说明书附图块数，M = figs/ 图片文件数）
 * - attachments/（W4-C）：任意材料（白名单 ATTACHMENT_EXTS，≤ 50 MB）；行尾上传 + 拖放上传；文件点击 → 预览，hover 转为专利（pdf/docx/md/txt，来源进 ConvertDialog）/ 下载 / 删除（二次确认）；后端 501 时显示「待实现」
 * - studio.json / content.md 是内部实现文件，不再显示（05 §3.4）：排版设置走 Rail「排版设置」/ 文件菜单；保存 / 历史 / 新建走菜单栏与顶栏
 * 数据来自 store（project.figs / settings / defaultSettings / doc.content / ast.books / attachments）。
 */
export function FileTree() {
  const pid = useStudio((s) => s.pid)
  const figs = useStudio((s) => s.figs)
  const content = useStudio((s) => s.content)
  const dirty = useStudio(selectDirty)
  const settingsOpen = useStudio((s) => s.settingsOpen)
  const toggleSettings = useStudio((s) => s.toggleSettings)
  const toast = useStudio((s) => s.toast)
  const books = useStudio((s) => s.ast?.books ?? null)
  const figureBlocks = useStudio((s) => s.ast?.figures.length ?? null)
  const cursorLine = useStudio((s) => s.cursor.line)
  const previewFig = useStudio((s) => s.previewFig)
  const previewAttachment = useStudio((s) => s.previewAttachment)
  const attachments = useStudio((s) => (s.attachmentsPid === s.pid ? s.attachments : NO_ATTACHMENTS))
  const attachmentsPid = useStudio((s) => s.attachmentsPid)
  const attachmentsUnavailable = useStudio((s) => s.attachmentsUnavailable)
  const attachmentsError = useStudio((s) => s.attachmentsError)
  const figures = useStudio((s) => (s.figuresPid === s.pid ? s.figures : NO_FIGURES))
  const figuresPid = useStudio((s) => s.figuresPid)
  const projectReady = useStudio((s) => !!s.pid && s.project?.id === s.pid)
  // R54-01：三组折叠态持久化（与 outlineCollapsedIds 同口径）；R54-02：上传/删除等写 affordance 对只读角色禁用
  const fileTreeCollapsed = useStudio((s) => s.fileTreeCollapsed)
  const toggleFileTreeCollapsed = useStudio((s) => s.toggleFileTreeCollapsed)
  const canEdit = useStudio(selectCanEditStyle)
  const figsOpen = !fileTreeCollapsed.includes('figs')
  const docsOpen = !fileTreeCollapsed.includes('docs')
  const attOpen = !fileTreeCollapsed.includes('attachments')
  const [deletingAtt, setDeletingAtt] = useState<{ item: AttachmentItem; busy: boolean } | null>(null)

  useEffect(() => {
    if (pid && projectReady && attachmentsPid !== pid) void useStudio.getState().loadAttachments(pid)
  }, [pid, projectReady, attachmentsPid])
  useEffect(() => {
    if (pid && projectReady && figuresPid !== pid) void useStudio.getState().loadFigures(pid)
  }, [pid, projectReady, figuresPid])

  const currentBook = useMemo<BookName | null>(() => {
    if (!books) return null
    let cur: BookName | null = null
    for (const b of BOOK_NAMES) if (books[b].offset <= cursorLine && (cur === null || books[b].offset >= books[cur].offset)) cur = b
    return cur
  }, [books, cursorLine])
  const figFiles = useMemo(() => visibleFigFiles(figs, figures), [figs, figures])
  const figNums = useMemo(() => new Set(figFiles.flatMap((f) => (f.num == null ? [] : [f.num]))), [figFiles])
  const figCaption = figureNodeCaption(figureBlocks, figFiles.length)
  const refCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const n of figNums) m.set(n, countFigureRefs(content, n))
    return m
  }, [content, figNums])

  if (!pid) {
    return (
      <div data-slot="FileTree" className="px-3 py-2 text-xs text-fg-muted">
        打开案卷后在此显示文件。
      </div>
    )
  }
  const gotoFigure = (num: number) => {
    const line = firstFigureRefLine(content.split('\n'), num)
    if (line === null) toast(`正文中未引用 图${num}`)
    else gotoSourceLine(line)
  }

  const gotoBook = (book: BookName) => {
    if (!books) return
    if (settingsOpen) toggleSettings(false)
    gotoSourceLine(books[book].offset, book)
  }
  const openFilePreview = () => useStudio.getState().openPanel(makePanelId('file'))
  const previewFigFile = (name: string) => {
    const s = useStudio.getState()
    s.setPreviewAttachment(null)
    s.setPreviewFig(name)
    openFilePreview()
  }
  const previewAtt = (name: string) => {
    const s = useStudio.getState()
    s.setPreviewFig(null)
    s.setPreviewAttachment(name)
    openFilePreview()
  }
  const openFigureBook = () => useStudio.getState().openPanel(makePanelId('figures'))
  const uploadFigs = (files: File[]) => {
    const { ok, bad } = splitFiles(files, figureReject)
    for (const b of bad) toast(`${b.file.name}：${b.reason}`, 'error')
    if (ok.length) void useStudio.getState().uploadFigures(ok)
  }
  const uploadAtts = (files: File[]) => void useStudio.getState().uploadAttachments(files)
  const convertAtt = (a: AttachmentItem) => {
    const s = useStudio.getState()
    s.setConvertAttachment({ pid, name: a.name, size: a.size })
    s.openDialog('convert')
  }
  const firstConvertible = attachments.find((a) => (CONVERT_EXTS as readonly string[]).includes(a.ext.slice(1)))
  const convertFirst = () => {
    const s = useStudio.getState()
    if (firstConvertible) s.setConvertAttachment({ pid, name: firstConvertible.name, size: firstConvertible.size })
    s.openDialog('convert')
  }
  const confirmDeleteAtt = async () => {
    if (!deletingAtt) return
    setDeletingAtt({ ...deletingAtt, busy: true })
    await useStudio.getState().deleteAttachment(deletingAtt.item.name)
    setDeletingAtt(null)
  }

  const editorCurrent = !settingsOpen && !previewFig && !previewAttachment
  return (
    <div data-slot="FileTree" role="tree" aria-label="案卷文件" className="h-full overflow-y-auto overflow-x-hidden px-1 py-1 text-sm" data-testid="file-tree" data-dirty={dirty || undefined} onKeyDown={treeKeyDown}>
      <TreeRow
        id="dir:docs"
        tabStop
        collapsed={!docsOpen}
        onToggle={() => toggleFileTreeCollapsed('docs')}
        onActivate={() => toggleFileTreeCollapsed('docs')}
        icon={<FolderOpen />}
        count={BOOK_NAMES.length}
        title="正文三书：摘要 / 权利要求书 / 说明书"
        testId="file-docs"
      >
        五书正文
      </TreeRow>
      {docsOpen && (
        <div role="group" data-testid="file-docs-list">
          {BOOK_NAMES.map((book) => {
            const { file, label } = BOOK_FILES[book]
            const offset = books?.[book].offset ?? null
            return (
              <TreeRow
                key={book}
                id={`file:docs/${file}`}
                level={1}
                current={editorCurrent && currentBook === book}
                icon={<FileText />}
                disabled={offset === null}
                muted={offset === null}
                tag={offset === null ? '等待解析' : undefined}
                title={offset === null ? `${label} · 等待解析` : `${label} · 点击跳到本书开头`}
                onActivate={() => gotoBook(book)}
                testId="file-book"
              >
                {label}
              </TreeRow>
            )
          })}
        </div>
      )}

      <PlatformDocsGroup />

      <DropDir testId="file-figs-drop" onFiles={uploadFigs} disabled={!canEdit}>
      <TreeRow
        id="dir:figs"
        collapsed={!figsOpen}
        onToggle={() => toggleFileTreeCollapsed('figs')}
        onActivate={() => toggleFileTreeCollapsed('figs')}
        icon={<FolderOpen />}
        count={<span data-testid="file-figs-caption">{figCaption.text}</span>}
        title={figCaption.explain}
        ariaLabel={figCaption.aria}
        testId="file-figs"
        trailing={
          <span className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <UploadDrop compact accept={FIGURE_ACCEPT} label="上传附图" onFiles={uploadFigs} disabled={!canEdit} className="h-5 px-1" testId="file-figs-upload" />
            <button type="button" tabIndex={-1} aria-label="打开附图书" title="打开附图书（顺序 / 宽度 / 摘要图）" className="inline-flex size-5 items-center justify-center rounded-xs text-fg-muted hover:bg-active hover:text-fg-strong" onClick={openFigureBook} data-testid="file-figs-book">
              <BookImage className="size-4" />
            </button>
          </span>
        }
      >
        附图
      </TreeRow>
      {figsOpen && (
        <div role="group" data-testid="file-figs-list">
          {figFiles.length === 0 && (
            <div className="truncate pl-5.5 pr-2 text-xs leading-7 text-fg-subtle">拖入图片即可上传</div>
          )}
          {figFiles.map((f) => {
            const num = f.num
            const refs = num == null ? 0 : refCounts.get(num) ?? 0
            return (
              <TreeRow
                key={f.name}
                id={`file:figs/${f.name}`}
                level={1}
                current={previewFig === f.name}
                icon={<Image />}
                tag={num == null ? '未编入' : refs ? `图${num} · 引用 ${refs}` : `图${num} · 未引用`}
                tagBad={num != null && refs === 0}
                title={
                  num == null
                    ? `${f.name} · 点击预览；尚未编入附图书`
                    : `${f.name} · 点击预览；${refs ? `图${num} 在正文中引用 ${refs} 次` : `图${num} 未在正文中引用`}`
                }
                onActivate={() => previewFigFile(f.name)}
                testId="file-fig"
                trailing={
                  num != null && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`跳到图${num}首个引用`}
                      title="跳到首个引用行"
                      className={cn(HOVER_BTN, 'ml-auto text-2xs font-medium')}
                      onClick={(e) => {
                        e.stopPropagation()
                        gotoFigure(num)
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      data-testid="file-fig-goto"
                    >
                      →
                    </button>
                  )
                }
              >
                {f.name}
              </TreeRow>
            )
          })}
        </div>
      )}
      </DropDir>

      <DropDir testId="file-attachments-drop" onFiles={uploadAtts} disabled={attachmentsUnavailable || !canEdit}>
      <TreeRow
        id="dir:attachments"
        collapsed={!attOpen}
        onToggle={() => toggleFileTreeCollapsed('attachments')}
        onActivate={() => toggleFileTreeCollapsed('attachments')}
        icon={<FolderOpen />}
        count={attachments.length}
        title={`附件 · 任意材料（${ATTACHMENT_EXTS.join(' ')}，单文件 ≤ ${ATTACHMENT_MAX_MB} MB）`}
        testId="file-attachments"
        trailing={
          <span className="ml-auto flex items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {canEdit && !attachmentsUnavailable && (
              <button
                type="button"
                tabIndex={-1}
                aria-label="生成交底书模板"
                title="生成技术交底书模板（七段式），下载后发给发明人填写"
                className={HOVER_BTN}
                onClick={() => void useStudio.getState().seedIntakeTemplate()}
                data-testid="file-attachments-seed-intake"
              >
                <FilePlus2 className="size-3.5" />
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                tabIndex={-1}
                aria-label="一键转专利"
                title={firstConvertible ? `用 ${firstConvertible.name} 转为专利` : '转为专利（交底书 / 论文 → 专利草稿）'}
                className={HOVER_BTN}
                onClick={convertFirst}
                data-testid="file-attachments-convert"
              >
                <Sparkles className="size-3.5" />
              </button>
            )}
            <UploadDrop
              compact
              accept={ATTACHMENT_ACCEPT}
              label="上传附件"
              disabled={attachmentsUnavailable || !canEdit}
              onFiles={uploadAtts}
              className="h-5 px-1"
              testId="file-attachments-upload"
            />
          </span>
        }
      >
        附件
      </TreeRow>
      {attOpen && (
        <div role="group" data-testid="file-attachments-list">
          {attachmentsUnavailable && (
            <div className="pl-5.5 text-xs leading-7 text-fg-subtle" data-testid="file-attachments-todo">附件功能暂不可用</div>
          )}
          {!attachmentsUnavailable && attachmentsError && (
            <div className="pl-5.5 pr-2 text-xs leading-7 text-danger-fg" data-testid="file-attachments-error">
              附件加载失败
              <Button size="xs" variant="link" className="px-1" onClick={() => pid && void useStudio.getState().loadAttachments(pid)}>重试</Button>
            </div>
          )}
          {!attachmentsUnavailable && !attachmentsError && attachments.length === 0 && (
            <div className="truncate pl-5.5 pr-2 text-xs leading-7 text-fg-subtle">拖入交底书 / 参考文件即可上传</div>
          )}
          {attachments.map((a) => (
            <TreeRow
              key={a.name}
              id={`file:attachments/${a.name}`}
              level={1}
              current={previewAttachment === a.name}
              icon={<Paperclip />}
              tag={fmtBytes(a.size)}
              title={`${a.name} · ${fmtBytes(a.size)} · 点击预览`}
              onActivate={() => previewAtt(a.name)}
              testId="file-attachment"
              trailing={
                <span className="ml-auto flex items-center gap-0.5">
                  {canEdit && (CONVERT_EXTS as readonly string[]).includes(a.ext.slice(1)) && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`用 ${a.name} 转为专利`}
                      title="转为专利"
                      className={HOVER_BTN}
                      onClick={(e) => {
                        e.stopPropagation()
                        convertAtt(a)
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      data-testid="file-attachment-convert"
                    >
                      <Sparkles className="size-3.5" />
                    </button>
                  )}
                  <a
                    tabIndex={-1}
                    aria-label={`下载 ${a.name}`}
                    title="下载"
                    className={HOVER_BTN}
                    href={api.attachmentUrl(pid, a.name, true)}
                    download={a.name}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    data-testid="file-attachment-download"
                  >
                    <Download className="size-3.5" />
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`删除 ${a.name}`}
                      title="删除"
                      className={cn(HOVER_BTN, 'hover:text-danger-fg')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingAtt({ item: a, busy: false })
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      data-testid="file-attachment-delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </span>
              }
            >
              {a.name}
            </TreeRow>
          ))}
        </div>
      )}
      </DropDir>
      <DeleteAttachmentDialog item={deletingAtt?.item ?? null} busy={deletingAtt?.busy ?? false} onConfirm={() => void confirmDeleteAtt()} onClose={() => setDeletingAtt(null)} />

    </div>
  )
}
