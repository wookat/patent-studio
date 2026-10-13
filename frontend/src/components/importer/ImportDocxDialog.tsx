import { CheckCircle2, FileUp, Loader2, RefreshCw } from 'lucide-react'
import { fmtBytes } from '@/lib/format'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import type { ImportReportItem } from '@/lib/types'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { ImportReportPanel } from './ImportReportPanel'
import { StyleSuggestionList } from './StyleSuggestionList'
import { flattenStyle, pickStyle } from './styleLeaves'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const isDocx = (f: File) => f.type === DOCX_MIME || /\.docx$/i.test(f.name)
/** 文件名 → 案卷 ID 候选（后端接受 [A-Za-z0-9_-]；中文名留空由后端按规则生成） */
const slugOf = (name: string) =>
  name.replace(/\.docx$/i, '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40)

/**
 * 导入 Word 文档（docs/plan/10 §7.1，Google Docs 上传转换 + 报告面板）：
 * 1 拖入 / 选择 .docx → 2 样式建议逐项勾选 + 案卷 ID / 标题 → 「创建案卷并打开」→ 3 报告（三书/附图/未映射项）。
 * 成功后 importer slice 已 loadProjects + requestNavigation(open-project)；此处只负责展示。375 全屏。
 * importer slice 在对话框打开时重置（关闭后报告留在 store，供 dockview「导入」面板继续展示）。
 */
export function ImportDocxDialog() {
  const open = useStudio((s) => s.dialog === 'import-docx')
  const closeDialog = useStudio((s) => s.closeDialog)
  const phase = useStudio((s) => s.importPhase)
  const error = useStudio((s) => s.importError)
  const unavailable = useStudio((s) => s.importUnavailable)
  const report = useStudio((s) => s.importReport)
  const importedPid = useStudio((s) => s.importedPid)
  const suggestion = useStudio((s) => s.styleSuggestion)
  const importDocx = useStudio((s) => s.importDocx)
  const suggestStyles = useStudio((s) => s.suggestStyles)
  const resetImporter = useStudio((s) => s.resetImporter)
  const desktop = useIsDesktop()

  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pidInput, setPidInput] = useState('')
  const [title, setTitle] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const leaves = useMemo(() => flattenStyle(suggestion?.style), [suggestion])

  const reset = () => {
    setFile(null)
    setDragOver(false)
    setSuggesting(false)
    setSelected(new Set())
    setPidInput('')
    setTitle('')
    setLocalError(null)
  }
  useEffect(() => {
    if (open) resetImporter()
  }, [open, resetImporter])
  const close = () => {
    closeDialog()
    reset()
  }

  const pick = async (f: File) => {
    if (!isDocx(f)) {
      setLocalError(`「${f.name}」不是 .docx 文件`)
      return
    }
    setLocalError(null)
    setFile(f)
    setPidInput(slugOf(f.name))
    setTitle('')
    setSuggesting(true)
    const s = await suggestStyles(f)
    setSelected(new Set(flattenStyle(s?.style).map((l) => l.key)))
    setSuggesting(false)
    // suggest 失败在选件阶段透出；501 由 import-unavailable 条呈现，不重复提示
    if (s === null) {
      const st = useStudio.getState()
      if (!st.importUnavailable) setLocalError(st.importError ?? '无法解析该文档')
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void pick(f)
  }
  const onZoneKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileRef.current?.click()
    }
  }

  const submit = async () => {
    if (!file) return
    const all = leaves.every((l) => selected.has(l.key))
    const partial = suggestion && !all && selected.size > 0 ? suggestion : null
    await importDocx(file, {
      id: pidInput.trim() || undefined,
      title: title.trim() || undefined,
      apply_styles: all,
      style: partial ? pickStyle(partial.style, selected) : undefined,
    })
  }

  /** 导入完成后点报告项 → 在新案正文中查找该段文本并定位 */
  const locate = (it: ImportReportItem) => {
    const st = useStudio.getState()
    if (!importedPid || st.pid !== importedPid) {
      st.toast('案卷打开后再定位', 'info')
      return
    }
    const needle = it.text.trim().slice(0, 24)
    const line = needle ? st.content.split('\n').findIndex((l) => l.includes(needle)) : -1
    if (line < 0) {
      st.toast('正文中未找到该段（可能已被丢弃）', 'info')
      return
    }
    st.gotoLine(line + 1)
    close()
  }

  const busy = phase === 'uploading'
  const done = phase === 'done' && report
  const shownError = localError ?? (!unavailable && phase === 'error' ? error : null)

  /* 已选文件/已填项 → Esc / 遮罩 / 取消先问「放弃修改？」（done 阶段输入已落案，直接关） */
  const dirty = !done && (file !== null || selected.size > 0 || pidInput.trim() !== '' || title.trim() !== '')
  useBeforeUnload(() => open && dirty)
  const [ask, setAsk] = useState(false)
  const requestClose = () => (dirty ? setAsk(true) : close())

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) requestClose() }}>
      <DialogContent
        className={cn(
          'flex flex-col gap-3 overflow-hidden',
          desktop ? 'max-h-[calc(100dvh-4rem)] max-w-xl' : 'left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0',
        )}
        data-slot="ImportDocxDialog"
        data-testid="import-docx-dialog"
        onInteractOutside={(e) => { if (busy) e.preventDefault() }}
      >
        <DialogHeader>
          <DialogTitle>导入 Word 文档</DialogTitle>
          <DialogDescription>
            把 .docx 转成内核 Markdown 并新建案卷。标题、段落、表格、图片、公式尽力映射；无法映射的原样保留并列入报告。
          </DialogDescription>
        </DialogHeader>

        {/* form 包装使案卷 ID / 发明名称输入框内 Enter = 提交（同其余 10 个 form 对话框）；contents 不改变 flex 布局 */}
        <form className="contents" onSubmit={(e) => { e.preventDefault(); if (file && !busy && !suggesting && !unavailable && !done) void submit() }}>
          <input
            ref={fileRef}
            type="file"
            accept={`.docx,${DOCX_MIME}`}
            className="sr-only"
            aria-label="选择 Word 文档"
            data-testid="import-docx-file"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pick(f)
              e.target.value = ''
            }}
          />

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
          {unavailable && (
            <p className="rounded-sm border border-dashed px-3 py-2 text-xs text-fg-muted" data-testid="import-unavailable">
              Word 导入尚未实现（后端 501）。
            </p>
          )}

          {done ? (
            <>
              <p className="flex items-center gap-1.5 text-sm" data-testid="import-done">
                <CheckCircle2 className="size-4 text-ok-fg" aria-hidden />
                已创建案卷 <code className="rounded bg-sunken px-1">{importedPid}</code>，正在打开。
              </p>
              <ImportReportPanel report={report} onItemClick={locate} />
            </>
          ) : !file ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="拖入 .docx 或点击选择文件"
              data-testid="import-dropzone"
              data-drag={dragOver || undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center text-sm transition-colors',
                'cursor-pointer hover:border-primary/60 hover:bg-hover/40',
                FOCUS_RING,
                dragOver && 'border-primary bg-primary/5',
              )}
              onClick={() => fileRef.current?.click()}
              onKeyDown={onZoneKey}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <FileUp className="size-7 text-fg-muted" aria-hidden />
              <span className="font-medium">拖入 .docx，或点击选择</span>
              <span className="text-xs text-fg-muted">支持 Word 2007+（.docx）；.doc 请先另存为 .docx</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-sm border bg-sunken/40 px-3 py-2 text-sm" data-testid="import-file">
                <FileUp className="size-4 shrink-0 text-fg-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium" title={file.name}>{file.name}</span>
                <span className="shrink-0 text-xs text-fg-muted">{fmtBytes(file.size)}</span>
                <Button type="button" variant="ghost" size="sm" className="h-sm-control shrink-0 px-2 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <RefreshCw className="size-3.5" aria-hidden /> 更换
                </Button>
              </div>

              {suggesting ? (
                <p className="flex items-center gap-1.5 text-xs text-fg-muted" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> 正在提取样式…
                </p>
              ) : suggestion && leaves.length > 0 ? (
                <StyleSuggestionList suggestion={suggestion} selected={selected} onChange={setSelected} />
              ) : (
                !unavailable && <p className="text-xs text-fg-muted">未从文档中提取到可用的排版样式，将使用默认设置。</p>
              )}

              <div className={cn('grid gap-3', desktop && 'grid-cols-[1fr_2fr]')}>
                <div className="space-y-1">
                  <Label htmlFor="import-pid" className="text-xs">案卷 ID</Label>
                  <Input
                    id="import-pid"
                    value={pidInput}
                    disabled={busy}
                    placeholder="留空按文件名生成"
                    pattern="[A-Za-z0-9_\-]*"
                    onChange={(e) => setPidInput(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))}
                    className="h-md-control font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="import-title" className="text-xs">发明名称</Label>
                  <Input
                    id="import-title"
                    value={title}
                    disabled={busy}
                    placeholder="留空取文档标题（或文件名）"
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-md-control text-sm"
                  />
                </div>
              </div>
            </>
          )}

          {shownError && (
            <p role="alert" className="rounded-sm border border-danger-dot/40 bg-danger-bg px-3 py-2 text-xs text-danger-fg" data-testid="import-error">
              {shownError}
            </p>
          )}
        </div>

          <DialogFooter className="shrink-0">
            {done ? (
              <Button type="button" size="sm" onClick={close} data-testid="import-close">关闭</Button>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={requestClose}>取消</Button>
                <Button type="submit" size="sm" disabled={!file || busy || suggesting || unavailable} data-testid="import-submit">
                  {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {busy ? '正在导入…' : '创建案卷并打开'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); close() }} />
    </Dialog>
  )
}
