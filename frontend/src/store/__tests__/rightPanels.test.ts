// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'

/**
 * 审计 R1 / D1 / E5：右侧同一时刻只留一栏——伴随栏（AI / 历史 / 控制台…）与审阅栏（版面内嵌列 rightRailOpen、
 * 源码 / PDF 视图的 reviewDrawerOpen）互斥；关伴随栏恢复让位的那一栏，反向展开审阅栏则伴随栏让位。
 * W12 R9-06：让位的只能是**当前视图 / 视口可见的那个宿主**（selectReviewHost）——rightRailOpen 默认 true 且不随视图清零，
 * 源码 / PDF 视图下它是看不见的陈旧标记，按字段顺序让位会关错栏，留下审阅 Sheet 与伴随 Sheet 双层并存。
 */
const initial = useStudio.getInitialState()

/** 1440 桌面（默认）/ 1024–1279 窄桌面 / 375 移动：matchMedia 只关心三个断点查询 */
const stubViewport = (width: number) =>
  vi.stubGlobal(
    'matchMedia',
    (q: string) =>
      ({
        matches:
          q === '(min-width: 1280px)' ? width >= 1280
          : q === '(min-width: 1024px)' ? width >= 1024
          : q === '(min-width: 1024px) and (max-width: 1279px)' ? width >= 1024 && width <= 1279
          : false,
      }) as MediaQueryList,
  )

beforeEach(() => {
  // 1440 桌面：openCompanion 的 1024–1279 侧栏互斥分支不触发；版面视图使审阅宿主 = 内嵌列
  stubViewport(1440)
  useStudio.setState({ ...initial, editorView: 'layout' }, false)
})

