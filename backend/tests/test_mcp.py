# -*- coding: utf-8 -*-
"""F1 MCP Server（docs/plan/10 §3、§9）：v1 工具集 + 资源、stdio / Streamable HTTP 两种传输、PatGate、PAT 路由、审计。

传输：
- stdio：官方 mcp.client.Client 拉起 `python -m app.mcp` 子进程（AUTH=off 本机身份；AUTH=on 读 PATENT_STUDIO_PAT）。
- HTTP：uvicorn 在线程里起真实端口，官方 Client 走 streamable_http_client 连 /mcp；
  裸 TestClient 直连时 Host 须为 127.0.0.1——SDK 的 DNS 重绑定保护对 testserver 回 421。
AUTH=on：monkeypatch env 后按依赖顺序重载模块（同 test_auth._reload_app，再加 app.mcp.http / app.mcp.server）。
"""

import asyncio
import importlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from contextlib import contextmanager

import pytest
import uvicorn
from fastapi.testclient import TestClient
from mcp.client.client import Client
from mcp.client.stdio import StdioServerParameters
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

from app.mcp import audit, schemas
from app.mcp.auth import CURRENT_ACTOR, LOCAL, Actor, PatGate, new_token, resolve_actor, token_hash
from app.mcp.tools import suggest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BACKEND)
SECRET = "test-secret-not-for-production-32bytes+"
HEADERS = {"accept": "application/json, text/event-stream", "content-type": "application/json"}
INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "0"}},
}
FLOW = ["list_tools", "read_book", "patch_block", "lint", "build"]


# ---------------------------------------------------------------- 工具 ----


