import { Construction } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CompanionPanel, type CompanionPresentation } from '@/components/ui/companion-panel'
import { PanelErrorBoundary } from '@/components/ui/error-boundary'
import { EmptyState } from '@/components/ui/empty-state'
import { parseHash, writeCompanionHash } from '@/lib/hash'
import { useCompanionBodies } from '@/lib/slots'
import { isCompanionId, useStudio, type CompanionId } from '@/store'
import { COMPANION_META } from './companionMeta'

export { COMPANION_META }

/**
 * CompanionHost（W6 prep 骨架；prep 之后 DesktopShell.tsx / 本文件都不需要改）：
 * 订阅 store.companion / companionWidth，渲染 CompanionPanel 壳，并按 id 路由到各单元通过 `registerCompanionBody(id, Body)`（lib/slots.ts）注册的正文。
 * 归属：ai-panel → 'ai'；collab-review-history → 'review' / 'history'；shell-workbench → 'console' / 'problems' / 'terms' / 'figures' / 'search'；
 * dashboard → 'deadlines' / 'notify'（工作台内摘要）。未注册的 id 显示占位 EmptyState。
 * `presentation` 由壳传入：DesktopShell 恒 'column'；MobileShell 用 'sheet-right'（≥640）/ 'sheet-bottom'（<640）。
 */
function Placeholder({ id }: { id: CompanionId }) {
  const meta = COMPANION_META[id]
  return (
    <EmptyState
      size="sm"
      icon={Construction}
      title={`${meta.title}面板`}
      reason={`由 ${meta.unit} 单元在 CompanionHost.tsx 接入正文`}
      data-testid={`companion-placeholder-${id}`}
    />
  )
}

/**
 * hash ⇄ store 同步（05 §3.2）：`#/p/<pid>?panel=<id>` ⇒ openCompanion，hash 去掉 ?panel ⇒ closeCompanion（hashchange 时 hash 为真源）；
 * store.companion 变化 ⇒ replace 回写 ?panel=（关闭则删参）。
 * 只在工作台路由生效；单元不必再写 hash。
 */
function useCompanionHashSync() {
  useEffect(() => {
    const apply = () => {
      const r = parseHash()
      if (r.kind !== 'project') return
      const p = r.query.panel
      const st = useStudio.getState()
      if (p && isCompanionId(p)) {
        if (st.companion !== p) st.openCompanion(p)
      } else if (p) {
        /* 无效 panel id（手改 URL / 旧链接）：按「无 panel」处理并清参，不赖在地址栏被转发 */
        if (st.companion) st.closeCompanion() /* closeCompanion 订阅回写顺带删参 */
        else writeCompanionHash(null)
      } else if (st.companion) st.closeCompanion()
    }
    apply()
    window.addEventListener('hashchange', apply)
    // store → hash 用 subscribe 而非 effect 依赖：避免首帧闭包里 companion 仍为 null 时把 ?panel= 抹掉
    const unsub = useStudio.subscribe((s) => s.companion, (id) => writeCompanionHash(id))
    return () => {
      window.removeEventListener('hashchange', apply)
      unsub()
    }
  }, [])
}

export function CompanionHost({ presentation = 'column' }: { presentation?: CompanionPresentation }) {
  useCompanionHashSync()
  const id = useStudio((s) => s.companion)
  const width = useStudio((s) => s.companionWidth)
  const closeCompanion = useStudio((s) => s.closeCompanion)
  const setCompanionWidth = useStudio((s) => s.setCompanionWidth)
  const bodies = useCompanionBodies()
  if (!id) return null
  const meta = COMPANION_META[id]
  const entry = bodies.filter((b) => b.id === id).at(-1)
  const Body = entry?.Component
  const Actions = entry?.actions
  return (
    <CompanionMotion key={id}>
      <CompanionPanel
      id={id}
      title={meta.title}
      icon={meta.icon}
      width={width}
      onWidthChange={setCompanionWidth}
      onClose={closeCompanion}
      presentation={presentation}
      actions={Actions ? <Actions /> : undefined}
      data-testid="companion-host"
    >
      {/* 面板单元崩溃只死面板：边界在 CompanionPanel 内侧，顶栏关闭钮始终可用 */}
      <PanelErrorBoundary key={id} label={meta.title} onClose={closeCompanion}>
        {Body ? <Body /> : <Placeholder id={id} />}
      </PanelErrorBoundary>
    </CompanionPanel>
    </CompanionMotion>
  )
}

/** 伴随栏进出场：右缘滑入 + 淡出；切面板 key=id 同一过渡 */
function CompanionMotion({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="h-full"
    >
      {children}
    </motion.div>
  )
}

