import { ABSTRACT_NEAR_LIMIT_ID } from '@/components/editor/abstractLint'
import { RULE_LABEL } from '@/components/preflight/preflightUtils'
import { LINT_RULES, matchesRule } from '@/components/problems/lintRules'
import type { Diagnostic } from '@/lib/types'
import type { ConsoleTab } from '@/store'

/** 编辑器即时规则（source='client'，不计入 CheckPanel 的 10 条形式检查） */
const CLIENT_RULES: typeof LINT_RULES = [
  { id: ABSTRACT_NEAR_LIMIT_ID, name: '摘要接近字数上限', desc: '摘要字数 ≥ 上限的 95%（默认 285/300）时预警；超限才报错', severity: 'warning' },
]

/** 递交前体检经 lint 并入的诊断（id = preflight.<rule>#<n>，不计入十条形式检查） */
const PREFLIGHT_RULES: typeof LINT_RULES = Object.entries(RULE_LABEL).map(([id, name]) => ({
  id: `preflight.${id}`,
  name,
  desc: '递交前体检（控制台「体检」tab 可看完整报告）',
  severity: id === 'abstract.limit' || id === 'claims.forward_ref' || id === 'figures.ref_missing' ? 'error' : 'warning',
}))

/** 术语一致性（轨道 E，backend/src/patent_studio/kernel/terms_lint.py；id = terms.alias#<n>，带 replace）；不计入十条形式检查 */
const TERMS_RULES: typeof LINT_RULES = [
  { id: 'terms.alias', name: '术语统一：别名应改为主名', desc: '术语表（terms.json）里的别名在正文出现；一键改为主名或在「术语」面板整案统一', severity: 'warning' },
]

export function findRule(id: string) {
  return [...LINT_RULES, ...CLIENT_RULES, ...PREFLIGHT_RULES, ...TERMS_RULES].find((r) => matchesRule(id, r.id)) ?? null
}

export function filterItems(items: Diagnostic[], tab: ConsoleTab): Diagnostic[] {
  if (tab === 'error' || tab === 'warning' || tab === 'info') return items.filter((d) => d.severity === tab)
  return items
}
