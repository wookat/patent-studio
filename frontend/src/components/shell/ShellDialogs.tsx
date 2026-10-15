import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { useCopied } from '@/hooks/useMisc'
import { api } from '@/lib/api'
import { copyText } from '@/lib/download'
import { isValidCaseId, suggestCaseId } from '@/lib/caseId'
import { useStudio } from '@/store'
import { CaseIdField } from './CreateProjectDialog'

/** 顶栏自有对话框（ui.dialog）：重命名 / 复制案卷 / 源码语法 / 关于。在壳内挂一次（ProjectMenu 内），桌面/移动两壳各一份 */
export function ShellDialogs() {
  const id = useStudio((s) => s.dialog)
  const close = useStudio((s) => s.closeDialog)
  return (
    <>
      <RenameProjectDialog open={id === 'rename'} onClose={close} />
      <DuplicateProjectDialog open={id === 'duplicate'} onClose={close} />
      <SyntaxDialog open={id === 'syntax'} onClose={close} />
      <AboutDialog open={id === 'about'} onClose={close} />
    </>
  )
}

/** 把 content.md 第一行一级标题（案名来源，backend read_title）替换为新名称 */
function renameInContent(content: string, next: string): string {
  const lines = content.split('\n')
  const i = lines.findIndex((l) => l.startsWith('# ') && !l.startsWith('## '))
  if (i >= 0) lines[i] = `# ${next}`
  else lines.unshift(`# ${next}`, '')
  return lines.join('\n')
}

/** 重命名 = 改发明名称（一级标题）并立即保存；进入前已由守卫保证无未保存修改 */
function RenameProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dirtyRef = useRef(false)
  const [ask, setAsk] = useState(false)
  useBeforeUnload(() => open && dirtyRef.current)
  const requestClose = () => (dirtyRef.current ? setAsk(true) : onClose())
  return (
    <Dialog open={open} onOpenChange={(v) => !v && requestClose()}>
      <DialogContent data-slot="RenameProjectDialog" data-testid="rename-dialog">
        <DialogHeader>
          <DialogTitle>重命名案卷</DialogTitle>
          <DialogDescription>案名即发明名称（全文一级标题），修改后立即保存并重新排版。</DialogDescription>
        </DialogHeader>
        {open && <RenameForm onDone={onClose} onRequestClose={requestClose} onDirty={(d) => (dirtyRef.current = d)} />}
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
    </Dialog>
  )
}

function RenameForm({ onDone, onRequestClose, onDirty }: { onDone: () => void; onRequestClose: () => void; onDirty: (dirty: boolean) => void }) {
  const title = useStudio((s) => s.project?.title ?? '')
  const saving = useStudio((s) => s.saving)
  const [value, setValue] = useState(title)

  useEffect(() => {
    onDirty(value.trim() !== title)
  }, [value, title, onDirty])

  const submit = async () => {
    const next = value.trim()
    const s = useStudio.getState()
    if (!next || next === title) {
      onDone()
      return
    }
    s.persistMergedContent(renameInContent(s.content, next))
    const ok = await useStudio.getState().save()
    if (ok) onDone()
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="rename-title">发明名称</Label>
        <Input id="rename-title" value={value} onChange={(e) => setValue(e.target.value)} autoFocus required maxLength={200} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onRequestClose}>取消</Button>
        <Button type="submit" disabled={saving || !value.trim()}>保存</Button>
      </DialogFooter>
    </form>
  )
}

/** 复制案卷：新建目录 + 写入当前正文与排版设置（附图文件不随复制，后端暂无接口），完成后切换过去 */
function DuplicateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dirtyRef = useRef(false)
  const [ask, setAsk] = useState(false)
  useBeforeUnload(() => open && dirtyRef.current)
  const requestClose = () => (dirtyRef.current ? setAsk(true) : onClose())
  return (
    <Dialog open={open} onOpenChange={(v) => !v && requestClose()}>
      <DialogContent data-slot="DuplicateProjectDialog" data-testid="duplicate-dialog">
        <DialogHeader>
          <DialogTitle>复制案卷</DialogTitle>
          <DialogDescription>以当前案卷的正文与排版设置新建一份副本并切换过去；附图图片不随副本复制，需在新案卷的附图书中重新上传。</DialogDescription>
        </DialogHeader>
        {open && <DuplicateForm onDone={onClose} onRequestClose={requestClose} onDirty={(d) => (dirtyRef.current = d)} />}
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
    </Dialog>
  )
}

