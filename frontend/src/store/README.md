# store/ — 单一 zustand store（05 §2）

`useStudio = create(subscribeWithSelector(persist(...)))`，仅 ui slice（+ `build.debounceMs` + `agent.agentTab`）持久化到 `localStorage['patent-studio:ui:v2']`（`UI_STORAGE_KEY`，`UI_STORAGE_VERSION`=4：W4-E 去掉 `consoleTab` 的 `'xml'`/`'preflight'`，`migrate` 把旧值迁为 `'all'`；W5 prep 增 `agentTab`，旧版 / 非法值迁为 `'chat'`；`merge` 从持久化的 `outlineOpen/pdfView/consoleTab` 派生 `sideOpen/bottomOpen/bottomTab` 别名）。

| slice | 文件 | 字段 / 动作 |
|---|---|---|
| project | project.ts | projects pid project settings defaults defaultSettings figs backups health projectError · loadProjects loadBootstrap refreshHealth openProject saveSettings resetSettings createProject |
| doc | doc.ts | content saved contentEditedAt cursor outline saving editorHandle · setContent setCursor setOutline save restore registerEditor gotoLine · R4：`setBookContent(book, text)` `saveBook(book)` |
| build | build.ts | phase outcome lastOk stale elapsedMs pendingCount netError startedAt lastOkEditAt lastOkAt previewMs previewShownUrl autoBuild · enqueue(reason, immediate) applyOutcome markPreviewShown setAutoBuild resetBuild（400ms debounce，latest-wins） |
| diagnostics | diagnostics.ts | items buildItems lintItems clientItems · setFromBuild setFromLint setClient resetDiagnostics |
| ui | ui.ts | outlineOpen bottomOpen bottomTab settingsOpen layout theme railTab zoom zoomFit **pdfView consoleTab sideTab**（持久化）mobileTab **sideOpen sideAutoCollapsed mobileSettingsOpen** dirtyGuard dialog toasts pageInfo · toggleOutline toggleBottom setBottomTab openBottom toggleSettings setLayout cycleLayout setTheme toggleTheme setRailTab setMobileTab setZoom setPageInfo openDialog closeDialog toast dismissToast requestNavigation resolveNavigation runNavigation **toggleSide setSideTab setPdfView togglePdfView setConsoleTab openConsole toggleMobileSettings syncSideAutoCollapse** · R1：`editorView` `mobilePreviewKind` `outlineCollapsedIds`（持久化）setEditorView toggleEditorView setMobilePreviewKind toggleOutlineCollapsed · W5：`pdfLongPress`（375 PDF 长按目标 `{book, blockId, line?, page?}`，three-view dispatch → `PdfLongPressSheet`）setPdfLongPress · 移动壳：`mobileNav{open,tab: RailTab|'files'}` `moreOpen` `timelineOpen` `pdfFindOpen` `pdfLocate` · openMobileNav closeMobileNav（R57/R82/R99） |
| ast（R1） | ast.ts | ast astContent astLoading astError astPid astUnavailable activeBlock · loadAst(pid, {fromDisk?}) scheduleAst cancelAst setActiveBlock(id, source) selectBlockAt(fullLine) resetAst |
| figures（R2） | figures.ts | figures figuresLoading figuresError figuresUnavailable figuresPid selectedFigure · loadFigures(pid) uploadFigures(files) reorderFigures(order) updateFigure(name, patch) deleteFigure(name)→{ok}\|{ok:false, refs} selectFigure resetFigures |
| preflight（R2.5） | preflight.ts | preflight preflightContent preflightLoading preflightError preflightUnavailable preflightPid preflightElapsedMs preflightView · loadPreflight(pid, {fromDisk?}) setPreflightView resetPreflight |
| blocks（R3） | blocks.ts | editingBlockId blockPending blockError blocksUnavailable blockTemplates · startBlockEdit(id) cancelBlockEdit patchBlock(id, markdown) insertBlock({kind, after_block_id\|book, markdown?}) deleteBlock(id) loadBlockTemplates · 纯函数 `findBlockLines` `blockSource` `spliceBlock` |
| auth（R6） | auth.ts | authStatus('unknown'\|'off'\|'anon'\|'authed') user authError members shareLinks · loadMe login register logout clearAuthError loadMembers setMember removeMember loadShareLinks createShareLink revokeShareLink acceptShare |
| comments（R6） | comments.ts | comments commentsLoading commentsUnavailable activeCommentId · loadComments addComment updateComment replyComment resolveComment deleteComment setActiveComment resetComments · `selectOpenCommentCount` |
| history（R6） | history.ts | versions historyLoading historyUnavailable selectedSha versionContent historyDiff · loadHistory selectVersion loadDiff(a,b) restoreVersion(sha) resetHistory |
| mcp（R7） | mcp.ts | pats patsLoading patsUnavailable newPat audit auditLoading · loadPats createPat(name)→PatCreated（token 只此一次，存 newPat）revokePat dismissNewPat loadAudit(pid, limit) resetMcp |
| templates（R9） | templates.ts | templates templatesLoading templatesUnavailable templatesError · loadTemplates saveCurrentAsTemplate(name, description?, overwrite?) importTemplate(TemplateIn, overwrite?)（overwrite → PUT）applyTemplate(pid, name)→settings 覆盖 + enqueue('manual') deleteTemplate resetTemplates |
| importer（R9） | importer.ts | importPhase('idle'\|'uploading'\|'done'\|'error') importError importUnavailable importReport importedPid styleSuggestion · importDocx(file, {id?, title?, apply_styles?, style?})（style = 用户勾选的部分样式叶子，multipart JSON 透传后端）→成功后 loadProjects + requestNavigation(open-project) suggestStyles(file) resetImporter |
| review（R6） | review.ts | reviewMode('final'\|'original'\|'markup') marks marksLoading marksUnavailable · setReviewMode loadMarks scheduleMarks cancelMarks acceptMark rejectMark acceptAll rejectAll resetReview · `applyMarks` `MARKS_DEBOUNCE_MS` |
| layoutView（W4-D，docs/plan/16 §9） | layoutView.ts | layoutViewToolbar('none'\|'insert'\|'table'\|'equation') styleCssVersion · setLayoutViewToolbar bumpStyleCss resetLayoutView · D3（纸面 / 菜单 / 模式）与 D4（375 底部工具栏 / 三视图 tab）只通过这里通信；模式三态沿用 collabCenter 的 `selectEditorMode`；不持久化 |
| layout（R4） | layout.ts | dockHandle activePanelId layoutPreset compareLock activeBook · registerDock setActivePanel openPanel(id, opts) closePanel focusPanel focusNextPanel(dir) toggleMaximize applyPreset(id) resetLayout setCompareLock setActiveBook · 常量 `PANEL_KINDS` `BOOK_VIEWS` `LAYOUT_PRESET_IDS`，纯函数 `parsePanelId` `makePanelId`，selector `selectBookDirty(book)` |
| focus（W5 three-view） | focus.ts | focus(`Focus{book blockId line? page? source seq}`) pdfLocateFail(`PdfLocateFail`) pdfLocateCandidates · setFocus(f) clearFocus setPdfLocateFail(reason, candidates?) toggleCompareLock（→ layout.setCompareLock）· 类型 `types/focus.ts`；三视图统一用 `focus.seq` 去重，`source` 自己发的不回响 |
| agent（W5 ai-panel / agent-core） | agent.ts | agentTab(`AGENT_TABS` chat/scenarios/proposals/jobs，持久化) agentJobs agentActiveJobId agentEvents proposals proposalFilter agentLoading agentUnavailable agentDisabledByOrg agentBudgetExceeded agentError · setAgentTab loadAgent(pid) runScenario(pid, scenario, params?) cancelAgentJob watchAgentJob(jobId\|null)（SSE `/agent/jobs/{id}/events`）pushAgentEvent setProposalFilter applyProposal dismissProposal resetAgent · selector `selectProposalsPending` `selectAgentRunning` · 类型 `types/agent.ts`（S8 不在 `SCENARIOS`） |
| deadlines（W5 deadlines-backend / dashboard） | deadlines.ts | deadlines deadlineCounts deadlinesHolidaysMissing deadlinesFilter{range owner client kind} deadlinesLoading deadlinesUnavailable deadlinesError · loadDeadlines(filter?) setDeadlinesFilter setDeadlineDone overrideDeadline(pid, id, due, reason) nudgeDeadline resetDeadlines |
| notify（W5 notify-audit / notify-review） | notify.ts | notifications unreadCount notifyLoading notifyUnavailable notifyError · loadNotifications({unread?, limit?}) markRead(nid) markAllRead resetNotify |
| publicShare（W5 share-confirm / client-review） | publicShare.ts | publicLinks publicLinksLoading publicLinksUnavailable · publicToken publicMeta publicAst publicComments publicView publicLoading publicExpired publicUnavailable publicError guestName · loadPublicLinks createPublicLink revokePublicLink openPublic(token) setPublicView setGuestName addPublicComment confirmPublic(note?) resetPublic（匿名 `#/c/<token>`，不走 auth） |
| admin（W5 deliver-account-admin） | admin.ts | orgSettings orgSettingsSaving orgSettingsUnavailable orgAudit orgAuditTotal orgAuditQuery orgAuditLoading orgAuditUnavailable orgAiUsage orgAiUsageUnavailable · loadOrgSettings saveOrgSettings(patch) loadOrgAudit(query?) loadOrgAiUsage |
| account | account.ts | me meSaving meUnavailable org adminUsers adminLoading adminError adminUnavailable · loadAdmin saveMe putMe saveOrg putOrg updateAdminUser resetAccount |
| attachments | attachments.ts | attachments attachmentsPid attachmentsLoading attachmentsError attachmentsUnavailable previewAttachment · loadAttachments getAttachments deleteAttachment setPreviewAttachment resetAttachments |
| checks | checks.ts | lintRun lintRunning lintContent checkAllRun checkAllRunning · runLint runCheckAll togglePreflightCode setFromLint selectCheckCounts resetChecks |
| collabCenter | collabCenter.ts | collabCenterOpen collabCenterTab access accessLoading accessUnavailable invites invitesLoading invitesUnavailable collabSettings collabSettingsUnavailable editorMode invite · openCollabCenter closeCollabCenter setCollabCenterTab loadAccess loadInvites revokeInvite setInviteRole setMemberRole loadCollabSettings saveCollabSettings setEditorMode resetCollabCenter |
| dashboard | dashboard.ts | dashScope dashStatuses dashTags dashQuery dashView dashOwners dashFocus dashColumns dashGroup dashCompact dashSelected dashLoading caseFormPid caseFormField · loadDashboard setDash* toggleDash*(owner/status/tag/selected) openCaseForm closeCaseForm patchRow saveTag updateTag deleteTag select*Rows/Counts/Owners/TodayCounts |
| deliver | deliver.ts | xmlRunning xmlResult xmlError xmlAt manifest manifestLoading manifestError manifestUnavailable bundleRunning filingOpen deliverErrors deliverErrorsLoading deliverErrorsUnavailable fileCase · runXmlExport runBundle loadManifest loadDeliverErrors setFilingOpen resetDeliver |
| figuresBook | figuresBook.ts | previewFig figureAspects · loadFigures updateFigure setFigureAspect setPreviewFig resetFiguresBook（附图书视图态，图本体在 figures slice） |
| styleEdit（W9） | styleEdit.ts | **独立 zustand store（不进 index.ts）**：段落样式 ↔ style 叶子映射；panelOpen panelLevel preview · openPanel closePanel setLeaf setPreview applyHeadings applyParagraphStyle saveSettings（写回走 project.saveSettings → bumpStyleCss） |
| reviewHost | reviewHost.ts | **纯 selector 模块（无 slice 状态）**：`selectReviewHost`（rail-column / rail-sheet / drawer 唯一宿主）`selectRailEmbedded` `selectRailAsColumn` `selectReviewHostOpen` + `RIGHT_RAIL_QUERY` `REVIEW_HOST_FLAG` |

