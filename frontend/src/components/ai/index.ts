import type { ComponentType } from 'react'
import { AiPanel } from './AiPanel'
import { TermsPanel } from '@/components/terms/TermsPanel'
import './slots'

/** 供轨道 D dockview 注册的面板定义（09 §5.3：面板 id `ai` / `terms` 为约定值，与 RailTab 同名） */
export interface PanelDefinition {
  id: 'ai' | 'terms'
  title: string
  component: ComponentType
}

export const aiPanelDefinition: PanelDefinition = { id: 'ai', title: 'AI 智能体', component: AiPanel }
export const termsPanelDefinition: PanelDefinition = { id: 'terms', title: '术语', component: TermsPanel }
export const trackEPanels: readonly PanelDefinition[] = [aiPanelDefinition, termsPanelDefinition]

export { AiPanel } from './AiPanel'
export { SelectionActionBar } from './SelectionActionBar'
export type { EditorExtensionSlotProps, EditorSelectionInfo } from './SelectionActionBar'
export { SseParser, parseChatPayload, readSse } from '@/lib/sse'
export type { ChatEvent, ChatUsage } from '@/lib/sse'
