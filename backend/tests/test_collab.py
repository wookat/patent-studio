# -*- coding: utf-8 -*-
"""R8 协同（docs/plan/11 §7/§9）。prep 锁定：路由形状（off / WebSocket 拒绝）、save_content 钩子与 backup 开关、
服务端替换全文的字节偏移法则。G1：真实房间 —— uvicorn 起在线程里，`websockets` 客户端 + pycrdt `Provider`
跑 y-websocket 协议：初始化自磁盘、两端并发编辑收敛并写回（装配律成立）、去抖一次、外部 PUT 广播、
viewer 丢写、AUTH=on 握手、空房释放先落盘。"""

import asyncio
import contextlib
import importlib
import os
import shutil
import socket
import sys
import threading
import time

import httpx
import pytest
import uvicorn
import websockets
from fastapi.testclient import TestClient
from pycrdt import (
    Awareness,
    Doc,
    Provider,
    Text,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    read_message,
)
from starlette.websockets import WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

from app.collab import BOOKS, DEBOUNCE_S, IDLE_RELEASE_S, on_saved, rooms
from app.collab.text import apply_full_text
from app.domain import history
from patent_studio.kernel import docset

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SECRET = "test-secret-not-for-production-32bytes+"
FAST = 0.15  # 测试用去抖（秒）


def _reload_app(auth):
    """config → 丢弃 auth 子模块（on 时按新 DB_PATH 重新 import）→ auth 包 → router → projects/build/xml_export
    → mcp.tools / server（其 ProjectStore 须指向本用例的 PROJECTS_DIR）→ main。"""
    import app.auth
    import app.auth.router
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod
    from app.mcp import server as mcp_server
    from app.mcp import tools as mcp_tools

    importlib.reload(config)
    if auth:
        for name in ("db", "users", "acl", "schemas", "create_user"):
            sys.modules.pop(f"app.auth.{name}", None)
            app.auth.__dict__.pop(name, None)
        importlib.reload(app.auth)
        importlib.reload(app.auth.router)
    for m in (projects_mod, build, xml_export, mcp_tools, mcp_server):
        importlib.reload(m)
    return importlib.reload(main), projects_mod


@pytest.fixture()
def env(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    monkeypatch.setattr(rooms, "DEBOUNCE_S", FAST)
    state = {"auth": False}

    def make(collab="on", auth=False):
        monkeypatch.setenv("PATENT_STUDIO_COLLAB", collab)
        if auth:
            monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
            monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
            state["auth"] = True
        main, projects_mod = _reload_app(auth)
        return TestClient(main.app), projects / "method", projects_mod

    yield make
    _shutdown_rooms()
    if state["auth"]:
        monkeypatch.delenv("PATENT_STUDIO_AUTH")
        monkeypatch.delenv("PATENT_STUDIO_SECRET")
        _reload_app(True)


def _shutdown_rooms():
    room = next(iter(rooms.ROOMS.values()), None)
    if room is None:
        return
    if room.loop.is_running():
        asyncio.run_coroutine_threadsafe(rooms.shutdown(), room.loop).result(10)
    rooms.ROOMS.clear()


@contextlib.contextmanager
def serve(app, lifespan="off"):
    """uvicorn 起在线程里（真实 WebSocket 栈）；yield http base url。lifespan="on" 时 /mcp 会话管理器随进程起。"""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan=lifespan))
    th = threading.Thread(target=srv.run, kwargs={"sockets": [sock]}, daemon=True)
    th.start()
    deadline = time.time() + 10
    while not srv.started:
        assert time.time() < deadline, "uvicorn 未启动"
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        _shutdown_rooms()
        srv.should_exit = True
        th.join(10)


class WsChannel:
    """pycrdt Channel 协议套在 websockets 客户端连接上。"""

    def __init__(self, ws, path):
        self.ws, self.path = ws, path
        self.synced = False  # 收到服务端 SYNC_STEP2 —— 已拿到房间初始文本

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            msg = await self.ws.recv()
        except ConnectionClosed:
            raise StopAsyncIteration()
        if msg[0] == YMessageType.SYNC and msg[1] == YSyncMessageType.SYNC_STEP2:
            self.synced = True
        return msg

    async def send(self, message):
        await self.ws.send(message)

    async def recv(self):
        return await self.ws.recv()


