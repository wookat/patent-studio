import { ArrowRight, BookOpenCheck, Building2, CheckCircle2, FileStack, FolderKanban, GraduationCap, Landmark, Mail, MessageSquare, PencilRuler, Scale, Send, ShieldCheck, UserRound, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/auth/AuthFrame'

/**
 * 产品落地页（anon 访客入口）：顶栏 + hero + 数字带 + 六功能卡 + 两个深介栏（三视图/附图管线）
 * + 规范细节清单 + 适用场景 + FAQ + 收尾 CTA + 页脚。
 * 登录态用户直接进工作台，#/login 深链仍直达登录框——本页只面向未登录访客。
 * 视觉沿用 VI：brand-hero 底纹 + 篆刻标 + 真实产品截图（public/lp/*.png）+ 语义 token。
 */

const FEATURES = [
  { icon: FolderKanban, title: '案件台账与期限', desc: '全案卷台账、法定/内部期限中心、OA 轮次与催办通知一体收口' },
  { icon: FileStack, title: '三视图协作撰写', desc: 'Markdown 源码 ‖ Word 对齐版面 ‖ 真实 PDF，选块定位与行内块编辑' },
  { icon: PencilRuler, title: 'AI 论文转专利', desc: '导入论文或交底书，智能体起草权利要求书/说明书/摘要三书' },
  { icon: BookOpenCheck, title: '确定性附图管线', desc: '图源绘制、灰度化、图号声明、附图说明与正文引用一体核对' },
  { icon: Send, title: '递交体检与导出', desc: '体检规则先行纠错，一键产出 DOCX / PDF / CNIPA 五书 XML' },
  { icon: Users, title: '协同与客户审阅', desc: '多人实时协同、批注修订流、客户免登录确认审阅链接' },
]

const STATS = [
  ['1000+', '授权专利语料对账基线'],
  ['三书一体', '权项/说明书/摘要同案同稿'],
  ['三态交付', 'DOCX · PDF · CNIPA XML'],
  ['私有部署', '数据不出机构域'],
]

const VIEW_POINTS = [
  'Markdown 源码、Word 版面、PDF 成品三视联动——改一处三处同步',
  '提案逐条审回：AI 起草以 CriticMarkup 标记落位，接受/拒绝由人拍板',
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
  { icon: UserRound, title: '个人发明人', desc: '论文/交底书直接转三书，免去从零学专利文体' },
  { icon: Users, title: '代理机构', desc: '多案卷台账 + 客户免登录审阅链，交付效率与留痕兼得' },
  { icon: GraduationCap, title: '高校院所', desc: '课题组成果批量转申请，术语一致性有核对闸兜底' },
  { icon: Building2, title: '企业 IP 部门', desc: '私有部署数据不出域，权限分级 + 审计可追溯' },
]

const FAQ = [
  ['生成的专利能直接递交吗？', '产出即递交级文稿：三书 + 附图节 + CNIPA 五书 XML 包。系统内建百项确定性核对（权项结构、编号、行文、附图引用），把形式问题在递交前拦截；实质新创性判断仍需代理人把关——AI 负责把形式做到无可挑剔。'],
  ['我的论文和客户数据安全吗？', '全栈私有部署：文稿、附图、AI 提案全部存于机构自己的服务器，不经第三方留存；支持按机构/案卷分级授权，操作留审计轨迹。'],
  ['支持什么输入？', '论文 PDF（正文与附图自动抽取）、技术交底书、或直接空白起草；Word DOCX 导入亦可。'],
  ['多人怎么协作？', '实时协同编辑 + 批注修订流；给客户发免登录审阅/确认链接，案内状态随时可视。'],
  ['和通用大模型写专利有何不同？', '垂直管线：授权专利语料对账出的文体基线 + 确定性规则闸，不是单次对话碰运气——同一篇论文每次产出都稳定达标。'],
]

function LoginLink() {
  return <a href="#/login" className="text-sm text-fg-muted hover:text-fg transition-colors">登录</a>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-center text-xl font-semibold text-fg-strong md:text-2xl">{children}</h2>
}

export function LandingPage() {
  return (
    <main className="min-h-dvh bg-app">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-border bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2.5 px-4">
          <BrandMark size="sm" />
          <span className="text-sm font-semibold text-fg-strong">Patent Studio</span>
          <span className="text-xs text-fg-muted max-sm:hidden">· 中国发明专利全链路工作台</span>
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
            把论文变成可递交的中国发明专利
          </h1>
          <p className="mt-4 max-w-[56ch] text-base text-fg-muted md:text-lg">
            从论文 PDF 到三书成稿、附图、CNIPA 递交包——撰写、审阅、附图、递交一条链，规则核对待命于每一环。
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Button asChild size="lg">
              <a href="#/login">开始使用 <ArrowRight className="size-4" aria-hidden /></a>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="#features">了解功能</a>
            </Button>
          </div>
          <p className="mt-3 text-xs text-fg-muted">数据仅存于机构私有部署</p>
          <img
            src="/lp/workbench.png"
            alt="Patent Studio 工作台实景：左侧案卷与文档大纲，中间说明书源码编辑区，右侧实时 PDF 排版预览——一种时间序列预测模型案卷"
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
        <SectionTitle>一台覆盖撰写到递交</SectionTitle>
        <p className="mx-auto mt-3 max-w-[60ch] text-center text-sm text-fg-muted">
          不只是“AI 写稿”——案卷管理、协同审阅、附图管线、递交导出一站到底。
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
            alt="Patent Studio 案件台账实景：多案卷列表、状态流转（撰写/定稿）、期限与导出 CSV"
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
              alt="Patent Studio 附图图库实景：114 篇真实 CN 案 1021 张附图按 15 类工程画法分类参考"
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
        <SectionTitle>谁在用它</SectionTitle>
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
            <h3 className="text-base font-semibold text-fg-strong">私有部署，数据不出域</h3>
            <p className="mt-1.5 max-w-[62ch] text-sm leading-6 text-fg-muted">
              文稿、附图、AI 提案全程留存在机构自有服务器；案卷级权限、操作审计、会话失效即收权——专利未公开前的保密性由架构保证。
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
          <h2 className="mt-4 text-xl font-semibold text-fg-strong md:text-2xl">现在就开始撰写</h2>
          <p className="mt-3 max-w-[46ch] text-sm text-fg-muted">登录进入工作台，从第一篇论文开始生成可递交的专利文稿。</p>
          <Button asChild size="lg" className="mt-6">
            <a href="#/login">进入工作台 <ArrowRight className="size-4" aria-hidden /></a>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-6 text-xs text-fg-muted">
          <span className="flex items-center gap-2"><BrandMark size="sm" className="size-5" />© {new Date().getFullYear()} Patent Studio · 中国发明专利全链路工作台</span>
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
            <span className="flex items-center gap-1.5"><Landmark className="size-3.5" aria-hidden />数据仅存于机构私有部署</span>
          </span>
        </div>
      </footer>
    </main>
  )
}
