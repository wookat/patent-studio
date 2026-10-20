import type { Diagnostic } from '@/lib/types'

/** 可自动判定的形式规则目录（与后端 lint.py 的 diagnostic id 前缀一致；新增规则须在此登记） */
export const LINT_RULES: { id: string; name: string; desc: string; severity: Diagnostic['severity'] }[] = [
  { id: 'abstract.limit', name: '摘要字数 ≤ 上限', desc: 'settings.abstract_limit（默认 300）', severity: 'error' },
  { id: 'abstract.empty', name: '摘要非空', desc: '## 摘要 下有正文', severity: 'error' },
  { id: 'claims.numbering', name: '权项编号 1..n 连续', desc: '无跳号 / 重复', severity: 'error' },
  { id: 'claims.forward_ref', name: '从属引用仅指向在前权项', desc: '根据权利要求 N / 如权利要求 N 所述', severity: 'error' },
  { id: 'claims.independent_first', name: '第 1 项为独立权项', desc: '', severity: 'warning' },
  { id: 'claims.characterizing', name: '权项含「其特征在于」', desc: '约 85% 授权件的共同形式', severity: 'warning' },
  { id: 'claims.excluded_matter', name: '权项避开第 25 条排除项', desc: '疾病诊疗/智力活动规则等', severity: 'warning' },
  { id: 'spec.sections', name: '说明书五章节齐全且有序', desc: '技术领域 · 背景技术 · 发明内容 · 附图说明 · 具体实施方式', severity: 'error' },
  { id: 'spec.unknown_section', name: '无未知章节标题', desc: '## / ### 仅限允许的章节名', severity: 'error' },
  { id: 'figures.ref', name: '附图引用与附图说明一致', desc: '图N 均存在且被提及', severity: 'warning' },
  { id: 'figures.abstract', name: '摘要附图存在', desc: 'abstract_figure 文件可读', severity: 'warning' },
  { id: 'figures.source_orphan', name: '收录附图有对应图源', desc: 'figs-src 派生图失去同 stem 图源（改名/删除）时提示', severity: 'warning' },
  { id: 'equation.unclosed', name: '行内公式 $$ 成对', desc: '', severity: 'error' },
  { id: 'style.vague', name: '无不确定性用语', desc: '大约/左右/可能等', severity: 'warning' },
  { id: 'style.trademark', name: '无商标符号', desc: '®™©℠', severity: 'warning' },
  { id: 'style.self_ref', name: '自称统一', desc: '本申请/本发明/本公开不混用（约 86% 授权件统一）', severity: 'warning' },
]
/**
 * 诊断 id 是否属于某规则：后端 lint.py 用 `#` 追加实例后缀（claims.forward_ref#2 / spec.unknown_section#L7 /
 * figures.ref#desc1），历史格式还有 `:`、`.` 与 `lint:` 前缀。
 */
export function matchesRule(id: string, ruleId: string): boolean {
  const bare = id.startsWith('lint:') ? id.slice(5) : id
  if (bare === ruleId) return true
  if (!bare.startsWith(ruleId)) return false
  const sep = bare.charAt(ruleId.length)
  return sep === '#' || sep === ':' || sep === '.'
}