def _ws_url(base, book, pid="method"):
    return base.replace("http://", "ws://") + f"/api/projects/{pid}/collab/{book}"


@contextlib.asynccontextmanager
async def client(base, book, cookie=None, pid="method"):
    doc = Doc()
    doc["content"] = text = Text()
    headers = {"Cookie": f"studio_session={cookie}"} if cookie else None
    async with websockets.connect(_ws_url(base, book, pid), additional_headers=headers) as ws:
        ch = WsChannel(ws, book)
        async with Provider(doc, ch):
            await until(lambda: ch.synced)
            yield text


async def until(pred, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not pred():
        assert time.monotonic() < deadline, "等待超时"
        await asyncio.sleep(0.02)


async def rejected(base, book, cookie=None, pid="method"):
    """accept 后被 close(1008, reason)：返回 reason。"""
    headers = {"Cookie": f"studio_session={cookie}"} if cookie else None
    async with websockets.connect(_ws_url(base, book, pid), additional_headers=headers) as ws:
        with pytest.raises(ConnectionClosed) as ei:
            await ws.recv()
    assert ei.value.rcvd.code == 1008
    return ei.value.rcvd.reason


def read(p):
    # 与 store.read_content 同口径（universal newlines）——CRLF 工作区磁盘原文不逐字相等
    with open(p, encoding="utf-8") as f:
        return f.read()


# --- 路由形状 ---


def test_status_enabled_lists_active_rooms(env):
    c, _, _ = env("on")
    assert c.get("/api/projects/method/collab").json() == {
        "enabled": True,
        "readonly": False,
        "mode": "edit",
        "rooms": [],
    }


def test_status_disabled_when_off(env):
    c, _, _ = env("off")
    assert c.get("/api/projects/method/collab").json() == {
        "enabled": False,
        "readonly": False,
        "mode": "edit",
        "rooms": [],
    }


@pytest.mark.parametrize("collab,book,reason", [("on", "nosuchbook", "bad_book"), ("off", "claims", "collab_off")])
def test_ws_rejected_after_accept_with_1008(env, collab, book, reason):
    """先 accept 再 close(1008, reason)：客户端能读到 code（握手前拒绝浏览器只见 1006，11 §3.4）。"""
    c, _, _ = env(collab)
    with c.websocket_connect(f"/api/projects/method/collab/{book}") as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_bytes()
    assert (ei.value.code, ei.value.reason) == (1008, reason)


def test_ws_unknown_project_rejected(env):
    c, _, _ = env("on")
    with serve(c.app) as base:
        assert asyncio.run(rejected(base, "claims", pid="nope")) == "project:404"


def test_ws_route_is_plain_starlette_route():
    """用 add_websocket_route 而非 @router.websocket：全局依赖 project_access 不能套在 WebSocket 上（11 §0.4）。"""
    from fastapi.routing import APIWebSocketRoute
    from starlette.routing import WebSocketRoute

    from app.collab.routes import router

    ws = [r for r in router.routes if isinstance(r, WebSocketRoute)]
    assert [r.path for r in ws] == ["/api/projects/{pid}/collab/{book}"]
    assert not isinstance(ws[0], APIWebSocketRoute)


def test_constants():
    assert BOOKS == ("abstract", "claims", "description", "content")
    assert DEBOUNCE_S == 0.8 and IDLE_RELEASE_S == 60.0
    assert on_saved("method", "x") is None  # 无活跃房间 ⇒ 无操作


# --- save_content 钩子与 backup 开关 ---


def test_save_content_calls_on_saved_and_backup_switch(env, monkeypatch):
    _, pdir, projects_mod = env("on")
    from app import collab

    seen = []
    monkeypatch.setattr(collab, "on_saved", lambda pid, content: seen.append((pid, len(content))))
    store = projects_mod.ProjectStore(str(pdir.parent))
    md = store.read_content("method") + "\n"
    before = set(os.listdir(pdir))
    assert store.save_content("method", md, backup=False) is None
    assert set(os.listdir(pdir)) - before <= {".studio"}
    name = store.save_content("method", md + "\n")
    assert name and name.startswith("content.md.bak-") and (pdir / name).is_file()
    assert seen == [("method", len(md)), ("method", len(md) + 1)]


# --- 真实房间：uvicorn 线程 + websockets 客户端 + pycrdt Provider ---


def test_room_initialized_from_disk_and_status_counts_peers(env):
    c, pdir, _ = env("on")
    content = read(pdir / "content.md")
    with serve(c.app) as base:

        async def flow():
            async with client(base, "claims") as claims, client(base, "content") as full:
                await until(lambda: str(claims) == docset.split(content).claims)
                await until(lambda: str(full) == content)
                st = httpx.get(f"{base}/api/projects/method/collab").json()
                assert st["enabled"] is True
                assert sorted(st["rooms"], key=lambda r: r["book"]) == [
                    {"book": "claims", "peers": 1},
                    {"book": "content", "peers": 1},
                ]
                assert sorted(rooms.ROOMS) == [("method", "claims"), ("method", "content")]

        asyncio.run(flow())
    assert read(pdir / "content.md") == content  # 只连接不编辑 ⇒ 磁盘不动


def test_new_client_receives_existing_awareness_states(env):
    """后来者连上就该看到先到者（YRoom 只转发不补发，serve 前补一条全量 awareness）。"""
    c, _, _ = env("on")
    with serve(c.app) as base:

        async def flow():
            async with websockets.connect(_ws_url(base, "claims")) as a:
                aw_a = Awareness(Doc())
                aw_a.set_local_state({"user": {"name": "作者"}})
                await a.send(create_awareness_message(aw_a.encode_awareness_update([aw_a.client_id])))
                await a.recv()  # 自身 awareness 回声（YRoom 含自身转发）
                async with websockets.connect(_ws_url(base, "claims")) as b:
                    aw_b = Awareness(Doc())
                    seen = {}
                    for _ in range(3):  # 首批消息：补发 awareness + SYNC_STEP1
                        msg = await asyncio.wait_for(b.recv(), 3)
                        if msg[0] == YMessageType.AWARENESS:
                            aw_b.apply_awareness_update(read_message(msg[1:]), "ws")
                            seen = {k: v for k, v in aw_b.states.items() if k != aw_b.client_id}
                            break
                    assert seen == {aw_a.client_id: {"user": {"name": "作者"}}}

        asyncio.run(flow())


def test_two_clients_concurrent_edit_converge_and_writeback(env):
    """两端同时在不同位置插入 → 三方文本一致 → 去抖写回 docs/claims.md 与 content.md，装配律成立，
    history author=collab，无 .bak。"""
    c, pdir, _ = env("on")
    before = read(pdir / "content.md")
    ds0 = docset.split(before)
    with serve(c.app) as base:

        async def flow():
            async with client(base, "claims") as a, client(base, "claims") as b:
                await until(lambda: str(a) == ds0.claims and str(b) == ds0.claims)
                a.insert(0, "【A 在开头插入】")
                b += "【B 在末尾追加·含 emoji 🙂】\n"
                a.insert(len("【A 在开头插入】".encode()), "α")  # pycrdt 索引是 UTF-8 字节
                expected = "【A 在开头插入】α" + ds0.claims + "【B 在末尾追加·含 emoji 🙂】\n"
                await until(lambda: str(a) == expected and str(b) == expected)
                server_text = rooms.ROOMS[("method", "claims")].text
                assert str(server_text) == expected
                await until(lambda: read(pdir / "docs" / "claims.md") == expected, timeout=FAST * 10 + 5)
                return expected

        expected = asyncio.run(flow())
    after = read(pdir / "content.md")
    assert docset.split(after).claims == expected
    assert docset.assemble(docset.split(after)) == after
    assert after == docset.assemble(docset.replace(ds0, "claims", expected))
    assert not [f for f in os.listdir(pdir) if ".bak-" in f]  # backup=False
    top = history.log(str(pdir))[0]
    assert (top["message"], top["author"]) == ("collab:claims", "collab")


def test_writeback_debounced_once_and_noop_when_unchanged(env, monkeypatch):
    c, pdir, projects_mod = env("on")
    calls = []
    orig = projects_mod.ProjectStore.save_content

    def spy(self, pid, content, backup=True):
        calls.append(backup)
        return orig(self, pid, content, backup)

    monkeypatch.setattr(projects_mod.ProjectStore, "save_content", spy)
    with serve(c.app) as base:

        async def flow():
            async with client(base, "content") as t:
                await until(lambda: str(t).startswith("# "))
                for ch in "去抖五次键入":
                    t += ch
                    await asyncio.sleep(FAST / 4)
                await until(lambda: read(pdir / "content.md").endswith("去抖五次键入"), timeout=FAST * 10 + 5)
                await asyncio.sleep(FAST * 3)
                assert calls == [False]  # 5 次键入只写 1 次，且 backup=False
                room = rooms.ROOMS[("method", "content")]
                room.dirty = True  # 再触发一次 flush：与磁盘一致 ⇒ 不写不 commit
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(room.flush(), room.loop))
                assert calls == [False]

        asyncio.run(flow())
    log = history.log(str(pdir))
    assert log[0]["message"] == "collab:content" and log[0]["author"] == "collab"
    assert sum(1 for v in log if v["message"] == "collab:content") == 1


