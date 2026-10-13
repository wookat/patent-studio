import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ProjectSummary } from '@/lib/types'
import { useStudio, type NavAction } from '@/store'
import { LABEL_NEW_PROJECT } from '@/lib/copy'

function describe(a: NavAction, projects: ProjectSummary[]): { verb: string; cont: string } {
  switch (a.type) {
    case 'open-project': {
      const p = projects.find((x) => x.id === a.pid)
      return { verb: `切换到《${p?.title || a.pid}》`, cont: '保存并切换' }
    }
    case 'restore-backup':
      return { verb: `载入备份 ${a.name}`, cont: '保存并载入' }
    case 'create-project':
      return { verb: LABEL_NEW_PROJECT, cont: '保存并继续' }
    case 'dashboard':
      return { verb: '返回案卷面板', cont: '保存并返回' }
    case 'custom':
      return { verb: a.label, cont: '保存并继续' }
  }
}

/**
 * 未保存守卫（02 §5，痛点 #1）：ui.dirtyGuard.pending 非空时弹出，三选一
 *   保存并继续（默认焦点）/ 放弃修改 / 取消（Esc、遮罩、× 同为取消）。
 * 与 StoreBootstrap 的 beforeunload 守卫共用 selectDirty；由 DesktopShell / MobileShell 各挂一份。
 */
export function DirtyGuardDialog() {
  const pending = useStudio((s) => s.dirtyGuard.pending)
  const resolve = useStudio((s) => s.resolveNavigation)
  const saving = useStudio((s) => s.saving)
  const projects = useStudio((s) => s.projects)
  const saveWrap = useRef<HTMLSpanElement>(null)
  const desc = pending ? describe(pending, projects) : null
  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && void resolve('cancel')}>
      <DialogContent
        data-slot="DirtyGuardDialog"
        data-testid="dirty-guard"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          saveWrap.current?.querySelector('button')?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>有未保存的修改</DialogTitle>
          <DialogDescription>
            {desc ? `${desc.verb}前，是否保存当前案卷？` : ''}
            保存会自动备份上一版并记入版本历史；「放弃修改」会丢失本次编辑。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => void resolve('cancel')} data-testid="dirty-cancel">取消</Button>
          <Button variant="outline" className="border-danger-fg/40 text-danger-fg hover:bg-danger-bg hover:text-danger-fg" onClick={() => void resolve('discard')} data-testid="dirty-discard">
            放弃修改
          </Button>
          <span ref={saveWrap} className="contents">
            <Button onClick={() => void resolve('save')} disabled={saving} data-testid="dirty-save">
              {saving && <Loader2 className="animate-spin" />}
              {desc?.cont ?? '保存并继续'}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
