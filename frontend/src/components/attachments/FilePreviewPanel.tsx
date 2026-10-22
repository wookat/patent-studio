import { FileQuestion } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { FigureItem } from '@/types/figures'
import { selectAiEnabled, useStudio } from '@/store'
import { figPreviewName } from '@/components/outline/fileTreeUtils'
import { gotoAiChat } from '@/components/ai/aiModel'
import { AttachmentPreview } from './AttachmentPreview'

export interface FilePreviewPanelProps {
  className?: string
}

const NO_FIGURES: FigureItem[] = []

/**
 * 文件树点开的预览面（15 §4.3）：目标来自 store —— figuresBook.previewFig（figs/）或 attachments.previewAttachment（attachments/），二者互斥。
 * 桌面：dockview `file` 面板；移动：NavDrawer「案卷文件」tab 内替换文件树（带返回）。
 * figs/：svg / png / jpg 直接显示；emf 用 GET /figures 给的伴生 preview；没有伴生时只给下载。
 */
export function FilePreviewPanel({ className }: FilePreviewPanelProps) {
  const pid = useStudio((s) => s.pid)
  const fig = useStudio((s) => s.previewFig)
  const att = useStudio((s) => s.previewAttachment)
  const figures = useStudio((s) => (s.figuresPid === s.pid ? s.figures : NO_FIGURES))
  const figsV = useStudio((s) => s.figsVersion)
  const attItem = useStudio((s) => (att ? s.attachments.find((a) => a.name === att) ?? null : null))
  const aiEnabled = useStudio(selectAiEnabled)

  if (!pid || (!fig && !att)) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-fg-muted', className)} data-testid="file-preview-empty">
        <FileQuestion className="size-8" aria-hidden />
        <p>在左侧「案卷文件」里点开附图或附件即可预览</p>
      </div>
    )
  }

  if (fig) {
    const previewName = figPreviewName(fig, figures)
    return (
      <AttachmentPreview
        name={fig}
        kind={previewName ? 'image' : 'binary'}
        url={api.figUrl(pid, previewName ?? fig, figsV)}
        downloadUrl={api.figUrl(pid, fig, figsV)}
        className={className}
      />
    )
  }

  /* 「带入 Agent」：材料名入 aiChatMaterials（显式 chip 授权，scope.materials 白名单 + 服务端自抽文本），
     打开 AI 对话页签；不自动发送、不扩大授权，chip 可撤销。figs/ 不走此路（scope 只认 attachments 目录） */
  const bringToAgent = () => {
    const s = useStudio.getState()
    const already = s.aiChatMaterials.includes(att!)
    s.addAiChatMaterial(att!)
    gotoAiChat()
    s.toast(already ? `《${att}》已在 AI 对话上下文` : `已把《${att}》带入 AI 对话上下文（可撤销，不自动发送）`, 'info')
  }

  return (
    <AttachmentPreview
      name={att!}
      kind={attItem?.kind ?? 'binary'}
      url={attItem?.url ?? api.attachmentUrl(pid, att!)}
      downloadUrl={api.attachmentUrl(pid, att!, true)}
      onAgent={aiEnabled ? bringToAgent : undefined}
      className={className}
    />
  )
}
