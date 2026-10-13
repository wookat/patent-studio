import { useState } from 'react'
import { BookOpen, Check, ChevronDown, Copy, Crosshair, Sparkles, Wand2 } from 'lucide-react'
import { diagLocationLabel } from '@/lib/diagLocation'
import type { Diagnostic } from '@/lib/types'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'
import { selectAiEnabled, selectReadonly, useStudio } from '@/store'
import { editorCommands } from '@/components/editor/commands'
import { locateSourceLine } from '@/components/problems/locateSource'
import { applyReplaceFix, deriveReplaceFix } from './fixParser'
import { streamChat } from '@/components/ai/aiModel'
import { findRule } from './consoleUtils'
import { RuleDialog } from './RuleDialog'
import { useCopied } from '@/hooks/useMisc'
import { copyText } from '@/lib/download'

const SOURCE_LABEL: Record<Diagnostic['source'], string> = { build: '构建', lint: '形式检查', boundary: '编号边界', client: '编辑器' }
const TITLE_COLOR: Record<Diagnostic['severity'], string> = {
  error: 'text-danger-fg',
  warning: 'text-warn-fg',
  info: 'text-info',
}
/**
 * 触控（ConsolePanel data-variant=mobile 或 <md 的 html[data-density=touch]，含伴随 Sheet）（06 §2）：
 * 条目内次级动作 / 图标视觉 sm 32，touch-hit 伪元素命中区扩到 44；只有列表主行（定位）保持 44。
 */
const TOUCH = cn(touchHit, 'in-data-[variant=mobile]:size-sm-control in-data-[density=touch]:size-sm-control')
const MOBILE_ICON = TOUCH
const MOBILE_ACTION = cn(touchHit, 'in-data-[variant=mobile]:h-sm-control in-data-[variant=mobile]:px-3 in-data-[density=touch]:h-sm-control')
const MOBILE_INDENT = 'in-data-[variant=mobile]:ml-10'
const ICON_BTN = cn(
  'inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-fg-muted hover:bg-hover hover:text-fg-strong',
  FOCUS_RING,
  MOBILE_ICON,
)
const ACTION = cn(
  'inline-flex h-7 items-center gap-1 rounded px-2.5 text-sm font-medium transition-colors disabled:opacity-50',
  FOCUS_RING,
  MOBILE_ACTION,
)

/**
 * 控制台诊断条目（07 §2.1 / prototype-c .entry）：
 *   标题（三色 14px/600）+ 次行位置 `权利要求 6` / `说明书 · 段落 [0012]`（12px，不出现源码行号）+ 右侧 24px 圆形定位；
 *   人话解释（message）；操作行 [改为「Y」| 复制建议]（仅 fix 存在）· [查看规则说明]· [原始日志]（detail，默认折叠）。
 * fix 可解析为「把 X 改为 Y」（或 deriveReplaceFix 能为该诊断推导具体替换）且该行含 X → 绿色「改为「Y」」直接替换（editorCommands.replaceLine 走 CodeMirror 事务，可撤销；
 * 编辑器未挂载时回退 doc.persistMergedContent）；否则按钮如实叫「复制建议」，只把建议文案复制到剪贴板，不冒充自动修复。
 */
