# -*- coding: utf-8 -*-
"""v1 工具集 + 资源（docs/plan/10 §3.2）。全部复用 app 层函数：
ProjectStore / routes_ast._parse / routes_preflight._report /
lint / run_build / run_xml_export / figures / comments / history / patent_studio.kernel.patch。

每个案卷级工具：store.get(pid) 确认存在 → AUTH=on 时按 ACL 校验角色（读与建议 viewer+，direct 写 editor+）→
在工作线程里跑同步业务函数 → 追加一行审计（args 只记标量/长度，不记正文）。业务错误抛 ToolError，
文本为 ToolErrorDetail JSON（与 REST 的 error_detail 同形）。

建议模式（默认）：把块的新旧行做 difflib 行 diff，同行改动收成 `前缀{~~旧~>新~~}后缀`，
整行增删写 `{++ ++}` / `{-- --}`，
标记不跨行（critic.py 逐行解析）；随后仍走 patch.patch_block 重解析校验并落盘。
"""

from __future__ import annotations

import difflib
import functools
import json
import os
import uuid
from typing import Any

import anyio
from fastapi import HTTPException
from mcp.server.mcpserver.exceptions import ToolError

from app import config
from app.domain import comments, history
from app.domain.build import run_build
from app.domain.figures import FiguresError
from app.domain.lint import lint as run_lint
from app.domain.projects import ProjectError, normalize_settings
from app.domain.xml_export import run_xml_export
from app.mcp import audit, schemas
from app.mcp.auth import CURRENT_ACTOR, LOCAL, Actor
from app.routes.ast import _parse
from app.routes.preflight import _report
from patent_studio.kernel import critic, docset, patch
from patent_studio.kernel.docset import BOOKS

# ---------------------------------------------------------------- 错误 ----


def _err(kind, message, line=None, detail=None) -> ToolError:
    d = schemas.ToolErrorDetail(kind=kind, message=message, line=line, detail=detail)
    return ToolError(json.dumps(d.model_dump(), ensure_ascii=False))


def _detail_of(exc) -> schemas.ToolErrorDetail:
    if isinstance(exc, ProjectError):
        return schemas.ToolErrorDetail(kind="not_found" if exc.status == 404 else "bad_request", message=str(exc))
    if isinstance(exc, patch.PatchError):
        return schemas.ToolErrorDetail(kind=exc.kind, message=str(exc), line=exc.line)
    if isinstance(exc, HTTPException):
        d = exc.detail
        if isinstance(d, dict):
            return schemas.ToolErrorDetail(**{k: d.get(k) for k in ("kind", "message", "line", "detail")})
        return schemas.ToolErrorDetail(kind="bad_request", message=str(d))
    if isinstance(exc, history.HistoryError):
        return schemas.ToolErrorDetail(kind="history", message=str(exc))
    if isinstance(exc, FiguresError):
        return schemas.ToolErrorDetail(kind="figures", message=str(exc), detail=exc.detail)
    if isinstance(exc, docset.DocsetError):
        return schemas.ToolErrorDetail(kind="content", message=str(exc))
    raise exc


_BUSINESS = (ProjectError, patch.PatchError, HTTPException, history.HistoryError, FiguresError, docset.DocsetError)


# ---------------------------------------------------------------- 身份 / 权限 ----


def actor() -> Actor:
    return CURRENT_ACTOR.get() or LOCAL


async def _allow(who: Actor, pid: str, need: str) -> None:
    """AUTH=off：本机合作者，不设限。AUTH=on：PAT 绑定用户，superuser 放行，否则查 projects_acl。"""
    if not config.AUTH_ON or who.user_id is None or who.superuser:
        return
    from app.auth import acl, role_at_least

    if not role_at_least(await acl.role_for(pid, uuid.UUID(who.user_id)), need):
        raise _err("forbidden", f"需要 {need} 及以上角色", detail=pid)


async def _visible(who: Actor, pids: list[str]) -> list[str]:
    if not config.AUTH_ON or who.user_id is None or who.superuser:
        return pids
    from app.auth import acl

    mine = await acl.project_ids_for(uuid.UUID(who.user_id))
    return [p for p in pids if p in mine]


