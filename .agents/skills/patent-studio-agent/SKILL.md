---
name: patent-studio-agent
description: How an external agent (Codex / Claude Code / Devin) works on a Chinese invention-patent draft inside Patent Studio via its MCP server — read the three books, propose edits as CriticMarkup suggestions, run lint/preflight/build, never overwrite the author's source silently.
---

# Working on a patent draft through Patent Studio MCP

Connect first (see `docs/mcp.md`): stdio `uv run --project backend python -m app.mcp`, or HTTP `http://127.0.0.1:8000/mcp` (Bearer PAT when `PATENT_STUDIO_AUTH=on`).

Tools (schemas in `backend/app/mcp/schemas.py`, exact list `TOOL_NAMES`):
- v1: `list_projects` `read_book` `get_ast` `get_docs` `patch_block` `insert_block` `lint` `preflight` `build` `export_xml` `list_figures` `set_figure_order` `set_figure_width` `add_comment` `get_history`; resource `patent://{pid}/docs/{book}`.
- W4-E management (`docs/plan/17-w4e-deliver-admin-design.md` §4): `get_case` `set_case_status` `list_attachments` `read_attachment_text`.
- W4-E semantic, read-only, viewer+ (§5): `get_claim_tree` `get_support_map` `get_figures` `get_terms` `context_pack`. Derived on the fly from `preflight` / the block AST / `terms.json` — nothing stored, always the current `content.md`.

## The loop: claim tree → context_pack → propose → preflight
Do **not** reason about a claim from `read_book` alone — the full text hides which claims depend on which, whether a term is defined, which description paragraphs actually support a feature, and which reference numerals a figure really carries. Every claim-level task (review, OA reply, drafting a dependent claim, answering "is X supported") goes:
1. `get_claim_tree(pid)` → nested tree: independent claims are roots, each node has `num / kind / category / refs / line / text / issues / children` (`issues` are the preflight diagnostics on that claim, e.g. `claims.multi_multi`, `claims.unsupported_term`). Pick the claim(s) you are asked about; a multi-dependent claim (「权 2–6 任一」) hangs under its smallest referenced claim but keeps all `refs`.
2. `context_pack(pid, claim_id="N")` (also accepts `"claims/N"`; unknown → `not_found`) → one pack:
   - `claim` + `chain` (dependency chain up to the independent claim, never truncated);
   - `support`: description paragraphs whose terms the claim/chain uses — `{para_no:"[0012]", line, text, terms}` — cite `para_no` in OA replies and `line` in `add_comment`;
   - `figures`: the figures this claim touches with their reference-numeral table (`markers[].num / legend / names / consistent`);
   - `terms`: glossary rows with the defining sentence and its line (`definition_line`);
   - `comments`: unresolved comments anchored in this claim (resolved ones are left out);
   - `issues`: preflight diagnostics on the claim and its support paragraphs (each `chain` node carries its own `issues`).
   `truncated=true` means `max_chars` (default 12000, max 40000) cut `support` → `terms` → `comments` in that order; raise `max_chars` or narrow to the specific tool: `get_support_map` (term → claims → description lines, `supported` flag), `get_figures` (figure ↔ numerals, `consistent=false` = same numeral, different names), `get_terms`.
3. Propose — never rewrite. Suggestions go through `patch_block` / `insert_block` (CriticMarkup, the author accepts/rejects in the UI); questions and concerns through `add_comment(pid, {block_id, line, quote}, body)`. Cite block ids, `para_no` and line numbers from the pack, never from memory of the prose. Do not pass `direct=true` unless the user explicitly asked for a direct edit.
4. `preflight(pid)` again after your suggestions: fix your own `critic.*` / `claims.*` findings before handing back, and confirm the diagnostics you set out to clear are gone (`mode=final` renders as if accepted).
5. Tell the user what you suggested and where; leave accept/reject to them. The author's source is never silently overwritten.

## Case management
- `get_case(pid)` → `case.json` (status, dates, applicant, tags, …), viewer+.
- `set_case_status(pid, status, note="")` → status must be one of `intake drafting review client_review final filed oa granted rejected closed` (backend values; the UI shows 立案/撰写中/…/已递交). Needs **agent+** with auth on, and is audited + committed to history. Application date / number are entered by the author in the deliver page's filing dialog, not through MCP.
- `list_attachments(pid)` / `read_attachment_text(pid, name, max_chars=20000)` → client materials in `attachments/`; text extraction reuses the DOCX importer (`docx`), `pdftotext -layout` (`pdf`), UTF-8 (`text`); images / zips are `unsupported`.