### W5 slices（docs/plan/21-w5-spec.md §3 / §5.5；prep 已接线，后端 501 占位 ⇒ `*Unavailable`）
- 六个 slice 全部已注册进 `index.ts / types.ts`；单元只在自己目录内消费，**不改 store/\*\***。需要新字段时在单元 PR 里追加到自己的 slice 文件（各 slice 文件归对应单元 `own`）并更新本表。
- 501 约定：`api.*` 抛 `ApiError{status:501}` ⇒ slice 置 `*Unavailable=true`，不 toast；页面渲染 `<EmptyState title="功能开发中"/>`（`components/ui/empty-state.tsx`，`data-slot="empty-state"`）。
- `ui.MobileTab` 含 `'ai'`（移动 AI 全屏页 `MobileAiTab` 只包 `<AiPanel/>`）；桌面 AI **不再是 dockview 面板**（W6：`PANEL_KINDS` 无 `ai`），走顶栏伴随栏 `ui.companion === 'ai'`（`registerCompanionBody('ai', AiPanel)`）；预置 `ai-assist`（`DEFAULT_PRESET`）右侧 320 为 术语 / OA / 审阅 组。`DockviewHost.applyMinWidths` 把组内面板最大 `minWidth` 下发为 `setConstraints`。含未注册面板（如旧 `ai`）的持久化布局 → 回默认预置。
- 快捷键（`lib/hotkeys.ts`）：`cycleView: Mod-Alt-0`（源码→版面→PDF 循环）、`compareLock: Mod-Shift-L`。
- 路由（`lib/hash.ts`）：`#/deadlines` `#/inbox` `#/c/<token>` `#/__ds`；`#/p/<pid>?c=<cid>&focus=<block_id>` → `route.query.{c, focus}`。占位页 `components/deadlines/DeadlinesPage` `components/inbox/InboxPage` `components/client/ClientReviewPage`（均 `PageChrome` + `EmptyState`）由对应单元替换实现，保留导出名与 `page-<name>`。
- 注入点（`lib/slots.ts`）：`registerEditorExtension(id, () => Extension)` → `editor/Editor.tsx`（Compartment 热重配）；`registerLayoutDecoration(id, ({book, blockId, element}) => ReactNode)` → `layout-view/LayoutDecorations.tsx`；`registerPdfOverlay(id, Component<{page,width,height,url,active}>)` → `preview/PdfPreview.tsx` 每页 `[data-page]` 内；`registerTopBarItem` / `registerRailItem({id, render})` → `shell/TopBar` 用户菜单左 / `shell/Rail` 底部。在单元模块顶层调用即可，幂等，不改三视图与壳。

