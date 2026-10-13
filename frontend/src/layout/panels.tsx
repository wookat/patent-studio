import { ClipboardCheck, FileCode2, FileDown, FileSearch, FileText, History, Image, LayoutList, ListTree, Search, Settings, SquareTerminal, BookA, Mail } from 'lucide-react'
import { ConsolePanel } from '@/components/console/ConsolePanel'
import { OutlinePanel } from '@/components/outline/OutlinePanel'
import { HistoryPanel } from '@/components/outline/HistoryPanel'
import { SearchPanel } from '@/components/outline/SearchPanel'
import { FigureBookView } from '@/components/figure-book/FigureBookView'
import { FilePreviewPanel } from '@/components/attachments/FilePreviewPanel'
import { PreflightPanel } from '@/components/preflight/PreflightPanel'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { TermsPanel } from '@/components/terms/TermsPanel'
import { OaPanel } from '@/components/oa/OaPanel'
import { ImportPanel } from '@/components/importer/ImportPanel'
import { FullTextCard, PdfCard, SourceCard, StructureCard } from '@/components/cards'
import type { CardProps } from '@/components/cards'
import { makePanelId, useStudio, type PanelKind } from '@/store'
import { bookViewLabel, getPanel, registerPanel, type PanelComponentProps, type PanelDef } from './registry'

/**
 * 内建面板注册（docs/plan/08-r4-dockview-design.md §3.2；D1 所有）。
 * dockview panel props → 卡片 props 的适配在这里；卡片（D2）与 Rail 面板（现有）都不 import dockview。
 * 波次 3 集成：`ai` `terms` `oa`（轨道 E）与 `import`（轨道 F）用真实组件注册，与 Rail / 控制台 tab 里的同一组件共享 store。
 * 调一次 `registerBuiltinPanels()`（DockviewHost 模块顶层），幂等。
 */

function cardProps(kind: PanelKind, p: PanelComponentProps): CardProps {
  const book = p.params.book ?? 'all'
  return {
    panelId: makePanelId(kind, book),
    kind,
    book,
    active: p.api.isActive,
    onSwitchBook: (b) => useStudio.getState().openPanel(makePanelId(kind, b), { replace: p.api.id }),
  }
}

const bookTitle = (label: string) => (params: PanelComponentProps['params']) => `${label} · ${bookViewLabel(params.book)}`

export const BUILTIN_PANELS: Record<PanelKind, PanelDef> = {
  source: {
    icon: FileCode2,
    label: '源码',
    perBook: true,
    title: (params) => bookViewLabel(params.book),
    component: (p) => {
      const props = cardProps('source', p)
      return props.book === 'all' ? <FullTextCard {...props} /> : <SourceCard {...props} book={props.book} />
    },
  },
  layout: { icon: LayoutList, label: '版面', perBook: true, title: bookTitle('版面'), component: (p) => <StructureCard {...cardProps('layout', p)} /> },
  pdf: { icon: FileText, label: 'PDF', title: () => 'PDF', component: () => <PdfCard /> },
  console: { icon: SquareTerminal, label: '控制台', title: () => '控制台', component: () => <ConsolePanel className="h-full" /> },
  outline: { icon: ListTree, label: '大纲', title: () => '大纲', component: () => <OutlinePanel /> },
  history: { icon: History, label: '版本历史', title: () => '版本历史', component: () => <HistoryPanel /> },
  checks: { icon: ClipboardCheck, label: '递交前体检', title: () => '递交前体检', component: () => <PreflightPanel className="h-full" /> },
  search: { icon: Search, label: '全文搜索', title: () => '全文搜索', component: () => <SearchPanel /> },
  figures: { icon: Image, label: '附图书', title: () => '附图书', component: () => <FigureBookView className="h-full" /> },
  settings: { icon: Settings, label: '排版设置', title: () => '排版设置', component: () => <SettingsPanel /> },
  terms: { icon: BookA, label: '术语', title: () => '术语', component: () => <TermsPanel /> },
  oa: { icon: Mail, label: 'OA 答复', title: () => 'OA 答复', component: () => <OaPanel /> },
  import: { icon: FileDown, label: '导入', title: () => '导入', component: () => <ImportPanel /> },
  file: { icon: FileSearch, label: '文件预览', title: () => '文件预览', component: () => <FilePreviewPanel className="h-full" /> },
}

export function registerBuiltinPanels(): void {
  if (getPanel('source')) return
  for (const [k, d] of Object.entries(BUILTIN_PANELS)) registerPanel(k as PanelKind, d)
}
