import { FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStudio } from '@/store'
import type { ImportReportItem } from '@/lib/types'
import { ImportReportPanel } from './ImportReportPanel'

/**
 * dockview「导入」面板（波次 3 集成）：导入向导本身仍是 ImportDocxDialog（跨案卷动作，须走 requestNavigation 脏保护）；
 * 面板承载最近一次导入报告（三书切分 / 附图 / 未映射项），点报告项在当前案正文中定位。无报告时只有入口按钮。
 */
export function ImportPanel() {
  const report = useStudio((s) => s.importReport)
  const importedPid = useStudio((s) => s.importedPid)
  const pid = useStudio((s) => s.pid)

  const openWizard = () =>
    useStudio.getState().requestNavigation({ type: 'custom', label: '导入 Word 文档', run: () => useStudio.getState().openDialog('import-docx') })

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
  }

  return (
    <div data-slot="ImportPanel" data-testid="import-panel" className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {report ? (importedPid === pid ? '本案由 Word 导入生成' : `最近导入：${importedPid}`) : '把 .docx 交底书 / 申请文件转成三书 Markdown 新案'}
        </p>
        <Button size="sm" variant={report ? 'outline' : 'default'} onClick={openWizard} data-testid="import-panel-open">
          <FileDown className="size-4" aria-hidden />
          导入 Word…
        </Button>
      </div>
      {report && <ImportReportPanel report={report} onItemClick={locate} />}
    </div>
  )
}