### `data-testid` 约定（21 §5.5 ⑩；所有单元遵守，shot-cdp / axe-cdp / vitest 都按此定位）
格式 `<area>-<element>[-<state>]`，kebab；页面根 `page-<name>`；列表项 `row-<id>`；占位 / 空态统一 `data-slot="empty-state"`。已存在的不改（旧名见各组件），新增按下表：

| 区域（单元） | 根 / 容器 | 元素 | 状态 / 说明 |
|---|---|---|---|
| 页面壳（prep `PageChrome`） | `page-<name>` | `<name>-header` `<name>-back` `<name>-actions` | name ∈ dashboard deadlines inbox deliver account admin client ds |
| 面板（dashboard-frontend） | `page-dashboard` | `dashboard-ledger` `dashboard-filter-<key>` `dashboard-search` `row-<pid>` `dashboard-kpi-<key>` `dashboard-chart-<key>` | `-empty` `-loading` |
| 期限（dashboard-frontend） | `page-deadlines` | `deadlines-range-<range>` `deadlines-list` `row-<deadline_id>` `deadlines-done-<id>` `deadlines-override-<id>` `deadlines-holidays-missing` | `-overdue` `-today` `-done` |
| 收件箱 / 通知（notify-review） | `page-inbox` | `inbox-list` `row-<nid>` `inbox-mark-read-<nid>` `inbox-mark-all` `topbar-notify` `topbar-notify-badge` | `-unread` |
| 审阅面板（notify-review） | `review-panel` | `review-thread-<cid>` `review-reply-<cid>` `review-resolve-<cid>` `review-filter-<state>` | 现有 `review-*` 不改 |
| AI 面板（ai-panel） | `ai-panel` | `ai-tab-<tab>` `ai-chat-input` `ai-chat-send` `ai-context-<key>` `ai-scenario-<id>` `ai-run-<id>` `ai-proposal-<id>` `ai-proposal-apply-<id>` `ai-proposal-dismiss-<id>` `ai-proposal-locate-<id>` `ai-job-<id>` `ai-job-cancel-<id>` `ai-budget` `ai-clipped` | `-running` `-disabled-org` `-disabled-case` ；gutter 标记 `ai-gutter-<proposal_id>` |
| 三视图（three-view） | `editor-area` `layout-view` `pdf-preview` | `view-tabs` `view-tab-<source\|layout\|pdf>` `focus-ring` `pdf-locate-fail` `pdf-locate-candidate-<page>` `compare-lock` `layout-decorations` `topbar-slot` `rail-slot` | `-locked` ；`data-block-id` 保留 |
| 客户确认页（client-review） | `page-client` | `client-header` `client-org` `client-title` `client-version` `client-token` `client-view-<layout\|pdf>` `client-main` `client-pdf` `client-pdf-doc` `client-pdf-loading` `client-pdf-pending` `client-pdf-failed` `client-layout` `client-layout-pages` `client-selection-comment` `client-actionbar` `client-comment` `client-comment-sheet` `client-comment-form` `client-comment-quote` `client-guest-name` `client-comment-input` `client-comment-send` `client-comment-error` `client-confirm` `client-confirm-dialog` `client-confirm-name` `client-confirm-note` `client-confirm-submit` `client-confirm-error` `client-confirmed` `client-confirmed-old` `client-download` `client-readonly-hint` `client-loading` `client-expired` `client-unavailable` `client-error` `client-retry` `row-<comment_id>` | `-confirmed` |
| 协作者中心 · 对外链接（client-review） | `collab-public-links` | `collab-public-links-summary` `collab-public-links-loading` `collab-public-links-error` `collab-public-link-create` `collab-public-link-form` `collab-public-link-scope` `collab-public-link-scope-<scope>` `collab-public-link-ttl` `collab-public-link-ttl-<days>` `collab-public-link-download` `collab-public-link-copy-<token>` `collab-public-link-revoke-<token>` `collab-public-link-expiry-<token>` `collab-public-link-visits-<token>` | — |
| 递交 / 账号 / 机构（deliver-account-admin） | `page-deliver` `page-account` `page-admin` | `deliver-error-<code>` `deliver-oa-round-<n>` `admin-tab-<tab>` `admin-audit-list` `row-<event_id>` `admin-audit-filter-<key>` `admin-ai-usage` `admin-setting-<key>` `admin-public-links` | 现有 `deliver-*` `account-*` `admin-*` 不改 |
| 移动工作台（mobile-workbench） | `mobile-shell` | `mobile-tab-<edit\|preview\|ai\|console>` `mobile-ai-sheet` `mobile-view-<source\|layout\|pdf>` `mobile-bottom-drawer` | `-active` |
| 设计系统（prep） | `page-ds` | `ds-<section>` `ds-theme-toggle` `ds-table` | section ∈ colors status type dims buttons inputs feedback overlay nav table empty |