def test_external_put_broadcasts_to_connected_clients(env):
    """外部 PUT /docs/claims（现有路径）→ save_content → on_saved → 房间替换全文 → 客户端收到新内容。"""
    c, pdir, _ = env("on")
    before = read(pdir / "content.md")
    ds0 = docset.split(before)
    with serve(c.app) as base:

        async def flow():
            async with client(base, "claims") as a, client(base, "content") as full:
                await until(lambda: str(a) == ds0.claims and str(full) == before)
                new_claims = "1. 外部改写后的权利要求。\n2. 根据权利要求1所述的方法。\n"
                r = httpx.put(f"{base}/api/projects/method/docs/claims", json={"content": new_claims})
                assert r.status_code == 200, r.text
                await until(lambda: str(a) == new_claims)
                after = read(pdir / "content.md")
                await until(lambda: str(full) == after)
                assert docset.split(after).claims == new_claims
                await asyncio.sleep(FAST * 3)  # 服务端替换（origin=server）不得触发协同写回
                return after

        after = asyncio.run(flow())
    assert read(pdir / "content.md") == after
    assert [v["message"] for v in history.log(str(pdir))][:1] == ["save"]


def test_mcp_patch_block_broadcasts_to_room(env):
    """波次 3 跨轨道：MCP patch_block（建议模式）→ save_content → on_saved → claims 房间收到带 CriticMarkup 的新文本，
    且服务端替换不触发协同写回（磁盘与审计各一次）。"""
    from mcp.client.client import Client
    from mcp.client.streamable_http import streamable_http_client

    c, pdir, _ = env("on")
    with serve(c.app, lifespan="on") as base:

        async def flow():
            async with client(base, "claims") as a:
                await until(lambda: str(a) != "")
                async with Client(streamable_http_client(base + "/mcp")) as m:
                    ast = (await m.call_tool("get_ast", {"pid": "method"})).structured_content
                    c1 = ast["claims"][0]
                    lines = [s["text"] for s in c1["segments"]]
                    lines[0] = lines[0].replace("私钥生成方法，", "私钥生成方法及流程，", 1)
                    res = await m.call_tool(
                        "patch_block", {"pid": "method", "block_id": c1["id"], "markdown": "\n".join(lines)}
                    )
                    assert res.is_error is False, res
                await until(lambda: "私钥生成方法{++及流程++}" in str(a))
                await asyncio.sleep(FAST * 3)
                return str(a)

        text = asyncio.run(flow())
    assert docset.split(read(pdir / "content.md")).claims == text
    assert not [v for v in history.log(str(pdir)) if v["message"].startswith("collab:")]