## Ground rules
- `content.md` is the single source; the three books (`abstract` / `claims` / `description`) are its mirror. Never write both.
- **Default write = suggestion.** `patch_block` / `insert_block` emit CriticMarkup (`{++ ++}` `{-- --}` `{~~old~>new~~}`) that the author accepts/rejects in the UI. Only pass `direct=true` when the user explicitly asked for a direct edit; with auth on that needs editor role (viewer gets `forbidden`, and the refusal is audited).
- Markup never spans lines (`patent_docx/critic.py` parses per line). The server diffs per line: a changed line becomes `prefix{~~old~>new~~}suffix`, added/removed lines become whole-line `{++ ++}` / `{-- --}`. Send the **whole block** back, not just the changed line — a one-line reply replaces the whole block and shows up as delete-everything + insert-one-line.
- Questions or concerns go through `add_comment(pid, {block_id, line, quote}, body)`, not into the source.
- Every call is audited to `.studio/audit.jsonl` (who / tool / args summary / result). Don't try to avoid it.
- Errors come back as `isError` with JSON `{kind, message, line, detail}`; `stale` means the block id no longer exists — re-run `get_ast` and retry.
- Do not paste patent content into third-party AI services unless the project's outbound switch is on (project settings; off by default).

## Typical loop
1. `list_projects` → pick `pid`.
2. `get_claim_tree(pid)` → `context_pack(pid, claim_id)` for anything claim-specific (section above). `get_ast(pid)` for block ids of non-claim blocks; `read_book(pid, book)` only for whole-book prose (`mode=final` hides pending markup, `markup` shows it).
3. Propose: `patch_block(pid, block_id, markdown)` — send the full replacement text of that block; the server diffs and wraps it in CriticMarkup. New content: `insert_block(pid, kind, after_block_id=…, markdown=…)`.
4. Check: `lint(pid)` / `preflight(pid)` → fix your own findings before handing back (`critic.*` diagnostics flag malformed markup, not pending suggestions).
5. `build(pid)` → PDF/DOCX URLs + diagnostics (`mode=final` renders as if accepted, `markup` shows the marks); `export_xml(pid)` only when asked. `list_figures` / `get_history` for context.
6. Explain to the user what you suggested and where (block ids); leave accept/reject to them.

## Figures (`docs/figures.md` is the source of truth)
- `list_figures(pid)` → `{figures: [{name, num, width, alt, is_abstract, abstract_width, preview, companions, …}], settings}`. `num` is the 1-based position in the `# 说明书附图` section of `docs/figures.md` (`null` = file in `figs/` not yet listed); `alt` is the caption text of that line (`图N 题注`), `null` when unlisted. Same result as `GET /api/projects/{pid}/figures`.
- `set_figure_order(pid, order)` → rewrites the `# 说明书附图` section in that order; `order` must be a permutation of every listed filename (missing / extra / duplicate → `figures` error, nothing written). Figure numbers are recomputed from the new order; each line's width and alt travel with the file. Returns the same shape as `list_figures`.
- `set_figure_width(pid, name, width?, abstract_width?)` → `width` is the description-figure width in cm, `abstract_width` the width used when `name` is the abstract figure (ignored otherwise); both must be > 0. Only the numbers on that figure's line change. Returns the same shape as `list_figures`.
- These two **write `docs/figures.md` directly** (not CriticMarkup suggestions — figure order/width are layout, not prose). With `PATENT_STUDIO_AUTH=on` they need editor+; a viewer PAT gets `forbidden`. Check the description's `图N为…` captions with `preflight(pid)` (`figures.alt_mismatch`) after reordering.

## Scenario agents (`POST /api/projects/{pid}/agent/run`, W5)
Body `{scenario, params}`; scenarios `s1`–`s7`, `s9`, `s10` (`s8` is refused). A job runs a **fixed plan** (`backend/app/agent/plans/<scenario>.py`: ToolStep → GenStep → CheckStep, no open-ended loop; format failure retries once, then degrades to a comment), emits `StepEvent`s (`GET …/agent/jobs`), and ends with **pending proposals** only (`GET …/agent/proposals`: `critic` / `comment` / `patch`, each carrying its `checks`). Nothing touches `content.md` or `docs/*.md` until a human applies a proposal (`…/proposals/{id}/apply`); every job re-checks `no_direct_write` (md5 snapshot before/after) and reports it as a check event. Wording rule for everything the agent writes: 建议 / 疑似 / 请核对 — never 不支持 / 不清楚 / 应予驳回 / 无效 (`checks.LEGAL_VERDICT_WORDS`; a violating comment is dropped, not softened). Routing: `interactive` = swe-2-medium, `heavy` = swe-2-max, fallback swe-2-high; with `PATENT_STUDIO_AI_PROVIDER=mock` the JSONL fixtures `backend/app/ai/fixtures/agent_s*.jsonl` answer.

