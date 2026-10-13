import type { StateCreator } from 'zustand'
import type { ProjectSlice } from './project'
import type { DocSlice } from './doc'
import type { BuildSlice } from './build'
import type { DiagnosticsSlice } from './diagnostics'
import type { ChecksSlice } from './checks'
import type { DeliverSlice } from './deliver'
import type { UiSlice } from './ui'
import type { AstSlice } from './ast'
import type { FiguresSlice } from './figures'
import type { PreflightSlice } from './preflight'
import type { BlocksSlice } from './blocks'
import type { AuthSlice } from './auth'
import type { CommentsSlice } from './comments'
import type { HistorySlice } from './history'
import type { ReviewSlice } from './review'
import type { LayoutSlice } from './layout'
import type { AiSlice } from './ai'
import type { TermsSlice } from './terms'
import type { ConvertSlice } from './convert'
import type { OaSlice } from './oa'
import type { McpSlice } from './mcp'
import type { TemplatesSlice } from './templates'
import type { ImporterSlice } from './importer'
import type { CollabSlice } from './collab'
import type { DashboardSlice } from './dashboard'
import type { FiguresBookSlice } from './figuresBook'
import type { AttachmentsSlice } from './attachments'
import type { CollabCenterSlice } from './collabCenter'
import type { LayoutViewSlice } from './layoutView'
import type { AccountSlice } from './account'
import type { FocusSlice } from './focus'
import type { AgentSlice } from './agent'
import type { DeadlinesSlice } from './deadlines'
import type { NotifySlice } from './notify'
import type { PublicShareSlice } from './publicShare'
import type { AdminSlice } from './admin'

export type Studio = ProjectSlice & DocSlice & BuildSlice & DiagnosticsSlice & ChecksSlice & DeliverSlice & UiSlice & AstSlice &
  FiguresSlice & PreflightSlice & BlocksSlice & AuthSlice & CommentsSlice & HistorySlice & ReviewSlice & LayoutSlice &
  AiSlice & TermsSlice & ConvertSlice & OaSlice &
  McpSlice & TemplatesSlice & ImporterSlice & CollabSlice & DashboardSlice &
  FiguresBookSlice & AttachmentsSlice & CollabCenterSlice & LayoutViewSlice & AccountSlice &
  FocusSlice & AgentSlice & DeadlinesSlice & NotifySlice & PublicShareSlice & AdminSlice

/** 所有 slice 共用的 creator 类型（中间件顺序：subscribeWithSelector → persist） */
export type Slice<T> = StateCreator<
  Studio,
  [['zustand/subscribeWithSelector', never], ['zustand/persist', unknown]],
  [],
  T
>