### R4 layout slice（docs/plan/08-r4-dockview-design.md §5；prep 已接线，D1 的 DockArea 落地后即生效）
- 共享文件（prep/integrate 才能改）：`store/layout.ts` `store/doc.ts` `lib/docset.ts` `lib/hotkeys.ts`。D1/D2/D3 只**调用**这些动作；缺字段向 integrate 提需求。
- dockview 的布局树（`api.toJSON()`）**不进 store**，由 `layout/persistence.ts` 按案卷写 `localStorage['patent-studio:layout:v1:<pid>']`；`ui.layout`（split/editor/preview）保留，D1 把它映射为 dock 操作（split = 回到预置，editor = 最大化活动源码卡片，preview = 最大化 pdf）。
- `dockHandle: DockHandle | null`：D1 的 DockArea 在 `onReady` 调 `registerDock(handle)`，卸载时 `registerDock(null)`；`openPanel/closePanel/focusPanel/focusNextPanel/toggleMaximize/applyPreset/resetLayout` 全部委托给它。移动壳无 dock：`openPanel` 退化为现有动作（source/layout → `setActiveBook` + 切 tab；pdf → 预览 tab；console/checks → `openConsole`；Rail 面板 → `openMobileNav`），其余动作 no-op。
- `activePanelId`：DockArea 在 `onDidActivePanelChange` 写入；若是 `source:<book>` / `layout:<book>` 同时同步 `activeBook`。
- `activeBook: BookName | 'all'`：桌面 = 焦点卡片的书；移动 = BookSwitcher 选中项（编辑 Tab 显示哪本书，'all' = 现有全文 Editor）。不持久化。
- `doc.setBookContent(book, text)` = `setContent(replaceBook(content, book, text))`：单书卡片 onChange 只调它，全文仍是唯一真源，其它卡片自然跟随；`doc.saveBook(book)` 走 `PUT /docs/{book}`，成功后 `saved = replaceBook(saved, book, text)`（其它书的 dirty 保留）；`save()` 仍保存全文。`selectDirty` 语义不变，`selectBookDirty(book)` 给卡片 tab 脏标。
- 行坐标：`lib/docset.ts` `splitBooks(content).books[b].offset` 与 AST `books[b].offset` 同值（两案 golden 断言）；卡片内书相对行 k ↔ 全文行 offset+k。卡片向 store 报光标 / 请求跳行一律用**全文行**（`setCursor` `gotoLine` `selectBlockAt` 语义不变）。
- `compareLock`：对照滚动锁开关；实际对齐逻辑在 `components/cards/sync.ts`（D2），store 只存开关。
| ai（E） | ai.ts | aiStatus aiStatusLoading aiUnavailable chat chatStreaming chatError suggestions jobs jobsLoading · loadAiStatus(probe?) setAiEnabled sendChat(text, context) stopChat clearChat rewrite(action, sel, instruction?) acceptSuggestion dismissSuggestion startReview(scope) loadJobs(pid) upsertJob hideJob(id) watchJob(id) unwatchJob(id) resetAi · `selectAiEnabled` `selectAiRunning` |
| terms（E） | terms.ts | terms termsLoading termsSaving termsError termsUnavailable termsPid candidates candidatesLoading · loadTerms(pid) saveTerms upsertTerm removeTerm extractTerms({ai?}) adoptCandidate dismissCandidate unifyTerms(names?) resetTerms · `selectTermIssueCount` |
| convert（E） | convert.ts | convertStep('pick'\|'questionnaire'\|'running'\|'done'\|'error') convertFile questionnaire convertTarget convertAiAck convertJobId convertError convertUnavailable · setConvertFile setQuestionnaire setConvertTarget setConvertAiAck setConvertStep startConvert resetConvert · `selectConvertJob` `selectConvertResult` |
| oa（E） | oa.ts | oaText oaItems oaWarnings oaParsing oaAnswers oaJobId oaError oaUnavailable oaActiveItemId · setOaText parseOa answerOa(itemIds?) setOaAnswers markOaApplied setOaActiveItem resetOa · `selectOaJob` |

### 轨道 E slices（docs/plan/09-r5-r7-ai-design.md §6；prep 已接线，E1–E3 后端落地后即生效）
- 共享文件（prep/integrate 才能改）：`store/ai.ts` `store/terms.ts` `store/convert.ts` `store/oa.ts` `store/ui.ts` `lib/api.ts` `lib/types.ts` `types/{ai,terms,convert,oa}.ts`。E4/E5 只**调用**这些动作，不新增 slice 字段；缺什么在 09 §9 提需求给 integrate。
- 隐私开关 = `settings.ai_enabled`（project slice 的 settings，走 `saveSettings`；后端默认 false、旧 studio.json 无此键）。`setAiEnabled(v)` 是它的便捷写法（经 `saveSettings` 落盘 studio.json）；`selectAiEnabled(s)` 为唯一读法。后端所有带 pid 的 AI 路由关时 403 `ai_disabled`；E4/E5 面板在开关关时禁用按钮并明示，不发请求。
- `ai.jobs` 是**所有**后台任务（review / convert / oa_answer）的单一列表；convert / oa slice 只存自己的 `*JobId`，用 `selectConvertJob` / `selectOaJob` 从 `jobs` 里取。进度由 `api.aiJobEventsUrl(pid, id)`（SSE）→ `upsertJob` 推进；`GET …/ai/jobs` 轮询兜底。
- `ai.suggestions`：`rewrite` 的返回（`critic_markdown` + 行区间）先进列表，不直接改 content；`acceptSuggestion` 才把 CriticMarkup 按 `line_start..line_end` 回填到 content（prep 只删列表项，回填由 E4 补；之后由 R6 review slice 的 accept/reject 决定去留）。
- `terms`：`terms.json` 全量 PUT（`saveTerms`），`upsertTerm/removeTerm` 是对它的封装；`unifyTerms(names?)` 调 POST …/terms/unify 得 `{critic_markdown, count}`，`count>0` 时 `setContent(critic_markdown)` 灌回（内容是 `{~~别名~>主名~~}` 建议，不是直接替换）。术语 lint 诊断由后端 `lint()` 合并返回（id `terms.alias#<n>`，带 `replace: {from, to}`），`selectTermIssueCount` 数 Rail 角标；一键修复复用 `console/fixParser.deriveReplaceFix`（结构化 `replace` 优先于 `fix` 文本）。
- `convert`：向导五步 `convertStep`；`startConvert` 发 multipart（文件 + 问卷 JSON + target + ai_ack）→ job；`selectConvertResult` 解析 job.result 为 `{new_pid | draft_sha, report}`。
- `oa`：`parseOa` 是确定性拆条（不需要 AI 开关）；`answerOa` 才需要。`oaAnswers[itemId]` 的权项修改建议（CriticMarkup）由 E5 回填到 claims 行区间。
- 四个 slice 对 501 同 ast：`*Unavailable=true` + 面板占位文案，不弹 toast。`ui.railTab` 新增 `'ai'` `'terms'`（SideSplit 下块 → `components/ai/AiPanel` / `components/terms/TermsPanel`）；`ui.consoleTab` 新增 `'oa'`（ConsoleBody → `components/oa/OaPanel`）；`DialogId` 新增 `'convert'`（`components/convert/ConvertDialog`，Desktop/Mobile shell 都挂）。
- `lib/api.ts`：`aiStatus(probe?)` `aiChat`（返回 `Response`，SSE 由 E4 解析）`aiRewrite` `aiReview` `aiJobs` `aiJob` `aiJobEventsUrl` `aiUsage` `terms` `putTerms` `extractTerms` `unifyTerms` `convert`（multipart）`oaParse` `oaAnswer` `oaExportUrl`。
| collab（R8） | collab.ts | collabStatus('off'\|'connecting'\|'connected'\|'reconnecting') collabUnavailable peers(CollabPeer[]) collabReadonly collabError · loadCollabStatus(pid) setCollabStatus(status, error?) setPeers setCollabReadonly resetCollab · `selectCollabActive` |
| dashboard（W4-A） | dashboard.ts | dashScope('all'\|'mine'\|'shared'\|'archived'\|'trash') dashStatuses dashTags dashQuery dashView('list'\|'board') dashSelected dashLoading tags · loadDashboard setDashScope toggleDashStatus toggleDashTag setDashQuery setDashView toggleDashSelected setDashSelected setCaseStatus(pid, status, note?) patchCase(pid, patch) setListState(pid, state) deleteProject leaveProject bulk(action) loadTags saveTag deleteTag resetDashboard · `selectDashboardRows` `selectDueRows(s, withinDays=7)` |