def test_client_edit_after_external_put_merges(env):
    """外部改写后客户端继续键入 → 键入落在改写后的文本上并写回（不丢字、不覆盖外部改写）。"""
    c, pdir, _ = env("on")
    with serve(c.app) as base:

        async def flow():
            async with client(base, "abstract") as t:
                await until(lambda: str(t) != "")
                new_abs = "外部改写的摘要。\n"
                httpx.put(f"{base}/api/projects/method/docs/abstract", json={"content": new_abs})
                await until(lambda: str(t) == new_abs)
                t += "客户端续写。\n"
                await until(
                    lambda: docset.split(read(pdir / "content.md")).abstract == new_abs + "客户端续写。\n",
                    timeout=FAST * 10 + 5,
                )

        asyncio.run(flow())


def test_other_book_saved_keeps_pending_keystrokes(env, monkeypatch):
    """abstract 被外部 PUT（claims 正文未变）→ claims 房间未到去抖点的键入不被磁盘文本冲掉，随后连同落盘。"""
    c, pdir, _ = env("on")
    monkeypatch.setattr(rooms, "DEBOUNCE_S", 30.0)
    with serve(c.app) as base:

        async def flow():
            async with client(base, "claims") as t, client(base, "content") as full:
                t += "【未落盘键入】"
                await until(lambda: str(rooms.ROOMS[("method", "claims")].text).endswith("【未落盘键入】"))
                httpx.put(f"{base}/api/projects/method/docs/abstract", json={"content": "新摘要\n"})
                await until(lambda: docset.split(str(full)).abstract == "新摘要\n")  # content 房间收到外部改写
                await asyncio.sleep(0.2)
                assert str(t).endswith("【未落盘键入】") and rooms.ROOMS[("method", "claims")].dirty
                room = rooms.ROOMS[("method", "claims")]
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(room.flush(), room.loop))
                ds = docset.split(read(pdir / "content.md"))
                assert ds.abstract == "新摘要\n" and ds.claims.endswith("【未落盘键入】\n")
                await until(lambda: str(full) == read(pdir / "content.md"))

        asyncio.run(flow())


