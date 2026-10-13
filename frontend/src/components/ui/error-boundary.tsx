import { Component, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface State {
  error: Error | null
}

interface Props {
  children: ReactNode
}

interface PanelProps extends Props {
  /** 兜底区 aria-label / 测试锚（如「AI 面板」） */
  label: string
  /** 可选「关闭面板」出口（伴随栏 closeCompanion / 移动 Tab 回编辑等）；缺省只有重试 */
  onClose?: () => void
}

/**
 * 应用级错误边界（R22）：子树渲染崩溃不再白屏——换成中文兜底页，可刷新重试 / 回面板。
 * 也接住 lazy chunk 加载失败（部署后旧 chunk 404 → `Failed to fetch dynamically imported module`）。
 * 挂在 App 壳层：边界本身不依赖 store/router，崩溃路径尽量薄。
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // 边界自己就全量落 console——不引日志设施，崩溃路径少一个依赖点
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }

  private retry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-app px-6 text-center" role="alert" data-testid="app-error-boundary">
        <img
          src="/error-boundary.webp"
          alt=""
          aria-hidden
          className="w-40 dark:invert"
          data-testid="app-error-illustration"
        />
        <h1 className="text-base font-medium text-fg">界面出现异常</h1>
        <p className="max-w-md text-sm leading-6 text-fg-muted">
          {error.message || '未知错误'}——已自动保存的内容不受影响。可以重试，或回面板后重新打开案件。
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={this.retry} data-testid="app-error-retry">
            重试
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.hash = '#/'
              this.retry()
            }}
            data-testid="app-error-dashboard"
          >
            回面板
          </Button>
          <Button variant="soft" onClick={() => window.location.reload()} data-testid="app-error-reload">
            刷新页面
          </Button>
        </div>
      </div>
    )
  }
}

/**
 * 面板级错误边界：伴随栏/移动 Tab 内的功能单元渲染崩溃只死该单元——紧凑兜底（重试 / 关闭面板），
 * 不触发 AppErrorBoundary 的整屏兜底页。挂在面板单元调用点，边界本身不读 store。
 */
export class PanelErrorBoundary extends Component<PanelProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[PanelErrorBoundary]', this.props.label, error, info.componentStack)
  }

  private retry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const { label, onClose } = this.props
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-4 py-6 text-center" role="alert" data-testid="panel-error-boundary">
        <TriangleAlert className="size-6 text-danger-fg" strokeWidth={1.5} aria-hidden />
        <p className="text-sm text-fg-muted">{label}出现异常</p>
        {error.message && <p className="max-w-xs truncate text-xs text-fg-subtle" title={error.message}>{error.message}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={this.retry} data-testid="panel-error-retry">
            重试
          </Button>
          {onClose && (
            <Button size="sm" variant="soft" onClick={onClose} data-testid="panel-error-close">
              关闭面板
            </Button>
          )}
        </div>
      </div>
    )
  }
}
