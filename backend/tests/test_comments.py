# -*- coding: utf-8 -*-
"""C2：批注线程存储/重锚 + /critic、/comments 路由 + 含标记样例三模式构建与 XML 导出（07 §4.2、§6）。"""
import io
import json
import os
import shutil
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.domain import comments as cm
from patent_studio.kernel import critic
from patent_studio.kernel.ast import parse_ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _read(pid):
    # 与 read_content 同口径（universal newlines）——CRLF 工作区下 \n 定位/插入才一致
    with open(os.path.join(ROOT, "examples", pid, "content.md"), encoding="utf-8") as f:
        return f.read()


def marked_method():
    """examples/method 加五种标记：标题替换、摘要插入/删除/批注、权1 高亮、公式替换、表格无（案子无表）。"""
    lines = _read("method").split("\n")
    assert lines[0].startswith("# ") and lines[4].startswith("本发明公开了")
    lines[0] = lines[0].replace("方法及装置", "{~~方法及装置~>方法及系统~~}")
    lines[4] = lines[4].replace("本发明公开了一种", "本发明{++首次++}公开了{--一种--}{>>摘要首句待商议<<}", 1)
    i = next(k for k, ln in enumerate(lines) if ln.startswith("1.一种"))
    lines[i] = lines[i].replace("其特征在于", "{==其特征在于==}", 1)
    j = next(k for k, ln in enumerate(lines) if ln.startswith("$$"))
    lines[j] = lines[j].replace("$$", "$$Z_{~~old~>new~~}=", 1)
    src = "\n".join(lines)
    assert critic.has_markup(src) and len(critic.parse(src)) == 6
    return src


# ---------------- 存储 ----------------

def test_load_missing_is_empty(tmp_path):
    assert cm.load(str(tmp_path)) == []


def test_save_load_roundtrip_and_json_shape(tmp_path):
    c = cm.create(cm.Anchor("claims/1", 9, "其特征在于"), "权项主题不清", cm.LOCAL_AUTHOR)
    cm.reply(c, "已改", cm.LOCAL_AUTHOR)
    cm.resolve(c, True)
    cm.save(str(tmp_path), [c])
    p = tmp_path / "reviews" / "comments.json"
    raw = p.read_text(encoding="utf-8")
    assert "权项主题不清" in raw and "\\u" not in raw  # ensure_ascii=False
    data = json.loads(raw)
    assert isinstance(data, list) and data[0]["author"] == {"id": None, "name": "本机"}
    assert data[0]["anchor"] == {"block_id": "claims/1", "line": 9, "quote": "其特征在于", "stale": False}
    assert data[0]["resolved"] is True and data[0]["replies"][0]["body"] == "已改"
    assert cm.load(str(tmp_path)) == [c]


def test_reanchor_quote_moves_and_stale():
    content = _read("method")
    ast = parse_ast(content)
    # 摘要段（全文第 5 行）里选中一句
    a = cm.Anchor("abstract/p1", 5, "冻结基础预测模型并设定安全锚输出")
    b = cm.Anchor("claims/1", 9, "这句话不存在于全文")
    c = cm.Anchor("description/no-such-block", 300, "")
    cs = [cm.create(x, "x", cm.LOCAL_AUTHOR) for x in (a, b, c)]
    cm.reanchor(cs, ast, content)
    assert (cs[0].anchor.line, cs[0].anchor.stale) == (5, False)
    assert (cs[1].anchor.line, cs[1].anchor.stale) == (9, True)          # 块存在、引文丢失：保留 line 标 stale
    assert (cs[2].anchor.line, cs[2].anchor.stale) == (300, True)        # 块不存在
    # 摘要前插入两行 → 引文下移两行，块 id 不变、stale 清除
    moved = content.replace("## 摘要\n", "## 摘要\n\n\n", 1)
    cs[0].anchor.line = 5
    cm.reanchor(cs[:1], parse_ast(moved), moved)
    assert (cs[0].anchor.block_id, cs[0].anchor.line, cs[0].anchor.stale) == ("abstract/p1", 7, False)
    # 引文搬到别的块（权1 末尾）→ 按全文搜到并改 block_id
    head = "1.一种时间序列预测模型"
    claim_moved = content.replace("冻结基础预测模型并设定安全锚输出", "", 1)
    claim_moved = claim_moved.replace(head, head + "（冻结基础预测模型并设定安全锚输出）", 1)
    cm.reanchor(cs[:1], parse_ast(claim_moved), claim_moved)
    assert cs[0].anchor.block_id == "claims/1" and cs[0].anchor.stale is False