describe('右侧栏互斥', () => {
  it('打开伴随栏 → 内嵌审阅列让位；关伴随栏 → 恢复', () => {
    const s = useStudio.getState()
    expect(s.rightRailOpen).toBe(true)
    s.openCompanion('ai')
    expect(useStudio.getState().companion).toBe('ai')
    expect(useStudio.getState().rightRailOpen).toBe(false)
    expect(useStudio.getState().reviewHiddenByCompanion).toBe('rail-column')
    // 换另一个伴随栏：仍记着让位项
    useStudio.getState().openCompanion('history')
    expect(useStudio.getState().reviewHiddenByCompanion).toBe('rail-column')
    useStudio.getState().closeCompanion()
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().rightRailOpen).toBe(true)
    expect(useStudio.getState().reviewHiddenByCompanion).toBeNull()
  })

  it('审阅列本来就收着 → 关伴随栏不会凭空展开', () => {
    useStudio.setState({ rightRailOpen: false })
    useStudio.getState().openCompanion('console')
    expect(useStudio.getState().reviewHiddenByCompanion).toBeNull()
    useStudio.getState().closeCompanion()
    expect(useStudio.getState().rightRailOpen).toBe(false)
  })

  it('源码视图：打开伴随栏 → 审阅 Drawer 让位；关伴随栏 → 恢复 Drawer', () => {
    useStudio.setState({ editorView: 'source', rightRailOpen: false, reviewDrawerOpen: true })
    useStudio.getState().openCompanion('terms')
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
    expect(useStudio.getState().reviewHiddenByCompanion).toBe('drawer')
    useStudio.getState().closeCompanion()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
  })

  describe('R9-06 只让位当前可见的审阅宿主', () => {
    it('375 源码：rightRailOpen 陈旧为真 + 审阅 Sheet 开 → 关的是 Sheet（不是看不见的版面列）；关伴随栏只恢复 Sheet', () => {
      stubViewport(375)
      // #71 复验实测状态（insert-prior-review.json）：源码视图，审阅 Sheet 已开，版面列开关仍是默认 true
      useStudio.setState({ editorView: 'source', rightRailOpen: true, reviewDrawerOpen: true })
      useStudio.getState().openCompanion('figures')
      const s = useStudio.getState()
      expect(s.companion).toBe('figures')
      expect(s.reviewDrawerOpen).toBe(false)
      expect(s.rightRailOpen).toBe(true)
      expect(s.reviewHiddenByCompanion).toBe('drawer')
      useStudio.getState().closeCompanion()
      expect(useStudio.getState().reviewDrawerOpen).toBe(true)
      expect(useStudio.getState().rightRailOpen).toBe(true)
      expect(useStudio.getState().reviewHiddenByCompanion).toBeNull()
    })

    it('375 PDF 视图同源码：宿主 = Drawer', () => {
      stubViewport(375)
      useStudio.setState({ editorView: 'source', activePanelId: 'pdf:description', rightRailOpen: true, reviewDrawerOpen: true })
      useStudio.getState().openCompanion('figures')
      expect(useStudio.getState().reviewDrawerOpen).toBe(false)
      expect(useStudio.getState().rightRailOpen).toBe(true)
      expect(useStudio.getState().reviewHiddenByCompanion).toBe('drawer')
    })

    it('1440 源码：审阅全关、版面列开关陈旧为真 → 不让位；关伴随栏不会凭空开 Drawer', () => {
      useStudio.setState({ editorView: 'source', rightRailOpen: true, reviewDrawerOpen: false })
      useStudio.getState().openCompanion('ai')
      expect(useStudio.getState().rightRailOpen).toBe(true)
      expect(useStudio.getState().reviewHiddenByCompanion).toBeNull()
      useStudio.getState().closeCompanion()
      expect(useStudio.getState().reviewDrawerOpen).toBe(false)
      expect(useStudio.getState().rightRailOpen).toBe(true)
    })

    it('1440 版面窄卡（rail-sheet）：让位 / 恢复的是 rightRailSheetOpen，不动列开关与 Drawer', () => {
      useStudio.setState({ editorView: 'layout', rightRailColumnFits: false, rightRailOpen: true, rightRailSheetOpen: true, reviewDrawerOpen: false })
      useStudio.getState().openCompanion('ai')
      let s = useStudio.getState()
      expect(s.rightRailSheetOpen).toBe(false)
      expect(s.rightRailOpen).toBe(true)
      expect(s.reviewDrawerOpen).toBe(false)
      expect(s.reviewHiddenByCompanion).toBe('rail-sheet')
      useStudio.getState().closeCompanion()
      s = useStudio.getState()
      expect(s.rightRailSheetOpen).toBe(true)
      expect(s.reviewHiddenByCompanion).toBeNull()
    })

    it('1024–1279 版面（宿主 = rail-sheet）：伴随栏收侧栏的既有分支不变，陈旧的列开关不被碰', () => {
      stubViewport(1100)
      useStudio.setState({ editorView: 'layout', rightRailOpen: true, rightRailSheetOpen: false, outlineOpen: true, sideOpen: true })
      useStudio.getState().openCompanion('ai')
      const s = useStudio.getState()
      expect(s.companionAutoCollapsedSide).toBe(true)
      expect(s.outlineOpen).toBe(false)
      expect(s.rightRailOpen).toBe(true)
      expect(s.reviewHiddenByCompanion).toBeNull()
    })
  })

  it('伴随栏开着时展开审阅列 → 伴随栏让位，且不把让位记录反弹回来', () => {
    useStudio.getState().openCompanion('ai')
    useStudio.getState().setRightRailOpen(true)
    const s = useStudio.getState()
    expect(s.companion).toBeNull()
    expect(s.rightRailOpen).toBe(true)
    expect(s.reviewHiddenByCompanion).toBeNull()
  })

  it('伴随栏开着时开审阅 Drawer（openReviewDrawer / setReviewDrawerOpen / toggle）→ 伴随栏让位', () => {
    useStudio.setState({ editorView: 'source', rightRailOpen: false })
    useStudio.getState().openCompanion('ai')
    useStudio.getState().openReviewDrawer()
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)

    useStudio.getState().closeReviewDrawer()
    useStudio.getState().openCompanion('history')
    useStudio.getState().toggleReviewDrawer()
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    // 关 Drawer 不动伴随栏（已经关了，也不恢复）
    useStudio.getState().toggleReviewDrawer()
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
    expect(useStudio.getState().companion).toBeNull()
  })

  it('伴随栏开着时开版面审阅 Sheet（setRightRailSheetOpen，1024–1279 / 窄卡）→ 伴随栏让位且不反弹，收走的侧栏恢复', () => {
    stubViewport(1200)
    useStudio.setState({ editorView: 'layout', rightRailColumnFits: false, rightRailOpen: true, rightRailSheetOpen: false, outlineOpen: true, sideOpen: true })
    useStudio.getState().openCompanion('ai')
    expect(useStudio.getState().companionAutoCollapsedSide).toBe(true)
    expect(useStudio.getState().outlineOpen).toBe(false)

    useStudio.getState().setRightRailSheetOpen(true)
    let s = useStudio.getState()
    expect(s.companion).toBeNull()
    expect(s.rightRailSheetOpen).toBe(true)
    expect(s.reviewHiddenByCompanion).toBeNull()
    expect(s.outlineOpen).toBe(true)
    expect(s.companionAutoCollapsedSide).toBe(false)

    // 先开 Sheet 再开伴随栏再关伴随栏：正向让位 / 恢复不受影响；toggle 无参开 Sheet 同样让位
    useStudio.getState().openCompanion('figures')
    expect(useStudio.getState().reviewHiddenByCompanion).toBe('rail-sheet')
    useStudio.getState().setRightRailSheetOpen()
    s = useStudio.getState()
    expect(s.companion).toBeNull()
    expect(s.rightRailSheetOpen).toBe(true)
    expect(s.reviewHiddenByCompanion).toBeNull()
    // 关 Sheet 不动伴随栏（已经关了，也不恢复）
    useStudio.getState().setRightRailSheetOpen(false)
    expect(useStudio.getState().companion).toBeNull()
  })

  it('收起审阅列（setRightRailOpen(false)）不影响伴随栏', () => {
    useStudio.getState().setRightRailOpen(false)
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().rightRailOpen).toBe(false)
  })

  it('协同抽屉与伴随栏双向互斥（OBS-V2：开 AI 不关协同 = 「AI 钮没反应」观感）', () => {
    const s = useStudio.getState()
    s.openCollabCenter()
    expect(useStudio.getState().collabCenterOpen).toBe(true)
    s.openCompanion('ai')
    expect(useStudio.getState().companion).toBe('ai')
    expect(useStudio.getState().collabCenterOpen).toBe(false)
    s.openCollabCenter()
    expect(useStudio.getState().collabCenterOpen).toBe(true)
    expect(useStudio.getState().companion).toBeNull()
  })

  it('时间线抽屉与伴随栏双向互斥（批6：同区互挤观察项）', () => {
    const s = useStudio.getState()
    s.toggleTimeline(true)
    expect(useStudio.getState().timelineOpen).toBe(true)
    s.openCompanion('ai')
    expect(useStudio.getState().companion).toBe('ai')
    expect(useStudio.getState().timelineOpen).toBe(false)
    s.toggleTimeline(true)
    expect(useStudio.getState().timelineOpen).toBe(true)
    expect(useStudio.getState().companion).toBeNull()
  })

  it('开时间线走 closeCompanion 语义：伴随栏让位过的审阅列照常恢复', () => {
    const s = useStudio.getState()
    s.openCompanion('ai')
    expect(useStudio.getState().rightRailOpen).toBe(false)
    s.toggleTimeline(true)
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().rightRailOpen).toBe(true)
    s.toggleTimeline(false)
    expect(useStudio.getState().timelineOpen).toBe(false)
  })

  it('开协同抽屉走 closeCompanion 语义：伴随栏让位过的审阅列照常恢复', () => {
    const s = useStudio.getState()
    s.openCompanion('ai')
    expect(useStudio.getState().rightRailOpen).toBe(false)
    s.openCollabCenter()
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().rightRailOpen).toBe(true)
    s.closeCollabCenter()
    expect(useStudio.getState().collabCenterOpen).toBe(false)
  })
})

