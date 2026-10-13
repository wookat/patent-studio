import { ConsoleHeaderActions, ConsolePanel } from '@/components/console/ConsolePanel'
import { FiguresPanel } from '@/components/figures/FiguresPanel'
import { LifecyclePanel } from '@/components/lifecycle/LifecyclePanel'
import { SearchPanel } from '@/components/outline/SearchPanel'
import { CheckPanel } from '@/components/problems/CheckPanel'
import { TermsPanel } from '@/components/terms/TermsPanel'
import { useIsDesktop } from '@/hooks/useMisc'
import { registerCompanionBody } from '@/lib/slots'

/**
 * shell-workbench 归属的伴随栏正文（prep-contracts §4：console / problems / terms / figures / search），
 * 经 lib/slots.registerCompanionBody 挂进 CompanionHost，不改 CompanionHost / DesktopShell。
 * 由 TopBar.tsx 副作用引入（工作台壳一定加载）。正文自滚、无 primary。
 */
function ConsoleBody() {
  return <ConsolePanel variant="companion" className="bg-transparent" />
}

function ProblemsBody() {
  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="companion-problems-body">
      <CheckPanel />
    </div>
  )
}

function TermsBody() {
  return <TermsPanel />
}

function FiguresBody() {
  const desktop = useIsDesktop()
  return <FiguresPanel className="h-full" variant={desktop ? 'desktop' : 'mobile'} />
}

function SearchBody() {
  return <SearchPanel />
}

registerCompanionBody('lifecycle', LifecyclePanel)
registerCompanionBody('console', ConsoleBody, ConsoleHeaderActions)
registerCompanionBody('problems', ProblemsBody)
registerCompanionBody('terms', TermsBody)
registerCompanionBody('figures', FiguresBody)
registerCompanionBody('search', SearchBody)