# ---------------- 路由 ----------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*", "reviews"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("LO_PROFILE_DIR", str(tmp_path / "lo"))
    import importlib

    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(build)
    importlib.reload(xml_export)
    importlib.reload(main)
    return TestClient(main.app), projects


def test_critic_route_body_and_saved(client):
    c, _ = client
    r = c.post("/api/projects/method/critic", json={"content": "A{++B++}C"})
    assert r.status_code == 200
    assert r.json() == {"marks": [{"id": "1:1", "kind": "ins", "line": 1, "from": 1, "to": 8,
                                   "a": "", "b": "B", "final": "B", "original": "",
                                   "author": None, "at": None}]}
    assert c.post("/api/projects/method/critic", json={}).json() == {"marks": []}  # 两案无标记


def test_critic_marks_carry_author_and_time(client):
    """W11 C14：落盘时新出现的标记记「作者 · 时间」（reviews/marks.json），/critic 带回；接受后清掉。"""
    from app.domain import review_meta

    c, projects = client
    d = str(projects / "method")
    content = c.get("/api/projects/method/content").json()["content"]
    new = content.replace("本发明公开了一种", "本发明{++首次++}公开了{~~一种~>一类~~}", 1)
    # 落盘钩子（save_content 内）：新出现的标记按当前写入者记录
    with review_meta.writer("张代理"):
        review_meta.record(d, content, new)
    meta = review_meta.load(d)
    assert len(meta) == 2 and {v["author"] for v in meta.values()} == {"张代理"}
    at0 = next(iter(meta.values()))["at"]
    # 再改一处、只多一条：老标记的时间不变，新标记归新作者；显式 author 参数优先于上下文
    newer = new.replace("模型", "{--模型--}", 1)
    review_meta.record(d, new, newer, author="李审核")
    marks = review_meta.attach(d, critic.parse(newer))
    by_kind = {m["kind"]: m for m in marks}
    assert (by_kind["ins"]["author"], by_kind["ins"]["at"]) == ("张代理", at0)
    assert by_kind["del"]["author"] == "李审核" and isinstance(by_kind["del"]["at"], float)
    # 走路由：auth=off ⇒ 写入者为 None，但 /critic 仍按内容 key 带回已记录的作者
    assert c.put("/api/projects/method/content", json={"content": newer}).status_code == 200
    via_api = c.post("/api/projects/method/critic", json={}).json()["marks"]
    assert sorted(m["author"] for m in via_api) == ["张代理", "张代理", "李审核"]
    # 全部接受落盘 → 元数据文件随之清空
    c.put("/api/projects/method/content", json={"content": critic.accept(newer)})
    assert review_meta.load(d) == {} and not os.path.exists(os.path.join(d, review_meta.FILE))


def test_comments_crud_reply_resolve(client):
    c, projects = client
    assert c.get("/api/projects/method/comments").json() == []
    r = c.post("/api/projects/method/comments",
               json={"anchor": {"block_id": "abstract/p1", "line": 5, "quote": "安全锚输出"}, "body": "术语统一"})
    assert r.status_code == 201, r.text
    cmt = r.json()
    cid = cmt["id"]
    assert cmt["author"] == {"id": None, "name": "本机"} and cmt["resolved"] is False and cmt["replies"] == []
    assert cmt["anchor"] == {"block_id": "abstract/p1", "line": 5, "quote": "安全锚输出", "stale": False}
    assert (projects / "method" / "reviews" / "comments.json").is_file()

    r = c.patch(f"/api/projects/method/comments/{cid}", json={"body": "术语统一为「安全锚」"})
    assert r.status_code == 200 and r.json()["body"] == "术语统一为「安全锚」"
    assert r.json()["updated_at"] >= cmt["updated_at"]

    r = c.post(f"/api/projects/method/comments/{cid}/replies", json={"body": "同意"})
    assert r.status_code == 200 and [x["body"] for x in r.json()["replies"]] == ["同意"]
    assert r.json()["replies"][0]["author"]["name"] == "本机"

    r = c.post(f"/api/projects/method/comments/{cid}/resolve", json={})
    assert r.json()["resolved"] is True
    r = c.post(f"/api/projects/method/comments/{cid}/resolve", json={"resolved": False})
    assert r.json()["resolved"] is False

    lst = c.get("/api/projects/method/comments").json()
    assert [x["id"] for x in lst] == [cid] and lst[0]["anchor"]["stale"] is False

    assert c.delete(f"/api/projects/method/comments/{cid}").status_code == 204
    assert c.get("/api/projects/method/comments").json() == []
    assert c.delete(f"/api/projects/method/comments/{cid}").status_code == 404
    assert c.patch(f"/api/projects/method/comments/{cid}", json={"body": "x"}).status_code == 404
    assert c.post(f"/api/projects/method/comments/{cid}/replies", json={"body": "x"}).status_code == 404


