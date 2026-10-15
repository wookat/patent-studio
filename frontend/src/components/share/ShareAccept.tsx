import { useEffect, useState } from 'react'
import { CircleAlert, Link2, Loader2 } from 'lucide-react'
import { AuthFrame } from '@/components/auth/AuthFrame'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useIsDesktop } from '@/hooks/useMisc'
import { readHashShareToken, stashShareToken } from '@/lib/hash'
import { useStudio } from '@/store'

type Outcome = { kind: 'done'; pid: string } | { kind: 'failed'; text: string }
type Phase = { kind: 'missing' } | { kind: 'anon' } | { kind: 'accepting' } | Outcome

/**
 * 分享链接领取页 `#/share/<token>`（S8 品牌壳变体；docs/plan/07 §4.1 / §5.3）。
 * 已登录 → POST /api/share/{token}/accept → 跳 `#/p/<pid>`（openProject → writeHashPid，壳随之接管）；
 * 未登录 → 引导到 `#/login`（LoginPage 登录后不会丢掉 share hash，回到本页自动领取）；
 * 后端 501 / 410 过期 / 404 → 说明文案 + 返回工作台。
 * 挂点在 App.tsx（共享文件，由集成接入：hash 以 #/share/ 开头时渲染本页而非壳）。
 */
export function ShareAccept() {
  const status = useStudio((s) => s.authStatus)
  const acceptShare = useStudio((s) => s.acceptShare)
  const [token] = useState(() => readHashShareToken())
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  useEffect(() => {
    document.title = '领取协作邀请 · 知撰'
  }, [])

  useEffect(() => {
    if (!token || (status !== 'authed' && status !== 'off')) return
    let cancelled = false
    void (async () => {
      const pid = await acceptShare(token)
      if (cancelled) return
      if (pid) {
        setOutcome({ kind: 'done', pid })
        const s = useStudio.getState()
        await s.loadProjects()
        await s.openProject(pid)
      } else {
        setOutcome({ kind: 'failed', text: useStudio.getState().authError ?? '领取失败' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, status, acceptShare])

  const phase: Phase = !token ? { kind: 'missing' } : status === 'anon' ? { kind: 'anon' } : (outcome ?? { kind: 'accepting' })

  return (
    <AuthFrame data-slot="ShareAccept" data-testid="share-accept">
      <div className="flex items-center gap-2 text-fg-muted">
        <Link2 className="size-4" aria-hidden />
        <span className="text-xs font-medium tracking-wide uppercase">协作邀请</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg-strong">加入案卷</h1>
      <p className="mt-1 text-sm text-fg-muted">代理师通过分享链接邀请您协作撰写；领取后会直接打开该案。</p>
      <div className="mt-5">
        <Body phase={phase} token={token} />
      </div>
    </AuthFrame>
  )
}

function Body({ phase, token }: { phase: Phase; token: string | null }) {
  const desktop = useIsDesktop()
  const size = desktop ? 'lg' : 'xl'
  const home = (
    <Button variant="secondary" size={size} className="w-full" asChild>
      <a href="#/" data-testid="share-accept-home">返回工作台</a>
    </Button>
  )
  switch (phase.kind) {
    case 'missing':
      return (
        <div className="flex flex-col gap-4" data-testid="share-accept-missing">
          <Alert variant="danger">
            <CircleAlert aria-hidden />
            链接不完整：缺少分享令牌，请向代理师重新索取完整链接。
          </Alert>
          {home}
        </div>
      )
    case 'anon':
      return (
        <div className="flex flex-col gap-4" data-testid="share-accept-anon">
          <p className="text-sm text-fg">登录后即可加入该案卷；登录完成会自动回到此链接继续领取。</p>
          <Button asChild size="xl" className="w-full">
            <a
              href="#/login"
              data-testid="share-accept-login"
              onClick={() => {
                if (token) stashShareToken(token)
              }}
            >
              登录 / 注册
            </a>
          </Button>
        </div>
      )
    case 'accepting':
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-fg-muted" data-testid="share-accept-busy">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          正在领取，请稍候…
        </p>
      )
    case 'done':
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-fg-muted" data-testid="share-accept-done">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          已加入案卷「{phase.pid}」，正在打开…
        </p>
      )
    case 'failed':
      return (
        <div className="flex flex-col gap-4" data-testid="share-accept-failed">
          <Alert variant="danger">
            <CircleAlert aria-hidden />
            无法领取：{phase.text}
          </Alert>
          {home}
        </div>
      )
  }
}
