---
name: testing-patent-studio
description: How to run and browser-test Patent Studio (React/Vite + FastAPI + LibreOffice PDF preview) end-to-end, including mobile viewport emulation, split-pane drag, downloads, and example-data cleanup.
---

# Testing Patent Studio in the browser

## Services
- Before restarting a test backend, navigate app tabs to `about:blank` (or close them), then reopen the app only after health passes. A retained browser Yjs document can reconnect to a newly seeded room and duplicate book content; mobile may keep CodeMirror rooms mounted even in layout view. Use fresh isolated examples after such a restart, and compare source files after cancel-only smoke tests. This avoids conflating collaboration lifecycle issues with the feature under test.
- Prefer isolated project data for UI tests: create a fresh scratch directory outside the repo, copy `examples/method` and `examples/system` into it, then run `PATENT_PROJECTS_DIR=<scratch-dir> make dev`. Confirm `/api/health.projects_dir` points there before importing or saving. Stop only the test-owned process group; leave unrelated backend ports and Chrome running. Verify `git status --short -- examples/` is unchanged rather than blindly restoring another session's edits.
- Backend: `curl localhost:8000/api/health` → `{"ok":true,"soffice":true,...}`. If down: `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000`.
- Frontend dev: `http://127.0.0.1:5173` (`cd frontend && pnpm dev`, `/api` proxied to 8000).
- Production/Docker smoke: `http://127.0.0.1:8100` (FastAPI serving `frontend/dist`). Its LibreOffice version may paginate differently (method = 21 pages vs 22 in dev) — treat ±1 page as environment, not a bug.
- Builds take ~0.8–1.2 s with unoserver (`/api/health` → `"unoserver":true`), ~1.5–3 s on the soffice CLI fallback; editor debounce is 400 ms (`useBuild.ts`). Wait ≥3 s after an edit before asserting status `已更新 · x s`. The status bar also shows `编辑→预览 x s` = last keystroke (or, for setting/manual builds, build start) → new PDF painted (`[data-testid=preview-e2e]`, desktop StatusBar + mobile MobileStatusStrip). To prove it isn't using a stale edit timestamp, idle ≥60 s then trigger a non-edit build (sizes.body or 重新构建) and assert the value stays ≤5 s. The value is counted once per PDF URL when first shown (`markPreviewShown` / `previewShownUrl`), so mobile 编辑↔预览 tab switches don't change it; but if the 预览 tab is hidden during the initial build, the first mobile value = load → first show (can be 6+ s) — assert on the value after ↻ or an edit, not the initial one. Unsaved edits trigger Chrome's `Reload site?` beforeunload dialog — click Reload or discard before F5.
- The preview double-buffers: the new PDF renders in a hidden slot and swaps in only after the viewport pages are painted, so there is exactly one `.react-pdf__Document` when idle and only viewport±1 pages have canvases (22-page doc → ~3 canvases).

## Useful selectors / facts
- Word import: desktop 文件 → `[data-testid=file-import-docx]`; mobile 更多操作 → `[data-testid=more-import-docx]`. Pick a `.docx` in `[data-testid=import-docx-dialog]`, wait for checked style suggestions, then submit with a unique ASCII ID. `[data-testid=import-report]` remains visible until closed.
- Mobile settings page navigation uses `[data-testid=mobile-settings-page-select]` → `[data-testid=mobile-settings-page-option-templates]` / `[data-testid=mobile-settings-page-option-integrations]`. With AUTH=off, Integrations intentionally gets `/api/pat` HTTP 501 and displays `[data-testid=pat-unavailable]`; inspect audit separately below the client configuration (scroll on mobile).
- Header buttons are icon-only with `aria-label`: 切换案子, 新建案子, 保存, 立即构建, 查找替换, 备份历史, 回归检查, 排版设置, 切换主题; DOCX/PDF are `<a download>` links.
- Settings inputs use `aria-label` = settings path, e.g. `sizes.body`, `page.margin_left_mm`. 摘要字数上限 input has no aria-label (find by label text).
- Split-pane handle: `[aria-label="拖拽调整分栏"]`, `role=separator`, ArrowLeft/Right move 2 % per key.
- Desktop/mobile switch is `min-width: 1024px`. On mobile the 新建案子 button is inside the "更多" menu, not the header.
- PDF pages are pdf.js canvases: `document.querySelectorAll('.react-pdf__Page canvas').length`.
- Status bar shows `页数 N` and `第 p / N 页` (the latter only updates while the preview is mounted/visible).

## Gotchas
- Chrome's downloads bubble appears after clicking DOCX and swallows the next click; press `Escape` before clicking PDF.
- Split-pane drag with computer-use: `mouse_move` to the handle, then `left_mouse_down` **without** coordinates, several `mouse_move`s, then `left_mouse_up`.
- Typing CJK via xdotool `type` into CodeMirror may not register; use ASCII text for edits or set the doc via the CM view if you must insert Chinese.
- Mobile viewport: Chrome won't shrink below ~500 px, so use CDP `Emulation.setDeviceMetricsOverride` (390×844, mobile:true) via a python `websockets` script against `http://localhost:29229/json`. To undo reliably, call `setDeviceMetricsOverride` with `width:0,height:0,deviceScaleFactor:0,mobile:false` **and then** `clearDeviceMetricsOverride` from the same session — `clear` alone from a new session did not restore the viewport.
- The Docker (8100) tab and dev (5173) tab share the same Chrome; the emulation override sticks to the tab across navigations.
- Breakpoint checks (e.g. 1000 vs 1024 px): the same CDP override with `mobile:false, deviceScaleFactor:1` and an arbitrary width switches layouts instantly (the `useMediaQuery('(min-width: 1024px)')` hook reacts without reload). Verify with `[data-testid=mobile-tabs]` (mobile) vs `[aria-label="拖拽调整分栏"]` (desktop).
- PDF scroll-preservation check: the preview scroller is the parent of `.react-pdf__Document`; compare its `scrollTop` before/after `立即构建` (a preserved position keeps the same value, a regression drops it to 0 / `第 1 / N 页`).
- Console: if the dev server hot-reloaded `PdfPreview.tsx` during the session, the console buffer may hold one react-pdf `[error] Warning: Options prop passed to <Document /> changed…` from HMR. It does not appear on a fresh page load — reload once before judging "console has no errors".
- Unsaved editor edits (no Ctrl+S) never touch `examples/*/content.md` or create `.bak-*`; a plain reload discards them.
- Mobile shell layout sanity check: before testing tab content, measure `[role=tabpanel]`, `[data-testid=mobile-tabs]` and `[data-testid=status-bar]` heights via `getBoundingClientRect()` — the tab panel must fill the space between the top bar and the tabs (a 0px panel means a flex-height regression even though `.react-pdf__Page canvas` nodes exist in the DOM).
- UI v2 mobile shell (375): project switching is in the header project button (`aria-label="当前案子：…"` → 最近案件 list), **not** in the ☰ nav drawer (`aria-label="打开导航"`, which holds 大纲/历史/检查 tabs). ⋯ (`aria-label="更多操作"`) opens the action sheet (排版设置 / 运行当前案检查 / 深色主题 …). `TooltipProvider` is mounted once in `App.tsx` for both shells — a `<Tooltip>` rendered outside it unmounts the whole tree to a blank page with only a console *warning*; hook `window.addEventListener('error', …)` before reproducing to capture the real stack, and check `document.getElementById('root').children.length === 0` to confirm React unmounted.
- At 1024 px the desktop preview pane is ~470 px wide; the PDF toolbar uses a container query (`@container/pdftb`, < 600 px) to collapse 重新构建 / 下载 PDF to icons — screenshots there should show icon-only buttons, not a clipped label.
- `prefers-reduced-motion` check: `Emulation.setEmulatedMedia` only stays in effect while the CDP websocket session that set it is attached — a fire-and-forget script (connect → set → disconnect) leaves `matchMedia('(prefers-reduced-motion: reduce)').matches === false`. Set the media feature and run `Runtime.evaluate` on the *same* connection (see `/tmp/cdp_motion_check.py` pattern). Chrome serializes the `0.01ms` override as `1e-05s` in `getComputedStyle().transitionDuration/animationDuration`; compare numerically, not against the literal string `0.01ms`.
- Resource-failure audit: `transferSize === 0` for a `/builds/<id>/out.pdf` entry is usually a pdf.js re-fetch served from cache (backend log shows `200 OK`), not a failed request — cross-check `/tmp/be.log` (`grep -cE '" (4|5)[0-9]{2} '`) before reporting 4xx/5xx.
- Mobile settings search box (`aria-label="搜索设置"`) does not accept xdotool CJK input; scroll the settings list and target inputs by `aria-label` (e.g. `sizes.body`) instead.
- Backup list rows (`aria-label="备份列表"`) show two times: primary `备份 YYYY-MM-DD HH:MM:SS` parsed from the `.bak-` filename (server-local backup time) and secondary `内容修改 …` from the file mtime (`shutil.copy2` preserves the original content mtime) — the two legitimately differ; don't treat the mismatch as a bug or a missing entry.
- `performance.getEntriesByType('resource')` may return 0 `/api/build` entries even after successful builds (buffer cleared / different request path); rely on the status-bar text (`已更新 · x ms`, changed `摘要 N 字`) and PDF content instead of counting requests.
- Overleaf-style shell (UI-C prep and later): desktop settings REPLACE the editor pane (`[data-testid=settings-panel]` visible, `[data-testid=editor-pane]` has `display:none`) and the console REPLACES the PDF pane (`[data-testid=console-panel]`, tabs 问题/检查/交付报告, close `[data-testid=console-close]`, toggle Ctrl+J after focusing the page). There is no bottom panel / right drawer any more — don't wait for one. Persisted UI state is `localStorage['patent-studio:ui:v2']` and is nested: `JSON.parse(...).state.{pdfView,consoleTab,theme,railTab,layout}`. Mobile tabs are `mobile-tab-edit/preview/console` (3 tabs, no `mobile-tab-settings`); problems live in `[data-testid=mobile-console]`, `ProblemsSheet` is not mounted. `sideTab` may have no UI control yet (SideSplit placeholder) — assert persistence on `pdfView`/`consoleTab`/`railTab` instead.
- Narrow-desktop side-panel auto-collapse triggers at width ≤ `NARROW_DESKTOP_MAX` (1279) when opening settings; test with a CDP override of ~1200×900 (`mobile:false`), then restore 1440×900.
- **Run the example-data cleanup BEFORE `make check` / `make zero-drift`.** A saved editor edit (保存并继续 during export, Ctrl+S) changes `examples/method/content.md`; `test_api` (`摘要 259 == 253`), `test_cnipa_xml` and `test_zero_drift` (md5 mismatch) then fail even though the app is fine. After `git checkout -- examples/*` both targets go green again.
- Dark-mode contrast of side-panel secondary text (`[data-testid=claims-count]`, `[data-testid=claim-ref]`, FileTree `N 次` tags, HistoryPanel `内容修改`, `[data-testid=search-count]`): read `getComputedStyle(el).color` and walk up to the first ancestor with a non-transparent `backgroundColor` (the side panel, ≈`rgb(27,34,44)` in dark) — expect `text-muted-foreground` ≈ `rgb(175,181,192)` → 7.8:1. `document.querySelectorAll('.text-n6').length` must be 0; `text-n6` on that bg is only 3.3:1.
- axe-core is a frontend devDependency: inject `frontend/node_modules/axe-core/axe.min.js` (read the file, `eval` its source via `browser_console`, then `await axe.run(document,{resultTypes:['violations']})`). Expected since the a11y follow-ups: no `aria-required-attr` (split handle has `aria-valuenow/min/max/text`, e.g. 61/20/80 `左栏 61%`), gutter line numbers `--color-muted-foreground` ≈7.75:1 light / 7.77:1 dark, PDF-toolbar status text `text-primary-text`, no `scrollable-region-focusable` (`.cm-content` has `tabindex=0`; the PDF scroller `[data-testid=pdf-preview]` is `role=region` `tabindex=0`). Menubar: with focus on a top-level trigger, ←/→ move focus between 文件/编辑/视图/构建/帮助; with a menu open, ←/→ open the neighbour menu (inside a submenu ← closes it as before). Baseline since PR #13 (verified 1440 light + dark): **0 critical / 0 serious** — any new hit is a regression. The PDF region is reachable via Tab from the PDF toolbar and scrolls with ↓/PageDown when focused. If `browser_console` returns `{}` for `await axe.run`, use a direct CDP `Runtime.evaluate{awaitPromise:true}` (CDP helper scripts need `pip install --user websockets`).
- Chinese IME into CodeMirror works via CDP on the same websocket session: focus `.cm-content`, `Input.imeSetComposition{text:'zhong',selectionStart:0,selectionEnd:5}` then `Input.insertText{text:'中文测试'}` (see `/tmp/cdp_ime.py`). xdotool CJK still does not register.
- Menubar keyboard model (`[data-testid=menubar]`, Radix DropdownMenu + controlled `openId`): Tab moves between 文件/编辑/视图/构建/帮助 triggers with a 2 px focus ring, Enter/ArrowDown opens, ArrowDown moves inside the menu, Esc closes; ArrowLeft/ArrowRight cycle top-level triggers (focus only when closed, switch the open menu when open).
- Mobile 375 console quick fix: edit line 33 `根据权利要求5`→`权利要求7`, wait for the build, open 控制台 → the entry shows a green `改为「权利要求5」` button (40 px) that rewrites the source and toasts. Since `MobileShell.tsx` keeps `[data-testid=mobile-edit]` mounted (`hidden` + `display:none` on 预览/控制台/排版设置), the fix goes through the CodeMirror transaction: back on 编辑 the toolbar 撤销 (`[aria-label=撤销]`) must be enabled, 撤销/Ctrl+Z reverts to `权利要求7`, Ctrl+Y re-applies. If 撤销 is disabled after the fix, the edit tab was unmounted (regression). Reliable way to create the line-33 edit on mobile: toolbar 查找替换 → put the full line-33 sentence in search and the `权利要求7` variant in replace via CDP `Input.insertText` (`/tmp/cdp_type.py`), then click 替换 twice (first click only selects the match).
- Mobile `编辑→预览` after an undo/edit while the 预览 tab is hidden can read tens of seconds (edit → first time the new PDF URL is shown); assert on the value after ↻ instead.
- Mobile PDF toolbar (375): `[data-testid=rebuild-menu]` (build split-menu chevron) must be 40×40 (`mobile ? 'w-10' : 'w-6'`); toolbar height 44 px; the only <40 px element is the inline error-strip text (36 px), which is not a control.
- Theme check: the rail button `aria-label` flips between `切换深色主题`/`切换浅色主题` (label = the *next* theme), and `document.documentElement.classList.contains('dark')` + `getComputedStyle(document.body).backgroundColor` (dark ≈ `rgb(27, 34, 44)`) confirm the active theme. Menu path: 更多 (⋯) → 浅色 / 深色 / 跟随系统.
- Focus-return contract (focus-return.ts): opening a dialog from a trigger should focus an element INSIDE it (autoFocus field or close button); Esc dismiss must return focus to the opener. Verify via `document.activeElement` (tagName + `#id` + `data-testid`), not screenshots — focus rings can be subtle. Selectors: project menu trigger `[data-testid=project-tab]` (the WIDE case-title pill mid-topbar, css-x ~595 at 1440 — NOT the menubar 文件/编辑/… which sit left at css-x ~95-250; a click at tool-x ~153 hits the menubar), items `[data-testid=rename-project]`/`duplicate-project` → `#rename-title`/`#dup-title` inputs; rail `rail-help` → `shortcuts-dialog`; dashboard `manage-tags` → TagManagerDialog; mobile `mobile-tab-more` → MoreSheet (`more-settings` → `mobile-settings` region, scrollIntoView first — it can be offscreen in the sheet); deliver page `deliver-file` → `filing-dialog` (autoFocus `filing-date`). Note: clicking the bare dialog overlay dismisses AND restores focus to the opener (unmount cleanup treats body as lost-focus) — designed behavior, matches Radix default.
- computer-tool click calibration: tool space is a scaled screenshot of the real display (1024×768 for a 1600×1200 screen → factor 0.64). Map `tool_x = css_x * 0.64`, `tool_y = (chromeTop + css_y) * 0.64` where chromeTop ≈ 97–105 real px (browser chrome + tab strip). Get css coords via CDP `getBoundingClientRect`, then VERIFY with `elementFromPoint(css_x, css_y)` before clicking, or hover+screenshot — a stale/wrong offset silently hits the wrong control (e.g. menubar 编辑 instead of project-tab, rail 体检 instead of rail-help).