def test_comment_body_max_length(client):
    """站内批注与公开批注同口径 4000（CommentIn/ReplyIn/CommentPatch）。"""
    c, _ = client
    over = "x" * 4001
    anchor = {"anchor": {"block_id": "abstract/p1", "line": 5, "quote": "安全锚输出"}}
    assert c.post("/api/projects/method/comments", json={**anchor, "body": over}).status_code == 422
    r = c.post("/api/projects/method/comments", json={**anchor, "body": "ok"})
    cid = r.json()["id"]
    assert c.patch(f"/api/projects/method/comments/{cid}", json={"body": over}).status_code == 422
    assert c.post(f"/api/projects/method/comments/{cid}/replies", json={"body": over}).status_code == 422


def test_comments_list_reanchors_after_edit(client):
    c, _ = client
    content = c.get("/api/projects/method/content").json()["content"]
    anchor = {"block_id": "abstract/p1", "line": 5, "quote": "安全锚输出"}
    cid = c.post("/api/projects/method/comments", json={"anchor": anchor, "body": "x"}).json()["id"]
    c.put("/api/projects/method/content", json={"content": content.replace("## 摘要\n", "## 摘要\n\n", 1)})
    (cmt,) = c.get("/api/projects/method/comments").json()
    assert cmt["id"] == cid and cmt["anchor"]["line"] == 6 and cmt["anchor"]["stale"] is False


# ---------------- 含标记样例：三模式构建 + XML final ----------------

def test_marked_sample_builds_in_three_modes(client):
    c, _ = client
    src = marked_method()
    out = {}
    for mode in critic.MODES:
        r = c.post("/api/projects/method/build", json={"pdf": False, "content": src, "mode": mode})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "ok", (mode, j.get("error"))
        assert j["mode"] == mode
        out[mode] = j
    # 摘要字数：final 多「首次」少「一种」；original 与两案原文一致（253）；markup 含标记符号
    assert out["original"]["summary"]["abstract_chars"] == 253
    assert out["final"]["summary"]["abstract_chars"] == 253
    assert out["markup"]["summary"]["abstract_chars"] > 253
    # 结构 lint 在 accept 文本上跑：三模式下 critic 标记本身不产生结构诊断
    assert all(d["id"].startswith("critic.") is False for d in out["final"]["diagnostics"])


def test_markup_preview_build_is_word_tracked_changes(client):
    """markup 预览走 Word 原生修订：DOCX 含 w:ins / w:del，正文不出现裸 CriticMarkup 记号。"""
    c, _ = client
    r = c.post("/api/projects/method/build", json={"pdf": False, "content": marked_method(), "mode": "markup"})
    assert r.status_code == 200 and r.json()["status"] == "ok", r.text
    docx = c.get(r.json()["docx_url"])
    assert docx.status_code == 200
    with zipfile.ZipFile(io.BytesIO(docx.content)) as z:
        xml = z.read("word/document.xml").decode()
    assert "<w:ins " in xml and "<w:del " in xml
    assert not any(t in xml for t in ("{++", "++}", "{--", "--}", "{~~", "~>", "~~}"))


def test_lint_route_appends_critic_warnings(client):
    c, _ = client
    src = marked_method().replace("{==其特征在于==}", "{==其特征在于", 1)
    r = c.post("/api/projects/method/lint", json={"content": src})
    assert r.status_code == 200
    ids = [d["id"] for d in r.json()["diagnostics"]]
    assert any(i.startswith("critic.unclosed#L") for i in ids)