def _projects(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
    return projects


def _reload_app():
    """config → 丢弃 auth 子模块 → auth 包 / router → projects / build / xml_export
    → mcp.http / tools / server → main。"""
    import app.auth
    import app.auth.router
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod
    from app.mcp import http as mcp_http
    from app.mcp import server as mcp_server
    from app.mcp import tools as mcp_tools

    importlib.reload(config)
    for name in ("db", "users", "acl", "schemas", "create_user"):
        sys.modules.pop(f"app.auth.{name}", None)
        app.auth.__dict__.pop(name, None)
    importlib.reload(app.auth)
    importlib.reload(app.auth.router)
    importlib.reload(projects_mod)
    importlib.reload(build)
    importlib.reload(xml_export)
    importlib.reload(mcp_http)
    importlib.reload(mcp_tools)  # 与重载后的 app.domain.projects.ProjectError 同一类对象
    importlib.reload(mcp_server)
    return importlib.reload(main)


@pytest.fixture()
def off(tmp_path, monkeypatch):
    """AUTH=off + tmp PROJECTS_DIR（写操作不能落到 examples/）。"""
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    main = _reload_app()
    yield main, tmp_path / "projects"
    monkeypatch.delenv("PATENT_PROJECTS_DIR")
    _reload_app()


@pytest.fixture()
def on(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    main = _reload_app()
    yield main, tmp_path / "projects"
    monkeypatch.delenv("PATENT_PROJECTS_DIR")
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    _reload_app()


@contextmanager
def _serve(app):
    """uvicorn 线程起真实端口（lifespan 内建会话管理器），yield base_url。"""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    deadline = time.time() + 10
    while not server.started:
        assert time.time() < deadline, "uvicorn 未启动"
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        t.join(10)


def _http_client(base, token=None):
    hc = create_mcp_http_client(headers={"Authorization": f"Bearer {token}"} if token else None)
    return Client(streamable_http_client(base + "/mcp", http_client=hc))


def _stdio_params(projects, **env):
    return StdioServerParameters(
        command=sys.executable,
        args=["-m", "app.mcp"],
        cwd=BACKEND,
        env={**os.environ, "PATENT_PROJECTS_DIR": str(projects), **env},
    )


def _tool_error(res):
    """ToolError 文本 = 'Error executing tool X: {error_detail JSON}'。"""
    assert res.is_error, res
    return json.loads(res.content[0].text.split(": ", 1)[1])


async def _flow(c, pid="method"):
    """list_tools → read_book → patch_block(建议) → lint → build（docs/plan/10 §9）。"""
    names = [t.name for t in (await c.list_tools()).tools]
    book = (await c.call_tool("read_book", {"pid": pid, "book": "claims"})).structured_content
    ast = (await c.call_tool("get_ast", {"pid": pid})).structured_content
    c1 = ast["claims"][0]
    lines = [s["text"] for s in c1["segments"]]
    lines[0] = lines[0].replace("私钥生成方法，", "私钥生成方法及流程，", 1)
    patched = await c.call_tool("patch_block", {"pid": pid, "block_id": c1["id"], "markdown": "\n".join(lines)})
    markup = (await c.call_tool("read_book", {"pid": pid, "book": "claims", "mode": "markup"})).structured_content
    final = (await c.call_tool("read_book", {"pid": pid, "book": "claims"})).structured_content
    lint = (await c.call_tool("lint", {"pid": pid})).structured_content
    build = (await c.call_tool("build", {"pid": pid, "pdf": False})).structured_content
    return {
        "names": names,
        "book": book,
        "block": c1,
        "patched": patched,
        "markup": markup["text"],
        "final": final["text"],
        "lint": lint,
        "build": build,
    }


def _assert_flow(f, pid="method"):
    assert f["names"] == list(schemas.TOOL_NAMES)
    assert f["book"]["pid"] == pid and f["book"]["book"] == "claims" and f["book"]["text"].startswith("\n1.")
    assert f["patched"].is_error is False
    patched = f["patched"].structured_content
    assert patched["mode"] == "suggest" and patched["block_id"] == "claims/1"
    assert len(f["patched"].structured_content["sha"]) == 40
    assert "私钥生成方法{++及流程++}，" in f["markup"]  # 默认 CriticMarkup 建议：只标差异
    assert "私钥生成方法及流程，" in f["final"] and "{++" not in f["final"]  # final = 接受后
    assert f["lint"]["counts"]["error"] == 0 and isinstance(f["lint"]["diagnostics"], list)
    assert not [d for d in f["lint"]["diagnostics"] if d["id"].startswith("critic.")]  # 建议标记本身合法
    assert f["build"]["status"] == "ok" and f["build"]["docx_url"].startswith(f"/api/projects/{pid}/builds/")
    assert f["build"]["pdf_url"] is None


def _audit_tools(projects, pid="method"):
    return [r["tool"] for r in reversed(audit.tail(str(projects / pid), 100))]


# ---------------------------------------------------------------- 契约 ----


def test_schema_contract_names():
    assert len(schemas.TOOL_NAMES) == 74  # 15+图源4+W4-E 9+批1生命周期37+list_audit+admin 6+批4查新 2
    assert {"list_figures", "set_figure_order", "set_figure_width", "put_figure_source", "get_figure_source"} <= set(
        schemas.TOOL_NAMES
    )
    assert schemas.TOOL_NAMES[:15] == (
        "list_projects",
        "read_book",
        "get_ast",
        "get_docs",
        "patch_block",
        "insert_block",
        "lint",
        "preflight",
        "build",
        "export_xml",
        "add_comment",
        "get_history",
        "list_figures",
        "set_figure_order",
        "set_figure_width",
    )
    assert schemas.RESOURCE_TEMPLATE == "patent://{pid}/docs/{book}"
    assert schemas.PatchIn(pid="p", block_id="claims/1", markdown="x").direct is False
    with pytest.raises(ValueError):
        schemas.BookOut(pid="p", book="figures", text="")


def test_suggest_diff_marks_only_the_change():
    assert suggest(["甲乙丙"], ["甲丁丙"]) == ["甲{~~乙~>丁~~}丙"]
    assert suggest(["甲乙"], ["甲乙丙"]) == ["甲乙{++丙++}"]
    assert suggest(["甲乙丙"], ["甲丙"]) == ["甲{--乙--}丙"]
    assert suggest(["a", "b"], ["a"]) == ["a", "{--b--}"]
    assert suggest(["a"], ["a", "b", "c"]) == ["a", "{++b++}", "{++c++}"]
    assert suggest(["a", "b"], ["a", "b"]) == ["a", "b"]


def test_pat_token_shape():
    t = new_token()
    assert t.startswith("pat_") and len(t) == 36
    assert len(token_hash(t)) == 64 and token_hash(t) != token_hash(new_token())


def test_audit_record_and_tail(tmp_path):
    d = str(tmp_path)
    audit.record(d, "local", "patch_block", {"block_id": "claims/1", "direct": False, "markdown_len": 12}, "ok")
    audit.record(d, "local", "build", {"mode": "final"}, "error:settings")
    rows = audit.tail(d, 10)
    assert [r["tool"] for r in rows] == ["build", "patch_block"]
    assert set(rows[0]) == {"ts", "who", "tool", "args", "result"}
    assert audit.tail(str(tmp_path / "none"), 10) == []


# ---------------------------------------------------------------- AUTH=off ----


def test_http_streamable_at_exact_path_raw_jsonrpc(off):
    main, _ = off
    with TestClient(main.app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 40000)) as c:
        r = c.post("/mcp", json=INIT, headers=HEADERS)
        assert r.status_code == 200 and r.headers["mcp-session-id"]
        h = {**HEADERS, "mcp-session-id": r.headers["mcp-session-id"]}
        c.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=h)
        r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, headers=h)
        tools = json.loads(r.text.split("data: ", 1)[1].split("\n", 1)[0])["result"]["tools"]
        assert [t["name"] for t in tools] == list(schemas.TOOL_NAMES)
        r = c.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "list_projects", "arguments": {}},
            },
            headers=h,
        )
        out = json.loads(r.text.split("data: ", 1)[1].split("\n", 1)[0])["result"]
        assert out["structuredContent"]["result"][0]["id"] == "method"  # HTTP JSON 字段是 structuredContent
        assert c.get("/mcp/").status_code != 307  # 精确路径，不是 Mount 的 /mcp/ 跳转


