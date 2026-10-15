import { Activity, Bell, Bot, Bug, CalendarClock, Clock, FileStack, GitPullRequest, Image, MessageSquareText, Milestone, Search, SpellCheck2, TerminalSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CompanionId } from '@/store'

/** 伴随栏面板元数据（标题/图标/归属单元）：CompanionHost 壳与 ⌘K 命令面板共用——单独成模块，避免 App 根级消费者把工作台壳分包拉回主包 */
export const COMPANION_META: Record<CompanionId, { title: string; icon: ReactNode; unit: string }> = {
  ai: { title: 'AI 智能体', icon: <Bot />, unit: 'ai-panel' },
  review: { title: '审阅', icon: <MessageSquareText />, unit: 'collab-review-history' },
  history: { title: '版本历史', icon: <Clock />, unit: 'collab-review-history' },
  console: { title: '控制台', icon: <TerminalSquare />, unit: 'shell-workbench' },
  problems: { title: '问题', icon: <Bug />, unit: 'shell-workbench' },
  terms: { title: '术语', icon: <SpellCheck2 />, unit: 'shell-workbench' },
  figures: { title: '附图书', icon: <Image />, unit: 'shell-workbench' },
  search: { title: '全文搜索', icon: <Search />, unit: 'shell-workbench' },
  deadlines: { title: '期限', icon: <CalendarClock />, unit: 'dashboard' },
  notify: { title: '通知', icon: <Bell />, unit: 'dashboard' },
  lifecycle: { title: '流程', icon: <Milestone />, unit: 'dashboard' },
  // B17 M4：平台案件面板（platform 单元，registerCompanionBody 挂载；纯旧案显示未迁移空态）
  proposals: { title: '提案', icon: <GitPullRequest />, unit: 'platform' },
  materials: { title: '资料事实', icon: <FileStack />, unit: 'platform' },
  runs: { title: '运行', icon: <Activity />, unit: 'platform' },
}