@pytest.mark.skipif(
    shutil.which("pdftoppm") is None or shutil.which("soffice") is None,
    reason="需要 soffice 与 pdftoppm",
)
def test_marked_sample_xml_export_final(client):
    c, _ = client
    r = c.post("/api/projects/method/export/xml", json={"content": marked_method(), "mode": "final"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "ok", j.get("error")
    assert j["mode"] == "final"
    abstract = next(b for b in j["books"] if "abstract" in b["code"].lower() or "摘要" in b.get("name", ""))
    xml = c.get(abstract["xml_url"]).text
    assert "首次公开了" in xml and "{++" not in xml and "{>>" not in xml


# ---------------- W5 share-confirm-backend：锚点扩展 / 线程 / 提及 / 筛选 ----------------

def test_w5_anchor_shapes_and_mentions():
    a = cm.anchor_from_dict({"book": "claims", "block_id": "claims/1", "line_start": 9, "line_end": 10, "quote": "q"})
    assert a.line == 9 and a.book == "claims" and a.line_end == 10
    assert a.to_dict() == {"block_id": "claims/1", "line": 9, "quote": "q", "stale": False, "book": "claims",
                           "line_start": 9, "line_end": 10}
    f = cm.anchor_from_dict({"file": "docs/figures.md"})
    assert f.file == "docs/figures.md" and f.block_id == "" and f.to_dict()["file"] == "docs/figures.md"
    legacy = cm.anchor_from_dict({"block_id": "abstract/p1", "line": 5, "quote": "x", "stale": True})
    assert legacy.to_dict() == {"block_id": "abstract/p1", "line": 5, "quote": "x", "stale": True}
    assert cm.parse_mentions("@张律师 请看，@张律师 再看 a@b.com @王总") == ["张律师", "王总"]

    c = cm.create(cm.Anchor(file="docs/figures.md"), "@王总 图 1 需要更新", cm.LOCAL_AUTHOR, source="ai")
    assert c.source == "ai" and c.mentions == ["王总"] and c.resolved_at is None
    cm.reply(c, "@张律师 已处理", cm.LOCAL_AUTHOR, source="client")
    assert c.replies[0].parent_id == c.id and c.replies[0].source == "client" and c.replies[0].mentions == ["张律师"]
    cm.resolve(c, True, by=cm.LOCAL_AUTHOR)
    assert c.resolved and c.resolved_at is not None and c.resolved_by == cm.LOCAL_AUTHOR
    cm.resolve(c, False)
    assert not c.resolved and c.resolved_at is None and c.resolved_by is None
    content = _read("method")
    assert cm.reanchor([c], parse_ast(content), content) == [c] and c.anchor.stale is False  # file 锚不重锚
    # 老 JSON（无新字段）仍能读
    old = {"id": "x", "anchor": {"block_id": "claims/1", "line": 9, "quote": "q", "stale": False}, "body": "b",
           "author": {"id": None, "name": "本机"}, "created_at": 1.0, "updated_at": 1.0, "resolved": False,
           "replies": [{"id": "r", "body": "rb", "author": {"id": None, "name": "本机"}, "created_at": 1.0}]}
    loaded = cm._from_dict(old)
    assert loaded.source == "human" and loaded.mentions == [] and loaded.replies[0].parent_id == "x"


def test_w5_select_filters():
    su, ed = cm.Author("u1", "所长"), cm.Author("u2", "代理人")
    a = cm.create(cm.Anchor("claims/1", 9), "@代理人 看权1", su)
    b = cm.create(cm.Anchor("abstract/p1", 5), "摘要太长", ed, source="ai")
    cm.reply(b, "@所长 请定", ed)
    cm.resolve(b, True, by=su)
    c = cm.create(cm.Anchor(file="docs/figures.md"), "图不清", cm.Author(None, "王总"), source="client")
    all_ = [a, b, c]
    assert cm.select(all_, author="u1") == [a]
    assert cm.select(all_, author="代理人") == [b]
    assert cm.select(all_, status="open") == [a, c] and cm.select(all_, status="resolved") == [b]
    assert cm.select(all_, source="client") == [c] and cm.select(all_, source="ai") == [b]
    assert cm.select(all_, mention="所长") == [b] and cm.select(all_, mention="代理人") == [a]
    assert cm.select(all_, status="open", source="human") == [a]


def test_w5_routes_thread_reopen_filters(client):
    c, projects = client
    r = c.post("/api/projects/method/comments",
               json={"anchor": {"book": "claims", "block_id": "claims/1", "line_start": 9, "quote": "其特征在于"},
                     "body": "@张律师 权1 主题", "source": "ai"})
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["source"] == "ai" and a["mentions"] == ["张律师"] and a["anchor"]["book"] == "claims"
    assert a["anchor"]["line"] == 9 and a["resolved_at"] is None and a["resolved_by"] is None
    r = c.post("/api/projects/method/comments", json={"anchor": {"file": "docs/figures.md"}, "body": "图 1 缺标号"})
    assert r.status_code == 201 and r.json()["anchor"]["file"] == "docs/figures.md"
    b = r.json()

    r = c.post(f"/api/projects/method/comments/{a['id']}/replies", json={"body": "@王总 已改", "source": "human"})
    rep = r.json()["replies"][0]
    assert rep["parent_id"] == a["id"] and rep["mentions"] == ["王总"] and rep["source"] == "human"

    r = c.post(f"/api/projects/method/comments/{a['id']}/resolve", json={})
    assert r.json()["resolved"] is True and r.json()["resolved_at"] and r.json()["resolved_by"]["name"] == "本机"
    r = c.post(f"/api/projects/method/comments/{a['id']}/reopen")
    assert r.status_code == 200 and r.json()["resolved"] is False and r.json()["resolved_at"] is None

    ids = lambda q: [x["id"] for x in c.get(f"/api/projects/method/comments{q}").json()]  # noqa: E731
    assert ids("") == [a["id"], b["id"]]
    assert ids("?source=ai") == [a["id"]] and ids("?source=client") == []
    assert ids("?mention=王总") == [a["id"]] and ids("?mention=张律师") == [a["id"]] and ids("?mention=无人") == []
    c.post(f"/api/projects/method/comments/{b['id']}/resolve", json={"resolved": True})
    assert ids("?status=open") == [a["id"]] and ids("?status=resolved") == [b["id"]]
    assert ids("?author=本机") == [a["id"], b["id"]]
    assert c.get("/api/projects/method/comments?source=bogus").status_code == 422
    # 老锚形状原样保留（file 锚不带 book/line_start）
    raw = json.loads((projects / "method" / "reviews" / "comments.json").read_text(encoding="utf-8"))
    assert raw[1]["anchor"] == {"block_id": "", "line": 0, "quote": "", "stale": False, "file": "docs/figures.md"}


def test_comment_ledger_writes_serialized(client, monkeypatch):
    """R84：权限检查的 await 曾夹在台账 load→save 窗口——并发另一写方插入会丢；现按案串行化。"""
    import asyncio

    from app.routes import comments as rc

    c, _ = client
    cid = c.post("/api/projects/method/comments",
                 json={"anchor": {"block_id": "b1", "line": 1, "quote": "q"}, "body": "一"}).json()["id"]

    orig = rc._comment_perm
    async def slow_perm(*a, **k):
        await asyncio.sleep(0.05)
        return await orig(*a, **k)
    monkeypatch.setattr(rc, "_comment_perm", slow_perm)

    req = type("Req", (), {"app": c.app})()
    body_in = rc.CommentIn(anchor=rc.AnchorIn(block_id="b2", line=2, quote="q"), body="三")

    async def go():
        # 无锁时：delete 的 load 在 create 写入前完成、其 save 又会把 create 的新条目冲掉 ⇒ 终态 []
        await asyncio.gather(rc.delete_comment("method", cid, req, None),
                             rc.create_comment("method", body_in, req, None))

    asyncio.run(go())
    got = c.get("/api/projects/method/comments").json()
    assert [x["body"] for x in got] == ["三"]


def test_comments_file_lock_serializes_writers(tmp_path):
    """R92：flock 串行化跨进程/线程写方——并发各自 load→append→save 不丢更新。"""
    from concurrent.futures import ThreadPoolExecutor

    from app.domain import comments

    d = str(tmp_path)
    comments.save(d, [])

    def add(i):
        with comments.file_lock(d):
            items = comments.load(d)
            items.append(comments.create(comments.Anchor(block_id="b", line=1, quote="q"),
                                         f"c{i}", comments.LOCAL_AUTHOR))
            comments.save(d, items)

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(add, range(20)))
    assert len(comments.load(d)) == 20
