import { ChevronLeft, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectMenu } from "@/components/shell/ProjectMenu";
import { useStudio, selectBoundSha, selectDirty, selectProposalsPending } from "@/store";

/**
 * 移动顶栏 44（06-w8 §4）：‹ 返回（dirty 守卫）· ≡ 案卷树 · 居中案名 ▾（ProjectMenu compact，状态收进下拉）+ 11px mono 副行「案号 · 已保存/未保存」（视图 / 书不重复：紧跟在下方的两个分段控件已经显示）
 * · 克制批次 S10：右侧协作者 / 构建移出——协作者走 MoreSheet「协作者 · 分享」，构建在预览页工具行与 ⌘K「重新构建」。
 * 栏高 44 是唯一的 44：图标钮视觉 sm 32（ghost）/ md 36（primary），命中区靠 Button 自带 touch-hit 扩到 44；页边 16 走 token。
 * 栏内 gap 8（gap-group-m），仅 ‹ 与 ≡ 之间加 ml-1 凑到 12：两枚 sm 钮各向外扩 6 的 44 热区才互不重叠（8 会让前一枚只剩 40）；
 *   auth 时 👥（sm）与构建（md）之间同理需 10，构建加 ml-0.5；其余间隙不动，居中案名只让出 4（auth 6），不让 12–16（docs/plan/28）。
 * 主题 / 密度 / 账户全部收进 MoreSheet；书切换 / 视图切换在各 Tab 首行 Segmented md，顶栏不再叠工具条。
 */
export function MobileTopBar() {
  const openMobileNav = useStudio((s) => s.openMobileNav);
  const requestNavigation = useStudio((s) => s.requestNavigation);
  const caseNo = useStudio((s) => s.project?.case?.case_no);
  const dirty = useStudio(selectDirty);
  const pending = useStudio(selectProposalsPending);
  const savedSha = useStudio((s) => selectBoundSha(s).slice(0, 8));
  /* C1/P07：副行带版本 sha 前缀与待决数——3 秒内可辨「哪案、哪版、多少修改等我决定」 */
  const sub = [caseNo, savedSha && `稿 ${savedSha}`, pending > 0 && `待决 ${pending}`, dirty ? "未保存" : "已保存"].filter(Boolean).join(" · ");
  return (
    <header
      data-slot="MobileTopBar"
      data-testid="header"
      className="flex h-mobile-topbar shrink-0 items-center gap-group-m border-b bg-panel px-page-m pt-[env(safe-area-inset-top)]"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0 text-fg-muted"
        onClick={() => requestNavigation({ type: "dashboard" })}
        aria-label="返回案卷面板"
        data-slot="BackToDashboard"
        data-testid="back-to-dashboard"
      >
        <ChevronLeft className="size-5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="ml-1 shrink-0 text-fg-muted"
        onClick={() => openMobileNav()}
        aria-label="打开案卷文件"
        data-testid="open-nav"
      >
        <Menu className="size-5" />
      </Button>
      <div
        className="relative flex min-w-0 flex-1 flex-col items-center overflow-hidden [&_[data-testid=project-tab]]:h-touch [&_[data-testid=project-tab]]:max-w-full [&_[data-testid=project-tab]]:items-start [&_[data-testid=project-tab]]:px-1 [&_[data-testid=project-tab]]:pt-1.5 [&_[data-testid=project-tab]]:text-base [&_[data-testid=project-tab]]:font-semibold [&_[data-testid=project-tab]]:before:hidden"
        data-testid="mobile-project-tab"
      >
        <ProjectMenu compact />
        <span
          className="pointer-events-none absolute bottom-1 max-w-full truncate px-1 font-mono text-2xs leading-none text-fg-muted"
          data-testid="mobile-topbar-sub"
          title={sub}
        >
          {sub}
        </span>
      </div>
    </header>
  );
}