function DuplicateForm({ onDone, onRequestClose, onDirty }: { onDone: () => void; onRequestClose: () => void; onDirty: (dirty: boolean) => void }) {
  const pid = useStudio((s) => s.pid ?? '')
  const title = useStudio((s) => s.project?.title ?? '')
  const projects = useStudio((s) => s.projects)
  const [customId, setCustomId] = useState<string | null>(null)
  const [name, setName] = useState(title ? `${title}（副本）` : '')

  useEffect(() => {
    onDirty(name !== (title ? `${title}（副本）` : '') || customId !== null)
  }, [name, customId, title, onDirty])
  const autoId = suggestCaseId({ caseNo: `${pid}-副本`, existing: projects.map((p) => p.id) })
  const id = customId ?? autoId
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const s = useStudio.getState()
    if (!s.pid) return
    setBusy(true)
    setErr(null)
    try {
      const nid = id.trim()
      const nextTitle = name.trim() || title
      await api.createProject(nid, nextTitle)
      await api.saveContent(nid, nextTitle && nextTitle !== title ? renameInContent(s.content, nextTitle) : s.content)
      if (s.settings) await api.saveSettings(nid, s.settings)
      await s.loadProjects()
      await useStudio.getState().openProject(nid)
      s.toast(`已复制为「${nextTitle || nid}」`, 'success')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="dup-title">发明名称</Label>
        <Input id="dup-title" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
      </div>
      <CaseIdField id="dup-id" value={id} auto={customId === null} onChange={(v) => setCustomId(v === autoId ? null : v)} />
      {err && <p className="text-sm text-danger-fg">{err}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onRequestClose}>取消</Button>
        <Button type="submit" disabled={busy || !isValidCaseId(id)}>复制并打开</Button>
      </DialogFooter>
    </form>
  )
}

const SYNTAX: { code: string; desc: string }[] = [
  { code: '# 发明名称', desc: '全文唯一一级标题，即案名' },
  { code: '## 摘要 / ## 权利要求书 / ## 说明书', desc: '五部分各起新页；说明书内 ### 技术领域 等章节，#### 为小节标题' },
  { code: '1.一种……方法，其特征在于', desc: '权利要求按「序号.」起行；从属权项写「根据权利要求N所述的」' },
  { code: '$$ g_t = clip(…, 0, 1) $$', desc: '独立公式（OMML 原生 Word 公式）；行尾「（3）」为公式编号' },
  { code: 'x_t / x_{t-1} / x_[i]', desc: '行内下标记号 → Word 真下标；例外标识符在 设置 › 下标解析例外' },
  { code: '| 列1 | 列2 |', desc: '说明书表格；表题写在表格前一段（如「表1 对比结果」），可用 <!-- 表格: 三线 --> 声明样式' },
  { code: '```  伪代码  ```', desc: '围栏代码块 → 编号段内多行等宽体' },
  { code: '图1为本发明实施例的……图；', desc: '附图说明；图片文件、顺序与宽度在附图书中声明' },
]

function SyntaxDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  /* 语法例本就给人抄——点 code 行复制原文，短暂「已复制」反馈（useCopied 惯例） */
  const [copied, markCopied] = useCopied<string>()
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-slot="SyntaxDialog" data-testid="syntax-dialog" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>源码语法</DialogTitle>
          <DialogDescription>源码视图的格式约定摘要：照这些写法排版就能识别标题、权项、公式与表格。点示例可复制。</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-4 gap-y-2 text-sm">
          {SYNTAX.map(({ code, desc }, i) => (
            <div key={code} className="contents">
              <dt>
                <button
                  type="button"
                  className="cursor-copy rounded-sm bg-sunken px-1.5 py-0.5 text-left font-mono text-xs text-fg hover:bg-hover"
                  title={copied === code ? '已复制' : '点击复制'}
                  onClick={() => void copyText(code).then((ok) => ok && markCopied(code))}
                  data-testid={`syntax-copy-${i}`}
                >
                  {copied === code ? '已复制' : code}
                </button>
              </dt>
              <dd className="self-center text-fg-muted">{desc}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const health = useStudio((s) => s.health)
  const admin = useStudio((s) => s.user?.is_superuser ?? false)
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-slot="AboutDialog" data-testid="about-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>关于知撰</DialogTitle>
          <DialogDescription>知撰·AI 专利撰写与协同平台：面向中国发明专利的撰写与审阅工作台，源码 / 版面 / PDF 三视图同源，导出 Word 与 PDF。</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-fg-muted">后端</dt>
          <dd>{health ? (health.ok ? '已连接' : '异常') : '未连接'}</dd>
          <dt className="text-fg-muted">LibreOffice</dt>
          <dd>{health?.soffice ? (health.unoserver ? '已就绪（常驻）' : '已就绪') : '未检测到'}</dd>
          {admin && (
            <>
              <dt className="text-fg-muted">案卷目录</dt>
              <dd className="break-all font-mono text-xs">{health?.projects_dir ?? '—'}</dd>
            </>
          )}
        </dl>
        <DialogFooter>
          <Button asChild variant="outline" size="sm">
            <a href="https://github.com/wookat/patent-studio" target="_blank" rel="noreferrer">GitHub</a>
          </Button>
          <Button size="sm" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