### W4-A dashboard slice（docs/plan/13-w4a-case-dashboard-design.md §4）
- 数据源仍是 `project.projects`（`GET /api/projects` 已扩展 `case`（含 `next_deadline`）/ `collaborators` / `last_modified_by` / `my_role` / `list_state`，旧字段 id/title/mtime 不变）；本 slice 只放筛选 / 视图 / 多选 / 标签字典与写动作。写动作成功后就地 patch `projects` 行（不整表重拉）；`bulk` 例外，成功后 `loadProjects`。
- 写动作失败 → toast 后端错误文案，返回 false；`saveTag`/`deleteTag` 成功后同步改名 / 剔除 `dashTags` 里的已选标签。
- `ui.NavAction` 新增 `{type:'dashboard'}`（顶栏「← 案卷」/ ProjectMenu「返回案卷面板」经 dirty 守卫后 `goDashboard()`）；`project.createProject(id, title, caseFields?)` 第三参透传 `POST /api/projects` 的 `case`。
- 面板与工作台由 `App.tsx` 按 hash 二选一挂载（`#/` → `components/dashboard/DashboardPage`；`#/p/<pid>` 与旧 `#/<pid>` → 壳），回面板不清空 `project.*`（再进同一案 `openProject` 短路）。
| figuresBook（W4-C） | figuresBook.ts | previewFig figureAspects · setPreviewFig(name) setFigureAspect(name, ratio) unifyFigureWidth(cm) unifyFigureHeight(cm) moveFigure(name, ±1) resetFiguresBook · 常量 `FIG_WIDTH_MIN=2` `FIG_WIDTH_MAX=17` `clampFigWidth`（0.5 步进） |
| attachments（W4-C） | attachments.ts | attachments attachmentsLoading attachmentsError attachmentsUnavailable attachmentsPid previewAttachment · loadAttachments(pid) uploadAttachments(files)→bool deleteAttachment(name)→bool setPreviewAttachment(name) resetAttachments |

### W4-C figuresBook · attachments（docs/plan/15-w4c-figures-files-design.md §4.1；prep 已接线）
- 附图数据本体仍是 `figures.figures`（GET /figures，后端已改读 docs/figures.md，响应增 `alt`）；`figuresBook` 只放附图书独有 UI 状态与批量写：`unifyFigureWidth/Height` 逐图 PUT /figures/{name} 后用最后一次响应覆盖 `figures+settings` 并 `scheduleAst()`；`moveFigure` = 交换后 `reorderFigures`。
- `attachments`：GET/POST/DELETE `/api/projects/{pid}/attachments`；上传前 `types/attachments.attachmentReject` 按白名单 / 50 MB 预校验，任一被拒 toast 且整批不发；501 同 ast → `attachmentsUnavailable`，FileTree attachments/ 节点显示「待实现」且上传禁用，不弹 toast。
- 预览目标 `previewFig`（figs/）与 `previewAttachment`（attachments/）互斥，由 FileTree 点击设置、`components/attachments/FilePreviewPanel` 读取；桌面开 dockview `file` 面板（`PANEL_KINDS` 增 `'file'`），移动在 NavDrawer「案卷文件」tab 内替换文件树。`openProject/closeProject` 调 `resetFiguresBook/resetAttachments`。
- `lib/api.ts`：`getAttachments` `uploadAttachments`（multipart files[]）`deleteAttachment` `attachmentUrl(pid, name, download?)`。
- 下线：Rail「附图」按钮已移除（`railTab='figures'` 值保留只为旧持久化状态兼容，SideSplit 渲染 `FigureBookView`）；设置页附图段改为「打开附图书」按钮（schema kind `figures_book`）。
| deliver（R7 + W4-E E1，docs/plan/17 §2） | deliver.ts | xmlRunning xmlResult xmlError xmlAt · runXmlExport resetDeliver · **E1**：manifest(DeliverManifest\|null) manifestLoading manifestError manifestUnavailable bundleRunning filingOpen · loadManifest(pid) runBundle() setFilingOpen(open) fileCase({filed, application_no})→bool（内部调 dashboard 的 patchCase + setCaseStatus('filed')） |
| account（W4-E E2，docs/plan/17 §3） | account.ts | meSaving meUnavailable adminUsers(AdminUser[]) adminLoading adminUnavailable adminError org(Org\|null) · saveMe(MeIn)→FormErrors|null（成功覆盖 auth.user；改密成功即登出——R71-01）loadAdmin updateAdminUser(id, patch)→bool saveOrg(name)→bool resetAccount · 标签管理复用 dashboard.tags/saveTag/deleteTag，模板预设复用 templates slice |
| collabCenter（W4-B，docs/plan/14 §6.1） | collabCenter.ts | collabCenterOpen collabCenterTab('members'\|'links'\|'access'\|'settings') access(AccessReport\|null) accessLoading accessUnavailable invites(Invite[]) invitesLoading invitesUnavailable collabSettings collabSettingsUnavailable editorMode('edit'\|'review'\|'readonly') · openCollabCenter(tab?) closeCollabCenter setCollabCenterTab loadAccess(pid) loadInvites(pid) invite(pid,email,role) setInviteRole revokeInvite setMemberRole(pid,uid,role) loadCollabSettings saveCollabSettings(pid,patch) setEditorMode resetCollabCenter · `selectEditorMode` `selectCanSwitchMode`；成员 / 链接沿用 auth slice（ShareLink 带 accepted_by）；501 ⇒ *Unavailable |

### W4-E deliver · account（docs/plan/17-w4e-deliver-admin-design.md §2 / §3；prep 已接线）
- 共享文件（prep/integrate 才能改）：`lib/hash.ts`（`HashRoute` 增 `deliver` / `account` / `admin`，`readHashPid` 对递交页也返回 pid ⇒ StoreBootstrap 照常 openProject；`writeHashPid` 在递交页不改写）、`App.tsx`（三条页面分支）、`store/deliver.ts` `store/account.ts` `lib/api.ts`、`shell/ExportMenu`（增「递交页…」行）、`auth/UserMenu`（增「个人资料…」「机构管理…」）。E1/E2 只在 `components/deliver/**` `components/account/**` `components/admin/**` 内改。
- `deliver`：`loadManifest` GET `/deliver`；`runBundle` POST `/deliver/bundle`（编辑器当前 content + settings）；两者后端已落地（E1，`backend/app/routes/deliver.py`）；501 仅作通用不可用态 ⇒ `manifestUnavailable`，ExportGrid 六项按 `types/deliver.EXPORT_KINDS` 仍渲染但「暂无产物」、生成按钮禁用，不弹 toast。DOCX / PDF / 修订版 / 附图 zip 的下载 URL 不依赖清单（`api.exportUrl` `trackedDocxUrl` `figuresExportUrl` 现成），清单只补时间 / 大小。`fileCase` = `patchCase(dates)` → `setCaseStatus('filed')`，失败 toast 由 dashboard slice 给。`resetDeliver` 连带清空。
- `account`：`saveMe` PUT `/api/users/me`（唯一改密入口：`{password:{current,new}}` 核对旧密码，改密成功即登出重登；R6 的 `changePassword` PATCH 与 PasswordDialog 已删，UserMenu「修改密码…」跳 `#/account`）；`loadAdmin` 并发 GET `/api/admin/users` + `/api/admin/org`；501 ⇒ `meUnavailable` / `adminUnavailable`，页面表单只读 + 「待落地」文案。auth=off 时 `/api/users/me` 204 ⇒ AccountPage 显示「账号系统未启用」。