## Wave 3 (dockview / collab / AUTH / AI) lessons
- **Agent scenario mock mode is opt-in**: start the test backend with `PATENT_STUDIO_AI_PROVIDER=mock`; an absent `PATENT_STUDIO_AI_KEY` alone selects the real provider and produces a missing-key job failure, not fixtures. Enable the case-level AI switch in the UI before running 场景 → S3. The mock job should complete and expose a proposal in 建议; 忽略 moves it from 待处理 to 已忽略 without changing source. Restart only test-owned services after navigating their app tabs away to avoid stale Yjs rooms.
- **Scratch isolation**: start the backend with `PATENT_PROJECTS_DIR=/tmp/ps_w3/projects` (copy `examples/{method,system}` there) so saves, terms.json, templates (`PATENT_TEMPLATES_DIR`), converted projects (`disclosure`) and imports (`w3import`) never touch `examples/`. Verify at the end with `cmp examples/method/content.md /tmp/ps_w3/projects/method/content.md`. Restore scratch AI setting with `PUT /api/projects/<pid>/settings {"ai_enabled":false}`.
- **AUTH=on instance**: second FastAPI on another port (`PATENT_STUDIO_AUTH=on`, own `PATENT_PROJECTS_DIR`, serves `frontend/dist` — run `npm run build` first). First registered user becomes 管理员. Logging out and logging in as another user **without reloading** leaves the previous user's project content/avatar/PDF state in the zustand store (server still 403s correctly) — always F5 after switching users before judging what a role can see. Share links live in `share_links` table of `<projects_dir>/../studio.db` (`python3 -c "import sqlite3…"`; `sqlite3` CLI is not installed). Navigating to a second `#/share/<token>` by only changing the hash does not re-run accept — reload (F5).
- **xdotool drops characters** in long ASCII strings typed into CodeMirror (`{++W3++}` became `{+W3++}`, `VIEWERTYPE` → `VIEWERTEPE`). For CriticMarkup / exact tokens, use CDP `Input.insertText` (`/tmp/cdp.py insert "..."` with `CDP_TARGET=<tabid-prefix>` to pick a tab) and re-read `.cm-content.textContent` before asserting. The 审阅 panel only requests `/api/projects/<pid>/critic` when the text matches `/\{(\+\+|--|~~|>>|==)/`, so a malformed opener silently shows `修订 0 处`.
- **Collab probing**: wrap `window.WebSocket` via CDP before reload (`/tmp/cdp_ws_hook.py`) to log open/close codes and creation stacks; FastAPI logging `[accepted]` does not mean the client kept the socket (dockview desktop shell may mount→unmount the legacy `Editor` and destroy the provider at ~1 s → no `[data-testid=presence-bar]`). Check `useStudio.getState().collabStatus` via `import('/src/store/index.ts')` on the Vite tab.
- **Multi-tab CDP**: `/tmp/cdp.py` honours `CDP_TARGET=<id prefix>`; list ids with `curl localhost:29229/json`. Hidden tabs still run JS, so cross-tab sync can be asserted with `document.hidden` + textContent checks.
- **Build retention**: `PATENT_KEEP_BUILDS=3` — the server keeps the latest successful `out.pdf`, and `PdfPreview` auto-enqueues one rebuild when an artifact URL 404s (e.g. a second tab's `lastOk` pointing at a build pruned by the first tab). Expect a brief `PDF 加载失败` alert followed by a fresh PDF; only a *persistent* 404 is a bug.
- AI upstream (`aicdks`, swe-2-medium → swe-2-high fallback after 30 s) is slow and variable (12–200 s); record `ai-chat-meta` model/time and don't call the fallback a bug. Conversion jobs are polled at `GET /api/ai/jobs/{job_id}` (there is no `?kind=convert` list route). Per-call model/latency/fallback are appended to `<projects_dir>/<pid>/.studio/ai-usage.jsonl` (`kind`, `model`, `fallback`, `ms`) — read that instead of timing by hand.
- **Real key without printing it**: `set -a; . /home/ubuntu/research/.env; set +a; export PATENT_STUDIO_AI_KEY="$AICDKS_API_KEY" PATENT_STUDIO_AI_BASE_URL="$AICDKS_BASE_URL"` inside a start script (see `/tmp/w3r2_start.sh` pattern); never `echo`/`env` afterwards.
- **Role checks on the `dist` build** (AUTH=on instance): `import('/src/store/index.ts')` only works on the Vite tab. On `:80xx` use a same-origin fetch from the page instead: `fetch('/api/projects/<pid>',{credentials:'include'}).then(r=>r.json()).then(j=>j.role)`, plus DOM markers `[data-testid=card-readonly]`, `[data-testid=card-save]`, `.cm-content[contenteditable]`, `[data-testid=collab-status][data-status=readonly|connected]`.
- **375 touch selection via CDP**: keep emulation + `Emulation.setTouchEmulationEnabled` in one long-lived CDP session (`/tmp/cdp_mobile_session.py` pattern; separate connections drop emulation). Chrome's touch emulation does not implement long-press word selection — use two quick taps (double-tap) to get a native word selection. Both the 全文 tab (`<Editor>`) and single-book tabs (`MobileBookEditor`, slot host `mobile-book-slot-host`) render the SelectionActionBar; single-book tabs report full-document line numbers to the AI. Mobile book switcher controls are `role=radio` (`book-switcher-{all,abstract,claims,description}`), not tabs.
- **Screenshot bookkeeping**: with 50+ screenshots per run, log `filename → what it shows` as you go (e.g. append to `/tmp/<run>_shots.txt`); reconstructing from thumbnails after a context reset is slow and lossy.
- **External traffic on exposed ports**: if `:5173` was shared via "Open preview", the user may be clicking around — backend log lines from a non-loopback IP (e.g. `10.x`) are theirs. Never kill that stack; run count-sensitive regressions (build counts, MCP push) on a second isolated stack (`VITE_API_TARGET=http://127.0.0.1:8001 npx vite --port 5174` + FastAPI `:8001` with its own `PATENT_PROJECTS_DIR`), and filter log greps by `127.0.0.1`.
- **Accept/Reject under collab must be checked in three places**: `useStudio.getState().content`/`marks`, the CodeMirror text (`.cm-editor` innerText or `EditorView.findFromDOM(...).state.doc`), and server `content.md` (md5) — plus a reload. Review-store `setContent()` can diverge from the Yjs-backed card/mobile editors (store clears the mark while editor + server + other tab keep `{++…++}`, and F5 brings the suggestion back). A "passed" store check alone is not proof.
- **Timed two-tab polling**: keep a long-lived CDP poller (`/tmp/r3_poll.py` pattern — one WS per tab, `Runtime.evaluate` every 100 ms, print only on change) and give it a 30–60 s window; computer-use clicks land 5–10 s after the shell command, so an 8 s window closes before the click.
- **Typing URLs with xdotool also drops characters** (a share token lost one letter → `分享链接不存在或已撤销`). Navigate with CDP `location.href=…` or paste; read tokens from `share_links` in `studio.db` when in doubt. `.test`/`.example` e-mail domains are rejected by pydantic on the register page — use e.g. `@r3mail.org`.
- **Restoring a Yjs-backed editor from a shell**: `import('/node_modules/.vite/deps/@codemirror_view.js').then(m=>m.EditorView.findFromDOM(el).dispatch({changes:…}))` on the Vite tab edits through the collab path so the server and other tabs follow (CDP may report "Promise was collected" but the dispatch still runs).
- **Scratch dir can be overwritten by stale Yjs state**: if a tab was already connected to `pid` before you re-copied `examples/` into `PATENT_PROJECTS_DIR`, the server's in-memory room will write the old document back on the next edit. Order: navigate tabs to `about:blank` → stop backend → copy examples → start backend → reload tabs → `md5sum` the scratch `content.md` against `examples/` before testing. Same at teardown: navigate tabs away before stopping the backend.
- **Injected globals die on reload**: helpers that rely on `window.__s = (await import('/src/store/index.ts')).useStudio` must re-inject after any `Page.reload`/F5 (the mobile-session script reloads on start) or the poller crashes with `KeyError: 'value'`. Store `marks` lags `content` by 0.3–1.2 s (throttled re-parse) — assert on text first, treat `marks` as trailing.
- **MCP helpers**: tools take `pid` (not `project_id`); block ids go stale after any edit (`{"kind":"stale"}`) so re-fetch `POST /api/projects/<pid>/ast` right before `patch_block`; the client prints truncated content, so read AST via REST, not via MCP output. For a claim block pass the joined segment texts (`\n`) as `markdown` with your marker appended → server diff yields one `{++…++}` insert.
- **Mobile 审阅 / 拒绝 path**: the single-book mobile editor has no inline ✓/✗ widgets; open ≡ 导航 → scroll the tab strip horizontally (审阅/AI/术语 are off-screen after 案卷文件/大纲/历史/附图) → 审阅 → row ✓/✗. Use a page-side `document.addEventListener('click', …, {capture:true})` timestamp to correlate a computer-use click with poller rows; remember the last click recorded may be a later one (e.g. closing the drawer).
- **Concurrent-typing check**: fire `Input.insertText` into two tabs within one script (`/tmp/r4_burst.py` pattern) while a 100 ms poller records per-tab `content.length`; assert monotonic non-decreasing length per tab plus identical final text on both tabs and server. `.cm-content.innerText` may differ by 1 char between tabs (remote-cursor widget) even when stores are identical — compare `state.doc`/store, not innerText.

## Wave 4 (AUTH=on dashboard / roles / routes) lessons
- **Isolated AUTH=on stack**: copy `examples/{method,system}` to a scratch `PATENT_PROJECTS_DIR`, run uvicorn on `:8001` with `PATENT_STUDIO_AUTH=on COLLAB=on SECRET=<any> COOKIE_SECURE=off`, Vite `VITE_API_TARGET=http://127.0.0.1:8001 pnpm exec vite --port 5174 --strictPort`. The first registered account becomes superuser. `studio.db` sits next to the projects dir (`sqlite3` CLI is absent — use Python's `sqlite3`). Prod `:8000/:5173` pids change when the user restarts them — identify by port (`ss -ltnp`) before killing anything, never by remembered pid.
- **Users per role**: use a `@w4mail.org`-style real-looking domain (`.test/.local` are rejected). Owner invites by e-mail via the drawer or `PUT /api/projects/<pid>/members {email,role}` (201 = pending invite); registering that e-mail in a fresh CDP `Target.createBrowserContext` auto-consumes the invite. Logout is `POST /api/auth/cookie/logout` (204), not `/api/auth/logout` (405). Disabled users get `400 LOGIN_BAD_CREDENTIALS`, not a "disabled" error.
- **Roles & editor mode**: `selectReadonly` is true while `projectLoading` (set by `openProject` until `GET /api/projects/{pid}` returns or fails) and for `viewer`/`reviewer` afterwards, so `.cm-content` must be `contenteditable=false` from its very first frame (status bar shows 「加载中…」 `status-loading` while the role is unknown). Verify with a `requestAnimationFrame` loop that reads `contenteditable` and runs `document.execCommand('insertText')` every frame from mount (a polling probe misses 60–80 ms windows); any `true` frame is a regression. Repeat ≥7 fresh opens — before the `projectLoading` fix it hit ≈2/7. Reviewer source view shows `[data-testid=reviewer-source-hint]` ("审阅者：源码视图只读" + 「切到版面视图提建议」 on desktop, no CTA on 375) and the status bar reads 「审阅 · 版面视图键入即建议」. Only the layout view (`toCritic`) turns reviewer edits into CriticMarkup — type reviewer test input in 版面 blocks. The hint's CTA goes through `ViewTabs.switchView('layout', panelId)`: the active dock card itself must flip from `card-editor-*` to the layout card (`useStudio.getState().activePanelId`), not just `editorView`. Reviewer `POST /api/projects/<pid>/critic` is `viewer`-level in `ROUTE_ROLE` (read-only CriticMarkup parse) → expect 200 and the reviewer's own 审阅 badge/ReviewPanel to count the `{++…++}`; a 403 here is a regression (it was the cause of a stuck `修订 0 处` in an earlier run). Read the store from a page with `await import('/src/store/index.ts')` → `useStudio.getState()` (`/tmp/w4r_store.py`); toasts live in `getState().toasts` and auto-dismiss in ~1 s — subscribe to the store before triggering, don't poll the DOM afterwards.
- **Status machine**: backend `CaseStatus` names are `intake/drafting/review/client_review/final/filed/oa/granted/rejected/closed` (not `new/customer_confirm`); any→any is allowed, same status → 409. Board drag = real mouse down/move/up on the card; check `POST /api/projects/<pid>/case/status` in the backend log plus `case.json`. Status changes are not live-broadcast — other windows/workspace badge show stale status until reload.
- **Routes**: `#/<pid>` is rewritten to `#/p/<pid>`; `?pid=` query is NOT handled; unknown pid → toast + `#/`. Deliver page is `#/p/<pid>/deliver`.
- **Mobile 375 via CDP**: emulation is per-CDP-session — a one-shot `setDeviceMetricsOverride` script loses effect when its websocket closes; keep a long-lived session (`/tmp/cdp_mobile_session.py` FIFO pattern) or run axe/measurements inside the same session. On 375 the dashboard filter trigger (`filter-sheet-trigger`) is at the right end of the horizontally scrolling chip row (scroll it first); BulkBar is `position:sticky` with `bottom==innerHeight`. The compact ProjectMenu (375) no longer opens a 状态 submenu: the ten statuses are inline `role=menuitemradio` rows (`[data-testid=status-<s>]`, `aria-checked` on the current one) under the `project-status` label inside the single `[role=menu]`, which scrolls (`max-h-[--radix-dropdown-menu-content-available-height]`). Assert `[role=menu]` `getBoundingClientRect().right <= innerWidth` and that no `[role=menuitem][aria-haspopup]` exists — the earlier Radix `MenuSubContent` variant ignored `max-w-[--radix-…-available-width]` and rendered 180 px at `left 285 / right 465`. Picking a row still `POST /api/projects/<pid>/case/status`.
- **Share-accept idempotency check**: to exercise the real `INSERT` path on `POST /share/<token>/accept`, pick a project the accepting user has **no ACL row** on (e.g. `system` when they already hold `method`). StrictMode double-fires every mount, so the accept POST appears twice in the access log — both must be 200; any 500 there is a regression (R14-02 pattern). Bad token must render 「无法领取：分享链接不存在或已撤销」. The anon→login hop preserves the token via `sessionStorage['patent-studio:share-return']` (consumed once by `enterWorkspace`).
- **Import inputs**: Markdown import is `[data-testid=file-import-input]` (accept `.md/.txt`) and Word import is `[data-testid=import-docx-file]`; `DOM.setFileInputFiles` bypasses `accept`; feeding a `.docx`/NUL/invalid-UTF-8 file to the markdown input is rejected by `decodeMarkdownFile` with an error toast (`… 不是文本文件`) and leaves `content` untouched. Word import by a non-superuser must set `case.json.owner_user_id` and an ACL owner row — check `GET /api/projects/<pid>` `role` and the dashboard 责任人 column (the `/api/projects` list item carries `case.owner_user_id` + `collaborators`, not a top-level `role`).
- **Known Y.Doc duplication**: restarting the backend while browsers hold Y.Docs doubles the whole document within ~6 s (296→632 lines); reproduce only on scratch data and restore from history afterwards.
- **History restore under COLLAB=on (single-write path since c60ba79)**: up to c60ba79, 版本历史 → 恢复此版本 could pop the 「有未保存的修改」 dirty-guard dialog even while the status bar said 协同自动保存 (`requestNavigation` compared raw `content !== saved`; `saved` is only updated locally by `applyServerContent`). Since the follow-up commit `requestNavigation` uses the `selectDirty` rule (collab on ⇒ never dirty), so under COLLAB=on the dialog must NOT appear — if it does, that is a regression. Before c60ba79, 放弃修改 there produced an interleaved doubled `content.md` (17284→34552 chars); with `serverContent` + `applyServerContent` (`store/doc.ts`) the same path converges exactly (disk/API/every client md5 equal). Still assert it every run: keep the target version (`GET …/history/<sha>` → file), then compare `wc -c content.md`, `md5`, `grep -c '^## 说明书'` (must be 1) and every client's `content.length`/md5 (`/tmp/w4r_store.py`). For cleanup only, owner `PUT /api/projects/<pid>/content` is simpler. The 版本历史 list does not refresh after restore/save until reload.
- **Owner lock after 404**: before c60ba79, `#/p/<bad>` → dashboard → reopen a valid case could leave CodeMirror locked (`.cm-content contenteditable=false`, `EditorState.readOnly` true) while `selectReadonly` was false; `CardEditor` now reconfigures the lock through a runtime `Compartment`. Always assert on the CM DOM/`view.state.readOnly` *and* type a character that must reach `content.md`, not only on the store; it was intermittent, so run the sequence at least twice. Non-superusers get 「权限不足：需要 viewer 及以上角色」 (403) instead of 「案子「x」不存在」 for a bad pid — both redirect to `#/`. Owner first frame: `.cm-content` mounts after the project fetch, so the first 1–2 frames are `contenteditable=true`, then the unsynced collab lock flips it to `false` for ~80 ms, then `true` — `status-loading` is usually never sampled for owners; only reviewer/viewer are strictly read-only on every frame.
- **axe per page**: inject `frontend/node_modules/axe-core/axe.min.js` over CDP (`/tmp/w4_axe.py` pattern, `MOBILE=1` sets metrics inside the same session). Known moderates: `page-has-heading-one`, `region`, `landmark-one-main`. DueBar date chip no longer uses `.opacity-80`; `dashboard-create` has `aria-label="新建案卷"` and the dashboard logo is `role=img` — re-run axe rather than assuming.
- **Reviewer duplicate-count check**: poll rev store / boss store / disk every ~0.4 s for ≥60 s around the layout edit (count `{++…++}` occurrences, `marks.length`, 「修订 N 处」); convergence order is disk → reviewer (~0.5 s) → owner (~1.5 s). Pre-submit samples are (0,0,0); any sample >1 is the R3 P2 regression (`store/blocks.ts` optimistic replace is disabled when `collabStatus !== 'off'`).
- **Figure book**: open via the `figs` folder row button `[data-testid=file-figs-book]` (aria-label 打开附图书) or 设置 → `settings-open-figure-book`; reorder with a real mouse drag on `[data-testid=fb-drag-handle]` (mouse down → several moves → up; the lifted card previews in the target slot) → `PUT /api/projects/<pid>/figures/order` and `docs/figures.md` reorder within ~1 s. Card captions (`fb-card-caption`) come from description.md's 附图说明 by figure *number*, so they stay position-indexed after a reorder — not a bug.
- **Word import fixture**: a hand-rolled ZIP with only `word/document.xml` is rejected as 「不是有效的 DOCX 文件」; use `backend/tests/fixtures/import_native.docx` (parses to 9/9 style suggestions). The dialog keeps the previous error banner after 更换 file. Markdown `file-import-input` imports into the *current* case (no case creation); only Word import creates a case with owner.
- **CDP mobile taps**: `/tmp/cdp_mobile_session.py` `tap X Y` takes CSS px of the 375 viewport — compute from `getBoundingClientRect()` via `ev`, not from screenshot pixels (screenshots are scaled). Synthetic `document.dispatchEvent(new KeyboardEvent)` throws `target?.closest is not a function` in `StoreBootstrap.tsx onKeyDown` (target = document) — ignore that console line or dispatch on `document.body`. When killing helpers, `pkill -f cdp_mobile_session.py` matches the shell running it — use `pkill -f 'python3 /tmp/cdp_mobile'` or the pid.
- **Dark theme**: 设置 → 外观 → 主题 (Select, `SettingsContent.tsx`) toggles `html.dark`; compute contrast from `getComputedStyle` colours walking up to the first opaque background.

## W6 companion/mobile golden-path checks
- Desktop AI is the top-bar companion (`topbar-ai`), not a dock-card preset. Mobile uses `mobile-tab-ai`; choose `ai-tab-chat`, fill `ai-chat-input`, click `ai-chat-send`, and assert an actual `ai-msg-assistant` response rather than only the prompt. Use `PATENT_STUDIO_AI_PROVIDER=mock` and a scratch project with AI enabled. `ai-review-button` runs a background review that creates real scratch-project comments; do not treat it as a read-only action.
- Desktop PDF selection needs real mouse-down/move/up over `.react-pdf__Page__textContent span`, with an intermediate held-drag screenshot. Mobile Preview → PDF uses a real touch hold ≥600ms and should open `pdf-long-press-sheet`; `plp-open-source` should navigate to the matching source. Close any open navigation drawer before interacting with bottom tabs.
- Delivery is `#/p/<pid>/deliver`; completed preflight exposes `check-rerun`. At mobile width use `deliver-tab-checks` and `deliver-tab-exports`. Download `export-download-docx` and `export-download-pdf`, then validate the actual files with `unzip -tq` and `pdfinfo`.
- Anonymous review is `#/c/<public-token>` in a fresh browser context (share acceptance is `#/share/<token>`). Comment submission closes the sheet; reopen `client-comment` after reload to verify persistence and scope text locators to the dialog because the desktop sidebar can contain duplicate hidden text. Confirming is a persistent scratch-data mutation: inspect the dialog at both viewports, submit once, and verify the confirmation from a second context.
- Mobile target-size scans must exclude occluded background elements and Radix's hidden 1×1 native selects; a small checkbox may have a larger associated label target. Record measured boxes separately from effective clickable areas.
- Full-site audit lessons (develop 891aa23): (1) Radix tabs/segmented controls (审阅 sheet 修订/批注, deliver 体检/导出产物, home status menu) often ignore `el.click()` from `Runtime.evaluate` — read `getBoundingClientRect()` and dispatch a real CDP `Input.dispatchMouseEvent` click (or computer-tool click) instead. (2) The mobile bottom nav (`nav button` 案卷/编辑/预览/AI/更多) unmounts while a textarea has focus (all rects 0×0) — `activeElement.blur()` first. (3) With several 5174 pages open (incognito customer context), pin the CDP target via the page id (e.g. `W9_TARGET=<id>` in `/tmp/w9cdp.py`-style helpers) or you will drive the wrong page. (4) PDF long-press: `Input.dispatchTouchEvent` touchStart → sleep ≥0.8 s → touchEnd on a `.textLayer span` that is inside the viewport (scrollIntoView first) opens the locate sheet. (5) Deliver 「下载」 is an anchor navigation without `download`; when `selectDirty` is true a browser-native「Leave site?」dialog blocks every CDP eval on that target until answered — answer it with the computer tool, do not wait on the eval. Failed artefacts' 下载 return raw JSON and replace the app page (needs Back). (6) Case-form dates (申请日 etc.) are silently dropped by the backend (top-level `filing_date` vs `dates.filed`) — don't rely on them to seed 期限中心 data. (7) Logout from `#/account?tab=…` re-renders the login form in place (hash unchanged) and re-login lands on `#/`, so capture the hash before/after if asserting return-to-page.
- **Two mobile figure surfaces (375)**: a figures companion that was already open on desktop becomes a bottom sheet hosting `FiguresPanel`/`FigureCard` (`figure-abstract-badge`, `figure-name` with the companion `+N` span); `open-nav` → `nav-tab-figures` opens the separate `FigureBookView` (`fb-card-abstract`, no `+N`). Press Escape on the companion sheet before clicking the navigation opener it occludes, and record which surface is mounted — never infer one surface's colours/contrast from the other's.
- **Worktree with a symlinked `frontend/node_modules`**: Vite's `server.fs.allow` rejects the real-path `@fs/…` font and PDF-worker requests with 403 (fonts fall back, PDF preview never renders). Prefer `pnpm install` inside the worktree; if you must reuse another checkout's modules, start Vite with a scratch-only wrapper config that imports the original `vite.config.ts` and appends the real dependency root to `server.fs.allow` — never widen fs restrictions in the product config or commit the wrapper. Confirm fonts + PDF preview load before the recorded window and keep setup-phase errors out of the clean-run counts.

## Cleanup after a test run
```bash
cd /home/ubuntu/repos/patent-studio
git checkout -- examples/*/content.md examples/*/studio.json
rm -f examples/*/content.md.bak-*
```
Exports land in `~/Downloads/申请文件-<标题>.{docx,pdf}` and `studio-<project>.json`; validate with `unzip -tq` and `pdfinfo`.

## Testing the live site (https://patent.zalize.com — real patent texts)
No login (Access removed 2026-09-04). Snapshot `GET /api/projects/{method,system}` before and after; never click save
(undo with Ctrl+Z so `未保存` → `已保存` without a PUT); for settings change one row and restore with that row's ↺ only;
finish by diffing the after-snapshot against before (content md5, `style`, backup count).

While the public edge is down (Cloudflare 530/1033 since 2026-09-09) the live route is an SSH forward to the
app container: `ssh -C -N -L 18081:<container-ip>:8000 user@vps` — **`-C` matters** (uncompressed forward: 167 KB
CSS 22 s, `/api/health` TTFB 13 s; compressed: 0.5 s / 0.35 s; the app itself answers in 10 ms on the VPS).

Production read-only UI checks (lead-authorized only; prefer the isolated stack):
- Opening a live project auto-fires `POST build`, `POST ast` (`openProject` → `enqueue('open')`) and any field edit
  debounces a `PUT settings` — even without clicking save. Snapshot server bytes first (over SSH, not via the UI):
  md5 of `content.md`, `studio.json`, `case.json`, `docs/*.md` for both cases + `/data/studio.db`, plus
  `ls .studio/builds` and `ls -la --time-style=full-iso .studio/collab`.
- Use an owned disposable browser context. Before navigation install a CDP `Fetch` request-stage guard that fails
  every method except GET/HEAD and log blocked attempts separately from requests that reached the server. The UI
  will show build/connection errors because of the guard — do not claim those paths were tested, and do not report
  "all requests were GET" when POST/PUT attempts were blocked.
- `Network.setBlockedURLs` does **not** block WebSocket handshakes (collab rooms opened, `[accepted]` in uvicorn,
  presence showed 2 users). Pre-inject an inert `window.WebSocket` via `Page.addScriptToEvaluateOnNewDocument`,
  count constructor attempts and require CDP `webSocketCreated`/`webSocketHandshakeResponseReceived` = 0. If a real
  socket appears: `about:blank` + dispose the context, then re-check server bytes before continuing. An inert
  transport does not test collaboration.
- Restore any transient input change immediately (same session), compare the final browser GET
  project/settings/content with the baseline, and re-run the SSH byte check (hashes, `builds/` entries,
  `collab/*.ybin` mtimes — those are rewritten at container start, so compare against the container start time —
  and `docker logs` filtered to non-GET/non-WS/non-`/RPC2`; `/RPC2` POSTs are unoserver's own loopback pings).
- `DOMStorage` commands fail with `Frame not found` after `about:blank`; use `Storage.clearDataForOrigin` in the
  owned context and dispose it. Never clear another context's storage.
- **Close every probe tab and kill the `ssh -L` forward when a live check ends.** Two `127.0.0.1:18080` tabs left
  in the shared Chrome by an earlier round reconnected their collab rooms (6 `WebSocket … [accepted]` from the
  docker gateway IP within 8 s of the next deploy's container start) — outside any guard, and easy to misread as
  the current probe leaking. Before a live check: `curl localhost:29229/json` must show no old forward URLs and
  `ss -ltnp` no stale forward ports. `collab/*.ybin` mtimes a couple of seconds *before* container start are the
  old container's shutdown flush, not a write.
- The forward can be slow (~90 KB/s observed): set navigation timeout ≥240 s and selector waits accordingly, and
  wait for `img.complete` on every figure card before measuring geometry — a not-yet-loaded `<img>` is 2 px tall,
  the card's `WidthHandle` then sits over the row above (`menuDown` 12 instead of 22) and the card grows ~158 px
  once the bitmap arrives (R10-07). Bottom cards straddling the `#fb-body` scroll edge give a clipped cross-section;
  scroll them into view instead of reporting a size defect.
- Record the layout preset before asserting a dock width: the default ai-assist preset gives the settings panel
  ~460 px (single column), the explicit 源码|PDF preset ~580 px at 1440. Check both DOMRect containment and input
  `scrollWidth-clientWidth` — an `overflow:hidden` ancestor hides negatively overflowing controls while the panel's
  own `scrollWidth === clientWidth`; use 3× screenshots to read digits/prefix/unit/↺/spinner.
- Before a deploy, read the `delta:` line of `deploy.sh --delta` **before** the SCP starts: a frontend-only change
  should keep 1–3 layers / a few MB. `保留 15 层 656.7 MB` means the local layer chain diverged from the VPS image
  (local apt layer cache lost after a Docker prune/rebuild), not that the change is big; at ~25 KB/s that is a
  7-hour upload. Aborting during `>> upload (scp)` is safe (the image is only switched after `load`), but delete
  the half-written `/opt/patent-studio/image.tar.gz` on the VPS. Stopgap used for #93: build a throwaway image
  `FROM <deployed tag>` + `USER root` + `rm -rf /app/frontend/dist` + `COPY --from=<fresh build> /app/frontend/dist`
  + `USER 1000` (the `rm` fails with Permission denied without `USER root`), tag it `patent-studio:local`, and
  verify the 13 js/css md5s equal the full build's before deploying. A standalone `docker run` of that image reports
  `unoserver:false` in `/api/health` — that is the missing compose sidecar timing, not a broken image; check
  `unoserver:true` after the compose deploy instead. Also `ss -ltnp | grep <port>` before opening a new
  `ssh -L` forward: a leftover `ssh -N` from a killed run holds the port and the new forward silently fails with
  `Address already in use` while the ssh process stays alive.

## Devin Secrets Needed
None.

## Non-collaborative dirty guard and sidebar history
- Start isolated data with `PATENT_STUDIO_COLLAB=off` to exercise the three-way
  dirty guard. With collaboration enabled, ordinary content changes do not use
  that navigation guard.
- For long CodeMirror documents, `.cm-content` can be thousands of pixels tall.
  Do not click its bounding-box center: click an in-viewport text point, press
  Ctrl+End, and verify the marker and `未保存` before navigating.
- Discard verification must include immediate **no-refresh** same-case reopen,
  editor status/text, a subsequent save trigger, disk `content.md`, and F5.
  A clean disk immediately after Discard alone does not catch retained editor state.
- Desktop **文件 → 版本历史** (`file-history`) opens the left outline HistoryPanel;
  the topbar history icon opens a different companion surface. The current left
  HistoryPanel reloads on `saved` changes, so save/restore should refresh its list
  without F5; older notes about needing reload should not be assumed for this panel.
- On a fresh project history repository, a normal first save generates a real
  `.bak` which is imported as `旧备份 …`; select that row and restore to test
  `保存` / `旧备份 …` / `恢复自 …` without manufacturing git commits.
- `make dev` has a group-wide signal trap. To avoid recursive shutdown diagnostics,
  identify the test-owned uvicorn reloader and Vite pids, terminate those children,
  let make exit, then verify port release; never kill unrelated listeners.

## Word-like layout acceptance (Wave 9)
- Layout books are single ProseMirror editors (`[data-testid=ps-book-description]`,
  `.ps-book`). Use CDP `Input.insertText` for Chinese and real mouse drags for
  selection. Mobile editing mode is `[data-testid=mode-indicator]` →
  `mode-option-edit` / `mode-option-review`; do not assume desktop selectors.
- At 375, test `mlt-bold` and `mlt-rail` with exactly one click while the editor
  retains focus. Measure the selection popover bottom against the actual toolbar
  top, not the viewport bottom: browser focus can change the mobile tab bar.
- Reviewer suggestions need a persistence assertion, not just a green insertion
  and a review-card count. After typing, check scratch `content.md`, switch books,
  reload, and require the same unique marker and count. Local ProseMirror/store
  state can look correct even when the collab/write path has not saved anything.
- For axe breakpoint matrices, record visible-state flags alongside each result
  (source/layout/PDF/dialog/rail). A view-switch click can leave a different dock
  panel or mobile tab mounted; zero violations on that state does not prove the
  intended route/state was tested. Capture a screenshot for each confirmed state.
- Copy export artifacts outside `.studio/builds` before subsequent builds prune
  them. Preserve `word/document.xml` runs and `pdftotext` output for the exact
  marker rather than merely checking that some bold run exists.
- Fixture restore under COLLAB=on must go through the server: `cp backup →
  content.md` only fixes disk; the collab room keeps the mutated Y doc and the
  next reload/autosave shows or writes the old text back. Restore with
  `PUT /api/projects/<pid>/content` from the logged-in page (CDP `fetch`) and
  re-check md5 after a reload. `content.md` lives at the project root; `docs/`
  holds only the three books + `figures.md` — do not create `docs/content.md`.
- Undo has two histories: the layout view (FormatBar `format-undo` / Ctrl+Z and
  the 375 `MobileLayoutToolbar` 撤销 while a layout editor is mounted) =
  ProseMirror history via `layoutHistory`; the source view = `editorCommands.undo`
  (CodeMirror). Accept/reject are not part of the ProseMirror history, so an undo
  after accepting a revision must only remove typed text — always diff the book
  file after any undo, at every width (`{++…++}` returning on disk = regression).
- The topbar badge `2 警` on the `method` fixture is content lint (multi-dependent
  claim 9, figure label 1034 name mismatch), not a UI error; open it via
  `[data-testid=status-health]` before reporting it.
- CDP `Runtime.enable` on a fresh session replays the tab's console buffer since
  the last navigation, so `/tmp/w9console.py`-style snapshots work retroactively
  only up to the previous reload — attach a logger before the first scenario.
- Device-emulation coordinate mapping in the computer tool: 375 mobile → tool
  `x = css*0.64`, `y = 56 + css*0.64`; the green pen at the top right is
  `mobile-build` (构建 PDF), the mode indicator is the icon below it — verify
  with `getBoundingClientRect` before tapping.

## Word-like media in layout view (Wave 10)

- Layout cards are per book. The default card is `版面 · 说明书` (one `.ps-book`,
  description equations/tables + the trailing `说明书附图` figure paper). Claims
  equations (`.ps-eq.ps-claim-eq`) only exist once a claims layout card is open:
  card header `打开为…` (aria-label, `[data-testid=card-open-<panel>-layout-claims]`)
  → 拆分到右侧 → section labelled **结构** (not 版面) → 权利要求书. The `打开为…`
  dropdown may not open while the card is floating (`浮动`) — dock it back first
  (`停靠 …` button). At 375 the mobile 全文 tab mounts all 3 books (17 `.ps-eq`).
- Figures: `figure.ps-figure-paper[data-selected]`, `img.ps-figure-img`,
  `[data-testid=ps-figure-meta]`, `[data-testid=ps-figure-edit]`, width slider
  `[data-slot=WidthHandle][role=slider]` (44×44, `data-dragging`, `aria-valuenow`,
  ≈ 37.8 px per cm, 0.5 step). Real drags commit `PUT /figures/<name>` and rewrite
  `docs/figures.md {width=N}`; drag back or expect md5 drift. Tab order after
  clicking a figure: its WidthHandle, then the next figure. On desktop the figure
  book opens as dock `tab-figures`; on 375 it opens the 导航 drawer with the 附图书
  tab selected (no `tab-figures` testid).
- Tables: `.ps-book .ps-table-scroll > table.ps-table`. Typing in a cell writes
  to the source within ~2 s; Tab/Shift+Tab move between cells (`bookKeymap()`
  chains `goToNextCell` before swallowing) — verify by anchor cell index. prosemirror-tables CellSelection exists only
  while the pointer is held — poll `.selectedCell` during the drag.
- Equations: `.ps-eq > .ps-eq-side + .ps-eq-math[tabindex=0] + .ps-eq-label`;
  `.ps-eq-math` is `overflow-x:auto; overflow-y:hidden` with `padding-block`;
  regression check: `scrollHeight === clientHeight` and `offsetWidth === clientWidth`
  for every formula (a vertical scrollbar shifts the centre by half its width). Double-click `.ps-eq-math` opens the
  编辑公式 dialog; 取消 leaves disk untouched.
- Desktop 1440 emulation coordinate mapping in the computer tool (1600 screen):
  `x = css*0.639`, `y = 57 + css*0.637`.
- `pkill -f <script>` from the exec tool matches its own bash wrapper and kills the
  call (exit −1) — use `ps aux | grep "[w]9emu"` + `kill <pid>` instead.
- Killing the persistent CDP emulation client does **not** always drop the
  375 override (page kept `innerWidth 375` even after
  `Emulation.clearDeviceMetricsOverride` + reload). Reliable reset: start a new
  persistent client with the desktop size (`w9emu.py 1440 1000`, no `mobile`) and
  reload — `<html data-density>` flips back to `comfortable`.
- 375 `touch-hit` check: `getComputedStyle(btn,'::after').height` (44px under
  `html[data-density=touch]`), union with the element rect, then really tap 2–3 px
  below the visual box (`elementFromPoint` there must return the button).
- **Screenshot-tool DOM annotation redraws the ProseMirror books.** Every
  `computer` screenshot/zoom/`read_dom` (and the implicit screenshot after the
  last action of a batch) stamps `devin-hidden` / `offscreen` / `devinid` /
  `devin-tagname` / `devin-scrollable` attributes on page elements. Attribute
  mutations on PM block nodes are *not* ignored by PM's `DOMObserver`
  (`registerMutation` → `markDirty` → `DOMObserver.flush` → `view.updateState`),
  so all three `.ps-book` views redraw every block and re-create NodeViews
  (`.ps-eq`, `.ps-table`): tagged elements leave the DOM, equation `scrollLeft`
  resets to 0, `.ps-book` itself survives. Consequences for testing: never judge
  NodeView identity / in-container scroll retention / "was X re-created" across a
  computer-tool screenshot; use CDP `Input.dispatchTouchEvent` (`/tmp/w9touch.py`)
  + shell `sleep` + `w9cdp.py eval` for such probes, and only screenshot afterwards.
  The W10 "375 formula snaps back after touch swipe" P3 was this artefact — with
  CDP touch (tap or no tap, over-scroll or not) `scrollLeft` is retained for >25 s.
  Product-side note: any extension/tool that sets attributes on many blocks
  triggers the same full redraw (robustness, not a reproducible user bug). Since
  W10.1 `EquationNodeView` remembers `scrollLeft` per formula across destroy/rebuild
  (restored in a microtask), and paragraph-number widgets are keyed by block id so a
  redraw/keystroke no longer re-creates them — a screenshot after a swipe should now
  show the formula still scrolled. Verified on `0064508`: PM constructs the *new*
  NodeView before calling the old one's `destroy()`, so any "save state in
  destroy()" scheme misses the first redraw / restores a stale value — the memo must
  be written on the `.ps-eq-math` `scroll` event. Test it adversarially: swipe to X,
  screenshot → new element `scrollLeft≈X`; swipe to a *different* Y, screenshot → Y.
- Table shortcuts (`Mod-Alt-Arrow*` / `Mod-Alt-Backspace`, `table/commands.ts
  tableKeymap()`): dispatch with `w9cdp.py key ArrowDown 3` (CDP
  `Input.dispatchKeyEvent`, modifiers alt=1 ctrl=2 → 3) *after* clicking a body cell
  (a `document` capture `keydown` listener shows `ctrlKey/altKey` and whether Chrome
  swallowed it — on this box it does not). Use the 1440 mapping `x=css*0.639,
  y=57+css*0.637` to hit the cell. **Watch the row count for ≥3 s afterwards** (the
  AST round trip `POST /api/projects/method/ast` lands ≈1.5 s later): an inserted
  *empty* row `|  |  |  |  |` must stay (W10.1 fixed `is_table_separator` in
  `content.py`/`ast.py`, which used to treat all-empty cells as a `---` separator
  row → DOM 5→4 while the source kept it, and the 撤销 button went disabled). After
  a backend change **restart the isolated `:8001` uvicorn** (find the pid via
  `ss -ltnp`, never a broad pkill) or you test stale code. Undo history does not
  survive 版面↔源码/PDF view switches (editor instance is re-created) — Ctrl+Z before
  switching views, or clean up with `Mod-Alt-Backspace` in the added row. Fallback
  restore: owner `PUT /api/projects/method/content` from the page (same cookie):
  write the JSON body to `/tmp/restore.js` and evaluate it through a tiny websockets
  script — do **not** `import w9cdp` (module-level `asyncio.run(main())` runs on
  import).
- Widget-identity probes (`.ps-para-no`): tag elements (`el.__w=1`), attach a
  `childList` `MutationObserver` on the `.ps-book`, type via `xdotool type`, then
  read the counts **with `w9cdp.py eval` before taking any screenshot** — the
  screenshot redraw alone adds ~200 childList records and re-creates the widgets.
  Expected on W10.1: 2 records (typed paragraph's text node), 97/98 widgets kept.
- To see *why* a PM view redrew, import the app's own module instance
  (`import('/node_modules/.vite/deps/prosemirror-view.js?v=<hash from a served
  .tsx>')`) and patch `EditorView.prototype.updateState` (log `new Error().stack`)
  and `EditorState.prototype.applyTransaction` (meta keys). `view.dispatch` is
  instance-bound in the constructor, so a prototype patch does not see it. Grab
  views via a `someProp` prototype hook and wrap `view.domObserver.pendingRecords`
  / `registerMutation` to see the raw MutationRecords PM acted on.
- `performance.getEntriesByType('resource')` saturates at 250 entries on this app —
  call `performance.setResourceTimingBufferSize(5000)` before using it as a
  request counter (a `PerformanceObserver` or CDP `Network.enable` still works).
- `window.__errs` hooks are lost on reload — re-install after each `location.reload()`
  or rely on the CDP console replay (`w9console.py`) for the last load.
- Typed text comes out UPPERCASE / shifted in the app (e.g. AI prompt `CLAIM 1 OK?`)?
  Caps Lock is on at the X level, not an app bug: check `DISPLAY=:0 xset q`
  (`Caps Lock: on`) and toggle with `DISPLAY=:0 xdotool key Caps_Lock`.
- Diagnostic-language audit (W11 b3): the semantic label helper is
  `frontend/src/lib/diagLocation.ts` (`权利要求 N` / `说明书 · 段落 [NNNN]` / `摘要` /
  `图 N` / `全文`). Assert with a regex `content\.md|第 \d+ 行|L\d+|claims/|blk_` over
  the panel's `innerText`, per surface (console 问题 tab, 递交 体检 summary + table,
  mobile GlobalErrorBar, MobileConsole 输出 tab, PDF 定位提示, 术语/标记/成员 chips).
  Since W11 b4 the only surfaces that legitimately show editor line numbers are the
  源码 view itself (CodeMirror gutter, status-bar cursor in 源码 mode) and the
  「原始日志」<details> (collapsed by default) — anything else is a finding.
  To create a fresh `claims.forward_ref` error, edit a dependent claim in 源码 to
  reference a later claim (`权利要求2` → `权利要求4`); `摘要` errors need >300 chars.
- The `a11.sh shot <path>` helper appends `.png` itself — pass a name without the
  extension or rename `*.png.png` afterwards; its mobile mode is `size 375 812 mobile`
  (there is no `mobile` sub-command).
- **Leak audits must read DOM metadata, not just `innerText`**: FileTree / FigureCard /
  mobile nav drawer put internal strings in `title` / `aria-label` / `img src`
  (`figs/`, `fig1.emf`, `点击定位到说明书第 N 行`) while `document.body.innerText` is
  clean. Run the regex over `[...document.querySelectorAll('[title],[aria-label]')]
  .map(e=>e.title+' '+e.getAttribute('aria-label'))` as well. Likewise the 375 PDF
  long-press sheet title is the block id (`abstract/p1`), which `blk_` does not match.
- **XML content-error locate**: the empty-claims fixture is `method` with 摘要 shortened
  (<300 chars, otherwise DOCX fails first) and every claim line under `## 权利要求书`
  deleted; the build then succeeds and 递交 → CNIPA XML 重新生成 returns 200
  `{status:'error'}`. Check `[data-testid=xml-error-locate]` directly (text
  `定位 · 权利要求书`, aria `在源码中定位到权利要求书`); since the W11 b4 delta the
  failure card renders it via `ExportItem.errorAction`. Clicking must land on the
  claims *card* (`[aria-label="claims.md 编辑器"]` visible, tab `aria-selected=true`) —
  an empty book shows only its `## 权利要求书` heading (card line 1, full-file line N).
  Locate paths that go through `locateSourceLine` (console/体检, 附图书 FigureBookView,
  FileTree book rows) open the target card even if only another book's card is open;
  paths that still call the bare `gotoLine` (e.g. the companion-bar 附图 panel caption
  click) may silently no-op in that state — test each entry point separately, with
  ONLY a different book's card open, before judging.
- **375 PDF long-press sheet via CDP touch emulation**: `mouse_move` → `left_mouse_down`
  → wait ≥1 s → `left_mouse_up` opens the sheet, but Chrome also pops its native context
  menu on top — press `Escape` once (the sheet stays). Wheel scroll doesn't move the PDF
  under touch emulation; set `[aria-label="PDF 预览"].scrollTop` or type a page number.
  Sheet title = `diagLocationLabel` (`摘要` / `权利要求 N` / `说明书 · 段落 [NNNN]`),
  sub-line `第 N 页`; query the sheet's `h2` by text, not `document.querySelector('h2')`
  (the first h2 is the project title).
- **Fixture restore with COLLAB=on**: writing `content.md` while the page is open is
  overwritten by the Yjs server state; the reliable path is stop uvicorn → `cp`
  baseline `content.md` (and prune `reviews/marks.json`) → `start-backend.sh` → F5.
  Snapshot baselines (`cp -a` the project dir to `/tmp/<pid>-baseline-<run>`) before
  the run and compare md5s at cleanup.
- **Editor accessible names differ per card**: the same audit regex must be run with
  each source surface actually mounted — single-book `SourceCard`s, the desktop
  `source:all` `FullTextCard` (视图 → 布局 → 审阅 preset opens `source:all`+PDF) and
  the 375 `MobileBookEditor` each pass their own `aria-label`, so a fix in
  `Editor.tsx`'s default label may not reach all of them. Also expect CriticMarkup
  inline ✓/✗ buttons inside CodeMirror to carry `第 N 行` in title/aria when a
  suggestion is visible; decide up front whether that counts as the source-view
  exception.
- **Persisted dock titles are stale until reload**: panel titles come from the saved
  layout; after a title change hard-refresh (F5) before asserting the tab text.
- **Save feedback paths are distinct**: source-card Ctrl+S invokes `saveBook(book)`,
  while 文件 (`menu-file`) → 保存 (`file-save`) invokes whole-content `save()`.
  Layout typing invokes `saveBook(book, newMd)` → `saveBookDoc`, whose auto-save can
  intentionally be silent. Do not substitute source-card saving as evidence for
  layout auto-save. Confirm a layout marker on disk and its successful PUT/patch.
  Success toasts last 2500ms: poll `[data-testid=toasts]` immediately after real UI
  input and capture a screenshot without changing toast text or timeout. A DOM
  observer should account for removal/reappearance of identical messages.

## Source comment anchors and focus-return verification
- In persisted multi-card layouts, FileTree navigation can reuse a readonly
  `source:all` mirror. Before editing a particular book, select its dock tab
  (`tab-layout:abstract`, for example), then click the source view switch.
  Require a visible `.cm-content[contenteditable=true]` with the intended book's
  accessible name. Clicking the centre of a long editor can land offscreen;
  use a visible `.cm-line` rectangle instead.
- Comment selection comes from the active CodeMirror editor, not a ProseMirror
  caret. A blank line inside an AST block can legitimately have an anchor.
  For a negative test use the full-source title or the blank line between title
  and the first section, and log the selected full-file line.
- To naturally test an open draft losing its anchor, use desktop source for a
  single book: place the caret in its paragraph, open a draft, type a nonempty
  comment, return to that source editor, Ctrl+A and delete the book body. Wait
  for AST parsing; assert `review-draft-unanchored` has role=alert and
  `review-draft-submit` is disabled. Undo immediately in the same editor,
  confirm text/anchor recovery, cancel the draft and verify disk text is restored.
  Use scratch data only.
- Do not assume CDP key dispatch implements native button activation or Radix
  menu dismissal. If native Enter/Escape is required and xdotool is absent,
  X11 `libX11.so.6` + `libXtst.so.6` can send XTestFakeKeyEvent pairs; check
  the correct DISPLAY and flush the display. Tab to the opener (do not call
  DOM.focus()), then Enter, Tab/Shift+Tab and Escape. Record activeElement and
  whether it remains inside the dialog; repeat with ? and pointer close.
- At mobile widths, a first bottom-nav tap while editing may only dismiss editor
  focus; wait until the More sheet actually exists before choosing its action.
  Avoid clicking the project title merely to blur: that opens the status menu.
- Settings may be a dock/mobile panel rather than a Dialog. Report the actual
  surface tested instead of claiming a settings-dialog focus trap.

### Devin Secrets Needed
None for the isolated AUTH=off, COLLAB=off, mock-AI workflow above.

## Full-site audit navigation and measurement cautions (W12 R9)
- AUTH-off institution UI is `#/admin` (`?tab=org|members|ai|tags|audit`);
  `#/org` is interpreted as a project token and 404s `/api/projects/org`. The
  members tab intentionally says accounts are disabled; audit shows a 501
  placeholder — count those ≥400s as known placeholders, not page failures.
- Mobile Deliver starts on exports: click `deliver-tab-checks` before waiting
  for checks content; also inspect `deliver-tab-info`.
- Console: desktop `menu-view` → `view-console`; mobile More → `more-console`.
  More → `more-figures` opens FigureBook (`fb-card-*`), whereas
  `#/p/<pid>?panel=figures` opens the separate companion Sheet (`figure-card-*`,
  `FiguresPanel[data-variant=mobile]` below 1024 px).
- Mobile bottom navigation hides while an input/editor has focus. After keyboard
  sampling reaches the editor, blur via a hit-tested non-interactive header spot
  (not the project title — that opens the status menu) before tapping tabs; do
  not treat the zero-size hidden tabs as a missing feature or force-click them.
- Narrow layouts show ModeIndicator instead of the desktop edit/review segments,
  and opening review may mount a modal Sheet: capture it, Escape, then continue.
  In CDP predicates return explicit booleans (`!!x`); a raw `undefined` result
  object is easily misread as truthy by helpers.
- Touch audits: CSS width alone is not a 44 px target. Sample `elementFromPoint`
  cross-sections through the centre (include `::after` hit regions and clipping
  by neighbours), record the grid tolerance, and say they are cross-sections,
  not a 2D area or physical-touch guarantee. `getBoundingClientRect()` does not
  grow with the `touch-hit` utility — measure the hit region, not the box.
- Axe `incomplete` is a manual-review queue, not a pass or a violation: confirm
  dangling `aria-labelledby` with `Accessibility.getFullAXTree` (name source
  `invalid`), and separate a giant contenteditable "centre miss" from an actually
  clipped focused button (e.g. 375 board column at `x=-38 width=44`).
- WS close-before-established: record JS `readyState` at `close()`, native CDP
  handshake/frameError events, and uvicorn line ranges separately. A close call
  can observe CONNECTING while a 101 is already in flight, so `created −
  handshake` is not the same metric; always add a ≥1 s dwell control before
  attributing anything to the product (R9: 80/80/0 at 1000 ms).
- Cleanup: validate Vite by its resolved Node argv, not a literal `.bin/vite`
  prefix; stop only the recorded owned process groups; dispose browser contexts
  and wait for the COLLAB flush before deleting scratch data; verify ports last.

### Devin Secrets Needed
None for isolated AUTH-off/mock audits. For AUTH-on unknown-window checks,
register a scratch account through the real UI; keep its HTTP-only cookie while
clearing local/session storage, IDB, cache and service workers, and run anonymous
cold-load controls alongside. Never copy passwords or customer tokens into reports.

### Read-only figure and focus measurement caveats

- A production Fetch write guard can block `/api/projects/:pid/ast`.
  FiguresPanel obtains caption locations from `captionOf(ast, f.num)`; when
  `caption.line` is absent, `figure-caption` is a noninteractive SPAN, not the
  caption navigation BUTTON. Record the tag before applying touch-target
  assertions. Do not infer that the source document lacks captions, allow a
  POST, or inject application state to manufacture the button. Report that
  button's sizing untested in this guarded run and use an isolated stack if
  interactive caption coverage is needed.
- Images are lazy-loaded and can finish after the figures metadata response
  over SSH. Wait for the intended IMG elements to be complete with positive
  naturalWidth; scroll natively if offscreen images remain unloaded. Measure
  their parent box for the 96px/64px variant size, not the inner bordered IMG.
- For mobile CaseBoard Tab checks, record both viewport rect and every
  overflow-clipping ancestor. A button can satisfy x>=0/right<=innerWidth yet
  start left of its scrollport, clipping the button edge/focus ring. Keep the
  viewport criterion and screenshot-based focus visibility as separate results.

### Review hosts and parallel baseline setup

- Check which shell actually mounts an entry before writing readiness predicates.
  MobileTopBar does not expose `topbar-review`: use `open-nav` →
  `nav-tab-review` for ReviewDrawer (horizontal wheel on `nav-tabs-row` may
  be needed). More → `more-review` opens a different companion review body.
  The current desktop ViewSwitch uses `view-switch-layout/source/pdf`; the
  legacy `view-tabs-*` component may not be mounted.
- Combine screenshots with passive store reads. `reviewDrawerOpen`,
  `rightRailOpen`, and `rightRailSheetOpen` can contain stale invisible flags;
  do not equate a true flag with a visible host. Record the topbar's
  `data-review-host`, measured layout card width, actual surfaces and overlays.
  Desktop companion is nonmodal; absence of a Sheet does not mean it is closed.
- When checking reverse exclusivity, start with companion open and review
  closed, then use the real review button; capture whether companion remains
  mounted behind the Sheet. Sample the final state for a bounded interval
  instead of inferring "no bounce" from one screenshot.
- Concurrent Vite roots using a node_modules symlink should get separate
  `cacheDir` paths so baseline dependency optimization does not interfere
  with the other origin. Keep custom cache paths inside the owned run folder.
- User-owned baseline worktrees may contain unrelated test changes. Capture
  their initial status, verify the runtime diff against the intended base,
  and retain them unchanged at cleanup; do not require or manufacture a
  clean worktree by reverting someone else's files.

### Collaborative history freshness measurements (W12 R10-02)

- Freeze both baseline and fix source roots in their own worktrees when a
  shared checkout is being edited by the implementation agent; give each Vite
  root its own cacheDir. Record each worktree's initial status and retain it
  at cleanup instead of reverting it.
- Two history surfaces: desktop File → `file-history` mounts the left
  `HistoryPanel` (option buttons carry the full SHA as the first line of
  `title`, not `data-sha`); `#/p/<pid>?panel=history` mounts the companion
  `HistoryBody` (`version-row` buttons expose `data-sha`; close with
  `[data-slot=companion-close]`). Hiding the sidebar with `rail-outline` can
  leave `HistoryPanel` mounted — use a visible `side-back-outline` to replace
  it and assert both history roots are absent before claiming "no history
  requests while editing". Exclude mount/reopen requests from idle counts with
  explicit window timestamps.
- Timing: passively observe history fetch responses (clone bodies, do not
  consume the app's response), CDP network events, `content`/`saved` changes
  and the visible version-row SHA. Poll the scratch `.studio/history` HEAD
  read-only (≈20 ms); git dates are second-precision, so report the polling
  interval and distinguish first-observed commit time from the git timestamp.
  Never manufacture commits or call `loadHistory()` yourself.
- COLLAB-on immediate Ctrl+S only sets `saved`; the resulting GET can precede
  the server's 0.8 s debounced writeback. Judge by the later debounced request
  and the actual new SHA, not by request count. COLLAB-off first save may
  import an old backup and add a save commit: one GET can return two rows.
- Line-oriented CDP helpers hit asyncio's default 64 KiB limit; never embed a
  whole escaped Chinese document in a JS comparison string — fetch via a short
  expression and compare text/SHA locally. For CodeMirror state reads inspect
  the installed version's DOM binding (`cmTile` vs older `cmView`) rather than
  treating an undefined helper result as text.
- Classify business WebSockets by the `/collab/` URL segment
  (`/api/projects/<pid>/collab/<book>`), separately from Vite's root WS. Native
  close events can be missing on context disposal; do not infer a full
  close-handshake count from created/handshake totals.
- Deployed-code provenance is the full JS/CSS file-set hash comparison (local
  image dist / container dist / forward-served); minified timer/function-name
  grep is not reliable evidence. With the inert WS the status bar can still
  show「1 人在线」while `[data-testid=status-online]` says「连接协同…」— require
  native WS created/handshake = 0 rather than reading the count.
- When sharing the CDP browser, dispose only the owned context; never call
  global `Network.clearBrowserCache` as part of that cleanup.

#### Devin Secrets Needed
None for isolated AUTH-off/COLLAB-on or COLLAB-off history checks. For a
VPS-forwarded run: `CN_VPS_PASSWORD` (bound as `SSHPASS` for the ssh wrapper)
plus `CN_VPS_USER` / `CN_VPS_HOST`; never print the values.

### Nested Sheet focus, local Escape and loading geometry

- More → outline/figures replaces the More Sheet with NavDrawer. Capture the
  actual opener element before replacement and its `isConnected` state.
  Compare an immediate Escape during the outgoing animation with a settled
  close (>400 ms): the outgoing parent's delayed focus return can produce a
  different result. Record focusin timestamps, both surface states, and focus
  after 120 ms and ~800 ms. Do not call `body` a `useFocusReturn` contract
  violation if the remembered opener has unmounted; distinguish the broader
  UX continuity issue from the hook's connected-opener guarantee.
- At 375 the More → settings route uses `MobileSettings`, not desktop
  `SettingsPanel`. Default numeric inputs include `page.margin_left_mm`.
  Clear to an invalid blank when testing draft cancellation without committing
  settings, inspect host-level Escape behavior, then check persisted metadata.
  Mobile review may expose `review-add-comment` directly without a comments
  tab. AI is a mobile tab and filing uses a Dialog: inventory real hosts, not
  an assumed universal Sheet contract.
- FigureBook unified width/height custom forms, dirty abstract width, and
  companion CmInput have local Escape semantics. Verify first Escape preserves
  the outer surface and resets/cancels only the draft; then test the second.
  Include focus on the actual unified width/height opener buttons.
- For thumbnail loading use cache disabled plus network throttling, and sample
  while `naturalWidth===0`. `naturalWidth>0` is dimensions available, not proof
  that `complete===true`; keep those assertions separate. Opening-animation
  transforms can shift x coordinates without altering stage height or overlap.
- Avoid injecting relative dynamic imports on `about:blank`: guard by origin
  or resolve after navigation, otherwise diagnostic probes can generate their
  own unhandled module-resolution exceptions. Preserve and classify them rather
  than counting them as application exceptions or silently deleting evidence.
- `/proc/<pid>/stat` comm fields may contain spaces; parse after the closing
  parenthesis before reading process-group/start-time fields for safe cleanup.
  Resume from recorded disposal/termination results instead of repeating
  already-completed destructive actions.

### Effective touch-target measurement (W12 R11-02)

- `touch-hit::after` (44×44 pseudo-element) is not proof of an exclusive hit
  area. Measure the *effective exclusive region* with `elementFromPoint`: from
  the element centre scan left/right/up/down in 0.5 px steps until the hit
  element is no longer the target or one of its descendants. Report body rect
  and effective rect separately; a 32 px control with an untouched 44 px
  pseudo-element still fails when a neighbour's pseudo-element or the next
  row's `ScrollRow` bleed (`-my-2 py-2`) covers part of it.
- Cluster raw failures by cause, not by sample: adjacent-neighbour overlap and
  next-row bleed are two mechanisms; the same test-id repeated across
  themes/pages is one defect. Gap rule between neighbours of visual heights
  h₁/h₂: `gap ≥ (44−h₁)/2 + (44−h₂)/2`.
- Controls at the scroll viewport edge (e.g. `fb-card-menu` in a card row)
  are clipped by the scrollport, not by neighbours — scroll them into view
  before measuring or exclude them explicitly.
- In read-only live probes the aborted `POST build`/`ast` sets store
  `netError` and mounts `GlobalErrorBar` (h-9, own `touch-hit` buttons) right
  under the header. Its pseudo-element steals the bottom ~4–5 px of the header
  buttons, so header measurements read 39 high. Either record that state as
  probe-induced and re-measure with the bar hidden
  (`page.add_style_tag('[data-testid=global-error-bar]{display:none}')`), or
  measure before the aborted requests resolve. Do not report it as a
  regression of the header layout; it is a separate candidate (R11-03).
- The production image has no `curl`; check `/api/health` via an SSH forward
  to the app container IP (`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`),
  e.g. `ssh -C -N -L 127.0.0.1:18082:172.22.0.2:8000 …`. Forwarding to
  `localhost:8000` on the VPS refuses (port not published on the host).
- Container logs show unoserver's internal `POST /RPC2` XML-RPC health
  pings; exclude them when counting application non-GET writes.

### Review-draft Escape layers, live read-only AST exception and zero-write reconciliation (W12 R12)

- Escape inside a review host is layered (docs/plan/27 + 31): mention menu →
  draft/reply form → Sheet/Drawer. Assert per press: `[data-testid=review-draft]`
  (or the reply form) present/absent, host `data-state`, and `activeElement`
  (`review-add-comment` / `review-reply-open` after the form closes,
  `mobile-tab-more` / `topbar-review` after the host closes). Dispatch Escape
  with `page.keyboard.press`, never a synthetic event on `document` (target
  must be an element or `t?.closest` throws inside DismissableLayer).
- A new-comment draft needs a CodeMirror selection: `editorSelection()` only
  bridges the source editor's `activeView`. In layout view the body is
  ProseMirror, so clicking a paragraph and pressing 添加批注 toasts
  「请先打开编辑器并选中要批注的文字」— record that as untested / a product
  candidate, do not fake a selection. Locate the caret line by `.cm-line`
  text, wait for `networkidle` and stable geometry (an aborted `POST build`
  mounts `GlobalErrorBar` and shifts the editor down) before clicking.
- Reply scenarios need an existing comment. Live `method` has
  `GET /api/projects/<pid>/comments → []`; never create a production comment
  as a fixture — mark reply scenarios skipped and cover them in the isolated
  stack only.
- Live read-only guard, current form: inert `window.WebSocket` +
  `page.route('**/*')` that aborts every non-GET **except**
  `POST …/projects/<pid>/ast` (`_parse()` returns the block AST without
  writing; the app needs it to render anchors). Count allowed AST POSTs and
  blocked requests separately; console `net::ERR_FAILED` from your own aborts
  is probe noise, not a product error — judge the run on `pageerror`,
  HTTP ≥400 and real WebSocket counts instead.
- Zero-write must be shown on three layers before claiming it: (1) probe log
  (blocked non-GET list + allowed AST count), (2) container log — application
  non-GET other than `/ast` = 0, `POST /RPC2` is unoserver, (3) data snapshot
  before/after (`snap.sh`: content/config/docs md5, builds/collab/history/xml
  counts, `studio.db` md5) with an empty diff. Any one layer alone is not
  enough.
- Playwright `page.goto` over the SSH forward can exceed the default 30 s
  `load` wait (pdf.js worker and fonts); use
  `wait_until='domcontentloaded', timeout=90000` and then wait for the
  test-id you need. `connect_over_cdp` to the running Chrome (no headless
  shell installed); close your contexts in `finally` so failed runs do not
  leave `about:blank` tabs.
- Filter Sheet density: `filter-section-*` headings are `CollapsibleTrigger`s
  (actionable, count them); on AUTH-off the 责任人 group is not rendered, so
  filter the scan's section list to what exists rather than failing.
- Real error bar with a line number: edit a scratch claim to reference a
  non-existent higher claim, capture the real `POST /build` response and
  `diagnostics[].line`. Measure border ownership with `elementFromPoint` at
  x±2 as well as rects/`::after`.
- Host-specific history selectors: docked `version-list [role=option]`
  (title starts with SHA) vs companion `version-row[data-sha]`. CNIPA
  delivery is a ZIP — enumerate and parse every XML entry.
- Before whole-content replacement through CodeMirror, confirm the active
  editor is the full document, not a book-scoped view; prefer restoring
  scratch data via a UI history row verified against the original, then
  check store/disk/original equality.
- Live store reads: `import('/src/store/index.ts')` can return a STALE
  second module instance when vite has HMR-invalidated it — the app then
  uses `/src/store/index.ts?t=<ts>`. Always resolve the live URL first:
  `performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/store\/index\.ts(\?|$)/.test(n)).pop()`
  then `await import(thatUrl)`; same trick for `/src/store/blocks.ts`
  (`findBlockLines(ast,bid)` → anchor line = `offset+start`) and
  `activeView.ts` (`activePmView()`).
- When the tool-space↔CSS coordinate mapping drifts (window resize /
  metrics override changed), drive real input through CDP
  `Input.dispatchMouseEvent`/`dispatchKeyEvent`/`insertText` at exact CSS
  coords instead of screen clicks — same trusted input pipeline, immune to
  scale drift. For a drag-selection you MUST send `button:'left',
  buttons:1` on the `mouseMoved` events or Chrome treats them as hover and
  no text gets selected. See `/tmp/r1205/cdp2.py` (click/cclick/dragxy/
  type/key subcommands).
- Multi-card dock width control (rail/host tests): dockview separators are
  `.dv-sash` (4px, `.dv-enabled`) — drag them with cdp2 `dragxy` at CSS
  coords; group geometry from `.dv-groupview` rects; each layout card's
  card-body width = `[data-testid=right-rail-probe]`'s parentElement width
  (≥640 → column, <640 → sheet). `openPanel` dedupes by panelId, so a
  second layout card needs a different book (`view-open-layout-<book>` via
  视图→布局→打开为新面板); tabbed panels share the group width and
  inactive tabs detach from the DOM — side-by-side groups are required to
  keep two rail hosts mounted. Clicking another tab while `right-rail-sheet`
  is open first dismisses the sheet (outside-pointerdown), so activate with
  a second click.
- Public-link mint + `#/c/<token>` client page (AUTH=on only): mint via
  `curl -b admin.jar -X POST /api/projects/{pid}/public-links` with
  `{scope: read|comment|confirm, baseline: original|final,
  ttl_days: 1..365, allow_download, allow_comment}` — `allow_comment:false`
  collapses scope to read. Resolve codes: missing→404 / revoked→410 /
  expired→410. **Expiry test = backdate `public_share_links.expires_at`
  with ISO `YYYY-MM-DD HH:MM:SS` text — never a float epoch (causes
  str_to_datetime 500s on read).** Guest composer: click a paragraph →
  `client-selection-comment` → `client-guest-name`/`client-comment-input`/
  `send`. Owner-side verify `source='client'` via
  `GET /api/projects/{pid}/comments`. Confirm lands in
  `case.json.confirmations` ({version, sha, name, note, ip, ua, token}) —
  the name field may be prefilled with the remembered guest identity
  (clear it before typing).

## Accessibility / keyboard audits (R18)
- **cdp2 `key` dispatch pitfalls**: the helper ships only a few keys in `KEYMAP` — add Arrow*/PageUp/PageDown/F-keys/letters as needed (`windowsVirtualKeyCode` + `key` + `code`). `type='keyDown'` alone does NOT activate focused buttons on Enter — dispatch an extra `type='char'` with `text:'\r'` after the keyDown (then Enter clicks buttons; Space works via keyUp without it). `rawKeyDown` never activates. Track focus after each press via `document.activeElement` + `dataset.testid`/`aria-label`.
- **Focus trap detection**: Tab and Shift+Tab must move `activeElement`; if focus stays inside `.ProseMirror`/`.cm-content` for N presses AND Esc/F6/Ctrl+M/Ctrl+PageDown don't exit, it's a WCAG 2.1.2 trap. ProseMirror inserts `\t` on Tab (check `innerText.includes('\t')`).
- **Global hotkeys ARE expected to fire inside editors** (StoreBootstrap guards only `?`/undo/redo); `Mod-b` toggles sidebar (verify via panel width, not `data-state` on the rail button — wrong signal). `Mod-PageDown/PageUp` = dockview panel focus rotation (collides conceptually w/ Chrome tab-switch but DOES reach the page).
- **axe-core**: inject once via `script.src='/@fs/<abs>/frontend/node_modules/axe-core/axe.min.js'` (vite dev serves it), then `await axe.run()`.
- **Touch targets at 375**: visual boxes can be <44px — check `::after` inset expansion (`touch-hit` class / `in-data-[density=touch]:after` pattern) before calling it a violation; effective hit area is what counts.

## R19 gotchas (skip-link + panel-rotation verify)
- **The app is a hash SPA — `href="#main-content"` collides with the router.** A skip link as a plain anchor navigates hash → router resets to `#/` (dashboard). Verify skip links by *activation*, not presence: real Enter → check `location.hash` stayed put AND `document.activeElement === #main-content`. Watching `location.hash` after activation is the decisive check.
- **Panel-rotation verify**: `activeElement` landing on `BODY` = focus went nowhere real (dockview `panel.focus()` on a non-focusable element → falls to body). Also watch `.dv-active-tab` textContent — rotation that doesn't flip it = no-op.
- **keydown-reachability diagnostic**: `window.addEventListener('keydown',…,true)` capture listener + count — distinguishes "key swallowed by browser" (count 0) from "handler ran but no-op" (count ≥1).

## R19 AT/semantic walkthrough recipe
- **Per-page axe dump**: `python3 /tmp/r19/axe_run.py <label>` injects axe via `/@fs/.../axe.min.js` and writes `/tmp/r19/axe-<label>.json` (id/impact/targets). Re-inject after every `location.reload` (axe doesn't survive reloads).
- **Semantic probe**: `/tmp/r19/probe.js` (landmarks/mains/headings/aria-hidden-focusables) — filter `visibility:hidden` subtrees before calling aria-hidden-focus a defect (they can't take focus; axe agrees).
- **`#/c/<token>` + login page need AUTH=on** — public endpoints 404/501 under AUTH=off even for valid unexpired tokens. Restart backend with `PATENT_STUDIO_AUTH=on`+`PATENT_STUDIO_SECRET`, `Network.clearBrowserCookies` via CDP to reach the anonymous login page, then restore AUTH=off.
- **`pgrep -f "uvicorn"|xargs kill` inside a compound command self-matches the bash -c wrapper** → kills your own exec shell (exit -1). Restart backends as standalone commands, never combined with pgrep.

## R20 two-context collab E2E recipe
- **Second context**: `curl -X PUT "http://localhost:29229/json/new?<url>"` opens a sibling tab (same browser, same origin/backend) → save its `id`, then drive it with per-target CDP — `/tmp/r20/ctx.py` (`ctx.py A|B eval|key|type|goto|off|on`) picks tabs[0] vs the saved id. `off`/`on` wraps `Network.emulateNetworkConditions` for offline tests.
- **Console watcher only covers tab A** — B's console isn't captured; disclose that gap or add a second watcher pinned to B's ws url.
- **Collab shape**: `(pid,'content')` mirror room + per-(pid,book) rooms; source cards connect their book room; `collabStatus:'connected'` is the liveness signal; `peers` is 0 under AUTH=off (mirror is anonymous by design — don't flag).
- **Server persists via debounced room write-back** (DEBOUNCE_S=0.8) — verify sync in `ps_scratch/projects/<pid>/content.md` on disk, not the clients' `saved` snapshot (clients stay content≠saved until reload — symmetric dirty is the model, not a bug).
- **`.cm-content` first-match trap**: a context can host MULTIPLE CM editors (claims + description cards) — target by `[aria-label='<书>源码编辑器']`, never `querySelector('.cm-content')`.
- **CM caret positioning**: `focus()` the `.cm-content` FIRST, then set DOM selection (`collapseToEnd`/range into a `.cm-line` text node) — selection set before focus is reset.

## R21 lazy-bundle verification notes
- **`performance.getEntriesByType('resource')` caps at ~250 entries** — a vite dev page hits the cap during initial load, so lazy modules fetched AFTER navigation never appear. To prove laziness: snapshot the resource set on the FIRST page (assert DesktopShell/DockviewHost absent), then navigate and assert the UI rendered — don't try to positively list post-nav fetches. (`performance.setResourceTimingBufferSize(9999)` early would preserve them.)
- **cdp.py watch gotcha**: it opens `/tmp/r14/console.log` at startup — `rm` the log BEFORE launching the watcher, not after (rm-after unlinks the inode; events are written to a dead file and `ls` shows nothing).
- `#/login` under AUTH=off renders the login page itself (`route.kind==='login'` → showLogin unconditionally) — the expected "dashboard" behavior only applies to protected routes; don't flag.

## R21-02 AUTH=on notes
- **Chrome relaunch origin trap**: launching `google-chrome ... http://localhost:5173` can land the page on `127.0.0.1:5173` (vite/Chrome resolves localhost→127.0.0.1) — the `studio_session` cookie is then domain-mismatched (`localhost` vs `127.0.0.1`) and every authed fetch 401s. Always `goto http://127.0.0.1:5173/...` and check `location.host`.
- **Stale vite transform**: after a mid-session branch checkout, vite may keep serving the OLD transformed module (HMR timestamped URL persists) — symptoms look like the fix is broken (our Ctrl+Z threw `editorCommands is not defined` from a stale module). `curl localhost:5173/src/<file>.tsx | grep <snippet>` to compare served vs disk; restart vite before concluding a defect.
- **Screen→CSS click math**: `tool_y = (chromeTop + css_y) * 0.64` where chromeTop = outerHeight−innerHeight (~139px with the Chrome-for-Testing infobar). Clicking y<~60 lands on the window's close control and kills Chrome. Safer: `Input.dispatchMouseEvent` over CDP uses CSS coords directly — no scaling.
- **React-controlled inputs**: `el.value=x` alone doesn't reach React — use the native-setter + `input` event recipe, or `Input.insertText` after `el.focus()`.

## R23 perf/latency measurement notes
- **Per-keystroke latency must be measured in-page**, not via per-key CDP evals: attach `beforeinput` (sets `performance.now()`) + `MutationObserver` on `.cm-content`, dispatch `Input.dispatchKeyEvent keyDown+char+keyUp`, then read the collected array in ONE eval — per-eval round-trips inflate a true ~16ms to ~200ms and read as fake "slow".
- **Layout-view timing**: `view-switch-layout` → poll `.ProseMirror` mount; the PM layout renders ALL paragraph blocks (no virtualization) — at 1660 paras that's ~3300 block nodes yet scrollIntoView→paint stays ~23ms, so don't flag node count alone.
- Outline panel renders ~heading-count items only (~100 for a 1660-block doc) — virtualization question is moot there.
- `performance.memory.usedJSHeapSize` works in-page for a rough heap number.

## R23b huge-doc follow-ups
- **Layout-view mount scales ~linearly with block count**: 1660 blk→2.3s, 4080 blk→4.4-5.8s (PM renders every block, no virtualization). >5s on ~4K blocks is the SLOW threshold — bigger docs will get worse.
- **rAF-based frame-pacing evals can hang** on some CDP targets (requestAnimationFrame throttled/not firing) — fall back to real `Input.dispatchMouseEvent` wheel ticks + scrollTop delta to judge scroll fluidity.
- Source-view typing stays fine (avg 33ms @1.1MB doc); scrollIntoView tail ~48ms — scroll/layout fluidity is NOT the bottleneck, mount is.

## R24 weak-net/offline audit notes
- **Slow/cold load needs BOTH `Network.setCacheDisabled(true)` AND `emulateNetworkConditions`** — vite modules disk-cache otherwise and the "slow" test silently isn't slow. Also `Page.navigate` to the same URL is a no-op; use `Page.reload{ignoreCache:true}` (or a fresh `/json/new` tab to dodge DirtyGuard's beforeunload dialog blocking reloads).
- **Offline edits DO land in CM immediately and sync back on reconnect** — verify via `store.content.includes()` + disk grep of content.md, NOT `.cm-content` innerText (virtualized).
- **Gotcha**: an edit typed right before going offline can be LOST on reconnect — check the pre-offline marker survived, not just the offline one.
- **Dup-request test**: count `POST /api/...` lines in the backend log around rapid `el.click()` bursts.

## R24-03 instrumentation gotchas
- **`import('/src/collab/registry.ts')` gives a FRESH module instance** — the app's registry is bundled inside the lazy workbench chunk, so `roomEntries()` returns []. To introspect the live room you need the lead to expose `window.__collabRegistry = registry` or import the chunk's own URL. `/@fs/` and `?import` variants also miss it.
- **`Network.emulateNetworkConditions(offline)` can kill the CDP devtools socket too** (~70s offline → keepalive ping timeout on my harness ws). Keep offline windows <~50s or re-attach.
- **IDLE_RELEASE_S=60 on the server room did NOT trigger loss under emulation** — collab ws stays 'connected' through 70s offline; the release path needs the socket to actually close, not just emulate.

## R25 notes
- **`Emulation.setDeviceMetricsOverride` is cleared by `Page.navigate`** — set metrics AFTER navigation; verify via `innerWidth`+matchMedia (both shells render, one is display:none).
- **`window.__collab.roomEntries()`** (dev only, post-#108) exposes live collab rooms — use it instead of `import('/src/collab/registry.ts')` which yields a fresh empty module.

## R29 mobile 375 walkthrough
- **`Emulation.setDeviceMetricsOverride` is cleared by `Page.navigate`** — set metrics AFTER navigation; verify via `innerWidth`+matchMedia, not element presence (desktop+mobile shells both render in DOM, one is display:none — check `offsetParent`).
- 375 bottom tab bar `mobile-tabs` is `display:none` while an editor has focus (hide-on-focus) — blur() before tapping a tab.
- `review-add-comment` requires `editorSelection()` — a real CM drag-select persists across blur/sheet-open; DOM `setBaseAndExtent` does not.
- Two「登录」buttons exist: `login-tab-login` (tab) vs `login-submit` (submit).
- Close a fresh probe tab after use: `/json/close/<id>`.

### R35-01：OA 轮次操作行 testid
- 操作行：`oa-round-actions`（活动轮次下）；按钮 `oa-extend-1` / `oa-extend-2` / `oa-filed-toggle`；日期输入 `oa-filed-date`；确认 `oa-filed-save`；已答复态 `oa-round-filed`。
- **后端改动需重启 uvicorn**：`GET /oa/rounds` 响应缺 `filed_on` = 后端进程过旧的症状，重启即可。

### R37 附图面板（FiguresPanel / FigureBook）
- testid：`figures-panel`、`figure-card-<name>`、`figure-drag-handle`、`figure-menu-{abstract,delete}`、`figures-file-input`、`figures-export`、`figure-abstract-badge`、删图引用列表 `figure-refs`。
- 宽度输入**无 testid**：用 `aria-label="<图名> 说明书宽度（厘米）"` / `…摘要附图宽度（厘米）` 选中。
- 上传用 `DOM.setFileInputFiles` 喂 `figures-file-input`（accept 限制可绕过）；负路径直接打 API 更稳（.txt→400 / 坏图→400 / 同名→409 / width>17→422）。
- export.zip 核验：页面内 fetch → arrayBuffer → b64 → 回 shell `python zipfile` 读条目序，应与面板顺序一致（仅主文件 + 摘要图，伴生 png/svg 不进 zip）。
- 已归档 R37-02：**vite dev `?t=` 模块实例分裂**（已定性，非代码缺陷）——vite 重启后旧标签页 eager graph 与新 lazy chunk 混用，`import('/src/store/index.ts')` vs `…?t=<ts>` 是两个 zustand 实例；Rail 绑到 phantom（pid=null）→ `disabled={!pid}` 永久禁，reload 自愈。生产打包不受影响。探测 store 务必经 resource-timing URL（`performance.getEntriesByType('resource')` 过滤 `store/index`）拿同一实例，裸 `/src/store/index.ts` import 会落到 phantom。

### R39 著录项目表（CaseFormDialog）
- 入口：dashboard 行菜单 `edit-case-{pid}`；递交页 `deliver-edit-case`。
- Dialog：`case-form-dialog`；字段 `case-<key>`（key = caseNo/client/clientContact/applicants/inventors/attorney/reviewer/opened/targetFiling/applicationNo/filingDate/publicationDate/examRequestDate/grantDate/feeStatus）；优先权行 `priority-{i}-{country,date,number}`；`case-form-{save,cancel,failed}`。
- **`type=date` 输入层就拒收非法 ISO**（`2026-13-99`/`2026-02-30`/`abc` 全部 coerce 为 `''`）——`validateCaseForm` 的「YYYY-MM-DD」格式分支在 Chrome UI 不可达（防御性代码，正常）；测日期校验走 申请日<优先权日 / 授权日<申请日 分支。
- 清空文本字段 → PUT 体发 `null`（不是 `""`）；`cn` → 存 `CN`；未改动时保存钮 disabled。

### R40 双用户/通知 notes
- 第二用户：`cd backend && PATENT_PROJECTS_DIR=... PATENT_STUDIO_AUTH=on PATENT_STUDIO_SECRET=... uv run python -m app.auth.create_user <email> <pw> --display-name <名>`（DB=`<PATENT_PROJECTS_DIR>/../studio.db`）；成员：`PUT /api/projects/{pid}/members {email,role}`（owner 会话内 fetch）；责任人：`PUT /api/projects/{pid}/case {owner_user_id}`。
- **双登录态**：CDP `Target.createBrowserContext`（browser ws = /json/version 的 webSocketDebuggerUrl）→ `Target.createTarget(url, browserContextId)` = 独立 cookie jar 隐身 tab。`/json` 列表跨 context 混排——**必须按 targetId 选 tab**，按 URL 过滤会拿错（踩过：把 B tab 当 A 轮询了一轮）。
- `GET /api/users/me`（不是 /api/auth/users/me）；notify：`GET /api/notify` / `POST /api/notify/{nid}/read` / `POST /api/notify/read-all`；催办 `POST /api/projects/{pid}/nudge {deadline_id?,user_id?,message?}`，UI 钮 `nudge-{deadline_id}`（期限页 #/deadlines）。
- **pkill -f 自杀陷阱**：pattern 出现在自己 cmdline 就把自己杀了——改用 python 扫 /proc cmdline 精确 kill。
- AUTH=off 下 `authStatus`：带有效 cookie 的会话仍 authed（cookie 被认）→ 铃铛可见；要验「off 隐藏」需**无 cookie 的新 browserContext**。
- 通知 row testid `row-{nid}`（popover+inbox 共用）；inbox `inbox-filter-all/unread`、`inbox-mark-all`、`inbox-unread-count`；行点击即 markRead。

## R41 AI 提案链（agent/proposals）notes
- 入口：`topbar-ai` → companion 'ai' → `ai-panel`；tabs `ai-tab-{proposals,chat,jobs,scenarios}`；案级闸门 `ai-enabled-switch`（settings.ai_enabled，默认 off → `ai-scenarios-disabled-case`）；机构级 `PUT /api/admin/settings {ai_enabled:false}` → run/dismiss 403 `ai_disabled_by_org` → `ai-org-disabled` 空态（**非主动探测**：要一次失败请求翻转 store.agentDisabledByOrg）。
- 场景：`ai-run-{s1..s10}`；paramless = s2(heavy,comment)/s5(comment)/s6(critic+patch,默认limit300)/s10(patch)；s1 要交底书文本、s7 要 OA 条目、s3 要现有 comment 提案。摘要非空 → s6 产 critic 提案锚在 abstract。
- 提案 UI：`ai-proposals-{pending,applied,dismissed}` 分区（data-count）、`ai-proposal-{id}` 卡、`ai-proposal-{locate,dismiss,apply}-{id}`；**dismissed 区只渲 header+计数，无卡片体**。comment-kind 提案出生即 applied（批注直写存储，提案行是台账）。
- 预算：`settings.ai_daily_tokens`；`exhausted()` 要求 b>0 ⇒ **=0 是无限不是拦截**；正预算 N < 当日用量才 429「预算已用尽」→ `ai-budget-exceeded` 横幅（run 失败后显现）。用量账 `.studio/ai-usage.jsonl`；预算 chip `ai-budget`（jobs tab）。
- **Radix Tabs/触发器不吃 el.click()/合成 pointer**——topbar-ai、ai-tab-*、ai-run-* 都要 `Input.dispatchMouseEvent`(Moved→Pressed→Released)；点击前先 scrollIntoView+elementFromPoint 验证。
- ai.proposal 通知：apply/dismiss 时 emit → 收件人=case_owner（跳过操作者本人）；要看到 ai 行需"非 owner 的用户 B 操作"（agent rank3 ≥ reviewer 可 apply）。
- 轮询收尾：subscribe 走 EventSource `/ai/jobs/{id}/events`、onerror 降级 fetch poll；done→finish() 清 watcher。验证法：拦截 window.fetch + EventSource 计数器，空闲 8s 应 0 agent 请求（`/api/notify` 铃铛轮询属正常背景）。
- 提案存储：`.studio/ai-proposals/{pid}.jsonl`；API `GET/POST /api/projects/{pid}/agent/proposals[/{id}/apply|/dismiss]`。

## R42 docx 导入 notes
- 入口只在工作台 menubar：`menu-file` → `file-import-menu`（导入子菜单）→ `file-import-docx`；**dashboard 顶栏无 menubar**（只有 案卷/期限/通知 nav）——测导入入口须先进任一案件。
- 对话框：`import-docx-dialog`/`import-docx-file`（hidden input, DOM.setFileInputFiles）/`import-dropzone`/`import-file`/`#import-pid`/`#import-title`/`import-style-suggestions`+`style-suggest-{key}`（点行即可勾选）/`import-submit`/`import-done`/`import-report`(-figures,-items)/`import-error`/`import-close`。
- 流：pick→POST /api/import/docx/styles→勾选→submit→POST /api/projects/import/docx FormData{file,id,title,apply_styles,style?}→201→done+report→requestNavigation 自动开 `#/p/{pid}`。**部分采纳**：取消勾选→submit 发 apply_styles=false + style=选中键子集（FormData 可拦截 window.fetch 验证）。
- 服务端矩阵：非 docx 客户端拦(0 POST)；坏 docx→400 kind=import「不是有效的 DOCX」；显式 dup id→409「已存在」（留空自动 -2 唯一）；style 非 JSON→400/非对象→400；>50MB→413；匿名→401（require_login）。坏文件 + pick 阶段 styles 400 被 suggestStyles 静默吞。
- 修复后必须重启 uvicorn（R42 后端 49cc185 的 require_login 曾跑旧码返回 422）。

## R47 分享链/账号/PAT（w13 补录）
- **公审链 UI 入口**：`share-button`→collab-drawer→`collab-tab-links`→`collab-public-links`（forms `collab-public-link-{scope,ttl,download,baseline,create}`；行 `row-{token}` + `collab-public-link-{copy,revoke,expiry,visits}-{token}`）。成员邀请链同 tab `collab-links`（`collab-link-{create,row,copy-,revoke-}`）。**链接撤销均无确认步、单击即生效**；PAT 撤销才两步（`pat-revoke-{id}`→`pat-revoke-confirm-{id}`）。
- **匿名验证 #/c/<token>**：`Target.createBrowserContext`+`createTarget`（drv/anon.py `open_anon`）→ `page-client`/`client-{title,version,comment,confirm,readonly-hint,download}`；撤销后 meta 410+过期页。
- **账号页** `#/account?tab={profile,security,notify,pat}`：profile 改名/头像色（radio 是 sr-only——**点 label 非 input**；users/me 字段名 `display_name`/`avatar_color`）；security 改密（错旧密→403 toast，不落库；**改密不换 cookie 按设计**——旧会话续有效，别测"旧 cookie 失效"）。
- **PAT Bearer 只过 `/mcp`**（PatGate ASGI 层）；`/api/*` 一律 401——验 PAT 用 `POST /mcp` 任意 JSON-RPC（认证成功=400 非 401）。明文 token 仅创建时返回，`pat-new` 横幅 reload 即消。
- Radix Checkbox 若点了不翻：`elementFromPoint` 查是否被 `dv-sash`（z-99）压住——R47-01 已在 dock-host 加 `isolate` 根治；若再出现优先查别的堆叠覆盖（不要在控件上堆 z，不同上下文里赢不了）。
- 跑脚本前 `find()` 按 URL 取 tab 容易拿到匿名 ctx 的 `#/c/` 页——**按 targetId 前缀选**（本轮 admin 主 tab=62478222）。

## R48 搜索/gotoLine notes
- **`?t=` 模块分裂新变体**：vite dev 在 HMR 后可能给某模块发**旧 transform**——新增 import specifier 缺失但用法在 → 运行时 `X is not defined` 崩 ErrorBoundary（R48-01 复验时踩到）。修法：`touch` 源文件强制重转 + `Page.reload(ignoreCache)`；生产 build 不受影响（与 R37-02 同族）。
- **CDP 里 `import('/src/x.ts')` 探模块 state 要用带 `?t=` 的 URL**：app 通过 `?t=` specifier 加载的模块，裸 import 会开**第二个实例**——module-level 单例（如 editorCommands 的 `view`）读到 null → 全 false 假象。URL 从 `curl :5173/src/<file> | grep` 对端 transform 里的 specifier 拿。
- **rail tab（role=tab, `rail-search` 等）是 toggle**：合成 click 与真 click 叠加会把刚开的面板又关掉——每次交互后先断 `searchPanel`/目标面板存在性再继续。
- 搜索面板 testid：`search-panel`/`search-input`/`search-count`/`search-hit`（行号在第一个 span）/`search-open-editor`（「在编辑器中查找替换」→ CM `.cm-search` 面板，`input[name=search]` 应带回查询词）。命中跳转验 `[data-testid^="card-source-"]` 挂载卡 + `.cm-activeLine` 文本。
- R48-01 修复口径：gotoLine 现在先 `openPanel('source:'+book)` 激活目标卡再 requestScroll；scrollRequest 带 `at` 时间戳，卡挂载只消费 3s 内 pending（SCROLL_REQUEST_FRESH_MS）。回归注意：陈旧请求不重放的语义仍在，测试别用长 sleep 造请求。

## R50 机构管理页 notes
- `#/admin` 四面板 testid：`member-table`（行 `member-title-{uid}`/`member-toggle-super-{uid}`/`member-toggle-active-{uid}`；本人行两钮 disabled+后端 409）、`org-form`/`collab-form`/`admin-holidays`、`org-ai-enabled`/`ai-usage`/`ai-model-routes`/`ai-budget`、`audit-total`/`audit-export-csv`/`admin-audit-empty`；非超管 `admin-forbidden`。
- 成员操作 API：`PUT /admin/users/{id}` body=`{is_active?,is_superuser?,title?}`（无全局 role 字段；角色仍按案）；禁用后目标用户 session 立即失效。R50-01 起每次实际变更落 `admin.user` 审计行（data.changes）。
- `require_org_ai` 只挂在生成类 POST（agent run/apply/dismiss、ai chat/rewrite/review）；AiPanel 的 GET 不挡——机构关 AI 后 UI 完整渲染，`ai-org-disabled` 要等一次 403 才翻 store.agentDisabledByOrg（**R50-02 已登记**）。
- **X/Chrome 崩溃恢复**：Xvfb :0 + `DISPLAY=:0` 重启 chrome（--remote-debugging-port=29229 指向原 user-data-dir）即可恢复 CDP+录屏；computer 工具死着无妨（CDP Input.dispatch* 全部可用）。
- **ctx 登录 opaque-origin 陷阱**：`Target.createBrowserContext` 的新 tab 先 navigate 到 vite origin 再同源 POST login + reload——在 about:blank 直接 fetch 会因 opaque origin 拿不到 cookie。

## R51 dashboard 案卷管理 notes
- 页面: `#/`; `dashboard-create`→CreateProjectDialog(np-title/np-case-no/np-client + 折叠 np-id 域, isValidCaseId 客户端校验>64/非法字符, 服务端 dup→409「已存在」); 行 `row-{pid}`/`row-actions-{pid}`/`select-{pid}`; scope chips `scope-all|mine|shared|archived|trash`; 筛选 `toolbar-filter`→`status-filter-*`, `tag-filter-{name}`, `sort-*`, `dashboard-search`(客户端 dashQuery); `manage-tags`→TagManagerDialog(tag-new/name/save, tag-delete 两步确认 `tag-delete-confirm-*`); BulkBar `bulk-status|tags|owner|archive|trash|restore|clear`(`bulk-tag-{name}`,`bulk-status-{status}`).
- 语义: list-state per-user(每人自己的归档/回收站, agent+); DELETE 需先 trashed 且 owner; bulk `results[]` 逐案 ok/error 不回滚; 永久删除**无确认**(R51-01); viewer 行菜单归档/回收站 enabled 但 403(R51-02); 创建案卷 POST /api/projects {id,title} 任何人可建→自建为 owner; `empty-clear` 清全部筛选含搜索, `filter-clear` 只清条件不清搜索.
- 陷阱: API 建案不会进当前页面 store——reload 才出现; Escape 关 popover 后 menu item 需重新触发; viewer 点 enabled 项的报错是 sonner toast(看 [data-sonner-toast]/[role=status]).

## R51-复验追加
- 修复后 testid: `case-delete-dialog-{pid}`(DialogContent portal 外弹, 菜单先关), `case-delete-confirm-{pid}`(确认钮); 文案含「不可恢复」; 取消钮无 testid 按文本点.
- 375 复验法: `Emulation.setDeviceMetricsOverride{width:375,height:800,mobile:true}` 进 mobile-shell 卡列表, 同一 `row-actions-{pid}`/`select-{pid}` testid 可用; 完事 `clearDeviceMetricsOverride`+reload.
- userb 密码 `UserB12345`;「退出此案卷」POST /leave 204 自清成员, admin `PUT /members` 可复加.

## R52 快捷键/CDP 键事件 notes
- 键事件合成: `Input.dispatchKeyEvent` 逐个修饰键 keyDown→主键(keyDown+keyUp)→修饰键 keyUp; modifiers 位: alt=1 ctrl=2 meta=4 shift=8; e.key 直给 '?'/',' 等字符, code/vk 另算.
- **探 defaultPrevented 要用 bubble 期监听且后注册**(capture 期 pd 恒 false —— StoreBootstrap 的 window keydown 是 bubble; 我曾被 capture 期 pd:false 骗到以为键位未接线).
- 大纲侧栏开关 DOM 探针: `aside[aria-label*=大纲]` 的 `.invisible`/`aria-hidden` —— `outline-tree` 恒挂载勿用作开关判据.
- dockview 快捷键(Mod-Shift-w/m/L, F6)只在有 activePanel 时生效: 先 .dv-tab 点击聚焦; 面板最大化探针=组宽 642→1620 余者→0.
- 布局被我关坏可菜单 视图→布局→重置布局(view-layout-reset) 还原; dv 布局持久化过 reload.
- 全局面板不存在: cmdk 仅喂 @-mention; Ctrl+K/P 无任何 UI.
- IME: Input.imeSetComposition 可造 isComposing:true 的 keydown.

## R52-复验追加
- **修分支复验必须 `Page.reload{ignoreCache:true}`**(或 curl 裸 ?t= 硬刷) —— 普通 reload 会吃 vite 缓存模块拿到旧行为, 我曾因此误报修复未生效.
- `document.body.focus()` 不能夺走 contenteditable(.ProseMirror) 的 activeElement —— 测非编辑态键位要真点 .dv-tab 类非编辑元素.

## R53 AI 面板 notes
- 面板入口 `topbar-ai` 是 toggle——连点会关; 开完先断 ai-panel 存在再操作, 多次点击用循环+存在性判断.
- mock 供应商 8字/片 sleep(0): 流式极快, ai-chat-stop 中途点击不可达; SSE 结果直接看 ai-chat-log/live.
- Network.emulateNetworkConditions 需先 Network.enable 否则不生效(我曾按了没用 offline 仍 200).
- 场景卡 min_role: viewer→s2/s5(comment), reviewer→s3/s4/s6/s7(critic), editor→s1/s9/s10(patch); viewer 的超级按钮直接 disabled.
- ai-org-disabled 只在一个被 gate 的 POST 403 后才出; 机构重开后重开面板(jobs load)自愈, EmptyState 无 retry 按钮.
- 选区条: CM 内 mousePressed+shift+click 拉选区 → selection-action-{polish|formalize|expand|explain}; rewrite 落 CriticMarkup, 清理用 review-reject-all.

## R54 文件树/大纲
- 结构:file-tree 固定三组 file-docs(五书 gotoBook,无 CRUD)/file-figs(upload hidden input+figs-book+行 file-fig-goto)/file-attachments(upload+convert/download/delete+DeleteAttachmentDialog);下块 outline-tree=railTab 驱动,rail-outline 只在 railTab==='search' 时回切,其他视图用 side-back-outline;rail-outline 重复点=toggleSide 关整个侧栏(我踩过:以为没反应连点两次把面板关了)
- 上传驱动:UploadDrop 的 input[type=file] 在组级(`[data-testid=file-figs] input` 而非 file-figs-upload 内);DOM.setFileInputFiles+DOM.querySelector 传真实文件即可走通整条上传链
- 悬停钮:file-fig-goto/file-attachment-* 是 HOVER_BTN(未悬停 width=0),必须先真 mouseMoved 到行上再量坐标;同样行外不可见时会 hit-miss
- API:POST/figures|attachments 字段名 `files`(复数,不是 file);重名 409/坏扩展 400/不存在 404;`../`、`a/b`、`x\y` 文件名→basename 化;figures 非 _STEM_RE stem 自动改 figN;PUT order 必须全排列;viewer 全写 403
- 持久化差异:outline 标题折叠 outlineCollapsedIds 持久,file 三组 docsOpen/figsOpen/attOpen 是 useState 不持久(R54-01)
- 并发:文件树无实时刷新,他端删除后本端残留行直至 reload

## R55 递交页 notes
- 递交页入口无直达顶栏钮 → hash `#/p/{pid}/deliver`(懒加载路由:断网导航死在 import()→AppErrorBoundary,app-error-retry 恢复;已挂载页断网则 api 层 toast「网络已离线」)。
- toast 是自研 store 非 sonner:容器 `[data-testid=toasts]`、项 role=alert|status;error 5s/info 2.5s ——别用 `[data-sonner-toast]` 探。
- portal dialog 折叠陷阱(新):视口矮时 footer 钮 center 可落在 dialog 裁切区外→elementFromPoint 命中 scrim→outside-close 静默丢输入;点击前先 `dlg.scrollTop=scrollHeight`+验证 elementFromPoint。
- confirmations 种子必须含 `actor`(缺→normalize 丢整个字段,GET /case confs:null,瞬时 5xx);字段:{version,sha,name,note,confirmed_at,actor:'client:X'}。
- viewer 递交页变更钮全开是故意的(routes_deliver.py L17「只渲染到 .studio」)——bundle/lint/regen POST 200。
- `deliver-empty`/`deliver-error` 实为死态:新案自带首建 manifest 恒有 url;无权 pid openFromHash→goDashboard <150ms。
- 还原案:PUT /case 清字段 + POST /case/status 任意跳转;删案须先 POST list-state trashed 再 DELETE。

## R55-复验追加
- CaseFormDialog 修复后结构:DialogContent `sm:flex-col sm:overflow-hidden` + header/footer `shrink-0` + 内滚 `div.overflow-y-auto`——探「页脚钉住」=内滚后 saveY 不变。
- field-error 深链在移动端位于 deliver-tab-checks;`__net` 每次 reload 需重装,且 `window.__net=[]` 只清数组不重挂 wrapper——服务端正验(PUT 落盘)兜底。
- 同拍双击合成:press/release×2 连发(clickCount 1,2)中间不 await,才能真实测出 ref-vs-state 守卫差。

## R56 通知链 notes
- 通知数据面:GET /api/notify(?unread&limit) / POST read-all / POST {nid}/read(跨用户 404);事件驱动,case_staff 兜底链 owner→agent→活跃超管。
- seed 姿势:成员 @ 名字评论(@成员名匹配 display_name/email/user_id;超管要先 PUT members 加入才能被提及,删成员撞 owner 锁时直接删 projects_acl 行);review-assign 产 assign;nudge{user_id} 产催办;sqlite3 /home/ubuntu/ps_scratch/studio.db notifications 表可直插任意 kind/href(测畸形 href 的唯一路径)。
- NotificationRow:有 href → <a href="#...">(middle-click 可开新页);无 → role=button+Enter/Space;点击恒先 markRead(非乐观,失败 toast)再跳 hash。
- ?c= 落点→ReviewDrawer(requestReviewComment→openReviewHost);?focus= 本伦发现零消费(R56-02);?panel=notify→伴随栏 companion-notify。
- 轮询=startNotifyPolling(30s,ref 计数,挂载铃铛/OrgShell 顶栏即起;inbox 页也有)。

## R56-复验追加
- 修后端 emit(routes_*.py)必须重启隔离栈 uvicorn 才生效(pgrep -f "uvicorn app.main" → kill → 同 env nohup 重启,4s 内 health 200)。
- focus 深链验证:hash `#/p/pid?focus=<bid>` → 探 .cm-scroller scrollTop 跳变 + .cm-activeLine 文本 = 目标块;hash 会被消费清回纯 #/p/pid。
- ?focus= bogus 块兜底=pdf「近似定位」提示,不崩。

## R57-复验追加
- 页面 fetch 走 `localhost:5173/api`(vite 代理)→Network.setBlockedURLs 要封 `:5173/api/*` 不是 `:8000`;API GET 无 Cache-Control→emulateNetworkConditions(offline) 会命中启发式缓存假成功,测真断网用 setBlockedURLs。
- timeline 移动端入口=MoreSheet(mobile-tab-more→more-timeline);timelineOpen 在 ui store;断点翻转抽屉态保留。
- deadline done→undone 毒化已修:_VALID_KINDS 读端丢弃未知 kind(直连验证法:手插 `{"kind":"future.kind"}` 行看 GET 是否仍 200)。

## R58 移动端壳 notes
- 375 仿真:setDeviceMetricsOverride 后 Page.reload 会丢 override——reload 完再 set;恢复用先 set 桌面尺寸再 clear(clear 单独发不复位)。
- NavDrawer「审阅」tab 是启动器(点击→review-sheet 开+nav 关);tab 行超 320px 要 scrollIntoView 再点否则点中 scrim。
- MoreSheet 行选择器 more-*/export-*/open-*/run-lint;ITEM 类含 `disabled:pointer-events-none` 子串——dis 探测要用 .disabled 属性不是 className 子串。
- file-figs 是组头;行在 file-figs-list 下 file-fig。
- 移动触控档:tab 55/行 44;顶栏 icon 32-36(低于设计系统 44 档,R58-01)。

## R59 设置面 notes
- 数字字段是 blur-commit NumberField(draft+onChange 校验范围后 onCommit);合成改值可靠姿势:HTMLInputElement.prototype.value.set + dispatch input(insertText 对 type=number 不可靠,select() 在 number 上抛)。
- saveSettings=乐观 set+enqueue('settings')+600ms debounce PUT+失败回滚;viewer 无 UI 门控、提交才 403 回滚(第 4 例死端 affordance)。
- PUT /settings 无 etag——API 旁路写不回 SPA store,UI 显示旧值(LWW)。
- MoreSheet 排版设置→MobileSettings 整页;CaseSettingsDialog 仅 DeliverPage deliver-settings 入口;AccountPage #/account chips=radio;OrgPanel #/admin。

## R60 AI 面板 notes
- AiPanel testids：`ai-panel[data-enabled][data-tab]`、`ai-tab-{proposals,chat,jobs,scenarios}`、`ai-enabled-switch`、`ai-enabled-badge`、`ai-details-toggle`→`ai-provider/ai-models/ai-usage`；`ai-org-disabled`/`ai-budget-exceeded`/`ai-budget[data-over]`。
- Radix Tabs 不吃 `.click()`（evaljs），只认 CDP pointer 事件——切 tab 必须真实 click_at。
- `api.aiUsage` 契约坑：后端返回 `{rows,...}` 前端要 `{records}`——「本案用量」死功能（R60-02）。
- 任务链：POST /agent/run **同步**跑完（mock）→ 永远看不到 queued/running/cancel UI；verify 用 API（done-job cancel 200 no-op、bogus 404）。
- 预算闸门：`studio.json` 直写 `ai_daily_tokens`（settings PUT 会整体替换——裸 PUT 丢 ai_enabled！）；heavy 429、interactive 放行。
- org 关 AI：`PUT /admin/settings {ai_enabled:false}`→生成类 POST 403 ai_disabled_by_org；但 GET 不带 org 态→面板假就绪（R60-01）。
- SelectionActionBar 要真 CM 选区：CDP drag 必须 `buttons:1` on mouseMoved；layout 视图下无 CM/无条——先切「源码」。
- 页面在 `127.0.0.1:5173`——setBlockedURLs 模式用 `*127.0.0.1:5173/api/*`，`*localhost:*` 匹配不到会假绿。
- 提案动作端点：`POST /agent/proposals/{id}/apply|dismiss`（reviewer+）；notify 只发 apply/dismiss 且过滤 actor 自身。

## R61 协同中心 notes
- CollabDrawer 入口:桌面 `share-button`(顶栏「分享 ·N在线」)/移动 `mobile-collab`;`collab-tab-{members,links,access,settings}`;`openCollabCenter('members')`。
- 成员控制:RoleSelect `collab-member-role-{uid}`(owner 选项=lastOwner 守卫)+`collab-member-remove-{uid}`;邀请 `collab-invite-email`+submit,未注册→`collab-invite-row`「待接受」→`collab-invite-revoke-{email}`,已注册→直接入列。
- **CSS attr selector 必须带引号**:`[data-testid="collab-invite-revoke-a@b.com"]`——`@`/`.` 不引号会 parse 失败,tap 返回 null。
- 链接:`POST /share` 成员链、`/public-links` 客户链(`collab-public-link-{scope,baseline,ttl,download}`);`#/c/{token}` 匿名客户页——revoked→410→「已过期或已被撤销」`client-expired`,bogus→「链接失效」。
- 权限:members/share/access/invites/public-links=owner;collab-settings=viewer+;非成员全 403。viewer 抽屉=awareness 名单+开关禁用。
- member.changed → 被变更者收 system 通知(R61-01 起);前端轮询到当前案新通知→refreshProjectMeta 重取 role;抽屉开着 30s 轮询 members。
- 断线:`emulateNetworkConditions offline` 可杀活 WS(setBlockedURLs 不行——只管新请求);`share-button[data-status]` connected/reconnecting + 顶栏「重连中/协同自动保存」。
- 375:drawer=底部 Sheet 375×~690(85dvh)`data-density=touch`;「在线」口径三源(peers⊕access.online⊕成员-peerNameOf)不一致。

## R62 版本历史 notes
- 入口三处:菜单 `menu-file`→`file-history`→SideSplit 下块(outline/HistoryPanel);`?panel=history`→伴随栏(review/HistoryBody,双实现!);375 `more-history`→NavDrawer `nav-tab-history`。rail 无 history 图标。
- ACL:GET history/diff/version=viewer;POST restore 无覆盖→editor 地板(viewer/reviewer 403)。`restore-version` 钮只看 versionContent 不看角色=死端。
- `requestNavigation type:'custom'`:仅 collabStatus==='off'&&content!==saved 才弹 dirtyGuard;collab 案恢复零确认即执行;run() rejection 无 catch→403 静默。
- CM 编辑:`Input.insertText` 可入 CM;`document.execCommand` 被 CM6 忽略。协同案打字 0.8s 服务端 debounce 自动落盘+commit「collab:<book>」——脏守卫腿要先断网/让 collabStatus=off。
- restore 同文版=静默无提交;restore 产生的 commit 走 `history.override('restore <sha7>')`。
- SideSplit 可拖到 ~1px 仍工作;探测行宽异常先查 side-panel width。

## R62 复验追加
- Toasts 是自绘组件:容器 `[data-testid=toasts]`(非 sonner——`[data-sonner-toast]` 永空,假阴性教训)。
- 历史是双实现并存:同一 `data-testid=restore-version` 两处都渲——探测要用容器限定(`[data-testid=side-lower] ...` vs `[data-testid=history-body] ...`),否则量错面。

## R63 导入向导 notes
- 入口:`file-import-docx`(菜单文件直列)/`more-import-docx`(375,MoreSheet 里需 scrollIntoView 后再点)/`import-panel-open`(dockview)。对话框 `import-docx-dialog`,input `import-docx-file`。
- 文件注入:`DOM.querySelector` 拿 nodeId→`DOM.setFileInputFiles` 直塞路径(绕过 accept 过滤也能测负件——accept 只是浏览器 hint)。
- 测试件:repo 自带 `backend/tests/fixtures/import_native.docx`;负件自建 fake/empty/garbage/md_fake/big(52MB→413)。
- 后端:`POST /api/projects/import/docx`(multipart,login 即够,任何已登录用户建案为自身 owner);`/api/import/docx/styles` 只提样式;413 上界=ATTACHMENT_MAX_BYTES=50MB;dup id→409;非 docx→400「不是有效的 DOCX 文件」。
- 并发:同 id 竞发 201+409;异 id 双 201。
- **坑**:pick 坏件不报错(suggestStyles catch 静默),错误只在 submit 时显。

## R64 批注/审阅链 notes
- 批注面入口:顶栏 `topbar-review` → ReviewDrawer(桌面右列/375 `review-sheet`),tabs `review-rail-tab-comments`;卡片 `review-comment[data-comment-id]` + `review-locate/-reply-open/-reply-body/-reply-submit/-resolve/-delete`;过滤器 `review-filter-open|resolved|all`;新建 `review-add-comment`→`review-draft-body/-submit`(需先 CM 选区,否则 toast「批注要挂在某一段上」)。
- ACL: `/comments*` POST/回帖 viewer 底(讨论通道);PATCH/DELETE 需作者或 editor+,resolve/reopen 需作者或 reviewer+(`_comment_perm`);客户批注 author.id=None 只能角色管;非成员 403。前端 `canMutateComment` 同口径禁钮。
- 锚点漂移:删锚定文→`anchor.stale:true`+「锚点已变」徽标(后端每次 GET `load_reanchored` 重锚,撤销恢复后 stale 自清)。
- @提及:命中 display_name/email/user_id/email 本地段(无显示名成员按本地段插入);本地段撞名多人→该条跳过不盲发。通知 `kind=mention` href `#/p/{pid}?c={cid}`。
- 离线探测:`Network.emulateNetworkConditions` 必须先 `Network.enable` 才生效(否则 fetch 仍 200,假"静默");`setBlockedURLs` 对 ws 连接不杀但 fetch 阻断有效——本项目二者都须先 Network.enable。
- comments 挂载期间 30s 轮询(useCommentsViewLifecycle,quiet 不翻 loading);跨端新增 ≤30s 回流(断言前先等一轮或触 loadComments)。
- 客户批注:`POST /api/public/{token}/comments` 免登录(source=client);徽标判 `c.source==='client'`(或客户页自身 `guest`),渲染 `comment-client-badge`。

## R65 presence/awareness notes

- presence 房间 = 挂载中的源码 CM 卡 join 书房间（registry acquireRoom per pid/book）；'content' 镜像房（useCollabMirror，每个工作台壳必挂）R65 起携带真实身份 ⇒ 案卷级在线，版面/移动用户也在场。
- aggregate()/selectOnlineCount 按 uid 去重（无 uid 退回 name）：同名成员不塌缩（改 display_name 走 PUT /api/users/me）。书房间条目（带光标行）在镜像房条目之前聚合——uid 命中时带行的优先。
- 半开断线靠服务端 WS ping 兜底（uvicorn --ws-ping-interval 15 --ws-ping-timeout 20，Dockerfile/Makefile/隔离栈启动命令都带；漏带 ⇒ 幽灵 peer 残留 ≥40s 复现 R65-02）。hash 导航正常关 WS → ~3s 收敛。注意：offline 仿真会顺带掐死对该 page 的 CDP websocket——先取状态再断网，恢复用新连接。
- 改 display_name 走 `PUT /api/users/me`（登录 Cookie），admin PUT /api/admin/users/{id} 不收 display_name。
- compareLock 实测入口：「视图→布局→权利要求书↔说明书 对照锁」预设直接给双源码卡+锁开；OpenAsMenu 拆书若该书已是 tab 只会激活不会复制（panel id 唯一）。dockview tab 拖拽拆分不吃合成 mousemove。
- peers 弹层：点 share-button → collab-peer-row（名字/在线/正在编辑）；375 下同一入口可达。
- 去重键/房间口径改动点在 collab/registry.ts + provider.ts；判 peers 用 [data-testid=presence-avatar]，计数用 share-button innerText。

## R65 复验补充（presence 修复后口径）

- 半开断连的真复现：**不要**用 `Network.emulateNetworkConditions`——它不影响已建立 WS（浏览器网络栈照样 pong），且绑定 CDP 会话（conn 断开即还原）。用独立 Chrome 实例（--user-data-dir=/tmp/xxx --remote-debugging-port=29230）跑第二个登录用户，然后 `SIGSTOP` 其 `--utility-sub-type=network.mojom.NetworkService` 进程 → TCP 真半开；`SIGCONT` 恢复。uvicorn 需 `--ws-ping-interval 15 --ws-ping-timeout 20` 才会清（实测 ~45-66s）。
- 注意修后回归面：ws-ping 打开后**干净 FIN 的 peer 收敛从 ~3s 退到 ~31s**（ping 循环延迟 close 处理）——验该修复时别只看幽灵路径，也要测普通关页。
- 多用户多 ctx：browser ws `/json/version` → `Target.createBrowserContext`（独立 cookie jar）→ `Target.createTarget(url,browserContextId)`；或独立 Chrome 实例 + 登录表单原生填值提交（fetch 登录的 Set-Cookie 不落 document.cookie 的坑）。
- 修后每 tab join content+abstract+claims+description 四 WS 房；presence-avatar 按 uid 去重（同 uid 多 tab/镜像不再现身 peer）。

## R66 体检控制台 notes（develop@eaf50fd）

- 控制台入口：桌面 `console-toggle` 钮或 Ctrl+J（pdfView='logs'）；移动 375 → 底部「更多」sheet → `more-console` → `mobile-console`（三段：mobile-console-tab-problems/output/jobs）。移动壳需先 `Emulation.setDeviceMetricsOverride`+`setTouchEmulationEnabled` 再 `Page.reload` 才切；`clearDeviceMetricsOverride` 对另一 session 设置的 override 无效——直接 setDeviceMetricsOverride 回桌面尺寸再 reload。
- testid：entry 行 `console-entry`（data-id 如 `claims.forward_ref#2`）；钮 `console-entry-locate`(主点击行)/`-goto`/`-fix-btn`(data-mode apply|suggest)/`-rule`/`-raw-toggle`；tab `console-tab-{all,error,warning,info,checks,oa}`；页脚 `console-clear-cache`、`console-outputs` 下拉项 `console-out-docx/pdf/xml`；checks tab 里 `run-lint`「运行当前案检查」。
- 造 apply 级诊断最省事：权项 N 行内「根据权利要求M」把 M 改成大于 N 的号 → 自动 lint（编辑即触发重跑，无需手动）出 `claims.forward_ref#N`（apply「改为权利要求N-1」）+ `preflight.claims.cycle`；点修复即还原。
- 行内文字改 CM：先 `cm-scroller.scrollTop=0` 渲染目标行（虚拟列表只渲可视行），TreeWalker 定位字符拿 range.getBoundingClientRect，Input.dispatchMouseEvent 点，Delete(rawKeyDown)+char/keyDown 键改。DevTools 可用 `Input.dispatchTouchEvent` 模拟移动端点按。
- 体检规则开关在递交页 `deliver-settings` → `case-settings-dialog` → `case-settings-tab-checks`（settings-nav-lint 是另一套排版设置页，别混）。开关写 `settings.preflight.disabled[]`。
- **断链手法**：`Network.enable`+`Network.setBlockedURLs(['*pattern*'])` 可靠掐 fetch（测 netError「无法连接后端」）；`emulateNetworkConditions offline` 触发 navigator.onLine 守卫（toast「网络已离线」）且随 CDP 会话关闭失效；`Fetch.requestPaused` 会抢 drv.py evaljs 的 ws 读流——要用就开第二条 conn 跑 pauser。
- 空案（content.md 空）桌面端被 global-error-bar 拦、控制台打不开；移动端 console tab 可达。空案体检反而能看到「构建失败」诊断。
- /lint、/build 门槛都是 viewer（设计如此，渲染不落源码）；apply 修复对 viewer 无权属门控 → 静默本地分叉（R66-01）。

## R66 复验补充

- 快速造/改文档内容：`PUT /api/projects/{pid}/docs/{book} {content, base_sha}` 走 save_content→collab.on_saved，**活房间会同步**（编辑器即时更新）——比 CM 键盘编辑稳得多。GET 同路径拿 sha。
- CM 行内编辑注意：视觉行包裹令 ArrowDown 按视觉行算，长段落里会落错行（本次把「基础预测」误改成「基础9测」——用完务必 diff 校验）。

## R67 块编辑链 notes
- 生产无 StructureView/sv-block：版面卡片 = LayoutView(ProseMirror 纸面，`card-structure-<book>`)。块编辑入口有二：PDF 文字层双击→`block-editor-host` 弹层（桌面 popover/375 Sheet，`block-editor-submit`「提交并重建」）；说明书书内 `.ps-eq` 双击→`equation-editor`（claims 书的 `ps-claim-eq` 双击只 gotoLine，不开编辑器）。
- StructureToolbar/FormulaDialog/TableDialog/DeleteDialog 无生产入口（死代码），`StructureDialogs` 挂在 LayoutView 尾但 opener 都在 structure/*。
- PDF 文字层探测：`.react-pdf__Page__textContent span` 仅可视页存在且重建期间全部消失；span 定位+scrollIntoView+dispatch dblclick 要同一 evaljs 原子完成；PUT /docs 会触发 ~29s 重建使旧 out.pdf 404、面板空白。
- dockview 激活 tab 需 PointerEvent 序列(pointerdown/mousedown/up/click)，`.click()` 常无效；`className.includes('active')` 会误中 `dv-inactive-tab`，要用 `aria-selected`。
- `patchBlock` 并发：客户端 content 快照当服务端基准 → 同块并发编辑最后写赢且无提示（测竞态用 EquationEditor 最稳）。
- patch/insert/delete 块 API：POST/DELETE `/api/projects/{pid}/blocks/{block_id}`，`content` 字段=基线全文。

### R67 复验补充(2026-09)
- **pdfIndex 楔死排查手法**: 双击恒「PDF 尚未生成」时——经 `pdf-preview` DOM 的 `__reactFiber*` 上溯到 PdfPreview 组件,遍历 `memoizedState` 链可直读 `slots`/`active`/`staging`/`pdfIndexState`({url,index,building})。已知两种楔死:(a) slot 已载但 `stagingRendered` 空→`active` 永不切→`shown=null`→索引不建;(b) `building:true` 挂死(疑 doc 句柄孤儿)。`Page.reload` 可治;根因在槽交换/索引生命周期竞态,非测试手法问题。
- **打开块编辑器的兜底路径**: PDF 双击需要 pdfIndex 就绪;若楔死,LayoutView(版面卡 `.ps-eq` 双击)开 EquationEditor 是同一 `patchBlock` 通道——但注意其 base 是 useMemo 追 live content(非冻结),验 409 冲突要用 PDF→BlockEditorHost 路径(req.base 打开时冻结)。
- **fiber 读 zustand**: useStudio selector 结果在组件 hook 链里以 `useSyncExternalStore` 快照形式出现,按对象键名({version,title,books}=ast;{url,building,index}=pdfIndexState)识别。

## R69 只读门控补充
- **换 cookie 必须真 reload**：复用 browserContext 注入新 `studio_session` 后，`Page.navigate` 到相同 URL 只是软导航（SPA 不重新装载，store 保旧角色）——写操作会以旧身份落盘。务必 `Page.navigate` 到异 URL 或 `Page.reload{ignoreCache:true}`，再用 `/api/users/me` 核身份。
- **vite transform 陈旧**：checkout 新分支后 dev server 可能继续 serve 旧 transform（同文件部分 prop 缺失）。DOM 与源码不符时 `curl /src/...` 对比，`touch` 文件即触发重转。
- **Radix Menubar**：`click_testid`/`Input.dispatchMouseEvent` 点不开顶级菜单；需对该按钮 dispatch `pointerdown→mousedown→pointerup→mouseup→click` 序列。菜单项 `.click()` 可触发 onSelect。
- **editorCommands 双注册表**：模块级 `view`（CardEditor focus 时 `registerCard`，**readonly 跳过**——viewer 的 `openSearch/undo/redo` 等一律 false → 菜单项 toast「编辑器未显示」）vs doc store `editorHandle`（SourceCard onFocus 注册，不看 readonly——Mod-f/查找替换走它，viewer 可用）。验菜单路径别只验快捷键。
- **编辑器工具栏死面**：`etb-*`/EditorToolbar 只在 DockArea Suspense fallback 挂载，dock 工作台稳态下任何角色都拿不到——门控只能代码验证。
- **CM 写判定**：readonly CM `contenteditable=false` + `Input.insertText` docLen 不变为已拦；菜单/钮的 `aria-disabled=true` + 点击 inert 为已门控。

## R70 智能体任务链 notes
- **mock job 生命周期 ~450ms**：live 窗口太短，轮询 DOM 永远看不到 cancel；用 `MutationObserver` 在点击前就装「见到 `ai-job-cancel-*` 立即派发指针序列」能命中（viewer 403 实测就是这样抓到的）。`heavy` 场景(s1/s2/s7) 排 `{pid}:heavy` FIFO，但 sqlite 写锁（org_audit→notify/sink）把 POST 串行化到 ~470ms/个——与 job 时长打平，**并行 fetch 也攒不出 queue 深度**；`/agent/run` 响应本身要等上一个 job 完。
- **造 interrupted**：打不死运行中的 mock job。写 `<proj>/.studio/ai-jobs/job_x.json` 带 `status:"running"`+几条 steps → `GET jobs` 触发 `_load` 回收→持久化 `interrupted`/「服务重启，任务中断」——行徽标显「已取消」、无 done 帧，等价重启路径。
- **SSE→poll 验证**：CDP `Network.setBlockedURLs['*jobs/*/events*']` → EventSource onerror → 非终态退 `poll()`（GET `/api/ai/jobs/{id}`，JOB_POLL_MS=1500）；job 完成即停。
- **PUT /settings 整量替换陷阱**：body 里不带的键会被 normalize+defaults 抹掉——`ai_enabled`/`preflight` 都中招过；调 API 改设置必须回填 `ai_enabled:true`，否则静默关掉本案 AI（`require_enabled` 对缺失按关处理）。调完恢复建议 PUT `{ai_enabled:true,sub_except,abstract_limit,style:{}}`。
- **移动 AI 入口**：375 下不是 `topbar-ai`（在 1900px 桌面层屏外），是底栏 `mobile-tab-ai` → `mobile-ai-tab` 内嵌 `ai-panel`；`compact=!desktop(mq<1024)` → JobRow `min-h-touch` 44px。CDP emulation 每次 navigate/reload 后都要重设再测。
- **提案 dismiss 的 pending 列表**：`ai-proposal-{apply,dismiss,locate}-<propId>`；点 dismiss 后该项从 pending 消失（state 走 dismissed），locate 无 toast。

## R71 账户页 notes
- **入口**: `#/account` hash 路由,tabs `account-tab-{profile,security,notify,pat}`;`user-menu` 触发钮需 Radix 指针序列。
- **skeleton 楔死**: 首次 `Page.navigate` 到 #/account 常停 `account-loading` 骨架——`authStatus:'unknown'` 残留(loadMe 只在 bootstrap 跑一次,hash 导航不重跑)。`Page.reload` 即恢复;判 bug 前先确认 `fetch('/api/users/me')` 状态。
- **改密语义**: JWT=uid 不轮换——改密后所有现存会话存活;旧密码立即死、新密码立即可用(`/api/auth/cookie/login` form-encoded,成功 204)。
- **PAT 验证**: POST /api/pat→201(token 只在 pat-new 显一次);`/mcp` POST `Authorization: Bearer pat_…` 验活(200)与撤销后死(401)最直接;行内两步撤销 `pat-revoke-confirm-<id>`。
- **外观**: theme/density 存 `localStorage patent-studio:ui:v2`(zustand persist),0 后端写;`html.dark` + `dataset.density` 断言。
- **AUTH=off 切换**: kill uvicorn 后 `pgrep -f 'app.main:app'` 确认端口真释放再启(env 在 bash -c 包装里,pgrep 会匹配到 wrapper——按 PID 杀进程本体)。off 下 /users/me→204、`account-auth-off` EmptyState。
- **匿名**: `authStatus==='anon'` 时 App 直接渲 LoginPage(任何 authed 路由都接管)——`#/account` 匿名访问见登录页即对。

## R71b 修复复验 notes
- **未提交 backend 修复**:分支可只含前端提交,后端闸门(models/users/users_me/tests)可能停在 worktree M 态——`git status` 查 M,改了 backend 必须重启 uvicorn(uvicorn 只加载启动时代码;`pgrep -f` 会匹配 bash -c wrapper,按 `app.main:app` 主进程 PID 杀)。
- **会话闸门实测**: `password_changed_at` FLOAT 列由 init_db 的 USER_ADDED_COLUMNS 自动 ALTER;JWT iat=exp−lifetime(秒)。改密→同秒 login 的 token 会被误伤(iat int < pca float)——已知边界,测试时两操作间 sleep≥1s。
- **触发 authStatus:'unknown' 路径**: `Network.setBlockedURLs['*/api/users/me*']` + `Page.reload`(hash-only navigate 是同文档不重启 bootstrap,loadMe 不重跑)。
- **fetch 登录写 cookie**: evaljs 内 `fetch('/api/auth/cookie/login')` 的 Set-Cookie 会被 jar 收——会顶掉被测会话;要保留 UI 会话就另用 curl 或记得到重登。
- **toast 抓取**: `[data-sonner-toast]` 之外 app 用 `[data-slot=toast]`/role=status;观察者 selector 宁宽勿窄。

## R72 PDF 工具栏链 notes
- `PageBox` Esc 缺陷鉴别：`onBlur=commit` 会在 Esc 的 blur() 后仍提交——验证「取消语义」时对比跳页前后 `page-input` 值，别只看编辑态退出。
- `PdfToolbarMobileControls`（移动预览第二行）无 `data-testid`，用 `[data-slot=PdfToolbar][data-variant=mobile]` 选；移动变体缺 zoom-menu/page-prev/download-pdf。
- CDP `Emulation.setDeviceMetricsOverride` 掉线频繁（nav/重连后都可能丢）：断言要**在同一 conn 里 override→eval 连打**；shell 级 `useIsDesktop` 只在 mount 时判定，须 override 先于 doc load（nav 到裸 origin 再进 hash）。
- `locateByText` 命中条件：整段选区文本须为**单个 AST 块的唯一子串**（跨段必「未定位」）。造 located 选区：拖单行中段 60% 宽，避开行首尾。
- selBar 关闭路径只有三种：bar 内 Esc、bar 按钮动作、预览区 click 手势——选区清除不关 bar。
- `rebuild`/`rebuild-menu` 是 split 按钮（非 `build-btn`)；构建 ~1.3s 太快，busy 态别用 sleep 轮询抓。
- `/build` 端点无角色门（viewer 可重建属设计）；工具栏断言别把它当越权。
- find 计数 `pdf-find-count` 文本「n / m」；marks 在 `.react-pdf__Page__textContent mark`。

## R73 审阅标记链 notes
- 审阅面入口:桌面 `topbar-review`(带 Count badge);375 走 `nav-tab-review`(左侧抽屉)→`review-sheet`/`review-rail`/`review-panel` 同 DOM 三层。LayoutView 标记装饰 `data-critic-id`/`data-critic-kind` 只在 `editorMode='review'` 且 `markupLevel='all'` 出现——审计前先点 `edit-mode-review`。
- mark id 形如 `行:列`(9:16),**列随同行其他标记的接受/拒绝平移**(shiftMarks)——断言按 kind+位置找,别按固定 id。
- `markIntact` 陈旧保护验证法:`Network.setBlockedURLs(['*critic*'])` 冻防抖→正文破坏标记→点接受→应整条丢弃不错切。
- markupLevel 四档 Segmented `markup-level-{all,simple,none,original}` 是**按钮组非 Select**;PDF 侧 `review-mode-{original,final,markup}` aria-checked 反映档位;切换触发重建→`download-pdf` data-href build_id 变。
- CM 源码卡标记行内自带 ✓/✗ widget(就地接受/拒绝),点 widget 同落 final/original。
- 指派对话框:`review-assign-open`→`assign-dialog`→`assign-user`(成员 Select)→`assign-due`→`assign-submit`;501→`assign-unavailable` 内联,200→toast+关框。注入标记法:CM 任意行尾 `Input.insertText('{--删--}')` 即入列表(200ms 防抖)。

## R74 术语库链 notes
- TermsPanel 会双挂载（dock 卡片 + 伴随栏 companion-host 各一份），`terms-panel`/`term-row`/`term-candidate` DOM 断言按 2× 计数，数据同源非 bug。
- `terms-extract` 按钮只走确定性路径；`ai:true` 候选无 UI 入口，只能 `POST /terms/extract {"content":..., "ai":true}` API 验证（mock provider 产 source=ai）。
- `terms.alias#` 诊断不实时：save 不触发 lint，只手动 `run-lint`（console-tab-checks→run-lint）或 build 后 `setFromBuild/setFromLint` 才进 `diagnostics.items` → terms-issue 区。
- unify 链：`terms-unify` → `writeCriticLines` 把 `{~~别名~>主名~~}` 写进正文（非持久建议）→ review-mark(kind=sub) 列在 review rail → accept 落 final。unify 后同 alias 已包 mark，`skip_marks` 使其二次 unify count=0（可用于验证已生效）。
- 腐坏 terms.json → GET /terms 422，`loadTerms` catch 只判 501 → 静默空态（R74-01）。测腐坏用 `{corrupt!!!`。
- 还原 terms 用 `{"version":1,"terms":[]}`；编辑器内残文会被 PUT /content 推送到所有 live ctx。

## R75 convert 链 notes
- 文件输入 `convert-file-input` 用 `DOM.setFileInputFiles` 直灌(不点 dropzone);测试文件手工造:docx=zip+[Content_Types].xml+document.xml;无文字层 PDF 需合法 xref(pypdf 要能 parse 才会走 extract_text→scanned_pdf 分支)。
- `convert-start` disabled 条件 `!hasSource||!ack`;**重跑向导时 ack 保持勾选态,脚本里先查 .checked 再点**,否则 toggle 反向。
- 问卷步 `convert-skip` 直达 target;`convert-target-draft`=target=当前案 pid(需 editor,viewer 被 403)。
- 移动端入口 `more-convert`(MoreSheet);找元素注意 `more-sheet` 容器 testid 前缀同样命中 `more-*` 选择器,要用精确 testid。
- Job 级错误注入:临时移走 `backend/app/ai/fixtures/convert.json` → mock `_fixture` 返回 `[mock:convert]` → parse 两次失败 → AiError 502 → ErrorView。用完还原。
- mock convert job ~400ms:mid-run 态捕获要在 start 后零延迟连点;close() 的「后台运行」toast 只在 view 仍 running 时发。
- target=pid 完成后 `history.commit_draft`(author=ai)——测试残留可用 `git -C .studio/history reset --mixed <pre-sha>` 清(工作区不受影响;**切勿 --hard**,会覆盖 content.md 为草稿内容)。
- `jobs.busy` 检查在 extract 之前,await 窗口 → 并发 POST 可双跑(R75-01);复现:两线程同时 curl convert。

## R76 排版模板页 notes
- 桌面设置面板是窄变体：用 `settings-page-select`（Radix Select，`[role=option]` 模板项）+全 pointer 序列；**viewer/部分布局渲 `settings-nav-*` 直钮**（`settings-nav-templates`）。两条路都在。
- 移动端：`mobile-tab-more` → `more-settings` → `mobile-settings-page-select`（**DropdownMenu 不是 Select**，项是 `mobile-settings-page-option-templates` role=menuitem,`.click()` 即可）。
- 导入文件：hidden input `template-import-file`,`DOM.setFileInputFiles` 直接灌路径；`accept=".json"` 纯装饰（.txt 合法 JSON 照样入列）。
- **toast 不是 sonner**——自家 `data-testid=toasts` / `data-slot=toast`,4s 左右；`[data-sonner-toast]` 永远空。
- `Network.setBlockedURLs` **必须先 `Network.enable`** 否则静默不拦（fetch 照样 200）。
- dirtyGuard 只在 `collabStatus==='off'` 挂起（ui.ts:475）——AUTH=on collab 栈下 dirty 断言物理不可达；造脏用 CM 真鼠标点 `.cm-line` + `Input.insertText`（会真实落盘！记得还原 content.md+description.md+history——autosave 连 description 镜像一起写）。
- 并发同名 POST：8 轮并行恒定 201+409，无 TOCTOU（与 convert jobs.busy 不同）。
- viewer 实测可 POST/DELETE 全局模板（routes_templates.py 全路由仅 require_login）——ACL 洞按 UI 实测录证据。
- 管理端登录：POST `/api/auth/cookie/login` form-urlencoded `username=admin@example.com&password=Admin12345`→204+cookie。
- `settings-toggle` 指针序列点击偶发未开面板（返回 ok 但 panel:false）——开面板后必须回读 `settings-panel` 存在再续。
- R76：`acl.max_role_for` 返回跨案最高角色——测 `require_org_editor` 时「viewer 账号」须在所有案都是 viewer（userd），在任一案为 owner/editor 的用户经 API 属合法放行（机构级语义）；UI 门控按当前案角色更严。

## R77 期限页 notes
- 期限主页 `#/deadlines`；dashboard 伴随栏 `#/?panel=deadlines`（`companion-deadlines`，桌面 dashboard 面板，移动端无入口设计）。
- 分组 `group-{overdue,today,7d,30d,later,done}`：**空组不渲 DOM**；done 组默认 `data-state=closed` 且**折叠时行不渲染**——断言前先 `group-toggle-done` 点开。
- 行 testid `deadline-${d.id}` **无 pid 前缀**（跨案撞 id 风险）；操作钮 `done-${id}`/`nudge-${id}`；done 行无 nudge 钮。
- 催办矩阵：无 owner→disabled「未指定责任人」；**催办自己→409「不能催办自己」**；viewer→403 toast；agent→owner 写 notifications(kind=nudge)。
- viewer 行钮不门控：RowActions 无角色判断→viewer 可点必 403 toast（服务端拦，UX 死端型）。
- 造「今日到期」：admin PUT `/api/projects/{pid}/deadlines/{id}` `{due:today,override_reason}`（会把 source 改 manual，测后手改 case.json 还原）。
- toast 捕获：错误 toast 寿命短（~1.5s 后常消失）——点击后 0.3s×N 轮询，别等 1.5s 单读。
- 桌面筛选=Select（filter-owner/client/kind 需全 pointer 序列）；移动=chips `filter-kind-*`。
- 测试账号速查：userd@example.com/UserD12345（纯 viewer·system）；agentb@example.com/AgentB12345（method agent——催办 admin 的非自锁路径）。

### R78 三面杂项 notes（figure-book / integrations / attachments）

- **附图书（figure-book/）入口**：视图›布局›打开面板›`view-open-figures`（dock 卡）。**与 rail-figures 是两个组件**：rail-figures→伴随栏 `components/figures/FiguresPanel`（`figure-card-*`）；dock 卡 `figure-book/FigureBookView`（`fb-*`）。勿混。
- **fb 关键 testid**：`fb-upload`（file input, accept emf/png/jpg/gif/bmp/tiff）、`fb-unify-width`（预设下拉 17/15/12/8.5+自定义）、`fb-export`（`<a download>`→GET figures/export.zip 非 fetch）、`fb-card-{name}`、`fb-card-menu`→`fb-menu-{abstract,insert-ref,caption,up,down,delete}`。
- **WidthHandle 无 testid**：找 `.cursor-ew-resize`（每卡一个）；**必须 scrollIntoView** 后 Input.dispatchMouseEvent 拖拽才生效（屏外坐标点击无效）；0.5cm 步进、夹 2–17cm live 显示、pointerup 时一次 PUT 落盘。
- **Emulation.setDeviceMetricsOverride 按 CDP session**：新 ws 连接丢覆盖（iw 弹回 1900）——每 conn 后须重挂 + reload。
- **删除摘要图自动回任 fig1**（`_default_abstract`）；探多用 file input 循环会真上传（setFileInputFiles 绕 accept）→ 别把同一文件灌到 figs 和 attachments 两输入。
- **attachments API**：multipart 字段 `files[]`（非 file→422）；白名单 pdf/docx/doc/md/txt/png/jpg/zip ≤50MB；行钮 `file-attachment-{convert,download,delete}`（viewer 下 delete **隐藏**非 disabled，upload disabled）；点行→`attachment-preview` `data-kind`∈text/image/pdf/docx(降级下载)。
- **integrations**：设置页选「集成」；`pat-name`+`pat-create`→`pat-new` 一次性明文+`pat-token-copy`+dismiss；`pat-revoke-{id}`→内联「确认」两步；`pat-unavailable` 仅 AUTH=off；`audit-list`/`audit-refresh`（需 pid）。

### R79 健康回归 notes（踩坑）

- **`Input.insertText` 的 undo 不可靠**：execCommand('undo') 有时删不回插入的字符（实测残留 Z），协同轮把每次击键提交到 history → **污染修复唯一可靠路径**：PUT /api/projects/{pid}/content 写回基准文本，再 `git -C .studio/history reset --mixed <pre-sha>`。测试前 `md5sum content.md + git -C history log -1` 双快照。
- **file input 探测循环会真上传**：`DOM.setFileInputFiles` 对每个 input 探测会触发 onFiles——按 accept 属性和上下文精确锁定目标 input（方法案有 ≥4 个 file input：import/.emf fig/attachments/.zip），否则会像本轮把 txt 灌进 `file-import-input` **整文替换案卷正文**（污染同时写 content.md 和 history commit）。
- **登出→登录态**：`user-menu`→`user-menu-logout`；登出后 hash 不变但 LoginPage 接管（password input 存在即判据）。
- **批注锚点**：POST /comments 需要 `anchor:{block_id,line,quote}`，block_id 从 GET /ast 拿（顶层 key 如 'abstract'）；422「锚点需要 block_id 或 file」。SelectionPopover 用合成 Range 会随 pointerdown 消失，UI 路径改用真实鼠标拖选。
- **建案按钮**：构建菜单 `build-now`（menu-build 下）；PDF 卡失败态出「PDF 加载失败」+重新构建钮。
- **判顶栏在线数**：`share-entry` 文案「分享 · N 在线」；协同自动保存状态在 status bar。

## R80 lint 诊断面板 notes
- 控制台面板是 rail 切换按钮：`data-testid=rail-checks`（无 rail-tab- 前缀 id；点击**切换**开合——脚本里点两次=开又关，断言前先读 panel 存在态）。
- 定位钮 `data-testid=lint-goto`，文本=书节名（如「权利要求 12」「说明书 · 附图说明」）；`hasLine` guard 只对带 line 的诊断渲钮。
- `lint-rule-{id}` 行只在展开组内渲染：未通过/警告默认开，「其他诊断 6」默认开、通过组默认关（aria-expanded）——数行先展开组。
- viewer：`run-lint` **enabled 是正确的**——lint 是纯计算非写操作；服务端 ACL 已闸（401 匿名/403 非成员 viewer）。
- `check-stale`（deliver 页陈旧告警）实测不可常驻：ensureLint 进页即按 `lintContent!==content` 重跑，只剩竞态窗口——别为它造持久 stale 断言。
- 375 路径：more-sheet→`data-testid=open-check`（不是 more-checks）→ check-panel 全宽；mobileGoto 关 sheet→编辑 tab→源码行定位成立。
- 网络错误注入：`Network.setBlockedURLs(['*lint*'])` → 面板内联「检查请求失败：TypeError: Failed to fetch」；解禁重跑即恢复。
- POST /lint 无显式路由依赖但全局中间件兜住：anon 401 / 非成员 403(kind=forbidden) / 坏 JSON 422 / 假 pid 404。

## R82 portal 密度 notes
- **vite transform 陈旧坑**:checkout 分支后 vite dev 可能仍服务旧 transform（实测 import 已新而 JSX 缺新属性）——UI 复验前先 `curl localhost:5173/src/components/ui/xx.tsx | grep <新特征>` 确认 served 版本，必要时 `touch` 文件强制重转。
- 375 审阅底部 Sheet 真身：`nav-tab-review`（NavDrawer 审阅页签）→ `review-sheet`；`more-review` 走 companion `?panel=review`（data-slot=companion-panel，调用方显式 data-density）。
- 命中区量法：`getBoundingClientRect` ∪ `getComputedStyle(el,'::after')`——touch-hit 视觉高度不变、::after 扩到 44。
- mobile dashboard 行 ⋯：`row-actions-{pid}` 是容器不是 trigger。

## R115 批29 走查 notes（DeliverPage / OA / Inbox + CDP 拦截）
- **AUTH=off 堆栈下的可达面**：InboxPage/`/api/notify` 受 `authStatus==='authed'` 门控，off 模式永不加载（代码有意设计）；notify.create() off 模式不写库。要测通知 UI：CDP `Fetch.enable` 拦 `*users/me*` 返回 user JSON → authed，再拦 `*api/notify*` 按 before_id/unread 分页回数据。
- **Fetch 拦截 + evaljs 并发坑**：conn(t) 一条 ws 上 evaljs(cmd) 与 requestPaused 读循环同 recv → websockets ConcurrencyError 静默杀 drain → 请求永久 paused、页白跑。修法：单 reader 协程吞全部消息，命令 send-only + pending{id} 字典回执；截图/求值同样走 pending。
- **OA 轮次入口**：桌面 dockview `tab-oa`（rail 无 OA 项）；mobile MoreSheet `more-oa` → `openConsole('oa')`（R115-02，批29 已补）。轮次条 role=tablist；`oa-round-delete` 内联两阶 confirm/cancel；`oa-filed-toggle` 二步「确认」；`oa-extend-1/2` 超上限 409→error toast。
- **useState 首轮值坑**：`useState(rounds.length?...)` 在常驻组件 mount 时取一次——列表加载后不再重算默认值（R115-01 模式）；审「默认值随数据变化」类逻辑时查 state 是否放在每次挂载的子组件里。
- **toast 断言**：data-slot=toast 错误 5s/信息 2.5s 自消，低频轮询必漏；用 MutationObserver 记 addedNodes 或 ≤500ms 采样。
- **501 兜底测试**：Fetch.fulfillRequest responseCode=501 + detail.kind='not_implemented' 触发 unavailable 分支（oa-rounds-unavailable/notifyUnavailable 同模式）。
- **case.json 直改陷阱**：绕 API 改 dates/status 不触发 recompute → 派生期限残留；恢复用 PUT /case {dates:{filed:null,application_no:null}} 让服务端重算清空。
- **DeliverPage**：deliver-file 弹 filing-dialog（申请号需 12位+.校验位 regex）；export-regen-* 有「正在生成…」loading 闸；尚未生成项下载钮 disabled；field-error-* 链接开 case-form-dialog。

## R115 批30 走查 notes（客户页 / 附图书 / admin+集成）
- **公开链客页须 AUTH=on**：AUTH=off 下 POST /public-links 501 + resolve() 直接 404，客户页不可达；起并行栈 (PROJECTS_DIR=scratch + PATENT_STUDIO_SECRET + AI_PROVIDER=mock) 而不是切共享栈模式。
- **410 可缓存坑**：Chrome 会缓存 410 响应——sqlite 把链接翻回有效后页面仍渲 expired；每次失效态验证换新 token，别复用。
- **匿名上下文**：`Target.createBrowserContext`→`Target.createTarget{url,browserContextId}`；session 复用走 `Network.setCookie{name,value,url:'http://localhost:PORT/'}`（jar 里 cookie 域是 localhost，curl 必须打 localhost 不能打 127.0.0.1）。
- **含点 testid 须引号**：`[data-testid="fb-card-fig6.emf"]` 合法、`[data-testid=fb-card-fig6.emf]` 抛 SyntaxError——附图卡 id=文件名带扩展名。
- **figure-delete-dialog 是 role=alertdialog**（非 dialog）：`[role=dialog]` 查不到；两阶 confirm 元素 `figure-delete-confirm`、refs 列表 `figure-refs`、取消 `figure-delete-cancel`；409 figure-referenced 时对话框不关闭转 refs 列表。
- **num==null 活验证**：figures.md 摘要行 `![](figs/fig1.emf){width=14.5}`（无「图N」caption→num=null）恒不被统一影响；`count`=仅编号图数（FigureBookView.tsx:196），unify/move 同过滤。
- **附图书入口**：桌面 menu-view→布局→打开面板→附图书 dock 卡；375 `more-figures` 全宽 sheet（`more-oa` 同列）。上传输入 `[data-testid=figure-book] input[type=file]`，DOM.setFileInputFiles 真上传。
- **admin 行自门控**：自身行 member-toggle-super/active disabled；member-title 是 Radix select。`/api/admin/settings` 承载 default_collab+ai_daily_tokens+ai_enabled；`/api/admin/users` 无 DELETE（测试用户 sqlite 删或 is_active=false）。
- **集成页入口**：DeliverPage→`deliver-settings`→`case-settings-tab-integrations`；settings-page-select 的排版组**没有**集成项（属另一 SettingsPanel）。PAT 行钮 id 后缀化：`[data-testid^=pat-revoke-]` / `^=pat-revoke-confirm-`。
- **Emulation 不持久**：setDeviceMetricsOverride 按 CDP session 绑定且导航后可能回弹——375 断言前总重挂并验 innerWidth。
- **登录 API**：POST `/api/auth/cookie/login` form-urlencoded username/password（fastapi_users 规范），Set-Cookie `studio_session`。

## R115 批31 notes（UX 行为回归：脏守卫/两阶/⌘K/滚动/loading闸/分页/覆盖确认/错误重试）
- **window 派发键事件失败**：`dispatchEvent(new KeyboardEvent)` 打在 `window` 上时 e.target=window 无 `.closest` → StoreBootstrap keydown handler（:166）抛错吞掉 → 改派发到 `document.body`。CDP `Input.dispatchKeyEvent` modifiers 位掩码: Alt=1 Ctrl=2 Meta=4 Shift=8；`Mod-k` 在 Linux 解析为 ctrlKey（hotkeys.ts IS_MAC=false 分支）。
- **`command-palette` 根 testid 不落 DOM**：CommandDialog 包装层吞掉 data-testid——断言 palette 开态用 `palette-case-*`/`palette-panel-*` 项代替，勿找根节点。
- **BlockURL 模式须窄化**：`Network.setBlockedURLs['*attachments*']` 会把 vite 模块 `src/store/attachments.ts` 一并屏蔽 → app 白屏不启动。模拟 API 失败用 `*api/projects*attachments*` 之类带 `/api/` 前缀的窄模式。通用教训：屏蔽前先 `performance.getEntriesByType('resource')` 查同名 vite 模块。
- **CaseFormDialog 聚焦断言**：`fill-{col}-{pid}` 点击后 `document.activeElement.dataset.testid` 应等于 FIELD_TESTID 映射值（snake→camel：`case_no`→`case-caseNo`）；`case-title` 无 testid 字段（改它不置脏, requestClose 静默关→脏守卫假阴性）。
- **DiscardDialog 断言点**：`discard-dialog`（role=alertdialog）+「放弃未保存的修改？」+焦点在「继续编辑」；Esc/遮罩/取消三路同守卫；FilingDialog(:37)/ImportDocxDialog(:289) 同接 requestClose；TagManager 微表单刻意排除（直关不弹为正确行为）。
- **滚动复原断言**：scroller 是列表内嵌 div 非 window——从 `inbox-list`/`case-table` 父链找 `overflow-y-auto` 元素；usePageScroll(key) 在 mount+ready 时恢复 {top,left}；需先造足数据使列表可滚（<一页时 scrollTop 恒 0 断言无意义）。
- **通知分页共享 store 坑**（批32 已修）：`loadNotifications` merge `[...fresh, ...prev-非fresh]` 刻意保尾页；仪表盘未读集曾并入同一 store 稀释页窗+毒化游标——PR #285 起走 `loadDashUnread`→`dashUnread` 分仓，`notifications` 只被未过滤查询写入。断言分页时先数 li 再点 `inbox-load-more` 看增量+has_more→按钮消失。
- **sqlite 造数排序伪影**：`created_at` 存 TEXT——应用用空格分隔 `'2026-10-02 04:22:55'`，python `isoformat()` 给 `T` 分隔 `'...T03:59'`；字典序 `T(0x54)>空格(0x20)` → 合成行会排在真行之上,断言「顶部=最新」时踩坑。造数写 `'2026-10-02 04:00:00'` 空格格式。
- **模板导入覆盖**：`template-import-file` 灌同名 JSON → `template-import-confirm`「覆盖同名模板」+「覆盖导入」`template-import-confirm-ok`；JSON 须 `{"name":..,"settings":{...}}`（templateJson.ts:8-13, 仅认 patent_cn_invention）；settings 入口: settings-toggle→`settings-page-select`(BUTTON非SELECT)→菜单项「模板」。
- **协同抽屉**：触发钮是 `share-button` 非 share-entry；loading 闸断言 `collab-members-loading`/`collab-access-loading` 骨架出现且「暂无成员」文本不出现（Network.emulateNetworkConditions{latency:1500} 拉长窗口双采样）。

## R115 批34 notes（OA默认值/未读分流/AI任务台/转换向导/体检面板）
- **体检面板入口藏二级子菜单**：`menu-view` → `view-layout-presets`（布局，submenu 需 `mouseMoved` 悬停展开）→ `view-open-panel`（打开为新面板，再嵌套 submenu）→ `view-open-checks`。整条链全部要真 `Input.dispatchMouseEvent`（pressed/released + 悬停 mouseMoved），`el.click()` 和合成 PointerEvent 均不级联。
- **回归检查 tab 是新 DOM**：控制台 `console-tab-checks` 用 `check-counts`/`check-table`/`check-locate`/`check-rerun`（级别/位置/信息/定位 列表格），**不是**批80 的 `lint-group-*`/`lint-rule-*`/`lint-goto`——两套断言别混用。`check-locate` 跨书定位链（[0054]→description 书+cm-activeLine）与 lint-goto 同行为。
- **全代码库无 per-rule 开关/跳过概念**：`disabled_rules`/rule switch 零命中；「校验规则」settings 页只有全局参数（摘要字数上限/下标解析例外）。审「规则开关」类需求时先 grep 确认能力存在再判 absent≠defect。
- **OA 轮次造数走 API**：`POST /api/projects/{pid}/oa/rounds {kind:'first'|'subsequent'|'reexam', issued_on:'YYYY-MM-DD', delivery:...}`→201；`oa-round-add` 打开表单后 kind select 无 testid——用 `option[value]` 或 label（一通/后续通知/复审）断言默认值。`DELETE /api/projects/{pid}/oa/rounds/{rid}`→204。
- **申请号正则允许可空两空格**：`APPLICATION_NO_RE = /^\d{4}\s?[1-9]\s?\d{7}\.[0-9X]$/`（types/deliver.ts:51，与后端 xml_export 同规）——`2024 123 456.1` 合法、`20241123456.1` 报 `p.text-danger-fg` 内联错。还原日期：`PUT /api/projects/{pid}/case {dates:{filed:null,application_no:null}}`（走 recompute，勿直改 case.json）。
- **ConvertDialog**：`menu-file`→`file-import-menu`（导入 submenu）→`file-import-convert`。5 步 `convert-steps`；`convert-start` 被 ack 复选 gate（须先勾「我知悉…发送到 AI 中转站」）；mock provider 秒完→`convert-diff`/`convert-diff-body`(+/-计数)/`convert-adopt`/`convert-discard`/`convert-view-history`。⚠️ **adopt 会真写 workspace**——测后须 `PUT /api/projects/{pid}/docs/{book}` 逐书还原 + `PUT .../content`（books 是真源）；draft version commit 残留在 history（append-only 设计）。「繁简转换」功能不存在——该向导是论文/交底书→专利转换。
- **AiJobsTab 切 tab 重挂即重拉**：批34 起 AiJobsTab 挂载 effect 跑 `loadAgent`（Radix TabsContent 每次切出即卸载）——外源 API 造数切回任务 tab 即回流，无需 reload。live job 才有 `ai-job-cancel-{id}`（cancel 对 done job 是 200 no-op）；status map 排队中/进行中/完成/失败/已取消；running 有 Progress bar；error → timeline danger Alert；**无 retry 钮**。`ai-run-s7`（OA 条款场景）无 OA 输入时 legit disabled（「尚未拆条」hint）——非缺陷。
- **AI 产物清理路径**：job 记录 `<proj>/.studio/ai-jobs/job_*.json`、proposals `.studio/ai-proposals/{pid}.jsonl`、用量 `ai-usage.jsonl`；本案开关 `studio.json` 的 `ai_enabled`（UI `ai-enabled-switch` 写它）。jobs GET 走内存 registry——删文件后 API 仍列到进程重启（磁盘净即可报清）。
- **Emulation 随 attach 失效**：`setDeviceMetricsOverride` 是 per-session——新 ws 连同一 target 后 innerWidth 回 1050，每次 attach 必重挂并断言 innerWidth==375（尤其 MoreSheet/移动断言）。

## R115 批37 notes（convert跨案job / 改密会话失效 / 文件注入 / admin清理）
- **convert→新案卷 job 判定**：target=new 时后端把 job.pid 标为新案 id——批37 前 upsertJob 外案守卫全丢帧（永卡 0%）。断言跨案 job 终态直接 `GET /api/ai/jobs/{id}`，勿只看 UI；批37 起 convertJob 专属仓按 convertJobId 认领。
- **改密→全会话失效**：PUT /users/me{password} 后所有 cookie 作废且 localStorage 写 `patent-studio:auth-anon` → 下次 boot 跳过 /users/me 永停登录墙。复测须 `localStorage.removeItem` 再 reload；CDP 注入的 cookie 也失效，须 in-page fetch 重登。
- **文件注入**：`DOM.setFileInputFiles{nodeId,files:[真实路径]}` 走真 File→真上传，accept 校验仍跑；不存在路径不报错→0 字节 File（测 accept 边界够用）。
- **convert 菜单二级**：menu-file → `file-import-menu`(submenu)→ `file-import-convert`；先开 submenu 否则元素不在 DOM。
- **删案两步**：`POST {pid}/list-state{state:'trashed'}` → `DELETE` 才 204，直删 409。admin 无 DELETE users——测试用户清理 = `is_active=0` + 删 ACL/access 行。
- **eval 嵌套引号断串**：clickel 单引号包选择器内含单引号属性值断 JS 串 → 换 `querySelectorAll` + regex 过滤。
- **D1 模板导入门**：viewer 下 `template-import` 应 disabled（批37 已修）；同页 apply/save/delete 门控先例。

## R115 批39-40 notes（查找冷路径/超时/用量/模板失败）
- **hash 导航必须 reload**：`Page.navigate` 改 hash 时 SPA 不会重新执行 `location.hash` 解析（多数入口读在 mount 期）。断言 `?focus=`/`?c=` 深链要先 `setDocumentContent` 或 reload 后挂 hash，勿 SPA 内改 hash 等路由反应。
- **id 含冒号的选择器**：`#dir:figs` 这类 id 在 querySelector 里冒号是伪类语法→选不中也不报错（返回 null 静默假阴性）。一律 `document.getElementById('dir:figs')` 或 `[id="dir:figs"]`。
- **dev 模式 dynamic import 双 store**：vite dev 下 `import('@/store')` 与静态 import 可能各拿一份模块实例（第二 store instance）——断言 store 状态时页面内 dynamic import 拿的对象 ≠ 测试注入对象。验证 store 写副作用走 DOM/testid 断言，勿在页面 eval 里二次 import store。
- **拖拽合成事件**：HTML5 DnD 链要 `new DataTransfer()` + `new DragEvent('dragstart'|'drop', {dataTransfer})` 逐事件派发；dragover/drop 的 preventDefault 链一个不能少，jsdom 下 DataTransfer 构造可用但 effectAllowed/dropEffect 默认值与真浏览器有差——断言以 DOM 结果（节点移动/状态写）为准勿断 DataTransfer 字段。
- **编辑器查找冷路径**（批39 已修）：`commands.view` 只在 `u.focusChanged && u.view.hasFocus` 时经 registerCard 注册——未聚焦卡/冷启动后 `openSearch` 曾静默 false。回归断言 DOM 回退：`[data-testid="card-source-<book>"] .cm-content` → `EditorView.findFromDOM`；断线场景卸载卡片后应返回 false。
- **半开连接探测**：req/直用 netFetch 现带 `AbortSignal.timeout(120s)`；模拟半开 wedge 用 `Fetch.enable` 截住请求不 resume（勿 failRequest——fail 是立即断非挂起）。

## R115 批42-verify notes（跨案毒化已修 + 零写断言法）
- **「跨案 hash 导航毒化」条目可标记已修（#295）**：openProject 起调即清 content/ast/bookSha（翻案窗口内 patchBlock/saveBookDoc 的 !s.ast 守卫拒写）+ BookEditor saveChain 迟发保存盖挂载案戳（mountPid 不等即弃）。原毒化场景现为反例断言面。
- **md5 快照 + 双向 nav + 零写断言回归法**：①测前 `md5sum` 两案全文件快照（content.md/docs/*.md/studio.json/case.json）；②在两案间 `#/p/a`↔`#/p/b` 多次往返（含 docx 导入链触发的自动开案），每步零编辑；③`sed -n '/<log起点标记>/,$p' backend.log | grep -E 'POST|PUT|DELETE'` 断言窗口期**零写请求**（collab ws 的 PUT /ast 除外——那是合法计算请求）；④收尾 md5 逐字节比对。
- **毒化判定三元组**（复用）：旧作用域 store 字段残留 + 写路径按调用时 pid 寻址 + 自动保存触发（idle/unmount-flush/队列续跑）= 跨作用域覆写向量。审计其它 scope 切换（logout/expire/机构切换）时同查这三点。

### R115 批60 追记
- 桌面 console-tab-oa 须经 menu-view→view-console 开底栏才可见；OA generate 门控=UI 的 ai-enabled-switch（别改 studio.json）
- **studio.json 无尾换行**——json.dump 复原会 md5 漂移；audit.jsonl 时钟可偏 ~8h，按尾部行数删不按 ts
- su@example.com 不存在于测试库——审计任务指定时以 admin(superuser) 代验

## R115 批66 增补（源码编辑器/结构对话框面）

- **zustand 多实例坑（vite HMR `?t=`）**：vite dev 对带 `?t=<ts>` 的模块分发**不同 store 实例**——`/src/store/index.ts?t=123` 与 `/src/store` 是两家店。探 store 必须拿 `?t=` 活例（从组件 chunk 的 import 行抄），否则 `pid` 读到空店误判死按钮。
- **菜单「打开即自闭」诊断法**：别 `.click()` 一次就下结论。订阅 `layoutViewToolbar` 抓 `'insert'→'none'` 抖动间隔（实测 69ms）+ `focusin/focusout` 捕获日志（`in 按钮 → out→菜单 → in/out×3 重挂载 → out→null`）——能分清是 PopupList blur-onClose×StrictMode 双挂载，还是根本没开。
- **viewer 验证法（不毁主会话）**：`create_user` 建临时号 + `PUT /members` 授 viewer + **独立 Chrome profile（:29230）** 登录；验毕 `projects_acl` 删行 + `user.is_active=0`。
- **collab 写回陷阱（还原三件套）**：文件级还原必须 ①git-restore 文档 ②**删 `.studio/collab/*.ybin`** ③重启后端——in-memory 房间不删会把污染内容重刷回盘。`.studio/history` git 自动提交属惯例残留无需清。

## R115 批67 增补（插入菜单/表格/样式面板回归面）

- **还原顺序铁律（ybin 版）**：杀后端 → 验死 → git restore 文档 → 删 `.studio/collab/*.ybin` → **先让客户端页导航走（毁 Y.Doc）** → 启后端 → 验 md5。顺序反了：服务端/客户端 in-memory 房间都会把污染内容回写污染刚还原的文件（本轮实测：文件先净后脏）。
- **`pkill -f "uvicorn app.main"` 会自杀**：模式匹配自身 bash -c wrapper——用 `ss -ltnp`/`lsof` 取 PID 再 kill。
- **Radix dialog 判开看 `data-state`**：`open`/`closed` 切换时节点仍在 DOM，`querySelector` 命中 ≠ 开着——断言 `[data-testid=x][data-state="open"]`。
- **TableDialog 是编辑器非网格**：表格对话框是行列表单+「表头行不能全空」门控，不是格点选择器——别按网格形状找控件。

### 还原补遗（批67 修正）
- `studio.json` 字节级重建注意：**json.dump 无尾换行**——`"style": {}` 原样回写才能复得基线 md5。

## 批67v 增补（五面 DiscardDialog 实机回归技巧）
- `Input.dispatchTouchEvent` 本 Chrome 挂死；移动长按用 `PointerEvent('pointerdown',{pointerType:'touch'})` dispatch 到节点触发 500ms longPress
- `ps:pdf-longpress` 事件须带 blockId+book 否则监听静默丢——须真长按可定位 span（[data-page] 祖先内正文词）
- SelBar「未定位」= 选中文本不在任何 block；选正文词 span 才走通
- 客户评论门控=client-guest-name(nameOk)+body，只测 body 会误判发送死钮
- 文件净但 md5 漂移查 collab：杀后端（ss 取 PID)→restore→rm ybin→**先导航走客户端页**（毁 Y.Doc)→启后端
- DiscardDialog 断言：`discard-dialog` data-state=open、焦点在 `discard-stay`、elementFromPoint 验叠层顶

## 批71v 增补（草稿上提 store / 审计事件验证技巧）
- **验证新合并后端改动先核对进程年龄**：无 --reload 的长驻 uvicorn 会静默跑旧码（PUT 200 但新 emit 缺失）——`ss -tlnp` 取 PID + `ps -o lstart -p <pid>` 对照 `git log -1 --format=%ci` 目标提交时间；早于合并即重启后端再验
- **PUT /case 会 422 拒响应级字段**（version/status/confirmations/next_deadline/target_filing_days_left）——播种/还原前先 pop 再 PUT；deadlines 手动改期后 source=manual、recompute 不再删，还原须 `PUT deadlines=[]`
- **testid 含 @/. 不能 querySelector 直选**（选择器语法冲突）——`querySelectorAll` + `dataset.testid` filter 或 `CSS.escape`
- 术语 PUT 后前端面板须 reload 才重拉（无实时订阅）
- rail-timeline 是真 Sheet 卸载——验 store 草稿存活用「关→开」而非 blur
- org_audit 断言：`sqlite3` CLI 未装，用 `python3 -c "import sqlite3…"` 查 `org_audit_events` 表（kind/created_at/pid/actor）

## 批81 增补（CM 编辑器查找/撤销走查技巧）
- **CM 查找/替换必须用真键盘路径**：`openSearchPanel` 后必须 `Input.insertText`（或 keypress）输入查询词——直接 `setval`/evaljs 改 input.value 不会进 CM 的 SearchQuery state，替换动作按空查询执行（实测静默零替换）。断言前读 `view.state.field(searchState).query`。
- **Ctrl+Z 绝不发向 .cm-content 之外的元素**：焦点不在可编辑区时浏览器原生 undo 会落到 contenteditable 文档上，绕过 CM history 静默删正文（实测 -34 字，无 toast）。走查要测 undo 必须先 `page.click('.cm-content')` 聚焦再发键。批81 后该洞已被 beforeinput inputType=historyUndo 拦截根修——回归法：聚焦查找框 Ctrl+Z 后断言正文 md5 不变。
- **脏稿清理用 `persistMergedContent(get().saved)`**：走查留下未保存编辑会影响后续 md5 断言；store 里调 `persistMergedContent(saved)` 写回基线再清 dirty，比逐一撤销可靠。
- **md5 快照含 `.studio/`**：还原/断言时 `md5sum content.md docs/*.md` 之外别忘 `studio.json` 与 `case.json`——但 collab `.ybin`/audit.jsonl/git-history 属合法漂移要排除。

## VI V3 增补（台账空态/插画验证技巧）
- **造台账全空**：`POST /projects/{pid}/list-state {state:'archived'}` 按用户视角归档不落文件——**须 Page.reload** 让 selectDashboardRows 重算（只改 hash 会拿陈旧 list_state）；还原同接口回 active
- **EmptyState 槽位**：`data-slot=empty-state/empty-state-icon/empty-state-illustration`；illustration 仅 size=md 生效，sm/筛选空态仍走 icon
- **`Emulation.setEmulatedMedia {features:[]}` 不清特性**——须显式 `{name:'prefers-color-scheme', value:'light'}` 回亮
- scope 页签 testid：`scope-{all,mine,shared,archived,trash}`

## PR370 增补（lint 面板/编辑源/账库重建）
- lint 断言两界面：rail-checks 面板分组头 vs ⌘J 控制台诊断列表（`console-entry-rule` 只在 ConsoleEntry 出现）——分组核对用前者，逐条诊断用后者
- **编辑源是 `docs/*.md`（claims.md/description.md/abstract.md/figures.md），不是 content.md**——content.md 是合并产物会被工作台覆盖；触发 lint/AST 变更须改 docs/ 或走 CM 真键盘编辑
- `/tmp/studio.db` 会随系统清理丢失（用户全抹）：`python scripts/create_user.py` 重建账号后 `POST /api/auth/cookie/login` 直登取 cookie，比 UI 登录页 stale authed 401 绕行可靠

## UX 体检增补（R1 全站走查实测锚点）
- **入口地图**：审计日志+MCP 集成不在一级——在递交页「案级设置」modal→「集成」页签；「OA 答复」是控制台 tab（docked 于版面预设 `g-ai` 320 列）；「审阅」顶栏钮开审阅伴随栏
- **AI 面板 rail 钮** aria-label 是 `AI 助手（建议式，不改源码）`；面板无稳定 aria-label 时按 `button[title]` 找设置齿轮
- **视图切换钮 textContent 双字**「版面版面/源码源码/PDFPDF」（icon+label 各渲一遍）——断言用 `includes` 别精确匹配
- **移动仿真回桌面须显式 setDeviceMetricsOverride**：clearDeviceMetricsOverride 不一定还原；回桌面用 `{width:1568,height:993,deviceScaleFactor:1,mobile:false}` + reload
- **排版设置是 dock 页签不是 modal**；案级设置才是 modal（排版/体检/AI/集成 4 签）
- **每案 AI 外发闸门** = `studio.json.ai_enabled`；API 还原 `PUT /api/projects/{pid}/settings {"ai_enabled":false}`（PUT 非 PATCH）
- **协同面板 AUTH=off 降级**=红卡+501；presence(WS) 在线人数仍工作——两口径不一致非 bug（R534 后红卡已降 info）
- **落地页只在 authStatus==='anon' 渲**：AUTH=off 栈永远看不到；验 landing 须 AUTH=on+硬刷；注册邮箱用 .com（.test 被 pydantic 拒 422）
- **空态插画族一致性检查点**：期限（日历+沙漏）/通知（信封+蜡封）/台账（图卷）同风格雕线族——体检横向比对