def test_gate_rejects_remote_without_pat_and_bad_pat(off):
    main, _ = off
    with TestClient(main.app, base_url="http://127.0.0.1:8000", client=("10.0.0.9", 1)) as c:
        r = c.post("/mcp", json=INIT, headers=HEADERS)
        assert r.status_code == 403
        assert r.json()["detail"]["kind"] == "forbidden" and r.json()["detail"]["detail"] == "F1-mcp-server"
        r = c.post("/mcp", json=INIT, headers={**HEADERS, "authorization": "Bearer pat_deadbeef"})
        assert r.status_code == 401 and r.json()["detail"]["kind"] == "unauthorized"
        r = c.post("/mcp", json=INIT, headers={**HEADERS, "authorization": "Bearer nope"})
        assert r.status_code == 401


def test_resolve_actor_matrix_off(off):
    async def run():
        assert await resolve_actor(None, "127.0.0.1") == (LOCAL, 200, "")
        assert await resolve_actor(None, "::1") == (LOCAL, 200, "")
        assert (await resolve_actor(None, "192.168.1.2"))[1] == 403
        assert (await resolve_actor("pat_x", "127.0.0.1"))[1] == 401  # off 模式没有 PAT 表

    asyncio.run(run())
    assert isinstance(PatGate(lambda *a: None), PatGate)


def test_pat_routes_501_when_auth_off(off):
    main, _ = off
    c = TestClient(main.app)
    for r in (c.get("/api/pat"), c.post("/api/pat", json={"name": "codex"}), c.delete("/api/pat/x")):
        assert r.status_code == 501
        d = r.json()["detail"]
        assert d["kind"] == "not_implemented" and d["detail"] == "F1-mcp-server"


def test_stdio_official_client_flow(off):
    _, projects = off

    async def run():
        async with Client(_stdio_params(projects)) as c:
            return await _flow(c)

    f = asyncio.run(run())
    _assert_flow(f)
    assert _audit_tools(projects) == ["read_book", "get_ast", "patch_block", "read_book", "read_book", "lint", "build"]
    rows = audit.tail(str(projects / "method"), 100)
    patch_row = next(r for r in rows if r["tool"] == "patch_block")
    assert patch_row["who"] == "local" and patch_row["args"]["direct"] is False
    assert "markdown" not in patch_row["args"] and patch_row["args"]["markdown_len"] > 100  # 不记全文


def test_http_official_client_flow(off):
    main, projects = off

    async def run():
        async with _http_client(base) as c:
            return await _flow(c)

    with _serve(main.app) as base:
        f = asyncio.run(run())
    _assert_flow(f)
    assert _audit_tools(projects)[:3] == ["read_book", "get_ast", "patch_block"]


