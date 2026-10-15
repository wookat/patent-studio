import { ArrowLeft } from 'lucide-react'
import { BrandMark } from '@/components/auth/AuthFrame'

/**
 * 法务页（生产级合规内容）：#/legal/terms 用户协议 · #/legal/privacy 隐私政策 ·
 * #/legal/copyright 版权与免责声明。匿名与登录态均可达，落地页页脚引流到此。
 */

const DOC_DATE = '2026-10-11'
const DOC_VERSION = 'v1.0'

const DOCS: Record<string, { title: string; sections: [string, string[]][] }> = {
  terms: {
    title: '用户协议（服务条款）',
    sections: [
      ['第一条 总则', [
        '本协议由您（下称「用户」）与知撰·AI 专利撰写与协同平台服务提供方（下称「本平台」）订立。用户注册、登录或以任何方式使用本平台服务，即视为已阅读、理解并同意接受本协议全部条款。',
        '本平台为面向中国发明专利全流程的辅助工作台，提供案卷管理、文稿撰写辅助、附图处理、递交导出与协同审阅等功能。',
      ]],
      ['第二条 服务性质与边界', [
        '本平台为工具型软件：AI 生成内容（含权利要求书、说明书、摘要草稿与检索命中）均为起草辅助与机器初筛结果，不构成法律意见、专利代理意见或新颖性/创造性结论。',
        '依据《专利代理条例》，专利代理业务须由持有执业证的专利代理机构及代理师实施。递交前文稿的实质性审查、权利要求布局决策与递交行为，责任主体为用户或其委托的执业代理人。',
        '本平台不作「保证授权」承诺；因审查员审查意见、现有技术检索范围、申请人自身技术方案等原因导致的驳回、视撤或其他不利结果，本平台不承担责任。',
      ]],
      ['第三条 账号与使用规范', [
        '用户应妥善保管账号凭据，账号项下行为视为用户本人行为。禁止：逆向工程本平台、利用本平台生成违法或侵害他人权益的内容、超出授权范围抓取或导出他人案卷数据。',
        '机构部署场景下，用户与其所属机构之间的数据权限、案卷归属与离职交接，由机构管理策略确定。',
      ]],
      ['第四条 知识产权', [
        '用户上传的论文、交底书、文稿、附图及其他资料，其知识产权归用户或原权利人所有；用户在本平台加工产出的文稿，权利归属按适用法律规定确定，本平台不主张任何权利。',
        '本平台软件、界面设计、语料加工产物（句型骨架、向量索引、图库归类标注）与品牌标识的权利归本平台所有。',
        '内建参考图库/语料素材来源于已公开的中国专利文献（公有领域技术信息），仅供句式与画法风格参考；用户应确保自身文稿实质内容合法合规、不侵害他人在先权利。',
      ]],
      ['第五条 免责与责任限制', [
        '服务按「现状」提供。在法律允许范围内，本平台不就服务的无中断、无错误、绝对安全作担保；对因使用或无法使用服务产生的间接、附带、后果性损失（含利润损失、申请权丧失）不承担赔偿责任。',
        '因不可抗力、第三方服务（网络、云基础设施、开源组件）故障导致的服务异常，本平台免于承担责任但应及时采取补救措施。',
      ]],
      ['第六条 协议变更与争议', [
        '本平台可修订本协议并在页面公示，修订后继续使用视为接受；不同意修订可停止使用并联系导出数据。',
        '本协议适用中华人民共和国法律（不含冲突规范）；争议协商不成的，提交本平台运营主体所在地有管辖权的人民法院处理。',
      ]],
    ],
  },
  privacy: {
    title: '隐私政策',
    sections: [
      ['一、我们处理哪些信息', [
        '账号信息：用户名、显示名、登录凭据（加盐散列存储）、机构归属与角色权限。',
        '业务数据：您创建/上传的案卷、文稿、附图、附件、批注、检索式与操作日志。',
        '技术日志：登录与操作审计记录、错误诊断信息——用于安全审计与故障排查。',
      ]],
      ['二、数据存储与共享', [
        '私有部署场景：您的数据存储于机构自有服务器，本平台运营方原则上不接触、不复制业务数据；SaaS/托管场景（如有）将在部署协议中单独约定存储位置与期限。',
        'AI 处理：文本经您机构配置的大模型通道处理；如启用外部推理服务，仅发送完成功能所必需的最小内容片段，具体通道配置由部署方决定并在机构内公示。',
        '除法律法规要求或您明确授权外，不向第三方出售、共享您的案卷内容。',
      ]],
      ['三、您的权利', [
        '访问与导出：可随时导出自己的案卷文稿（DOCX/PDF/XML）。',
        '更正与删除：可编辑修正业务数据；账号注销与数据删除请联系机构管理员或服务提供方。',
        '审计留痕：重要操作可查询审计记录（管理员可见）。',
      ]],
      ['四、数据安全', [
        '传输加密（HTTPS/TLS）、凭据加盐散列、权限分级与审计轨迹；未公开案卷内容的保密同时取决于部署形态与访问控制配置，请按单位数据政策部署。',
        '如发生可能影响您数据安全的事件，将依法及时告知并处置。',
      ]],
      ['五、政策更新', [
        '本政策可能随法规与产品演进更新并在页面公示；重大变更将以显著方式提示。',
      ]],
    ],
  },
  copyright: {
    title: '版权与免责声明',
    sections: [
      ['版权声明', [
        `© ${new Date().getFullYear()} 知撰。保留所有权利。本平台软件及文档未经许可不得复制、改编或用于再分发。`,
        '平台内嵌的开源组件按其各自许可证使用；中国专利公开文献内容为公有领域技术信息。',
      ]],
      ['免责声明', [
        '本平台产出为辅助文稿与机器初筛，不构成法律意见、专利代理意见，亦不构成对授权前景的任何保证。',
        '用户应自行或委托执业代理人核实文稿的新颖性、创造性、支持性与合规性后递交。',
        '因依赖平台输出直接递交产生的任何后果，由用户自行承担。',
      ]],
      ['第三方内容', [
        '检索命中链接（如 patents.google.com）指向第三方站点，其内容与可用性由第三方负责。',
        '附图图库标注的专利号与题注来自公开文献，供风格参考；平台不授予这些文献中技术方案的实施许可。',
      ]],
    ],
  },
}