describe('移动端覆盖层互斥：导航抽屉 / 更多 Sheet / 审阅 Sheet 同一时刻只开一个', () => {
  it('导航抽屉开着 → 开审阅 Sheet 时抽屉关；审阅 Sheet 开着 → 开抽屉时审阅关', () => {
    useStudio.getState().openMobileNav('outline')
    expect(useStudio.getState().mobileNav.open).toBe(true)
    useStudio.getState().openReviewDrawer()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(useStudio.getState().mobileNav.open).toBe(false)
    useStudio.getState().openMobileNav()
    expect(useStudio.getState().mobileNav.open).toBe(true)
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
  })

  it('NavDrawer「审阅」页签是启动器：开审阅 Sheet 关掉抽屉后，无参再开抽屉回到大纲而不是记住 review（否则挂载即又被关掉）', () => {
    useStudio.getState().openMobileNav('review')
    useStudio.getState().openReviewDrawer()
    expect(useStudio.getState().mobileNav).toEqual({ open: false, tab: 'review' })
    useStudio.getState().openMobileNav()
    expect(useStudio.getState().mobileNav).toEqual({ open: true, tab: 'outline' })
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
    useStudio.getState().closeMobileNav()
    useStudio.getState().openMobileNav('history')
    useStudio.getState().closeMobileNav()
    useStudio.getState().openMobileNav()
    expect(useStudio.getState().mobileNav.tab).toBe('history')
  })

  it('更多 Sheet 开着 → setReviewDrawerOpen(true) 关掉它；关审阅不动其它层', () => {
    useStudio.getState().toggleMore(true)
    useStudio.getState().setReviewDrawerOpen(true)
    expect(useStudio.getState().moreOpen).toBe(false)
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    useStudio.getState().openMobileNav('outline')
    useStudio.getState().closeMobileNav()
    useStudio.getState().setReviewDrawerOpen(false)
    expect(useStudio.getState().mobileNav.open).toBe(false)
    expect(useStudio.getState().moreOpen).toBe(false)
  })

  it('版面卡审阅 Sheet（rightRailSheetOpen，375 工具条「审阅栏」）与导航抽屉 / 更多 Sheet 同样互斥', () => {
    useStudio.getState().openMobileNav('outline')
    useStudio.getState().setRightRailSheetOpen(true)
    expect(useStudio.getState().rightRailSheetOpen).toBe(true)
    expect(useStudio.getState().mobileNav.open).toBe(false)
    useStudio.getState().openMobileNav()
    expect(useStudio.getState().mobileNav.open).toBe(true)
    expect(useStudio.getState().rightRailSheetOpen).toBe(false)
    useStudio.getState().closeMobileNav()
    useStudio.getState().toggleMore(true)
    useStudio.getState().setRightRailSheetOpen()
    expect(useStudio.getState().rightRailSheetOpen).toBe(true)
    expect(useStudio.getState().moreOpen).toBe(false)
    useStudio.getState().setRightRailSheetOpen(false)
    expect(useStudio.getState().moreOpen).toBe(false)
    expect(useStudio.getState().mobileNav.open).toBe(false)
  })
})