### R6 slices（docs/plan/07-r6-collab-foundation-design.md §5；prep 已接线，C1–C3 后端落地后即生效）
- `auth`：`loadMe` 在 StoreBootstrap 首屏调一次；`GET /api/users/me` 204 → `authStatus='off'`（与 R1 完全一致，顶栏不渲染分享 / 用户菜单，控制台无 4xx/5xx）；401 → `'anon'`（App 渲染 `components/auth/LoginPage`）；200 → `'authed'`。登录走 fastapi-users cookie 路由（form-urlencoded username/password）。
- `comments`：锚定 `{block_id, line, quote}`（与 ast slice 同一个 block id 体系）；501 → `commentsUnavailable`，ReviewPanel 显示占位。
- `history`：`restoreVersion` 经 `requestNavigation({type:'custom'})` 走脏检查后再调 POST restore，成功后以 loaded 方式灌回 content；取代 project.backups（.bak）——C3 落地后 HistoryPanel 换源。
- `collab`（R8，docs/plan/11 §5.2；prep 只有状态，连接实现在 `frontend/src/collab/`）：`loadCollabStatus` GET /collab，off / 501 → `collabUnavailable`（PresenceBar 不渲染，行为与现状一致）；`collabStatus!=='off'` 时 `doc.save` 不再 PUT /content，只清脏标记（写盘由服务端去抖完成）；`build.enqueue` 仍由客户端 `setContent` 去抖触发；`collabReadonly` → 编辑器只读 + 顶栏「只读」。
- `review`：`setReviewMode` → `enqueue('manual', true)`，build.ts 把 `reviewMode` 作为 `mode` 透传 POST /build；`setContent` → `scheduleMarks()`（200ms；`mayHaveMarks` 开口正则为 false 时不请求，否则后端 POST /critic，前端不解析）；`acceptMark/rejectMark` 用 `applyMarks` 做同一行内字面替换后 `setContent`。Editor.tsx 把 `marks` 推进 `components/review/criticExtension`（`setCriticMarks` 效果），C5 在那里画装饰。
- `ui`：`RailTab` 新增 `'review'`（Rail 「审阅」→ SideSplit 下块 ReviewPanel；移动 NavDrawer 四 tab）；`DialogId` 曾有 `'password'`（W4-E 已删，改密在 #/account）（W4-B D10：原 `'share'`/ShareDialog 已删，分享入口改 `collabCenter` slice 的 `openCollabCenter`）。

### R7 / R9 mcp · templates · importer slice（docs/plan/10-r7-r9-mcp-word-design.md §7；F1–F4 已集成）
- 三 slice 对 501 同 ast：`*Unavailable=true` + 文案，不弹 toast（现只剩 AUTH=off 的 PAT 路由会 501）。
- `mcp`：`createPat` 返回的 `token` 明文只出现一次 → 存 `newPat` 供「集成」页复制框展示，`dismissNewPat` 清除；`audit` 为当前案 `.studio/audit.jsonl` 末尾 N 行（最新在前）。AUTH=off 时 PAT 501（`patsUnavailable`），页面只展示 stdio / HTTP 本机接法（docs/mcp.md）。
- `templates`：`saveCurrentAsTemplate` 只取 `settings.{style, sub_except, abstract_limit}`（附图选择是案卷私有的）；`applyTemplate` 成功后以后端返回的归一化 `settings` 覆盖并 `enqueue('manual', true)`；导出 = 前端直接把 `Template` 下载成 JSON，导入 = `importTemplate(TemplateIn, overwrite?)`（POST；同名 409 由页面确认后 `overwrite=true` 走 PUT）。模板路由的 409/404/400 走 `ProjectError` handler（`{detail: string}`），与案卷路由一致；导入 400 走 errors.py 形状——`ApiError` 两种都取到 message。
- `importer`：`importDocx` 成功 → `loadProjects()` + `requestNavigation({type:'open-project', pid})`（走脏检查）；`importReport.items` 列出未能映射的元素（`code` 见 `lib/types.ts ImportReportItem`），`styleSuggestion.evidence` 说明每个建议字段取自 DOCX 何处，供用户勾选后写入 settings 或另存模板；只勾选部分时 `importDocx(file, {apply_styles:false, style})`，后端按 `style` 覆盖。
- `lib/api.ts`：`pats createPat revokePat audit trackedDocxUrl importDocx importDocxStyles templates template createTemplate updateTemplate deleteTemplate applyTemplate`。
- UI 挂点：`components/integrations/IntegrationsPage.tsx`（设置 › 集成）、`components/templates/TemplatesPage.tsx`（设置 › 模板）、`components/templates/TemplateMenuItems.tsx`、`components/importer/ImportDocxDialog.tsx`（`DialogId 'import-docx'`）、`components/importer/ImportReportPanel.tsx`；菜单「文件 › 导入 Word 文档…」`openDialog('import-docx')`、「导出 › Word（带修订）」链接 `api.trackedDocxUrl(pid)`；移动端 MoreSheet `more-import-docx`、MobileSettings 头部页面下拉（PAGES 全部页，含模板/集成）经 `SettingsContent page/onPageChange` 受控切页。

### R1 ast slice（docs/plan/04-r1-design.md §5.3；prep 已接线，B2 后端落地后即生效）
- `ast: Ast | null`（`@/types/ast`，与 `backend/patent_docx/ast_schema.json` 逐字段对应）；请求中/失败时保留旧值，`selectAstStale(s)` = `ast && astContent !== content`。
- 触发：`openProject` → `resetAst()` + `loadAst(pid, {fromDisk: true})`（磁盘内容）；`setContent` → `scheduleAst()`（200ms `AST_DEBOUNCE_MS` 防抖 → `loadAst(pid)` 带编辑区 content + settings；`AbortController` 最新者胜；不占构建锁）。
- 后端路由 501（B2 未落地）→ `astError` 置文案、`astUnavailable=true`，本案内停止随编辑重试（不弹 toast）；`resetAst`/显式 `loadAst` 复位。
- `activeBlock: {id, source: 'editor'|'structure'|'outline'} | null`：编辑器光标行 → `selectBlockAt(fullLine)`（source editor）；结构预览单击 → `setActiveBlock(id,'structure')`（不切视图）；大纲点击 → `setActiveBlock(id,'outline')` + `gotoLine`。
- `ui.editorView: 'source'|'layout'`（W4-D 前为 `'structure'`，`store/index.ts` merge 时归一化旧值）：Editor.tsx 桌面且 layout 时渲染 `components/block-model/StructureView`（D3 升级为版面视图 `components/layout-view`），移动端强制源码；版面模式收到 `scrollRequest` 先切回源码再跳行。`ui.mobilePreviewKind: 'layout'|'pdf'` 供移动端预览页子切换。`ui.outlineCollapsedIds: string[]`（AST block id）供 F2 大纲折叠态持久化，与 `sideOutlineCollapsed`（侧栏整块折叠）不同。
- `lib/api.ts`：`getAst(id, {content?, settings?}, signal)`（POST /ast）`putDoc(book, content)`（三书路由，B1）。

