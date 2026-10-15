import { useEffect, useId, useState, type FormEvent } from 'react'
import { CircleAlert, Eye, EyeOff, Info } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { readHashPid } from '@/lib/hash'
import { cn, touchHit } from '@/lib/utils'
import { useIsDesktop } from '@/hooks/useMisc'
import { useStudio } from '@/store'
import { AuthFrame } from './AuthFrame'
import { PASSWORD_MIN, authErrorText, enterWorkspace, signOut } from './session'

type Mode = 'login' | 'register'

const MODE_OPTIONS = [
  { value: 'login' as const, label: '登录', 'data-testid': 'login-tab-login' },
  { value: 'register' as const, label: '注册', 'data-testid': 'login-tab-register' },
]

const EMAIL_RE = /^\S+@\S+\.\S+$/

/**
 * `#/login` 全屏页 / auth=on 未登录时的着陆页（S8 s8-login.html；docs/plan/07 §5.3 / §7.1 / §7.2）。
 * 两栏品牌区 + 表单卡：「登录 ｜ 注册」Segmented 同卡切换（不跳页）+ 邮箱 / 密码（Input xl 16px）+ 全宽 primary。
 * 校验全部行内（Field/FieldError + Alert），表单 noValidate 不出浏览器原生气泡。
 * 无邮件验证 / 找回密码（缺 SMTP，第一个注册者即管理员）。
 *
 * 成功后回到来处：进入登录页前 hash 里的案卷（#/<pid>）或分享链接（#/share/<token>，交给 ShareAccept）；
 * 都没有则打开第一个可见案卷。匿名期间 GET /api/projects 是 401，所以登录后先 loadProjects 再开案。
 */