export function ConsoleEntry({ item }: { item: Diagnostic }) {
  const gotoLine = useStudio((s) => s.gotoLine)
  const persistMergedContent = useStudio((s) => s.persistMergedContent)
  const toast = useStudio((s) => s.toast)
  const [collapsed, setCollapsed] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [copied, markCopied] = useCopied()

  const rule = findRule(item.id)
  const title = rule?.name ?? item.message
  const showMessage = title !== item.message
  const content = useStudio((s) => s.content)
  const ast = useStudio((s) => s.ast)
  const replace = deriveReplaceFix(item)
  const fixText = typeof item.fix === 'string' ? item.fix : null
  const readonly = useStudio(selectReadonly)
  const canApply = !readonly && replace != null && item.line != null && applyReplaceFix(content, item.line, replace) != null
  const aiEnabled = useStudio(selectAiEnabled)
  const chatStreaming = useStudio((s) => s.chatStreaming)
  const openCompanion = useStudio((s) => s.openCompanion)
  const setAgentTab = useStudio((s) => s.setAgentTab)
  const locate = (line: number) => locateSourceLine({ book: null, line, source: 'problems' })
  const where = diagLocationLabel(item, ast)
  const loc = item.line != null ? where : [SOURCE_LABEL[item.source], where === '全文' ? null : where].filter(Boolean).join(' · ')

  /** 「AI 修复」：把诊断原文+位置+已有建议打包成任务送进 agent 对话（Solve「Resolve with Solve」同款入口），
   *  agent 走工具循环自查后出 CriticMarkup 提案——确定性替换走上面的「改为」按钮，这里兜不能机械替换的条目 */
  const askAiFix = () => {
    const prompt =
      `请修复这条${SOURCE_LABEL[item.source]}诊断：[${item.severity}] ${item.message}` +
      (item.line != null ? `（位置：${where}，源码第 ${item.line} 行）` : '') +
      (fixText ? `\n已有建议：${fixText}` : '') +
      `\n请用工具定位上下文后给出 CriticMarkup 修订提案（提案由用户点应用），不要大段解释。`
    openCompanion('ai')
    setAgentTab('chat')
    void streamChat(prompt, null, [])
  }

  const onFix = async () => {
    if (!fixText) return
    if (canApply && replace && item.line != null) {
      const applied = applyReplaceFix(useStudio.getState().content, item.line, replace)
      if (applied) {
        if (!editorCommands.replaceLine(applied.line, replace.from, replace.to)) {
          persistMergedContent(applied.content)
          gotoLine(applied.line)
        }
        toast(`已把「${replace.from}」改为「${replace.to}」（${where}）`, 'success')
        return
      }
    }
    if (await copyText(fixText)) {
      markCopied(true)
      toast('已复制建议到剪贴板', 'info')
    } else {
      toast('复制失败：浏览器未授予剪贴板权限', 'error')
    }
  }

  return (
    <li
      data-slot="ConsoleEntry"
      data-testid="console-entry"
      data-severity={item.severity}
      data-id={item.id}
      className="border-b px-4 pb-3 pt-2 text-base transition-colors hover:bg-hover"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className={cn(
            'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg-strong',
            FOCUS_RING,
            'in-data-[variant=mobile]:mt-0 in-data-[density=touch]:mt-0',
            TOUCH,
          )}
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开条目' : '折叠条目'}
          data-testid="console-entry-toggle"
        >
          <ChevronDown className={cn('size-4 transition-transform', collapsed && '-rotate-90')} aria-hidden />
        </button>
        {item.line != null ? (
          <button
            type="button"
            className={cn('min-w-0 flex-1 rounded text-left in-data-[variant=mobile]:min-h-touch in-data-[density=touch]:min-h-touch', FOCUS_RING)}
            onClick={() => locate(item.line!)}
            title={`在源码中定位到${where}`}
            data-testid="console-entry-locate"
          >
            <p className={cn('break-words font-semibold leading-5', TITLE_COLOR[item.severity])} data-testid="console-entry-title">
              {title}
            </p>
            <p className="mt-0.5 text-xs leading-4 text-fg-muted" data-testid="console-entry-loc">
              {loc}
            </p>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <p className={cn('break-words font-semibold leading-5', TITLE_COLOR[item.severity])} data-testid="console-entry-title">
              {title}
            </p>
            <p className="mt-0.5 text-xs leading-4 text-fg-muted" data-testid="console-entry-loc">
              {loc}
            </p>
          </div>
        )}
        {item.line != null && (
          <button
            type="button"
            className={cn(ICON_BTN, 'ml-auto')}
            onClick={() => locate(item.line!)}
            aria-label={`在源码中定位到${where}`}
            title="在源码中定位"
            data-testid="console-entry-goto"
          >
            <Crosshair className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {showMessage && (
            <p className={cn('ml-7 mt-2 break-words leading-5 text-fg', MOBILE_INDENT)} data-testid="console-entry-message">
              {item.message}
            </p>
          )}
          {fixText && (
            <p className={cn('ml-7 mt-1.5 break-words text-sm leading-5 text-fg-muted', MOBILE_INDENT)} data-testid="console-entry-fix">
              建议：{fixText}
            </p>
          )}
          <div className={cn('ml-7 mt-2 flex flex-wrap items-center gap-2 in-data-[variant=mobile]:gap-3 in-data-[density=touch]:gap-3', MOBILE_INDENT)} data-testid="console-entry-actions">
            {fixText && (
              <button
                type="button"
                className={cn(ACTION, canApply ? 'bg-primary text-primary-foreground hover:bg-primary-hover' : 'border border-border-strong bg-panel hover:bg-hover')}
                onClick={() => void onFix()}
                title={canApply ? `把「${replace!.from}」改为「${replace!.to}」（可撤销）` : '此建议需手动修改：点击复制建议文案'}
                data-testid="console-entry-fix-btn"
                data-mode={canApply ? 'apply' : 'suggest'}
              >
                {copied ? <Check className="size-3.5" aria-hidden /> : canApply ? <Wand2 className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {canApply ? `改为「${replace!.to}」` : copied ? '已复制' : '复制建议'}
              </button>
            )}
            {aiEnabled && !readonly && (
              <button
                type="button"
                className={cn(ACTION, 'border border-border-strong bg-panel hover:bg-hover')}
                onClick={askAiFix}
                disabled={chatStreaming}
                title="把这条诊断交给 AI agent：它会自查上下文并给出修订提案（提案需你确认）"
                data-testid="console-entry-ai-fix"
              >
                <Sparkles className="size-3.5" aria-hidden /> AI 修复
              </button>
            )}
            <button
              type="button"
              className={cn(ACTION, 'border border-border-strong bg-panel hover:bg-hover')}
              onClick={() => setRuleOpen(true)}
              data-testid="console-entry-rule"
            >
              <BookOpen className="size-3.5" aria-hidden /> 查看规则说明
            </button>
            {item.detail && (
              <button
                type="button"
                className={cn(ACTION, 'px-1.5 text-fg-muted hover:bg-hover hover:text-fg-strong')}
                onClick={() => setRawOpen((v) => !v)}
                aria-expanded={rawOpen}
                data-testid="console-entry-raw-toggle"
              >
                原始日志 <ChevronDown className={cn('size-3.5 transition-transform', rawOpen && 'rotate-180')} aria-hidden />
              </button>
            )}
          </div>
          {rawOpen && item.detail && (
            <pre
              className={cn('ml-7 mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-sunken px-3 py-2 font-mono text-xs leading-[18px] text-fg', MOBILE_INDENT)}
              data-testid="console-entry-raw"
            >
              {item.detail}
            </pre>
          )}
        </>
      )}
      {ruleOpen && <RuleDialog item={item} open={ruleOpen} onOpenChange={setRuleOpen} />}
    </li>
  )
}
