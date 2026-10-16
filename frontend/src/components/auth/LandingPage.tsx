import { useEffect } from 'react'
import { ArrowRight, BookOpenCheck, Bot, Building2, CheckCircle2, FileStack, FolderKanban, GraduationCap, Landmark, Mail, MessageSquare, PencilRuler, Scale, Send, Server, ShieldCheck, UserRound, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/auth/AuthFrame'

/**
 * 产品落地页（anon 访客入口）：顶栏 + hero + 数字带 + 六功能卡 + 两个深介栏（三视图/附图管线）
 * + 规范细节清单 + 适用场景 + FAQ + 收尾 CTA + 页脚。
 * 登录态用户直接进工作台，#/login 深链仍直达登录框——本页只面向未登录访客。
 * 视觉沿用 VI：brand-hero 底纹 + 篆刻标 + 真实产品截图（public/lp/*.png）+ 语义 token。
 */

const FEATURES = [
  { icon: FolderKanban, title: '案件台账与事务', desc: '十档状态台账、期限红黄绿、OA 轮次与查新记录一体收口' },
  { icon: FileStack, title: '材料成案与三书撰写', desc: '交底书/论文/Word 导入立案；源码 · 版面 · PDF 三视图同源撰写' },
  { icon: PencilRuler, title: 'AI 办案成员', desc: '起草、专利语义检查与十个场景任务；产出只有建议·批注·待确认，逐条等人批' },
  { icon: BookOpenCheck, title: '附图画板与图库', desc: '图源即文本真源、画板精调；公开授权案附图分类参考（114 篇 · 1021 张）' },
  { icon: Users, title: '协同办案', desc: '作者·代理人·机构管理者同卷协作；批注·修订·提案·审批进同一收件箱，客户免登录审阅链' },
  { icon: Send, title: '交付门禁与导出', desc: '体检规则先行纠错，导出 DOCX / PDF / CNIPA 五书 XML；人工核对后走正式递交' },
  { icon: Bot, title: '开放接入外部 Agent', desc: 'Codex / Claude Code / Devin 经 MCP 持凭证进场，与人在同一案卷协同、同一本审计账' },
  { icon: Server, title: '开源可自部署', desc: 'Apache-2.0，一条 compose 命令起全栈；案卷存部署方存储，模型与外发按机构与案件设置' },
]

const STATS = [
  ['全链路', '材料·三书·附图·期限·OA·交付同卷'],
  ['人机协作', 'AI 出建议 · 人做决断'],
  ['开源', 'Apache-2.0 可自托管'],
  ['三态交付', 'DOCX · PDF · CNIPA XML'],
]

const VIEW_POINTS = [
  'Markdown 源码、Word 版面、PDF 成品三视联动——改一处三处同步',
  '建议逐条审回：AI 修改以 CriticMarkup 标记落位，接受/拒绝由人拍板',
  '行内块编辑与选块定位，PDF 点哪改哪',
  '历史版本任意两版 A↔B 对比，全文可回溯',
]

const FIGURE_POINTS = [
  'mmd 图源自研渲染：正交布线、簇框、菱形判据、图例停角——对齐授权件画法',
  '论文抽图自动收编：灰度化、300dpi、按声明图号进附图节',
  '图号声明 ↔ 附图说明 ↔ 正文引用三向核对，悬空图号直接拦截',
  '附图宽度上限、题注孤页、同号多源——规则先行，不靠人眼兜底',
]

const DETAILS = [
  ['权项四型束', '方法/系统/电子设备/存储介质独权齐备，缺型自动检出'],
  ['两段式权项', '「其特征在于」缺失即点名重写，引用句式全标准化'],
  ['所述回指', '术语前后一致压缩——名称绑定标记表逐字核对'],
  ['编号归一', '式号/表号/标号跨书归一，跳号重编自动回正'],
  ['摘要四要素', '领域→问题→方案→效果，限幅截断前要素先齐'],
  ['行文节奏', '其中/可以/具体地/可选地惯例表达对齐授权件密度'],
  ['CNIPA 五书 XML', '100001–100005 五件齐，GB18030、jpg 附图、图号标签'],
  ['确定性体检', 'lint/preflight 规则库先行纠错，不靠抽样碰运气'],
]

const PERSONAS = [
  { icon: UserRound, title: '作者 / 发明人', desc: '提交交底书或想法，在案卷内看稿、批注、与代理人讨论确认——不学专利文体也提得出意见' },
  { icon: PencilRuler, title: '代理人 / 撰写人', desc: 'AI 起草三书与附图初稿、做专利语义检查、整理查新与 OA 争辩思路，机械劳动交给 AI' },
  { icon: Building2, title: '机构管理者', desc: '案件是机构资产：台账、分派、期限、审批、成员与 AI 外发治理一手掌握' },
  { icon: GraduationCap, title: '个人作者 / 开发者', desc: '独立办案压缩为单人循环，AI 补足产能；可自部署、接自选模型、外部 Agent 入场扩展' },
]

const FAQ = [
  ['知撰是做什么的？', '知撰·AI 专利撰写与协同平台把「写专利」从散乱的文件，变成一个案卷里的协作办案：作者提交交底书、论文或想法，机构收案管理并分派代理人，代理人借助 AI 撰写三书与附图，作者与代理人在案卷内审阅、批注、讨论、确认；期限、OA、查新与交付导出都在同一案卷完成。'],
  ['哪些人适合用知撰？', '三类角色在同一份案卷上分工：代理人/撰写人借助 AI 起草与检查，机构管理者管台账、分派、期限与审批，作者/发明人看稿、批注、讨论、确认定稿；个人作者独立使用时同一条办案链路压缩成单人循环。'],
  ['AI 写的专利文稿能保证授权吗？', '不能。本平台产出为机器起草辅助与人审工具，不构成法律意见或授权保证；递交前应自行或委托执业专利代理师核实新颖性、创造性与支持性。'],
  ['我的论文和客户数据安全吗？', '案卷数据存于部署方自有存储，支持按机构/案卷分级授权与操作审计。需要注意：启用远端 AI 或检索服务后，相关材料会发送到对应服务商网关——通道配置由部署方决定。'],
  ['支持什么输入？', '论文 PDF（正文与附图自动抽取）、技术交底书、或直接空白起草；Word DOCX 导入亦可。'],
  ['和通用大模型写专利有何不同？', 'AI 在案卷的上下文里工作：它读的是权项树、说明书支持映射、术语库与图文对应等结构化语义；产出限定为修订建议、批注与待确认操作，逐条等人裁决，并有确定性规则随写随检——不是一次性生成后直接定稿。'],
]

function LoginLink() {
  return <a href="#/login" className="text-sm text-fg-muted hover:text-fg transition-colors">登录</a>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-center text-xl font-semibold text-fg-strong md:text-2xl">{children}</h2>
}

export function LandingPage() {
  useEffect(() => {
    document.title = '知撰·AI 专利撰写与协同平台 — 作者·代理人·机构与 AI 在一个案卷里协作办案'
  }, [])
  return (
    <main className="min-h-dvh bg-app">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-border bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2.5 px-4">
          <BrandMark size="sm" />
          <span className="text-sm font-semibold text-fg-strong">知撰</span>
          <span className="text-xs text-fg-muted max-sm:hidden">· AI 专利撰写与协同平台</span>
          <nav className="ml-auto flex items-center gap-4">
            <a href="#features" className="text-sm text-fg-muted hover:text-fg transition-colors max-md:hidden">功能</a>
            <a href="#scenes" className="text-sm text-fg-muted hover:text-fg transition-colors max-md:hidden">场景</a>
            <a href="#faq" className="text-sm text-fg-muted hover:text-fg transition-colors max-md:hidden">FAQ</a>
            <LoginLink />
            <Button asChild size="sm">
              <a href="#/login">进入工作台</a>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="brand-hero border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-4 py-14 text-center md:py-20">
          <BrandMark className="size-12 rounded-lg shadow-md" />
          <h1 className="mt-5 text-3xl font-semibold text-fg-strong md:text-4xl">
            知撰 · AI 专利撰写与协同平台
          </h1>
          <p className="mt-4 max-w-[56ch] text-base text-fg-muted md:text-lg">
            把「写专利」从散乱的文件，变成一个案卷里的协作办案——作者提交需求、机构管理分派、代理人借助 AI 撰写成稿、作者与代理人在案卷内讨论确认；材料、三书、附图、批注、期限、答复稿与交付文件都在同一案卷。
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Button asChild size="lg">
              <a href="#/login">开始使用 <ArrowRight className="size-4" aria-hidden /></a>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="#features">了解功能</a>
            </Button>
          </div>
          <p className="mt-3 text-xs text-fg-muted">开源自托管 · AI 产出为建议/批注/待确认操作，由人裁决</p>
          <img
            src="/lp/workbench.png"
            alt="知撰工作台实景：左侧案卷与文档大纲，中间说明书源码编辑区，右侧实时 PDF 排版预览——一种时间序列预测模型案卷"
            className="mt-10 w-full max-w-3xl rounded-xl border border-border/60 shadow-sm"
            loading="lazy"
          />
          <p className="mt-3 text-xs text-fg-muted">▲ 真实产品截图：Markdown 源码 → DOCX → PDF 同屏所见所得</p>
        </div>
      </section>

      {/* 数字带 */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-4 py-10 text-center md:grid-cols-4">
          {STATS.map(([num, label]) => (
            <div key={label}>
              <div className="text-xl font-semibold text-fg-strong tabular-nums">{num}</div>
              <div className="mt-1 text-xs text-fg-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 功能 */}
      <section id="features" className="mx-auto max-w-5xl scroll-mt-14 px-4 py-14 md:py-20">
        <SectionTitle>从需求到交付，一个案卷收到底</SectionTitle>
        <p className="mx-auto mt-3 max-w-[60ch] text-center text-sm text-fg-muted">
          不只是“AI 写稿”——材料成案、三书撰写、协同审阅、事务跟踪、附图管线、交付导出一站到底；全链路不是功能多，而是没有缺环。
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-panel p-5 shadow-sm">
              <f.icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold text-fg-strong">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-fg-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 深介 A：三视图协作 */}
      <section className="border-y border-border bg-sunken/50">
        <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-14 md:grid-cols-2 md:py-18">
          <img
            src="/lp/dashboard.png"
            alt="知撰案件台账实景：多案卷列表、状态流转（撰写/定稿）、期限与导出 CSV"
            className="w-full rounded-xl border border-border/60 shadow-sm"
            loading="lazy"
          />
          <div>
            <h3 className="text-lg font-semibold text-fg-strong md:text-xl">三视图协作撰写</h3>
            <p className="mt-2 text-sm leading-6 text-fg-muted">
              源码、版面、成品同一案卷三个视角，AI 起草与人审在一条链上往复。
            </p>
            <ul className="mt-4 space-y-2.5">
              {VIEW_POINTS.map((p) => (
                <li key={p} className="flex gap-2 text-sm leading-6 text-fg-muted">
                  <CheckCircle2 className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 深介 B：附图管线 */}
      <section>
        <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-14 md:grid-cols-2 md:py-18">
          <div className="md:order-2">
            <img
              src="/lp/figlib.png"
              alt="知撰附图图库实景：114 篇公开 CN 授权案 1021 张附图按 A–H 系细类与未分类兜底共 15 组分类参考"
              className="w-full rounded-xl border border-border/60 shadow-sm"
              loading="lazy"
            />
          </div>
          <div className="md:order-1">
            <h3 className="text-lg font-semibold text-fg-strong md:text-xl">确定性附图管线</h3>
            <p className="mt-2 text-sm leading-6 text-fg-muted">
              附图不靠手绘碰运气——图源声明、渲染、核对全由确定性管线收口。
            </p>
            <ul className="mt-4 space-y-2.5">
              {FIGURE_POINTS.map((p) => (
                <li key={p} className="flex gap-2 text-sm leading-6 text-fg-muted">
                  <CheckCircle2 className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 规范细节 */}
      <section className="border-y border-border bg-sunken/50">
        <div className="mx-auto max-w-5xl px-4 py-14 md:py-18">
          <SectionTitle>写进法条的细节</SectionTitle>
          <p className="mx-auto mt-3 max-w-[60ch] text-center text-sm text-fg-muted">
            从千余件授权发明中提炼的文体与格式基线，落成每一条确定性核对。
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DETAILS.map(([t, d]) => (
              <div key={t} className="rounded-xl border border-border bg-panel p-4">
                <h4 className="text-sm font-semibold text-fg-strong">{t}</h4>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 适用场景 */}
      <section id="scenes" className="mx-auto max-w-5xl scroll-mt-14 px-4 py-14 md:py-20">
        <SectionTitle>一个全能的 AI，三副面孔</SectionTitle>
        <p className="mx-auto mt-3 max-w-[60ch] text-center text-sm text-fg-muted">
          同一条办案链路，对不同角色给不同职责；个人作者独立使用时，链路压缩成单人循环，AI 补足产能。
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PERSONAS.map((p) => (
            <div key={p.title} className="rounded-xl border border-border bg-panel p-5 text-center shadow-sm">
              <p.icon className="mx-auto size-6 text-primary" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold text-fg-strong">{p.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-fg-muted">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 合规/安全 */}
      <section className="border-y border-border bg-sunken/50">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-12 text-center md:flex-row md:text-left">
          <ShieldCheck className="size-10 shrink-0 text-primary" aria-hidden />
          <div>
            <h3 className="text-base font-semibold text-fg-strong">私有部署，边界清晰</h3>
            <p className="mt-1.5 max-w-[62ch] text-sm leading-6 text-fg-muted">
              文稿、附图与审阅记录留存在部署方自有存储；案卷级权限、操作审计、会话失效即收权。启用远端 AI 服务时，调用所需材料会发送到所配置的服务商网关——数据边界由部署方掌控。
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-14 px-4 py-14 md:py-20">
        <SectionTitle>常见问题</SectionTitle>
        <div className="mt-8 space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group rounded-xl border border-border bg-panel px-5 py-4 shadow-sm">
              <summary className="cursor-pointer list-none text-sm font-semibold text-fg-strong marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="inline-flex w-full items-center justify-between gap-3">
                  {q}
                  <ArrowRight className="size-4 shrink-0 rotate-90 text-fg-muted transition-transform group-open:-rotate-90" aria-hidden />
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-fg-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 收尾 CTA */}
      <section className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-4 py-14 text-center md:py-20">
          <Scale className="size-8 text-primary" aria-hidden />
          <h2 className="mt-4 text-xl font-semibold text-fg-strong md:text-2xl">现在就开始协作办案</h2>
          <p className="mt-3 max-w-[46ch] text-sm text-fg-muted">登录进入工作台，开始你的下一件专利案卷。</p>
          <Button asChild size="lg" className="mt-6">
            <a href="#/login">进入工作台 <ArrowRight className="size-4" aria-hidden /></a>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-6 text-xs text-fg-muted">
          <span className="flex items-center gap-2"><BrandMark size="sm" className="size-5" />© {new Date().getFullYear()} 知撰 · AI 专利撰写与协同平台</span>
          <span className="flex items-center gap-5">
            <a href="#features" className="hover:text-fg transition-colors">功能</a>
            <a href="#scenes" className="hover:text-fg transition-colors">场景</a>
            <a href="#faq" className="hover:text-fg transition-colors">FAQ</a>
            <a href="#/login" className="hover:text-fg transition-colors">登录</a>
          </span>
          <span className="flex items-center gap-4">
            <a href="#/legal/terms" className="hover:text-fg transition-colors">用户协议</a>
            <a href="#/legal/privacy" className="hover:text-fg transition-colors">隐私政策</a>
            <a href="#/legal/copyright" className="hover:text-fg transition-colors">版权与免责声明</a>
          </span>
          <span className="flex items-center gap-4">
            <a href="mailto:wookat@qq.com" className="flex items-center gap-1.5 hover:text-fg transition-colors"><Mail className="size-3.5" aria-hidden />wookat@qq.com</a>
            <span className="flex items-center gap-1.5" title="微信号"><MessageSquare className="size-3.5" aria-hidden />微信 hveary</span>
            <span className="flex items-center gap-1.5"><Landmark className="size-3.5" aria-hidden />支持私有化部署</span>
          </span>
        </div>
      </footer>
    </main>
  )
}