# ---------------------------------------------------------------- 建议模式 ----


def _sub_line(a: str, b: str) -> str:
    """同一行的改动：公共前后缀保留在标记外（保住 `1.` / `### ` 等结构前缀），中间写 {~~旧~>新~~}。"""
    p = 0
    while p < len(a) and p < len(b) and a[p] == b[p]:
        p += 1
    s = 0
    while s < len(a) - p and s < len(b) - p and a[-1 - s] == b[-1 - s]:
        s += 1
    old, new = a[p : len(a) - s], b[p : len(b) - s]
    if not old:
        mark = "{++%s++}" % new
    elif not new:
        mark = "{--%s--}" % old
    else:
        mark = "{~~%s~>%s~~}" % (old, new)
    return a[:p] + mark + (a[len(a) - s :] if s else "")


def suggest(old_lines: list[str], new_lines: list[str]) -> list[str]:
    """新旧块行 → 带 CriticMarkup 建议的行；无差异时原样返回。"""
    out: list[str] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False).get_opcodes():
        if tag == "equal":
            out.extend(old_lines[i1:i2])
        elif tag == "replace" and i2 - i1 == j2 - j1:
            out.extend(_sub_line(a, b) for a, b in zip(old_lines[i1:i2], new_lines[j1:j2]))
        else:
            out.extend("{--%s--}" % ln for ln in old_lines[i1:i2])
            out.extend("{++%s++}" % ln for ln in new_lines[j1:j2])
    return out


def _settings(store, p):
    try:
        return normalize_settings(p.settings, store.list_figs(p.dir))
    except (TypeError, ValueError, KeyError, IndexError) as e:
        raise _err("bad_request", f"settings 不合法：{e}")


# ---------------------------------------------------------------- 案卷级工具公共骨架 ----
# W4-E E3（docs/plan/17 §4）：tools_case / tools_figures / tools_attachments / tools_semantic 都用这两个函数，
# 工具体重载需要（正式、实测没用）；保持“存在校验 → ACL → 工作线程 → 审计 → ToolError”一套语义。


async def run_audited(store, pid, tool, args, fn, result_of=lambda _r: "ok"):
    """工作线程跑 fn() → 审计 → 返回；业务异常 → 审计 error:<kind> → ToolError。"""
    d = store.get(pid).dir
    try:
        result = await anyio.to_thread.run_sync(fn)
    except _BUSINESS as e:
        detail = _detail_of(e)
        audit.record(d, actor().name, tool, args, f"error:{detail.kind}")
        raise ToolError(json.dumps(detail.model_dump(), ensure_ascii=False)) from e
    except ToolError as e:
        audit.record(d, actor().name, tool, args, "error:" + json.loads(str(e))["kind"])
        raise
    audit.record(d, actor().name, tool, args, result_of(result))
    return result


async def open_project_for(store, pid, need="viewer"):
    """store.get 不存在 → ToolError not_found；AUTH=on 按 need 查 ACL。"""
    try:
        p = store.get(pid)
    except ProjectError as e:
        detail = _detail_of(e)
        raise _err(detail.kind, detail.message) from e
    await _allow(actor(), pid, need)
    return p


# ---------------------------------------------------------------- 注册 ----