def test_in_process_every_tool_and_resource(off):
    """官方 Client 直连 MCPServer 实例（无传输），覆盖 13 个工具 + 资源 + 错误形状。"""
    main, projects = off
    from app.mcp.server import server

    async def run():
        async with Client(server) as c:
            out = {}
            out["projects"] = (await c.call_tool("list_projects", {})).structured_content["result"]
            out["docs"] = (await c.call_tool("get_docs", {"pid": "method"})).structured_content
            ast = (await c.call_tool("get_ast", {"pid": "method"})).structured_content
            out["ast_keys"] = sorted(ast)
            c1 = ast["claims"][0]
            out["insert"] = (
                await c.call_tool("insert_block", {"pid": "method", "kind": "claim", "after_block_id": c1["id"]})
            ).structured_content
            out["insert_md"] = (
                await c.call_tool(
                    "insert_block",
                    {
                        "pid": "method",
                        "kind": "paragraph",
                        "book": "description",
                        "markdown": "新增段落甲。\n新增段落乙。",
                    },
                )
            ).structured_content
            out["markup"] = (
                await c.call_tool("read_book", {"pid": "method", "book": "claims", "mode": "markup"})
            ).structured_content["text"]
            out["desc_markup"] = (await c.call_tool("get_docs", {"pid": "method"})).structured_content["description"]
            out["preflight"] = (await c.call_tool("preflight", {"pid": "method"})).structured_content
            out["xml"] = (await c.call_tool("export_xml", {"pid": "method"})).structured_content
            out["figs"] = (await c.call_tool("list_figures", {"pid": "method"})).structured_content
            out["comment"] = (
                await c.call_tool(
                    "add_comment",
                    {
                        "pid": "method",
                        "body": "请核对步骤一的术语",
                        "anchor": {"block_id": c1["id"], "line": c1["lines"]["start"], "quote": "冻结"},
                    },
                )
            ).structured_content
            out["history"] = (await c.call_tool("get_history", {"pid": "method", "limit": 5})).structured_content
            out["direct"] = (
                await c.call_tool(
                    "patch_block",
                    {"pid": "method", "block_id": "abstract/p1", "markdown": "直接改写的摘要。", "direct": True},
                )
            ).structured_content
            out["abstract"] = (await c.read_resource("patent://method/docs/abstract")).contents[0]
            out["err_pid"] = _tool_error(await c.call_tool("read_book", {"pid": "nope", "book": "claims"}))
            out["err_block"] = _tool_error(
                await c.call_tool("patch_block", {"pid": "method", "block_id": "claims/99", "markdown": "x"})
            )
            out["err_kind"] = _tool_error(
                await c.call_tool("insert_block", {"pid": "method", "kind": "poem", "book": "claims"})
            )
            out["err_anchor"] = _tool_error(
                await c.call_tool("add_comment", {"pid": "method", "anchor": {}, "body": "x"})
            )
            out["templates"] = [t.uri_template for t in (await c.list_resource_templates()).resource_templates]
            return out

    o = asyncio.run(run())
    assert o["projects"][0]["id"] == "method" and "指纹信息" in o["projects"][0]["title"]
    assert set(o["docs"]) == {"pid", "title", "abstract", "claims", "description"}
    assert o["docs"]["claims"].startswith("\n1.")
    assert {"claims", "description", "abstract", "books", "figures"} <= set(o["ast_keys"])
    assert o["insert"]["mode"] == "suggest" and o["insert"]["block_id"] == "claims/2"
    assert "{++2.一种……，其特征在于，++}" in o["markup"]  # 模板整块建议
    assert "{++新增段落甲。++}\n{++新增段落乙。++}" in o["desc_markup"]
    assert o["preflight"]["counts"]["error"] == 0 and o["preflight"]["claim_tree"]
    if shutil.which("pdftoppm"):
        assert o["xml"]["status"] == "ok" and o["xml"]["zip_url"].startswith("/api/projects/method/xml/")
    else:  # 无 poppler 的环境（Windows 本机）只能走到 build 错误——错误形态本身也是契约
        assert o["xml"]["status"] == "error" and o["xml"]["error"]["kind"] == "build"
    assert len(o["figs"]["figures"]) == 3 and o["figs"]["figures"][0]["name"] and "settings" in o["figs"]
    assert o["comment"]["author"] == {"id": None, "name": "本机"} and o["comment"]["resolved"] is False
    assert o["history"]["result"][0]["message"] and len(o["history"]["result"]) <= 5
    assert o["direct"]["mode"] == "direct"
    assert o["abstract"].mime_type == "text/markdown" and o["abstract"].text.strip() == "直接改写的摘要。"
    assert (projects / "method" / "docs" / "abstract.md").read_text(encoding="utf-8").strip() == "直接改写的摘要。"
    assert o["err_pid"] == {"kind": "not_found", "message": "案子不存在：nope", "line": None, "detail": None}
    assert o["err_block"]["kind"] == "stale" and "claims/99" in o["err_block"]["message"]
    assert o["err_kind"]["kind"] == "kind"
    assert o["err_anchor"]["kind"] == "bad_request"
    assert o["templates"] == [schemas.RESOURCE_TEMPLATE]
    tools = _audit_tools(projects)
    assert tools.count("read_book") == 2  # 1 次工具 + 1 次资源
    assert [r for r in audit.tail(str(projects / "method"), 100) if r["result"] != "ok"] and {
        r["result"] for r in audit.tail(str(projects / "method"), 100)
    } == {"ok", "error:stale", "error:kind"}