### R2 / R2.5 figures · preflight slice（docs/plan/05-r2-figures-preflight-design.md §6.1；prep 已接线，A1/A2 后端落地后即生效）
- `figures: FigureItem[]`（`@/types/figures`，= GET /figures 响应）；写动作（上传 / 排序 / 宽度·摘要图 / 删除）成功后同时 `set({figures, settings})` 并 `scheduleAst()`（图号可能变）；`reorderFigures` 乐观更新失败回滚。`deleteFigure` 遇 409 `figure-referenced` 不 toast，返回 `refs` 由面板列出引用行。
- `preflight: PreflightReport | null`（`@/types/preflight`）；不随键入防抖，只在控制台「体检」tab 可见且 `selectPreflightStale(s)` 时由面板触发；`preflightView` = 面板二级 tab（问题 / 权利要求树 / 附图标记 / 支持性）。体检项并入问题面板靠后端 `lint()` 返回（id `preflight.<rule>#<n>`），前端不合并。
- 两 slice 对 501 同 ast：`*Unavailable=true` + 文案，不弹 toast。`ui.railTab` 新增 `'figures'`（SideSplit 下块 / NavDrawer → `components/figures/FiguresPanel`）；体检面板作为 dockview 卡片 `checks`（`layout/panels.tsx` → `components/preflight/PreflightPanel`）与递交页左栏 `PreflightSummary`；W4-E 起控制台不再有 `'preflight'`/`'xml'` tab。
- `lib/api.ts`：`getFigures` `uploadFigures`（multipart）`reorderFigures` `updateFigure` `deleteFigure` `figuresExportUrl` `getPreflight`（POST /preflight，体同 getAst）；`isFigureReferenced(e)` 识别 409。

### R3 blocks slice（docs/plan/06-r3-structure-edit-design.md §6；prep 已接线，B1 后端落地后即生效）
- 共享文件（prep/integrate 才能改）：`store/blocks.ts` `store/ui.ts`（`structureEditable`）`lib/api.ts`。B2/B3 只**调用**这些动作，不新增 slice 字段；缺什么在 06 §7 提需求给 integrate。
- `ui.structureEditable: boolean`（持久化，默认 false）· `setStructureEditable` `toggleStructureEditable`。`StructureView` 实际可编辑 = `structureEditable && isDesktop`（375 恒只读，06 §5.6）；`StructureView` 的 `editable` prop 可覆盖（测试 / MobilePreview）。
- 行区间法则（后端 `patent_docx/patch.py` 同一法则）：块全文行 = `ast.books[book].offset + block.lines.{start,end}`（书相对 1-based 闭区间）；`blockSource(ast, content, id)` 取该块源码行（不含块间空行），`spliceBlock(ast, content, id, markdown)` 回填。可编辑块 = 摘要**各段** `abstract/pN`、权项 `claims/N`、说明书块；`title` / 摘要整块 `abstract` / `figures/*` 不可编辑（`findBlockLines` 返回 null）。两案 golden：`store/__tests__/blocks.test.ts` 对每块断言 `spliceBlock(blockSource) ≡ content`。
- `patchBlock(id, markdown)`：快照 `{content, saved, ast, astContent}` → 本地 `spliceBlock` + `setContent`（结构预览/构建照常跟随）→ `api.patchBlock(pid, id, {markdown, content, settings})` → 成功以后端 `content/ast` 为准且 `saved = content`（后端已 `save_content`）、`activeBlock = {id, 'structure'}`、`enqueue('save')`；失败恢复快照、`blockError` + `toast(error)`（422 文案含行号）、501 → `blocksUnavailable = true`（进入编辑仍允许，提交必失败并回滚）。返回 `boolean`。
- `insertBlock` / `deleteBlock`：不做本地预演（新块 id 由后端 AST 定），成功同上，`insertBlock` 返回新块 id 并设为 activeBlock；`deleteBlock` 成功后若 activeBlock 是被删块则清空。
- 一次只编辑一块：`editingBlockId`；`blockPending` 期间 `BlockEditor` 禁用再次提交。`blockTemplates` 由 `loadBlockTemplates()`（GET /api/block-templates）一次性缓存，B3 插入菜单用。

### 方案 C（07）新增 ui 字段 / 动作与兼容映射
| 新 | 语义 | 旧（保留，互为别名） |
|---|---|---|
| `pdfView: 'pdf'\|'logs'` · `setPdfView` `togglePdfView` | 控制台替换 PDF 区（07 §2.2） | `bottomOpen` / `toggleBottom`（`bottomOpen ⇔ pdfView==='logs'`） |
| `consoleTab: 'all'\|'error'\|'warning'\|'info'\|'checks'\|'xml'\|'preflight'` · `setConsoleTab` | 控制台 tab | `bottomTab` / `setBottomTab`，映射常量 `BOTTOM_TO_CONSOLE`（problems→all, checks→checks, deliver→xml）/ `CONSOLE_TO_BOTTOM` |
| `openConsole(tab?)` | 桌面 → `pdfView='logs'`；移动 → `mobileTab='console'` | `openBottom(tab)` → `openConsole(BOTTOM_TO_CONSOLE[tab])` |
| `MobileTab = 'edit'\|'preview'\|'console'` | 移动三 tab（07 §3） | — |
| `mobileSettingsOpen` · `toggleMobileSettings` | 移动全屏设置 Sheet | 与 `settingsOpen`/`toggleSettings` 同步 |
| `sideTab: 'files'\|'outline'` · `setSideTab` | 209 侧栏上下分栏展开项 | — |
| `sideOpen` · `toggleSide` | 侧栏开合 | `outlineOpen` / `toggleOutline`（同步） |
| `sideAutoCollapsed` · `syncSideAutoCollapse` | ≤1279（`NARROW_DESKTOP_MAX`）打开设置自动折叠侧栏、关闭恢复（原 DesktopShell 逻辑迁入 `toggleSettings`；DesktopShell 只挂 resize） | — |
| `settingsOpen` | **语义改为「设置面板替换编辑器区」**（07 §1 G4） | 动作名不变 |

