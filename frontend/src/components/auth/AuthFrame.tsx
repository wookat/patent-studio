import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 匿名页外壳（S8 s8-login.html）：≥ md 两栏 —— 左品牌区 bg-sunken（logo · 产品名 · 一句价值 · 四步流程 · 白纸样张），右表单卡 max 400 r-xl sh-md bg-panel；
 * < md 单栏 —— 品牌区压成 120 高一行（logo 不隐藏），表单直接铺在 bg-app 上无卡。
 * 仅展示层；登录页 / 分享领取页共用。
 */
const FLOW = ['作者提交需求 · 机构管理分派', '代理人借助 AI 撰写三书与附图', '案卷内批注 · 讨论 · 确认定稿', '期限 · OA · 查新跟进，体检后交付']

export function BrandMark({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' }) {
  return (
    <img
      src="/logo-mark.svg"
      alt=""
      aria-hidden
      className={cn('shrink-0 rounded-md', size === 'md' ? 'size-8' : 'size-7 rounded-sm', className)}
    />
  )
}

function PaperSample() {
  return (
    <div aria-hidden className="mt-auto hidden overflow-hidden rounded-md bg-panel shadow-md lg:block">
      <div className="flex h-7 items-center gap-2 border-b border-border bg-app px-2.5 text-2xs text-fg-muted">
        <span className="size-1.5 rounded-full bg-ok-dot" />
        WK2026-0012 · 说明书 · 构建 #47
      </div>
      <div className="grid h-38 grid-cols-2">
        <pre className="m-0 overflow-hidden border-r border-border px-3 py-2.5 font-mono text-2xs leading-4 text-fg-muted">
          {'45 ## 说明书\n47 ### 技术领域\n49 本发明涉及时间序列预测与机器\n   学习模型部署技术领域……\n51 ### 背景技术\n53 时间序列预测广泛应用于电力\n   负荷、电价、交通流量……'}
        </pre>
        <div className="flex items-center justify-center bg-paper-canvas">
          <div className="h-30 w-23 space-y-1 bg-paper p-2 text-paper-fg shadow-paper">
            <div className="mx-auto h-1 w-6 rounded-full bg-fg-subtle/40" />
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className={cn('h-0.5 rounded-full bg-fg-subtle/30', i % 4 === 3 ? 'w-2/3' : 'w-full')} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AuthBrand() {
  return (
    <section aria-label="产品介绍" className="brand-hero flex flex-col border-b border-border px-4 py-3 md:border-r md:border-b-0 md:p-8">
      <div className="flex items-center gap-2 md:gap-2.5">
        <BrandMark size="sm" className="md:hidden" />
        <BrandMark className="max-md:hidden" />
        <span className="text-base font-semibold text-fg-strong">知撰</span>
        <span className="text-xs text-fg-muted">· AI 专利撰写与协同平台</span>
      </div>
      <p className="mt-1 text-xs text-fg-muted md:hidden">AI 专利撰写与协同平台</p>
      <p className="mt-8 max-w-[26ch] text-2xl font-semibold text-fg-strong max-md:hidden">AI 专利撰写与协同平台</p>
      <p className="mt-2 max-w-[44ch] text-base text-fg-muted max-md:hidden">
        把「写专利」从散乱的文件收进同一个案卷：作者提交需求、机构管理分派、代理人借助 AI 撰写成稿、作者与代理人在案卷内审阅、批注、讨论、确认，期限 · OA · 查新与交付导出都在同一条链上。
      </p>
      <ol className="mt-6 max-md:hidden">
        {FLOW.map((t, i) => (
          <li key={t} className="flex h-8 items-center gap-3 text-sm text-fg">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-panel text-2xs text-fg-muted tabular-nums shadow-sm">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      <img src="/auth-scroll.webp" alt="" aria-hidden className="mt-6 w-56 select-none opacity-95 max-md:hidden" />
      <PaperSample />
      <p className="mt-6 flex items-center gap-1.5 text-xs text-fg-muted max-md:hidden">
        <ShieldCheck className="size-3.5" aria-hidden />
        支持私有化部署 · © {new Date().getFullYear()} 知撰
      </p>
    </section>
  )
}

export function AuthFrame({ children, ...props }: { children: ReactNode } & Omit<React.ComponentProps<'main'>, 'children'>) {
  return (
    <main {...props} className={cn('grid min-h-dvh grid-rows-[auto_1fr] bg-app md:grid-cols-2 md:grid-rows-1', props.className)}>
      <AuthBrand />
      <section className="flex items-start justify-center px-4 py-6 md:items-center md:p-6">
        <div className="w-full max-w-form-col md:rounded-xl md:bg-panel md:p-8 md:shadow-md">{children}</div>
      </section>
    </main>
  )
}