def test_lifecycle_tools_off(off):
    """批1 生命周期工具面（AUTH=off）：读面 + 写面 + 审计。"""
    main, projects = off
    from app.mcp.server import server

    async def run():
        async with Client(server) as c:
            out = {}
            out["settings"] = (await c.call_tool("get_settings", {"pid": "method"})).structured_content
            out["summary"] = (await c.call_tool("case_summary", {"pid": "method"})).structured_content
            out["deadlines"] = (await c.call_tool("get_deadlines", {"pid": "method"})).structured_content
            out["timeline"] = (await c.call_tool("get_timeline", {"pid": "method", "limit": 5})).structured_content
            out["oa"] = (await c.call_tool("list_oa_rounds", {"pid": "method"})).structured_content
            out["comments"] = (await c.call_tool("list_comments", {"pid": "method"})).structured_content
            out["links"] = (await c.call_tool("list_public_links", {"pid": "method"})).structured_content
            out["proposals"] = (await c.call_tool("get_proposals", {"pid": "method"})).structured_content
            out["jobs"] = (await c.call_tool("list_ai_jobs", {"pid": "method"})).structured_content
            out["errors"] = (await c.call_tool("get_deliver_errors", {"pid": "method"})).structured_content
            out["tags"] = (await c.call_tool("list_tags", {})).structured_content
            out["templates"] = (await c.call_tool("list_templates", {})).structured_content
            await c.call_tool("add_note", {"pid": "method", "body": "mcp 笔记"})
            out["tl2"] = (await c.call_tool("get_timeline", {"pid": "method", "limit": 50})).structured_content
            out["upd_case"] = (
                await c.call_tool("update_case", {"pid": "method", "fields": {"applicants": ["生命周期测试"]}})
            ).structured_content
            out["settings2"] = (
                await c.call_tool("put_settings", {"pid": "method", "settings": {"ai_enabled": True}})
            ).structured_content
            out["settings3"] = (await c.call_tool("get_settings", {"pid": "method"})).structured_content
            out["tag"] = (await c.call_tool("create_tag", {"name": "生命周期标签"})).structured_content
            out["new_pid"] = (await c.call_tool("create_project", {"title": "MCP 新建案"})).structured_content
            out["err_settings"] = _tool_error(await c.call_tool("get_settings", {"pid": "nope"}))
            return out

    o = asyncio.run(run())
    assert "style" in o["settings"] and "applicants" in o["summary"]
    assert isinstance(o["deadlines"]["deadlines"], list)
    for k in ("timeline", "oa", "comments", "links", "proposals", "jobs", "errors", "tags", "templates"):
        assert isinstance(o[k].get("result"), list), k
    assert any(e.get("kind") == "note" and "mcp 笔记" in (e.get("text") or "") for e in o["tl2"]["result"])
    assert o["upd_case"]["applicants"] == ["生命周期测试"]
    assert o["settings2"]["ai_enabled"] is True and o["settings3"]["ai_enabled"] is True
    # merge 语义：未携带键保留
    assert "style" in o["settings3"]
    assert o["tag"]["name"] == "生命周期标签"
    assert o["new_pid"]["pid"] and o["new_pid"]["title"] == "MCP 新建案"
    assert o["err_settings"]["kind"] == "not_found"


def test_audit_route_reads_project_file(off):
    main, projects = off
    audit.record(str(projects / "method"), "local", "lint", {}, "ok")
    r = TestClient(main.app).get("/api/projects/method/audit")
    assert r.status_code == 200 and r.json()[0]["tool"] == "lint"
    assert TestClient(main.app).get("/api/projects/nope/audit").status_code == 404