export function LoginPage() {
  const status = useStudio((s) => s.authStatus)
  const user = useStudio((s) => s.user)
  const login = useStudio((s) => s.login)
  const register = useStudio((s) => s.register)
  const error = useStudio((s) => s.authError)
  const [mode, setMode] = useState<Mode>('login')
  const isDesktop = useIsDesktop()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [emailHint, setEmailHint] = useState<string | null>(null)
  const [pwdHint, setPwdHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [returnPid] = useState(() => readHashPid())
  const uid = useId()

  useEffect(() => {
    useStudio.getState().clearAuthError()
    document.title = '登录 · 知撰'
  }, [])

  const switchMode = (m: Mode) => {
    setMode(m)
    setPwdHint(null)
    setEmailHint(null)
    useStudio.getState().clearAuthError()
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      setEmailHint('请输入邮箱')
      return
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailHint('邮箱格式不正确')
      return
    }
    setEmailHint(null)
    if (password.length < PASSWORD_MIN) {
      setPwdHint(`密码至少 ${PASSWORD_MIN} 位`)
      return
    }
    setPwdHint(null)
    setBusy(true)
    try {
      const ok = mode === 'login' ? await login(trimmed, password) : await register(trimmed, password, displayName.trim())
      if (ok) await enterWorkspace(returnPid)
    } finally {
      setBusy(false)
    }
  }

  const authedUser = status === 'authed' ? user : null
  const errorId = `${uid}-error`
  const titleId = `${uid}-title`
  const emailId = `${uid}-email`
  const pwdId = `${uid}-password`
  const pwdHintId = `${pwdId}-err`
  const inputSize = 'xl'
  const fieldGap = isDesktop ? undefined : 'gap-1'

  return (
    <AuthFrame data-slot="LoginPage" data-testid="login-page">
      {authedUser ? (
        <div className="space-y-5" data-testid="login-authed">
          <div>
            <h1 id={titleId} className="text-2xl font-semibold text-fg-strong md:text-3xl">已登录</h1>
            <p className="mt-1 text-sm text-fg-muted">
              当前账号 <span className="font-medium text-fg">{authedUser.email}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button size="xl" className="w-full" onClick={() => void enterWorkspace(returnPid)} data-testid="login-enter">
              进入工作台
            </Button>
            <Button variant="secondary" size={isDesktop ? 'lg' : 'md'} className="w-full" onClick={() => void signOut()} data-testid="login-switch">
              切换账号
            </Button>
          </div>
        </div>
      ) : (
        <>
          <h1 id={titleId} className="text-2xl font-semibold text-fg-strong md:text-3xl">
            {mode === 'login' ? '登录' : '注册'}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">机构工作台 · 专利代理团队协作撰写</p>

          <Segmented
            value={mode}
            onValueChange={switchMode}
            options={MODE_OPTIONS}
            aria-label="登录或注册"
            size="md"
            className="mt-5 grid w-full grid-cols-2"
          />

          {status === 'off' && (
            <Alert variant="info" className="mt-4" data-testid="login-auth-off">
              <Info aria-hidden />
              <span>
                此部署未开启账号（PATENT_STUDIO_AUTH=off），无需登录即可
                <a href="#/" className="ml-1 font-medium text-primary underline-offset-2 hover:underline">进入工作台</a>。
              </span>
            </Alert>
          )}

          <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4" aria-labelledby={titleId} aria-describedby={error ? errorId : undefined}>
            {mode === 'register' && (
              <Field id={`${uid}-name`} className={fieldGap}>
                <FieldLabel>显示名（可选）</FieldLabel>
                <Input
                  id={`${uid}-name`}
                  size={inputSize}
                  autoComplete="name"
                  maxLength={64}
                  placeholder="如：李研 · 代理师"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  data-testid="login-display-name"
                />
              </Field>
            )}

            <Field id={emailId} error={emailHint ?? undefined} className={fieldGap}>
              <FieldLabel>邮箱</FieldLabel>
              <Input
                id={emailId}
                size={inputSize}
                type="email"
                autoComplete="email"
                inputMode="email"
                autoFocus
                placeholder="name@agency.cn"
                aria-invalid={emailHint ? true : undefined}
                aria-describedby={emailHint ? `${emailId}-err` : undefined}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (emailHint) setEmailHint(null)
                }}
                data-testid="login-email"
              />
              <FieldError className="flex items-center gap-1 text-danger-fg" data-testid="login-email-hint">
                {emailHint && (
                  <>
                    <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                    {emailHint}
                  </>
                )}
              </FieldError>
            </Field>

            <Field id={pwdId} error={pwdHint ?? undefined} className={fieldGap}>
              <FieldLabel>密码</FieldLabel>
              <div className="relative">
                <Input
                  id={pwdId}
                  size={inputSize}
                  type={showPwd ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  aria-invalid={pwdHint ? true : undefined}
                  aria-describedby={pwdHint ? pwdHintId : undefined}
                  className="pr-12"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (pwdHint) setPwdHint(null)
                  }}
                  data-testid="login-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size={isDesktop ? 'icon-lg' : 'icon-xs'}
                  className="absolute top-1/2 right-0 -translate-y-1/2 text-fg-muted"
                  aria-label={showPwd ? '隐藏密码' : '显示密码'} title={showPwd ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPwd}
                  onClick={() => setShowPwd((v) => !v)}
                  data-testid="login-password-toggle"
                >
                  {showPwd ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </Button>
              </div>
              {pwdHint ? (
                <FieldError className="flex items-center gap-1 text-danger-fg" data-testid="login-password-hint">
                  <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                  {pwdHint}
                </FieldError>
              ) : (
                mode === 'register' && <FieldDescription>至少 {PASSWORD_MIN} 位；第一个注册的账号自动成为机构管理员。</FieldDescription>
              )}
            </Field>

            {error && (
              <Alert variant="danger" id={errorId} data-testid="login-error">
                <CircleAlert aria-hidden />
                {authErrorText(error)}
              </Alert>
            )}

            <Button type="submit" size="xl" className="w-full" loading={busy} loadingLabel="请稍候…" data-testid="login-submit">
              {mode === 'login' ? '登录' : '注册并登录'}
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-fg-muted">
            <span>{mode === 'login' ? '忘记密码？请联系机构管理员重置' : '首个注册账号成为机构超管'}</span>
            <button
              type="button"
              className={cn(
                touchHit,
                'shrink-0 rounded-sm font-medium text-primary underline-offset-2 hover:underline',
                !isDesktop && 'inline-flex h-sm-control items-center',
              )}
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              data-testid="login-toggle-mode"
            >
              {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
            </button>
          </div>
        </>
      )}
    </AuthFrame>
  )
}