def register(server, store):
    run = functools.partial(run_audited, store)
    open_project = functools.partial(open_project_for, store)

    async def write(pid, p, tool, args, direct, op):
        """op(content, settings) -> PatchResult；落盘走 save_content（.bak + 三书镜像 + git commit）。
        direct 需 editor+（AUTH=on），被拒也进审计。"""
        if direct:
            try:
                await _allow(actor(), pid, "editor")
            except ToolError:
                audit.record(p.dir, actor().name, tool, args, "error:forbidden")
                raise

        def body():
            r = op(store.read_content(pid), _settings(store, p))
            store.save_content(pid, r.content)
            return schemas.WriteOut(
                ok=True, mode="direct" if direct else "suggest", sha=history.head(p.dir), block_id=r.block_id
            )

        return await run(pid, tool, args, body)

    # ---- 读 ----

    @server.tool()
    async def list_projects() -> list[schemas.ProjectSummary]:
        """案卷列表（AUTH=on 只列当前 PAT 用户有权限的案卷）。"""
        out = []
        for pid in await _visible(actor(), store.list_ids()):
            p = store.get(pid)
            out.append(schemas.ProjectSummary(id=p.id, title=p.title, mtime=os.path.getmtime(p.content_path)))
        return out

    @server.tool()
    async def read_book(pid: str, book: schemas.Book, mode: schemas.CriticMode = "final") -> schemas.BookOut:
        """读一书正文（abstract / claims / description）。
        mode：final=接受全部建议后的文本，original=拒绝后，markup=含标记原文。"""
        await open_project(pid)
        return await run(
            pid,
            "read_book",
            {"book": book, "mode": mode},
            lambda: schemas.BookOut(
                pid=pid, book=book, text=critic.resolve(docset.split(store.read_content(pid)).book(book), mode)
            ),
        )

    @server.tool()
    async def get_ast(pid: str) -> dict[str, Any]:
        """块 AST（同 GET /api/projects/{pid}/ast）：块 id 用于 patch_block / insert_block / add_comment。"""
        await open_project(pid)
        return await run(pid, "get_ast", {}, lambda: _parse(store, pid, None, None))

    @server.tool()
    async def get_docs(pid: str) -> schemas.DocsOut:
        """三书 + 标题（源码原文，含 CriticMarkup 标记）。"""
        await open_project(pid)

        def body():
            ds = docset.split(store.read_content(pid))
            return schemas.DocsOut(
                pid=pid, title=ds.title or "", abstract=ds.abstract, claims=ds.claims, description=ds.description
            )

        return await run(pid, "get_docs", {}, body)

    # ---- 写 ----

    @server.tool()
    async def patch_block(pid: str, block_id: str, markdown: str, direct: bool = False) -> schemas.WriteOut:
        """替换一个块的 Markdown。默认写成 CriticMarkup 建议（{~~旧~>新~~} / {++ ++} / {-- --}）由作者接受或拒绝；
        direct=true 直接改写（AUTH=on 需 editor 及以上角色）。"""
        p = await open_project(pid)

        def op(content, s):
            if direct:
                return patch.patch_block(content, block_id, markdown, s)
            _book, _b, st, en = patch.find_block(patch._reparse(content, s), block_id)
            new = suggest(content.split("\n")[st:en], patch._block_lines(markdown))
            return patch.patch_block(content, block_id, "\n".join(new), s)

        return await write(
            pid, p, "patch_block", {"block_id": block_id, "direct": direct, "markdown_len": len(markdown)}, direct, op
        )

    @server.tool()
    async def insert_block(
        pid: str,
        kind: str,
        after_block_id: str | None = None,
        book: schemas.Book | None = None,
        markdown: str | None = None,
        direct: bool = False,
    ) -> schemas.WriteOut:
        """在 after_block_id 之后（或 book 书首）插入一块
        （kind：paragraph/claim/section/subsection/equation/table/figure-ref）。
        默认整块写成 {++ ++} 建议；markdown 缺省用该类型模板。direct=true 直插（AUTH=on 需 editor+）。"""
        p = await open_project(pid)

        def op(content, s):
            if direct:
                return patch.insert_block(content, kind, after_block_id, book, markdown, s)
            if markdown is None:  # 先按模板插一次拿到模板行，再整块包成 {++ ++}
                r0 = patch.insert_block(content, kind, after_block_id, book, None, s)
                lines = r0.content.split("\n")[r0.changed_lines["start"] - 1 : r0.changed_lines["end"]]
            else:
                lines = patch._block_lines(markdown)
            marked = "\n".join("{++%s++}" % ln for ln in lines)
            return patch.insert_block(content, kind, after_block_id, book, marked, s)

        args = {
            "kind": kind,
            "after_block_id": after_block_id,
            "book": book,
            "direct": direct,
            "markdown_len": len(markdown or ""),
        }
        return await write(pid, p, "insert_block", args, direct, op)

    # ---- 检查 / 构建 ----

    @server.tool()
    async def lint(pid: str) -> dict[str, Any]:
        """形式检查（同 POST /api/projects/{pid}/lint）：diagnostics + counts，含 CriticMarkup 标记 lint。"""
        p = await open_project(pid)

        def body():
            raw = store.read_content(pid)
            report = run_lint(
                critic.accept(raw),
                _settings(store, p),
                p.figs_dir,
                with_preflight=True,
                figures=store.load_figures(p.dir),
            )
            marks = critic.lint_marks(raw)
            report["diagnostics"].extend(marks)
            for d in marks:
                report["counts"][d["severity"]] += 1
            return report

        return await run(pid, "lint", {}, body)

    @server.tool()
    async def preflight(pid: str) -> dict[str, Any]:
        """递交前体检报告（同 GET /api/projects/{pid}/preflight）。"""
        await open_project(pid)
        return await run(pid, "preflight", {}, lambda: _report(store, pid, None, None))

    @server.tool()
    async def build(pid: str, mode: schemas.CriticMode = "final", pdf: bool = True) -> schemas.BuildOut:
        """构建 DOCX（及 LibreOffice PDF）。
        返回 status、下载 URL（相对后端根，如 /api/projects/{pid}/builds/{id}/out.pdf）与诊断。"""
        await open_project(pid)

        def body():
            o = run_build(store, pid, None, None, pdf, mode)
            return schemas.BuildOut(
                status=o.status,
                build_id=o.build_id,
                pdf_url=o.pdf_url,
                docx_url=o.docx_url,
                diagnostics=o.diagnostics,
                summary=o.summary,
                error=o.error,
            )

        return await run(
            pid, "build", {"mode": mode, "pdf": pdf}, body, lambda o: "ok" if o.status == "ok" else f"error:{o.status}"
        )

    @server.tool()
    async def export_xml(pid: str, mode: schemas.CriticMode = "final") -> dict[str, Any]:
        """CNIPA 五书 XML 导出（同 POST /api/projects/{pid}/export/xml）：各书 xml_url / preview_url 与 zip_url。"""
        await open_project(pid)
        return await run(pid, "export_xml", {"mode": mode}, lambda: run_xml_export(store, pid, None, None, mode))

    # ---- 批注 / 历史（附图三工具已移到 tools_figures.py，W4-E E3）----

    @server.tool()
    async def add_comment(pid: str, anchor: dict, body: str) -> dict[str, Any]:
        """新建批注线程。anchor = {block_id, line(全文 1-based), quote}；作者 = 当前 PAT 用户或本机。"""
        p = await open_project(pid)
        try:
            a = comments.Anchor(block_id=str(anchor["block_id"]), line=int(anchor["line"]), quote=str(anchor["quote"]))
        except (KeyError, TypeError, ValueError) as e:
            raise _err("bad_request", f"anchor 须为 {{block_id, line, quote}}：{e}")
        who = actor()
        author = comments.LOCAL_AUTHOR if who.user_id is None else comments.Author(id=who.user_id, name=who.name)

        def do():
            with comments.file_lock(p.dir):  # R92：stdio MCP 与 web 是两进程，台账写跨进程互斥
                items = comments.load(p.dir)
                c = comments.create(a, body, author)
                items.append(c)
                comments.save(p.dir, items)
            return c.to_dict()

        return await run(pid, "add_comment", {"block_id": a.block_id, "line": a.line, "body_len": len(body)}, do)

    @server.tool()
    async def get_history(pid: str, limit: int = 20) -> list[dict]:
        """git 版本历史（新→旧）：[{sha, at, message, author, added, deleted}]。"""
        p = await open_project(pid)
        return await run(pid, "get_history", {"limit": limit}, lambda: history.log(p.dir)[:limit])

    # ---- 资源 ----

    @server.resource(schemas.RESOURCE_TEMPLATE, mime_type="text/markdown")
    async def book_resource(pid: str, book: str) -> str:
        """一书源码原文（docs/<book>.md 的内容，含 CriticMarkup 标记）。"""
        if book not in BOOKS:
            raise _err("bad_request", f"book 须为 {'/'.join(BOOKS)}")
        await open_project(pid)
        return await run(
            pid,
            "read_book",
            {"book": book, "mode": "markup", "resource": True},
            lambda: docset.split(store.read_content(pid)).book(book),
        )