`Diagnostic` 形状不变（`lib/types.ts`，`fix?: string`）；**不要**加结构化修复字段（后端本轮不动）。

选择器（index.ts）：`selectDirty selectStale selectAbstractLive selectSummary selectErrorCount selectWarningCount selectPdfUrl selectBusy`。

## 未保存守卫
会离开当前正文的操作一律走 `requestNavigation({type:'open-project'|'restore-backup'|'create-project'|'custom'})`；
dirty 时写入 `dirtyGuard.pending`，`DirtyGuardDialog` 读取并 `resolveNavigation('save'|'discard'|'cancel')`。

## 方案 C 占位组件（07 各区 ↔ 组件目录）
导出签名固定；占位阶段渲染 `<div data-slot="<Name>"/>` 或包住现有组件保持功能等价。旧组件（AppBar/DeliverMenu/BottomPanel/ProblemList/ProblemsSheet/SettingsDrawer/ExportButtons/editorBridge/shellDialog）已在 integrate 阶段删除；StaleBanner 仅移动端预览 Tab 保留。

| 07 区 | 目录 / 占位文件 | 现状（prep） |
|---|---|---|
| ① 顶栏 40 | `shell/TopBar.tsx`（MenuBar + 标题 + History/Layout/Export）、`shell/MenuBar.tsx`、`shell/ExportMenu.tsx` | TopBar 包 AppBar；ExportMenu 包 DeliverMenu |
| ② Rail 40 | `shell/Rail.tsx` | 沿用 |
| ③ 侧栏 209 | `outline/SideSplit.tsx`（上 FileTree / 下 OutlinePanel，`ui.sideTab`）、`outline/FileTree.tsx` | SideSplit 包 SidePanel |
| ④ 编辑器区 | `editor/EditorTabs.tsx`、`editor/EditorToolbar.tsx`、`editor/Editor.tsx` | 占位 |
| ④' 设置（替换编辑器区） | `settings/SettingsPanel.tsx`（左 172 `SettingsNav` + `SettingRow`）、`settings/SettingsNav.tsx`、`settings/SettingRow.tsx` | SettingsPanel 包 SettingsDrawer 拉满宽 |
| ⑤ PDF 区 | `preview/PreviewPane.tsx`、`preview/BuildButton.tsx`（绿色 split 按钮）、`preview/PdfStatusText.tsx` | 占位 |
| ⑤' 控制台（替换 PDF 区） | `console/ConsolePanel.tsx`、`console/ConsoleTabs.tsx`、`console/ConsoleEntry.tsx`、`console/ConsoleSummary.tsx` | ConsolePanel = ConsoleTabs(包 BottomTabs) + BottomPanelBody |
| ⑥ 状态栏 24 | `shell/StatusBar.tsx` | 沿用 |
| 移动 | `mobile/MobileConsole.tsx`（控制台 tab）、`mobile/MobileTabs.tsx`（编辑/预览/控制台） | MobileConsole = ConsoleTabs + BottomPanelBody |

壳网格 `shell/DesktopShell.tsx`：`columns: var(--w-rail) [var(--w-side)|0] minmax(0,1fr)`，`rows: var(--h-topbar) minmax(0,1fr) var(--h-statusbar)`；
SplitPane 左 = `settingsOpen ? <SettingsPanel/> : <Editor/>`（编辑器隐藏不卸载），右 = `pdfView==='logs' ? <ConsolePanel/> : <PreviewPane/>`；无底部面板行、无右侧抽屉列。

### 单元接入方式
在自己目录内替换占位文件的实现，保持导出名/签名与 `data-slot`/`data-testid`；状态只读写上表 ui 字段（新代码用 `pdfView/consoleTab/sideTab/openConsole`，不要再依赖 `bottomOpen/openBottom`）；token 用 `index.css` 的 `--h-topbar --w-rail --w-side --h-pdftb --h-statusbar --w-settings-nav` 及 `n0…n9 / primary / destructive / warning / info` 语义色（旧别名 `--h-appbar --w-outline --w-settings --h-bottom-collapsed` 已在 W5 集成阶段删除）；不改 `backend/**`、不加第二套组件库；完成后 `make check` + `make zero-drift` 全绿。

### 对比度验证（index.css）
用 WCAG 相对亮度公式脚本（Python，`(L1+0.05)/(L2+0.05)`）逐对计算 token 实际使用组合：正文 `n9/白 16.0`、次要 `n7/白 7.8`、白字/`primary` 4.55、`primary-text/primary-soft` 7.5、白字/`destructive` 5.7、`info/白` 5.2、深色 `n1/n9` 14.7 均 ≥4.5:1。`warning #de8014` 与白字仅 2.9 → 只用于图标/背景/圆点，文字用 `--warning-foreground`（浅 #8a4c0d / 深 #f5c98a）；`primary` 绿在 `n1` 底为 4.2 → 绿字统一用 `--primary-text`；`n6` 只作装饰/占位文字（白底 4.87，`n1` 底 4.46 不作正文）；warning 文字对 `--warning-soft` 6.0（浅）/ 8.9（深）。

## 方案 B 占位组件（06 §3 单元 → 文件，已落地）
- F1 shell：`components/shell/{AppBar,Rail,LayoutMenu,DeliverMenu,ProjectMenu,DirtyGuardDialog,StatusBar,DesktopShell,StoreBootstrap,Toasts}.tsx`
- F2 outline：`components/outline/{OutlinePanel,HistoryPanel,SidePanel}.tsx`（写 `doc.outline`，用 `lib/outline.ts`）
- F3 preview：`components/preview/{PdfToolbar,StaleBanner,PreviewEmpty,PreviewPane,PdfPreview}.tsx`
- F4 problems：`components/problems/{BottomPanel,ProblemList,CheckPanel,CheckDialog}.tsx`
- F5 settings/deliver：`components/settings/{SettingsDrawer,SettingsPanel}.tsx`、`components/deliver/{DeliverReport(XmlReport),ExportButtons}.tsx`（W4-E：XmlExportDialog 已删，XML 导出在递交页）
- F6 editor：`components/editor/Editor.tsx`（`CodeMirrorEditor` 纯受控 + `Editor` store 包装）
- F7 mobile：`components/mobile/{MobileShell,MobileTopBar,GlobalErrorBar,MobileTabs,NavDrawer,MoreSheet,MobileSettings}.tsx`
- B1 backend：`api.lint()` 已接 `POST /api/projects/{pid}/lint`（404/405 → 空报告），结果进 `diagnostics.setFromLint`

## 接入约定
- 组件只 `useStudio(selector)` 读、调 slice 动作写；**不要**从 App/Shell 传业务 props。
- 新字段加到对应 slice 并更新本表；跨 slice 逻辑放动作里（`get()` 访问全局）。
- 快捷键在 `lib/hotkeys.ts` 的 `registerHotkeys` 注册（骨架，F1 接 window keydown → `dispatchHotkey`）。
- 占位组件内含 `data-slot="<Name>"`，替换实现时保留导出名与 `data-testid`。