def test_simultaneous_first_connections_share_one_room(env):
    c, _, _ = env("on")
    with serve(c.app) as base:

        async def flow():
            all_seen = asyncio.Barrier(3)  # 三端都确认 peers==3 后才允许任何一端断开，否则先断的把 peers 拉低

            async def one():
                async with client(base, "claims") as t:
                    await until(lambda: rooms.ROOMS[("method", "claims")].peers == 3)
                    await all_seen.wait()
                    return str(t)

            texts = await asyncio.gather(one(), one(), one())
            assert list(rooms.ROOMS) == [("method", "claims")]
            assert len(set(texts)) == 1 and texts[0] != ""

        asyncio.run(flow())


def test_idle_release_flushes_pending_then_drops_room(env, monkeypatch):
    """最后一个客户端断开 → IDLE_RELEASE_S 后释放；释放前把未到去抖点的输入落盘。"""
    c, pdir, _ = env("on")
    monkeypatch.setattr(rooms, "DEBOUNCE_S", 30.0)  # 去抖永不触发，只能靠释放前 flush
    monkeypatch.setattr(rooms, "IDLE_RELEASE_S", 0.3)
    with serve(c.app) as base:

        async def flow():
            async with client(base, "content") as t:
                await until(lambda: str(t).startswith("# "))
                t += "释放前落盘"
                await until(lambda: str(rooms.ROOMS[("method", "content")].text).endswith("释放前落盘"))
            assert ("method", "content") in rooms.ROOMS
            await until(lambda: ("method", "content") not in rooms.ROOMS, timeout=5)
            # drop() 先从 ROOMS 摘除再 await stop() flush 落盘——以文件内容为就绪信号，否则磁盘忙时读早
            await until(lambda: read(pdir / "content.md").endswith("释放前落盘"), timeout=5)
            # 再连：房间从磁盘重建
            async with client(base, "content") as t2:
                await until(lambda: str(t2).endswith("释放前落盘"))
                assert rooms.ROOMS[("method", "content")].peers == 1

        asyncio.run(flow())


def test_reconnect_within_idle_window_keeps_room(env, monkeypatch):
    c, _, _ = env("on")
    monkeypatch.setattr(rooms, "IDLE_RELEASE_S", 1.0)
    with serve(c.app) as base:

        async def flow():
            async with client(base, "claims"):
                await until(lambda: ("method", "claims") in rooms.ROOMS)
                room = rooms.ROOMS[("method", "claims")]
            await until(lambda: room.release is not None)
            async with client(base, "claims"):
                await until(lambda: room.peers == 1)
                assert room.release is None and rooms.ROOMS[("method", "claims")] is room
            await asyncio.sleep(1.3)
            assert ("method", "claims") not in rooms.ROOMS

        asyncio.run(flow())