### Template 1 — 交底书 → 初稿 (S1)
```json
POST /api/projects/{pid}/agent/run
{"scenario": "s1",
 "params": {"text": "<交底书全文>",            // or "attachment": "<file in attachments/>"
            "questionnaire": {"…": "…"},        // optional 发明人问卷
            "target": "current"}}               // "current" (default) | "new"
```
- `target:"new"`: the existing 一键转专利 pipeline creates a **new** case (`done.data.new_pid`); the current case is untouched, no proposals.
- `target:"current"`: 1 heavy outline gen + 3 gens (claims / description sections / abstract) → one `patch` proposal (`BlocksPatch`): new claims appended after the last claim and renumbered to continue, description paragraphs appended to their `###` section, abstract only when it is empty. Existing blocks are never rewritten.
- Acceptance: job ends `done`; `content.md` md5 unchanged until apply; the patch passes `parse` and `preflight_delta` (no new `error`); `no_direct_write` ok. If the draft cannot be fitted into the case (parse / preflight_delta fail), the plan ends with a comment on the last claim carrying the raw draft instead of a patch.

### Template 2 — OA → 争辩稿 (S7)
```json
POST /api/projects/{pid}/agent/run
{"scenario": "s7",
 "params": {"item_ids": ["oa-1", "oa-3"]}}      // from .studio/oa/items.json (OA page); omit = all items
// or inline: {"items": [{"id":"oa-1","claims":[1],"kind":"novelty","text":"<审查意见原文>"}]}
```
- Exactly **one heavy gen per item**: `context_pack` of the attacked claim(s) → argument points citing `[00NN]` → one `comment` on the independent claim; optional claim amendments come back as `critic` (`{~~old~>new~~}` / `{++…++}`) on the amended claim block, normalized through the existing OA helpers.
- Never reorders or renumbers claims (A9): the claim number is always taken from the original block, an edit that cannot be diffed back to the original is dropped (failed `claim_edit` check), and a `comment` with verdict wording is dropped (failed `no_legal_verdict`).
- Acceptance: `comment` count == item count; each `critic` passes `lint` + `roundtrip` (reject == original, byte-for-byte); `no_legal_verdict` 0 violations; `no_direct_write` ok.

### Template 3 — 术语统一 (S4)
```json
POST /api/projects/{pid}/agent/run
{"scenario": "s4", "params": {}}
```
- Deterministic candidates from `get_terms` rows with aliases + numeral tables where one numeral carries two names (`numerals.inconsistent`); **one** interactive gen picks the canonical form per group (must be one of the group's own spellings, otherwise the deterministic default — legend name / glossary main name — wins).
- Output: one `critic` per affected block, `{~~旧~>新~~}` only (no insertions/deletions), glossary rows untouched.
- Acceptance: every critic passes `lint` and `roundtrip`; applying = accept in the review UI; `no_direct_write` ok. Example on `examples/method`: `投注财富门控` → `投注财富门控控制器` (numeral 1034, L189 and the 实施例 paragraphs).

Other scenarios follow the same contract: `s2` claim critique (deterministic `antecedent` first, then per-independent-claim heavy gen → comments citing `[00NN]`), `s3` support completion (`{++…++}` inserted after the last 具体实施方式 paragraph, `support` + `noun_subset` checked), `s5` figure numerals (comments only), `s6` abstract (≤300 字, `noun_subset`; `{~~…~~}` on the existing abstract or a `patch` when empty), `s9` translation (`patch` new `docs/<book>.en.md`, `params.books` default all three; structure mismatch after one retry → comment), `s10` client brief (`patch` new `docs/brief.md`).

## Kernel syntax you must respect
- One `# 发明名称`, then `## 摘要` / `## 权利要求书` / `## 说明书`; description sections are `### 技术领域` … and `#### 实施例一` sub-sections.
- Claims: blank-line-separated blocks, `1.一种…方法，其特征在于，` / `2.根据权利要求1所述的方法，…`; each line inside a block is a paragraph.
- Formulas: a standalone `$$…$$` line (linear syntax → OMML), `$$…$$ （编号）` for numbered ones; see `backend/patent_docx/README.md` §content.md 格式约定.
- Don't invent Markdown the kernel doesn't parse (no HTML, no nested lists, no inline `$`).