# ---------------------------------------------------------------- AUTH=on ----


def _register(c, email, password="pw-123456", display_name=""):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "display_name": display_name})
    assert r.status_code == 201, r.text
    return r.json()


def _login(main, email, password="pw-123456"):
    c = TestClient(main.app)
    r = c.post("/api/auth/cookie/login", data={"username": email, "password": password})
    assert r.status_code == 204, r.text
    return c


def _users(main):
    """su（第一个用户 = superuser）/ owner / viewer 三个已登录 client；method 的 owner/viewer 由 su 指派。"""
    anon = TestClient(main.app)
    _register(anon, "su@example.com", display_name="超管")
    _register(anon, "owner@example.com", display_name="张律师")
    _register(anon, "viewer@example.com", display_name="小王")
    su, owner, viewer = (_login(main, f"{n}@example.com") for n in ("su", "owner", "viewer"))
    members = "/api/projects/method/members"
    assert su.put(members, json={"email": "owner@example.com", "role": "owner"}).status_code == 200
    assert owner.put(members, json={"email": "viewer@example.com", "role": "viewer"}).status_code == 200
    return su, owner, viewer


def _pat(c, name="codex"):
    r = c.post("/api/pat", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def test_on_pat_crud_and_gate(on):
    main, _ = on
    anon = TestClient(main.app)
    assert anon.get("/api/pat").status_code == 401
    su, owner, viewer = _users(main)

    created = _pat(owner, "codex 本机")
    assert set(created) == {"id", "name", "prefix", "created_at", "last_used_at", "token"}
    assert created["token"].startswith("pat_") and len(created["token"]) == 36
    assert created["prefix"] == created["token"][:12] and created["last_used_at"] is None
    listed = owner.get("/api/pat").json()
    assert [p["name"] for p in listed] == ["codex 本机"] and "token" not in listed[0]  # 明文只出现一次
    assert viewer.get("/api/pat").json() == []  # 只看自己的
    assert owner.post("/api/pat", json={"name": ""}).status_code == 422

    async def run():
        actor, status, _ = await resolve_actor(created["token"], "10.0.0.9")
        bad = await resolve_actor("pat_" + "0" * 32, "10.0.0.9")
        none = await resolve_actor(None, "127.0.0.1")
        return actor, status, bad[1], none[1]

    actor, status, bad, none = asyncio.run(run())
    assert status == 200 and actor.name == "张律师" and actor.id == created["id"] and actor.superuser is False
    assert bad == 401 and none == 401  # on 模式本机也要令牌
    assert owner.get("/api/pat").json()[0]["last_used_at"] is not None

    # 账号被禁用后 PAT 一并失效（会话登录同样拒禁用用户），恢复后可用
    owner_id = owner.get("/api/users/me").json()["id"]
    assert su.put(f"/api/admin/users/{owner_id}", json={"is_active": False}).status_code == 200

    async def denied():
        return (await resolve_actor(created["token"], "10.0.0.9"))[1]

    assert asyncio.run(denied()) == 401
    assert su.put(f"/api/admin/users/{owner_id}", json={"is_active": True}).status_code == 200
    assert asyncio.run(denied()) == 200

    # 远程 HTTP：Bearer 有效 PAT 放行；撤销后 401；别人不能撤销我的；重复撤销幂等
    with TestClient(main.app, base_url="http://127.0.0.1:8000", client=("10.0.0.9", 1)) as c:
        h = {**HEADERS, "authorization": f"Bearer {created['token']}"}
        assert c.post("/mcp", json=INIT, headers=h).status_code == 200
        assert viewer.delete(f"/api/pat/{created['id']}").status_code == 404
        assert owner.delete(f"/api/pat/{created['id']}").status_code == 204
        assert owner.delete(f"/api/pat/{created['id']}").status_code == 204
        assert owner.get("/api/pat").json() == []
        r = c.post("/mcp", json=INIT, headers=h)
        assert r.status_code == 401 and r.json()["detail"]["kind"] == "unauthorized"
        assert c.post("/mcp", json=INIT, headers=HEADERS).status_code == 401


def test_on_http_official_client_roles_and_audit(on):
    main, projects = on
    su, owner, viewer = _users(main)
    owner_tok, viewer_tok, su_tok = _pat(owner)["token"], _pat(viewer)["token"], _pat(su)["token"]
    anon = TestClient(main.app)
    _register(anon, "stranger@example.com")
    stranger_tok = _pat(_login(main, "stranger@example.com"))["token"]

    async def run(base):
        out = {}
        async with _http_client(base, viewer_tok) as c:
            out["viewer_flow"] = await _flow(c)
            out["viewer_direct"] = _tool_error(
                await c.call_tool(
                    "patch_block", {"pid": "method", "block_id": "abstract/p1", "markdown": "x", "direct": True}
                )
            )
            out["viewer_insert_direct"] = _tool_error(
                await c.call_tool(
                    "insert_block", {"pid": "method", "kind": "paragraph", "book": "description", "direct": True}
                )
            )
            out["viewer_comment"] = (
                await c.call_tool(
                    "add_comment",
                    {
                        "pid": "method",
                        "body": "viewer 也能批注",
                        "anchor": {"block_id": "claims/1", "line": 9, "quote": "冻结"},
                    },
                )
            ).structured_content
        async with _http_client(base, owner_tok) as c:
            out["owner_direct"] = (
                await c.call_tool(
                    "patch_block",
                    {"pid": "method", "block_id": "abstract/p1", "markdown": "owner 直改摘要。", "direct": True},
                )
            ).structured_content
            out["owner_projects"] = (await c.call_tool("list_projects", {})).structured_content["result"]
        async with _http_client(base, su_tok) as c:
            out["su_projects"] = (await c.call_tool("list_projects", {})).structured_content["result"]
            out["su_direct"] = (
                await c.call_tool(
                    "insert_block",
                    {
                        "pid": "method",
                        "kind": "paragraph",
                        "book": "description",
                        "markdown": "超管直插。",
                        "direct": True,
                    },
                )
            ).structured_content
        async with _http_client(base, stranger_tok) as c:
            out["stranger_projects"] = (await c.call_tool("list_projects", {})).structured_content["result"]
            out["stranger_read"] = _tool_error(await c.call_tool("read_book", {"pid": "method", "book": "claims"}))
        return out

    with _serve(main.app) as base:
        o = asyncio.run(run(base))
    _assert_flow(o["viewer_flow"])
    assert o["viewer_direct"]["kind"] == "forbidden" and "editor" in o["viewer_direct"]["message"]
    assert o["viewer_insert_direct"]["kind"] == "forbidden"
    assert o["viewer_comment"]["author"]["name"] == "小王" and o["viewer_comment"]["author"]["id"]
    assert o["owner_direct"]["mode"] == "direct" and o["su_direct"]["mode"] == "direct"
    assert [p["id"] for p in o["owner_projects"]] == ["method"] == [p["id"] for p in o["su_projects"]]
    assert o["stranger_projects"] == [] and o["stranger_read"]["kind"] == "forbidden"
    rows = audit.tail(str(projects / "method"), 200)
    assert {r["who"] for r in rows} == {"小王", "张律师", "超管"}  # stranger 未过 ACL，不进该案审计
    who = {(r["who"], r["tool"], r["result"]) for r in rows}
    assert ("小王", "patch_block", "error:forbidden") in who and ("小王", "patch_block", "ok") in who
    assert ("张律师", "patch_block", "ok") in who and ("超管", "insert_block", "ok") in who
    assert (projects / "method" / "docs" / "abstract.md").read_text(encoding="utf-8").strip() == "owner 直改摘要。"


def test_on_stdio_requires_pat_env(on):
    main, projects = on
    su, owner, viewer = _users(main)
    tok = _pat(owner)["token"]
    env = {"PATENT_STUDIO_AUTH": "on", "PATENT_STUDIO_SECRET": SECRET}

    async def run():
        async with Client(_stdio_params(projects, PATENT_STUDIO_PAT=tok, **env)) as c:
            names = [t.name for t in (await c.list_tools()).tools]
            book = (await c.call_tool("read_book", {"pid": "method", "book": "abstract"})).structured_content
            return names, book

    names, book = asyncio.run(run())
    assert names == list(schemas.TOOL_NAMES) and "指纹信息" in book["text"]
    assert audit.tail(str(projects / "method"), 1)[0]["who"] == "张律师"

    for pat, msg in ((None, "PATENT_STUDIO_PAT"), ("pat_" + "f" * 32, "无效或已撤销"), ("oops", "pat_ 开头")):
        e = {**os.environ, "PATENT_PROJECTS_DIR": str(projects), "PYTHONIOENCODING": "utf-8", **env}
        e.pop("PATENT_STUDIO_PAT", None)
        if pat:
            e["PATENT_STUDIO_PAT"] = pat
        r = subprocess.run(
            [sys.executable, "-m", "app.mcp"],
            cwd=BACKEND,
            env=e,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        assert r.returncode == 2 and msg in r.stderr, (pat, r.stderr)


# ---------------------------------------------------------------- 批3-C admin ----


def _call_tool(name, args, actor_obj=None):
    """进程内直调工具（注入 Actor）；成功返回结果，业务错返回 {kind,message}。"""
    from mcp.server.mcpserver.exceptions import ToolError

    from app.mcp import server as srv

    async def go():
        try:
            if actor_obj is not None:
                tok = CURRENT_ACTOR.set(actor_obj)
                try:
                    res = await srv.server._tool_manager.call_tool(name, args, None)
                finally:
                    CURRENT_ACTOR.reset(tok)
            else:
                res = await srv.server._tool_manager.call_tool(name, args, None)
        except ToolError as e:
            s = str(e)
            return {"_error": json.loads(s[s.find("{") :])}
        return res

    return asyncio.run(go())


def test_off_admin_tools_unavailable(off):
    assert _call_tool("list_org_members", {})["_error"]["kind"] == "unavailable"


def test_on_admin_tools(on):
    main, projects = on
    su, owner, viewer = _users(main)
    from app.domain import org_audit

    org_audit.install()  # test_w5_prep 会 events.reset()（test_org_audit 同款）
    su_id = su.get("/api/users/me").json()["id"]
    viewer_id = viewer.get("/api/users/me").json()["id"]
    plain = Actor(id="u-x", name="小王", user_id=viewer_id, superuser=False)
    boss = Actor(id="u-su", name="超管", user_id=su_id, superuser=True)

    # 非超管 → forbidden(superuser)
    assert _call_tool("list_org_members", {}, plain)["_error"]["kind"] == "forbidden"

    members = _call_tool("list_org_members", {}, boss)
    assert {"su@example.com", "owner@example.com", "viewer@example.com"} <= {m["email"] for m in members}
    assert all("hashed_password" not in m for m in members)

    # 自己降级自己 → conflict；别人降唯一超管 → 至少保留一位（两个独立闸）
    assert "自己" in _call_tool("update_org_member", {"user_id": su_id, "is_active": False}, boss)["_error"]["message"]
    other_admin = Actor(id="u-z", name="另管", user_id="other-admin-id", superuser=True)
    assert (
        "至少保留"
        in _call_tool("update_org_member", {"user_id": su_id, "is_superuser": False}, other_admin)["_error"]["message"]
    )

    # 授 viewer 超管 → 由 viewer 降 su（自降级闸在 su 自己身上）；admin.user 进机构审计
    out = _call_tool("update_org_member", {"user_id": viewer_id, "is_superuser": True, "title": "合伙人"}, boss)
    assert out["is_superuser"] is True and out["title"] == "合伙人"
    promoted = Actor(id="u-v", name="小V", user_id=viewer_id, superuser=True)
    out = _call_tool("update_org_member", {"user_id": su_id, "is_superuser": False}, promoted)
    assert out["is_superuser"] is False

    aud = _call_tool("list_org_audit", {"kind": "admin.user", "limit": 10}, boss)
    assert any(it["kind"] == "admin.user" for it in aud["items"])
    # org 级写落 <projects>/.studio/.studio/audit.jsonl（lifecycle ORG_DIR 存量口径）
    rows = [
        json.loads(ln)
        for ln in (projects / ".studio" / ".studio" / "audit.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(r["tool"] == "update_org_member" for r in rows)

    # 机构设置读写（merge 语义）
    cur = _call_tool("get_org_settings", {}, boss)
    out = _call_tool("put_org_settings", {"patch": {"ai_daily_tokens": 12345}}, boss)
    assert out["ai_daily_tokens"] == 12345
    again = _call_tool("get_org_settings", {}, boss)
    assert again["ai_daily_tokens"] == 12345 and set(cur) <= set(again)

    nm = _call_tool("set_org_name", {"name": "  沃客专利  "}, boss)
    assert nm["name"] == "沃客专利"