def test_offline_edit_then_reconnect_merges(env):
    """A 断开期间本地插入、服务端同时被 B 改写 → A 重连后三方收敛且磁盘 = 合并结果（11 §0 E9 用 pytest 复现）。"""
    c, pdir, _ = env("on")
    with serve(c.app) as base:

        async def flow():
            doc_a = Doc()
            doc_a["content"] = ta = Text()
            async with websockets.connect(_ws_url(base, "claims")) as ws:
                ch = WsChannel(ws, "claims")
                async with Provider(doc_a, ch):
                    await until(lambda: ch.synced and str(ta) != "")
            base_text = str(ta)
            ta += "【A 离线新增】\n"  # 离线编辑
            async with client(base, "claims") as tb:
                await until(lambda: str(tb) == base_text)
                tb.insert(0, "【B 在线开头】")
                await until(
                    lambda: read(pdir / "docs" / "claims.md") == "【B 在线开头】" + base_text, timeout=FAST * 10 + 5
                )
                async with websockets.connect(_ws_url(base, "claims")) as ws:
                    ch = WsChannel(ws, "claims")
                    async with Provider(doc_a, ch):
                        merged = "【B 在线开头】" + base_text + "【A 离线新增】\n"
                        await until(lambda: str(ta) == merged and str(tb) == merged)
                        await until(lambda: read(pdir / "docs" / "claims.md") == merged, timeout=FAST * 10 + 5)

        asyncio.run(flow())


# --- AUTH=on：握手鉴权与 viewer 只读 ---


def _register(base, email, display_name=""):
    r = httpx.post(
        f"{base}/api/auth/register", json={"email": email, "password": "pw-123456", "display_name": display_name}
    )
    assert r.status_code == 201, r.text
    return r.json()


def _login(base, email):
    r = httpx.post(f"{base}/api/auth/cookie/login", data={"username": email, "password": "pw-123456"})
    assert r.status_code == 204, r.text
    return r.cookies["studio_session"]


def test_auth_on_handshake_roles_and_viewer_readonly(env):
    c, pdir, _ = env("on", auth=True)
    from app import config

    assert config.AUTH_ON
    ds0 = docset.split(read(pdir / "content.md"))
    with serve(c.app) as base:
        _register(base, "su@example.com", "管理员")
        _register(base, "editor@example.com", "代理人")
        _register(base, "viewer@example.com")
        _register(base, "stranger@example.com")
        su, editor, viewer, stranger = (
            _login(base, f"{n}@example.com") for n in ("su", "editor", "viewer", "stranger")
        )
        for email, role in (("editor@example.com", "editor"), ("viewer@example.com", "viewer")):
            r = httpx.put(
                f"{base}/api/projects/method/members",
                json={"email": email, "role": role},
                cookies={"studio_session": su},
            )
            assert r.status_code == 200, r.text
        for cookie, ro in ((su, False), (editor, False), (viewer, True)):
            st = httpx.get(f"{base}/api/projects/method/collab", cookies={"studio_session": cookie})
            assert (st.status_code, st.json()["readonly"]) == (200, ro)

        async def flow():
            assert await rejected(base, "claims") == "forbidden"  # 无 cookie
            assert await rejected(base, "claims", cookie="bogus") == "forbidden"
            assert await rejected(base, "claims", cookie=stranger) == "forbidden"  # 非成员
            async with client(base, "claims", cookie=editor) as te, client(base, "claims", cookie=viewer) as tv:
                await until(lambda: str(te) == ds0.claims and str(tv) == ds0.claims)
                tv.insert(0, "【viewer 试图写入】")
                te += "【editor 追加】\n"
                expected = ds0.claims + "【editor 追加】\n"
                await until(lambda: str(te) == expected)
                await asyncio.sleep(FAST * 2)
                assert str(rooms.ROOMS[("method", "claims")].text) == expected  # viewer 的写入被丢弃
                await until(lambda: read(pdir / "docs" / "claims.md") == expected, timeout=FAST * 10 + 5)
                # viewer 仍收到广播（本地被丢弃的插入仍留在其本地 Doc 中，其余与服务端一致）
                assert str(tv).replace("【viewer 试图写入】", "") == expected
            async with client(base, "claims", cookie=su) as ts:  # superuser 无 ACL 行也放行
                await until(lambda: str(ts) == expected)

        asyncio.run(flow())
    top = history.log(str(pdir))[0]
    assert (top["message"], top["author"]) == ("collab:claims", "代理人")


# --- 服务端替换全文（UTF-8 字节偏移）---


def _ytext(s):
    doc = Doc()
    doc["text"] = t = Text()
    t += s
    return t


