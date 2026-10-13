import { ChevronDown, Download, FileText, PackageCheck } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { api } from '@/lib/api'
import { downloadFile } from '@/lib/download'
import { goDeliver } from '@/lib/hash'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio, selectDirty, selectStale } from '@/store'
import { MenuContent, MenuLabel, MenuRow, MenuSeparator } from '@/components/ui/menu-bits'
import { fmtClock } from '@/lib/format'

/**
 * 导出菜单项（顶栏「导出 ▾」与 文件 › 导出 ▸ 共用）：
 *   下载 DOCX / 下载 PDF（上次成功构建的产物；构建失败 / 过期 / 未保存时副文案「上次成功构建 HH:MM」）
 *   ─ 递交页…（#/p/<pid>/deliver，W4-E：CNIPA XML / 修订版 DOCX / 附图 zip / 递交包与体检总览都在那里，带时间与大小，docs/plan/17 §2.5）。
 * 有未保存修改时经 ui.requestNavigation 守卫（先保存再导出，05 §4）。
 */
export function ExportMenuItems({ noIcon = false }: { noIcon?: boolean }) {
  const pid = useStudio((s) => s.pid)
  const lastOk = useStudio((s) => s.lastOk)
  const lastOkAt = useStudio((s) => s.lastOkAt)
  const phase = useStudio((s) => s.phase)
  const stale = useStudio(selectStale)
  const dirty = useStudio(selectDirty)
  const pages = useStudio((s) => s.lastOk?.summary?.pages ?? null)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const toast = useStudio((s) => s.toast)

  const hasOk = lastOk !== null && pid !== null
  const outdated = hasOk && (phase === 'error' || stale || dirty)
  const sub = outdated ? `上次成功构建 ${fmtClock(lastOkAt)}` : undefined

  const guarded = (label: string, run: () => void | Promise<void>) => requestNavigation({ type: 'custom', label, run })

  const exportFile = (fmt: 'docx' | 'pdf') => {
    if (!pid || !lastOk) return
    guarded(`下载 ${fmt.toUpperCase()}`, () => {
      const s = useStudio.getState()
      const buildId = s.lastOk?.build_id ?? lastOk.build_id
      return downloadFile(api.exportUrl(pid, fmt, buildId)).then(
        () => undefined,
        (e: unknown) => toast(`下载失败：${e instanceof Error ? e.message : String(e)}`, 'error'),
      )
    })
  }

  return (
    <>
      {dirty && hasOk && <MenuLabel>有未保存修改，导出前会先提示保存</MenuLabel>}
      <MenuRow noIcon={noIcon} icon={<FileText />} disabled={!hasOk} onSelect={() => exportFile('docx')} sub={sub} data-testid="export-docx">
        下载 DOCX
      </MenuRow>
      <MenuRow noIcon={noIcon} icon={<FileText />} disabled={!hasOk} onSelect={() => exportFile('pdf')} sub={sub ?? (pages != null ? `${pages} 页` : undefined)} data-testid="export-pdf">
        下载 PDF
      </MenuRow>
      <MenuSeparator />
      <MenuRow noIcon={noIcon} icon={<PackageCheck />} disabled={!pid} onSelect={() => pid && goDeliver(pid)} sub="体检 · CNIPA XML · 修订版 · 附图 zip · 递交包" data-testid="open-deliver-page">
        递交页…
      </MenuRow>
    </>
  )
}

/** 顶栏右侧「导出 ▾」：绿色 24px 圆角主按钮（原型 button.primary），取代 DeliverMenu */
export function ExportMenu({ className }: { className?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-base font-semibold text-primary-foreground transition-colors',
            'hover:bg-primary-hover data-[state=open]:bg-primary-hover', FOCUS_RING,
            className,
          )}
          aria-label="导出"
          data-slot="ExportMenu"
          data-testid="export-menu"
        >
          <Download className="size-4" aria-hidden />
          <span>导出</span>
          <ChevronDown className="size-3.5 opacity-80" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <MenuContent align="end" className="min-w-[260px]">
        <ExportMenuItems />
      </MenuContent>
    </DropdownMenu>
  )
}
