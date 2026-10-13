import { cn } from "@/lib/utils";
import { VIEW_LABEL } from "@/components/workbench/viewSwitchPlan";
import { switchToView } from "@/components/workbench/ViewSwitch";
import {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "@/components/ui/segmented";
import { useStudio, type EditorView } from "@/store";

const OPTIONS: readonly SegmentedOption<EditorView>[] = (
  ["source", "layout"] as const
).map((v) => ({
  value: v,
  label: VIEW_LABEL[v],
  "data-testid": `mobile-editor-view-tabs-${v}`,
}));

/**
 * 375「源码 / 版面」Segmented（05 §3.19：住在更多 Sheet「编辑」组，size xl 44；PDF 在预览 Tab）。
 * W9 起编辑页顶部 MobileEditChrome 已有三段 ViewSwitch，这里保留为更多 Sheet 的第二入口，
 * 与之走同一 switchToView（保持块定位）；快捷键 Ctrl+1/2/3 由 ViewSwitch 注册，不再重复。
 */
export function MobileEditorViewTabs({
  className,
  size = "xl",
}: {
  className?: string;
  size?: SegmentedProps<EditorView>["size"];
}) {
  const view = useStudio((s) => s.editorView);
  return (
    <Segmented
      size={size}
      options={OPTIONS}
      value={view}
      onValueChange={(v) => switchToView(v)}
      aria-label="编辑视图"
      data-testid="mobile-editor-view-tabs"
      className={cn("py-0", className)}
    />
  );
}