@pytest.mark.parametrize(
    "old,new",
    [
        ("1. 一种装置，其特征在于：\n", "1. 一种装置，其特征在于：\n2. 根据权利要求1所述的装置。\n"),
        ("1. 一种装置，其特征在于：\n", "【前缀】1. 一种装置，其特征在于：\n"),
        ("1. 一种装置，其特征在于：\n2. 根据权利要求1所述的装置。\n", "1. 一种装置，其特征在于：\n"),
        (
            "1. 一种装置，其特征在于：\n2. 根据权利要求1所述的装置。\n",
            "1. 外部改写后的权利要求。\n2. 根据权利要求1所述的装置。\n",
        ),
        ("α β γ 中文 emoji 🙂 end", "α γ 中文 emoji 🙃 end!"),
        ("", "从空开始"),
        ("全删", ""),
    ],
)
def test_apply_full_text_multibyte(old, new):
    t = _ytext(old)
    assert apply_full_text(t, new, origin="server") is True
    assert str(t) == new


def test_apply_full_text_noop_and_minimal_edit():
    t = _ytext("摘要 300 字")
    assert apply_full_text(t, "摘要 300 字") is False
    seen = []
    t.observe(lambda ev: seen.append(ev.delta))
    apply_full_text(t, "摘要 299 字")
    # 只动了差异段，未变前缀以 retain 保留（远端光标不跳）
    assert seen and seen[0][0] == {"retain": len("摘要 ".encode())}


def test_examples_roundtrip_through_apply_full_text():
    """两案全文互换：任何字符组合都能被差分应用到位。"""
    a = read(os.path.join(ROOT, "examples", "method", "content.md"))
    b = read(os.path.join(ROOT, "examples", "system", "content.md"))
    t = _ytext(a)
    apply_full_text(t, b)
    assert str(t) == b
    apply_full_text(t, a)
    assert str(t) == a


# --- Y 文档身份持久化：房间重建后旧 Y.Doc 重连不成双份 ---


@pytest.mark.parametrize("rebuild", ["idle_release", "restart"])
def test_room_rebuilt_from_persisted_state_no_duplicate_on_reconnect(env, monkeypatch, rebuild):
    """A 持有 Y.Doc 期间房间被重建（闲置释放 / 进程重启 = shutdown 全部房间）→ A 重连后正文 = 磁盘，不是双份。"""
    c, pdir, _ = env("on")
    monkeypatch.setattr(rooms, "IDLE_RELEASE_S", 0.3)
    with serve(c.app) as base:

        async def flow():
            doc_a = Doc()
            doc_a["content"] = ta = Text()
            async with websockets.connect(_ws_url(base, "claims")) as ws:
                ch = WsChannel(ws, "claims")
                async with Provider(doc_a, ch):
                    await until(lambda: ch.synced and str(ta) != "")
                    ta += "【A 在线新增】\n"
                    await until(
                        lambda: read(pdir / "docs" / "claims.md").endswith("【A 在线新增】\n"), timeout=FAST * 10 + 5
                    )
            state_file = pdir / ".studio" / "collab" / "claims.ybin"
            if rebuild == "idle_release":
                await until(lambda: ("method", "claims") not in rooms.ROOMS, timeout=5)
            else:
                await asyncio.to_thread(_shutdown_rooms)  # 跑在服务端事件循环上，等同进程退出时的 lifespan 收尾
            assert state_file.exists()
            disk = read(pdir / "docs" / "claims.md")
            ta += "【A 离线新增】\n"  # 房间不在时 A 又改了一笔
            async with websockets.connect(_ws_url(base, "claims")) as ws:
                ch = WsChannel(ws, "claims")
                async with Provider(doc_a, ch):
                    want = disk + "【A 离线新增】\n"
                    await until(lambda: str(ta) == want)
                    await until(lambda: read(pdir / "docs" / "claims.md") == want, timeout=FAST * 10 + 5)
            assert str(ta).count("【A 在线新增】") == 1
            assert str(ta).count("# 权利要求书") <= 1

        asyncio.run(flow())


def test_persisted_state_unreadable_falls_back_to_fresh_doc(env):
    c, pdir, _ = env("on")
    sf = pdir / ".studio" / "collab" / "content.ybin"
    sf.parent.mkdir(parents=True, exist_ok=True)
    sf.write_bytes(b"\xff\x00garbage")
    with serve(c.app) as base:

        async def flow():
            async with client(base, "content") as t:
                await until(lambda: str(t) == read(pdir / "content.md"))

        asyncio.run(flow())