export function LegalPage({ page }: { page: string }) {
  const doc = DOCS[page] ?? DOCS.terms
  return (
    <main className="min-h-dvh bg-app">
      <header className="sticky top-0 z-10 border-b border-border bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-2.5 px-4">
          <a href="#/" className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span className="text-sm font-semibold text-fg-strong">知撰</span>
          </a>
          <a href="#/" className="ml-auto inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg transition-colors">
            <ArrowLeft className="size-4" aria-hidden /> 返回
          </a>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-fg-strong">{doc.title}</h1>
        <p className="mt-2 text-xs text-fg-muted">生效日期 {DOC_DATE} · 版本 {DOC_VERSION}</p>
        <nav className="mt-4 flex gap-4 text-xs">
          <a href="#/legal/terms" className={page === 'terms' ? 'font-semibold text-fg-strong' : 'text-fg-muted hover:text-fg'}>用户协议</a>
          <a href="#/legal/privacy" className={page === 'privacy' ? 'font-semibold text-fg-strong' : 'text-fg-muted hover:text-fg'}>隐私政策</a>
          <a href="#/legal/copyright" className={page === 'copyright' ? 'font-semibold text-fg-strong' : 'text-fg-muted hover:text-fg'}>版权与免责声明</a>
        </nav>
        <div className="mt-8 space-y-7">
          {doc.sections.map(([h, paras]) => (
            <section key={h}>
              <h2 className="text-base font-semibold text-fg-strong">{h}</h2>
              {paras.map((p, i) => (
                <p key={i} className="mt-2 text-sm leading-7 text-fg-muted">{p}</p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-10 border-t border-border pt-4 text-xs text-fg-muted">
          如对本文件有任何疑问，请通过机构管理员或本平台联系渠道反馈。
        </p>
      </article>
    </main>
  )
}
