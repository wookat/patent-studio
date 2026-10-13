import { AiPanel } from '@/components/ai'
import { PanelErrorBoundary } from '@/components/ui/error-boundary'
import { useStudio } from '@/store'

/**
 * 375「AI」Tab 全屏页（05 §3.19 / S10d）：只做容器——页签由 <AiPanel/> 自带的面板内 Tabs（对话 / 场景 / 建议 / 任务，绑定 store.agentTab，移动 min-h 44）提供，
 * 不再叠壳级 Segmented（旧 W5 双层 Tab 下线）。内容区可滚，输入框由 AiPanel 贴底；
 * 内边距走 Sheet 规格（06-w8 §5：左右 / 底 16、顶 8），底部 Tab bar 自带 safe-area。这是移动端 AI 的唯一入口（?panel=ai 由 MobileShell 并入本 Tab）。
 * AI 一切改动仍是 CriticMarkup 建议 / 批注或需确认的 Proposal，本页只负责容器。
 */
export function MobileAiTab() {
  const agentTab = useStudio((s) => s.agentTab)
  return (
    <section data-slot="MobileAiTab" data-testid="mobile-ai-tab" className="flex h-full min-h-0 flex-col bg-panel" aria-label="AI 助手">
      <div className="min-h-0 flex-1 overflow-y-auto px-sheet-m pb-sheet-m pt-sheet-top-m" data-testid="mobile-ai-body" data-agent-tab={agentTab}>
        {/* 单元崩溃只死本页：返回编辑出口到 store（375 无伴随栏可关） */}
        <PanelErrorBoundary label="AI" onClose={() => useStudio.getState().setMobileTab('edit')}>
          <AiPanel />
        </PanelErrorBoundary>
      </div>
    </section>
  )
}
