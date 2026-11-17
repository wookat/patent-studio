import { registerCompanionBody } from '@/lib/slots'
import { MaterialsCompanionBody, ProposalsCompanionBody, RunsCompanionBody } from './PlatformCompanion'

/**
 * B17 M4：platform 单元槽位——伴随栏正文（proposals / materials / runs）。
 * 克制批次 S2：提案 / 资料 / 运行不再常驻 Rail（12 → 6），入口在 ⌘K 命令面板与移动端 MoreSheet；
 * 伴随栏正文仍在此注册，`companion` 路由 / 命令面板照常打开。
 */
registerCompanionBody('proposals', ProposalsCompanionBody)
registerCompanionBody('materials', MaterialsCompanionBody)
registerCompanionBody('runs', RunsCompanionBody)
