# -*- coding: utf-8 -*-
"""share-confirm-backend：客户免登录审阅链接 + 确认定稿 + 水印 PDF（docs/plan/21 §1.3 A6 / R-REV-05 / R-CHK-08）。
夹具复用 test_auth（on / client / _register / _login / _assert_501）。"""
import asyncio
import io
import json
from datetime import UTC, datetime, timedelta

import test_auth
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter

from app.domain import cases, events, history, public_share

on = test_auth.on
client = test_auth.client
_register, _login, _assert_501 = test_auth._register, test_auth._login, test_auth._assert_501


def _write_pdf(projects, pid="method", pages=2):
    """造一份「最新构建」的 out.pdf（LibreOffice 产物的替身：测试只关心水印叠加与响应头）。"""
    d = projects / pid / ".studio" / "builds" / "20260906-000000"
    d.mkdir(parents=True)
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(595, 842)
    with open(d / "out.pdf", "wb") as f:
        w.write(f)
    return d / "out.pdf"


def _team(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com", display_name="所长")
    su = _login(on, "su@example.com")
    return anon, su


def _link(su, **body):
    body = {"scope": "confirm", "ttl_days": 7, "allow_download": True, **body}
    r = su.post("/api/projects/method/public-links", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _events(kind):
    got = []
    events.subscribe(kind, lambda ev: got.append(ev))
    return got


# ---------------- off ----------------

def test_off_links_501_and_public_404(client):
    c, _ = client
    _assert_501(c.get("/api/projects/method/public-links"), "C1-auth")
    _assert_501(c.post("/api/projects/method/public-links", json={"scope": "read"}), "C1-auth")
    r = c.get("/api/public/nope/meta")
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"


# ---------------- 链接 CRUD ----------------

def test_create_list_revoke_links(on, tmp_path):
    anon, su = _team(on)
    created = _events("share.created")
    link = _link(su, scope="comment", ttl_days=3)
    assert set(link) >= {"token", "pid", "scope", "allow_download", "expires_at", "revoked", "created_by", "created_at",
                         "visits", "last_visit_at"}
    assert link["scope"] == "comment" and link["revoked"] is False and link["created_by"]["display_name"] == "所长"
    assert abs(link["expires_at"] - (datetime.now(UTC) + timedelta(days=3)).timestamp()) < 60
    assert [e.data["token"] for e in created] == [link["token"]]

    lst = su.get("/api/projects/method/public-links").json()
    assert [x["token"] for x in lst] == [link["token"]]
    # 未登录 / 非成员管理链接：401 / 404（不存在的 pid）
    assert anon.get("/api/projects/method/public-links").status_code == 401

    r = su.delete(f"/api/projects/method/public-links/{link['token']}")
    assert r.status_code == 204
    assert su.get("/api/projects/method/public-links").json()[0]["revoked"] is True
    assert su.delete("/api/projects/method/public-links/nope").status_code == 404
    r = anon.get(f"/api/public/{link['token']}/meta")
    assert r.status_code == 410 and r.json()["detail"]["kind"] == "share.revoked"


def test_link_cannot_widen_case_settings(on):
    _, su = _team(on)
    assert su.put("/api/projects/method/collab-settings", json={"allow_download": False}).status_code == 200
    link = _link(su, scope="confirm", allow_download=True)
    assert link["allow_download"] is False
    link2 = _link(su, scope="comment", allow_comment=False)
    assert link2["scope"] == "read"


# ---------------- 匿名读取 ----------------

def test_anonymous_reads_pdf_ast_css_comments_and_logs_access(on, tmp_path):
    anon, su = _team(on)
    projects = tmp_path / "projects"
    _write_pdf(projects)
    link = _link(su, allow_download=False)
    tok = link["token"]

    meta = anon.get(f"/api/public/{tok}/meta")
    assert meta.status_code == 200, meta.text
    m = meta.json()
    assert m["allow_download"] is False and m["allow_comment"] is True and m["scope"] == "confirm"
    assert m["title"] and m["pdf_ready"] is True and m["confirmation"] is None and m["org_name"]

    r = anon.get(f"/api/public/{tok}/pdf", headers={"User-Agent": "ua-test"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("inline;")
    assert r.headers["x-watermark"] == "footer"
    reader = PdfReader(io.BytesIO(r.content))
    assert len(reader.pages) == 2
    assert all(public_share.watermark_text(tok) in p.extract_text() for p in reader.pages)
    assert public_share.watermark_text(tok).endswith(cases.local_today().isoformat())

    ast = anon.get(f"/api/public/{tok}/layout-ast")
    assert ast.status_code == 200 and ast.json()["books"] == anon.get(f"/api/public/{tok}/ast").json()["books"]
    css = anon.get(f"/api/public/{tok}/layout-css")
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    assert anon.get(f"/api/public/{tok}/comments").json() == []

    # 访问记录：库里 visits 递增 + 案内 jsonl
    lst = su.get("/api/projects/method/public-links").json()[0]
    assert lst["visits"] == 6 and lst["last_visit_at"] is not None
    log = public_share.read_access_log(str(projects / "method"))
    assert len(log) == 6 and log[1]["path"] == f"/api/public/{tok}/pdf" and log[1]["ua"] == "ua-test"

    # 允许下载 ⇒ attachment
    link2 = _link(su, allow_download=True)
    r = anon.get(f"/api/public/{link2['token']}/pdf")
    assert r.headers["content-disposition"].startswith("attachment;")
    # 不暴露源码 / 导出
    assert anon.get(f"/api/public/{tok}/content").status_code == 404
    assert anon.get("/api/projects/method/content").status_code == 401


def test_pending_revisions_not_rendered_as_final_by_default(on, tmp_path, monkeypatch):
    """W9 domain-02：正文含 reviewer 未决插入 {++碳++}{++的++} 时，缺省链接（baseline=original）的 layout-ast 与 PDF
    是撰写人已定正文；baseline=final 才按接受渲染；meta 报 pending_revisions 供两端提示。"""
    anon, su = _team(on)
    projects = tmp_path / "projects"
    content = su.get("/api/projects/method/content").json()["content"]
    assert "预测模型部署期" in content
    marked = content.replace("预测模型部署期", "{++碳++}预测模型{++的++}部署期", 1)
    assert su.put("/api/projects/method/content", json={"content": marked}).status_code == 200
    # 预览构建按 final 落盘（旧行为：客户 PDF 直接拿它 ⇒ 未决插入成了定稿）
    stale = _write_pdf(projects, pages=1)
    with open(stale.parent / "content.md", "w", encoding="utf-8") as f:
        f.write(marked.replace("{++碳++}", "碳").replace("{++的++}", "的"))

    link = _link(su)
    assert link["baseline"] == "original"
    tok = link["token"]
    m = anon.get(f"/api/public/{tok}/meta").json()
    assert m["baseline"] == "original" and m["pending_revisions"] == 2
    # 客户页版面按 studio.json sub_except 渲染行内下标（默认白名单来自 projects.DEFAULT_SUB_EXCEPT）
    assert isinstance(m["sub_except"], list) and m["sub_except"]

    def flat(books):
        return json.dumps(books, ensure_ascii=False)

    ast = anon.get(f"/api/public/{tok}/layout-ast").json()
    assert "预测模型部署期" in flat(ast) and "碳预测模型的部署期" not in flat(ast) and "{++" not in flat(ast)

    # PDF：陈旧 final 构建的 content.md 与 original 正文不一致 ⇒ 按 original 构建一次（这里替身 _build 只造文件）
    built = []

    def fake_build(store, pid, mode):
        built.append(mode)
        d = projects / pid / ".studio" / "builds" / f"20260907-00000{len(built)}"
        d.mkdir(parents=True)
        with open(d / "content.md", "w", encoding="utf-8") as f:
            f.write(public_share.critic.resolve(store.read_content(pid), mode))
        w = PdfWriter()
        w.add_blank_page(595, 842)
        w.add_blank_page(595, 842)
        w.add_blank_page(595, 842)
        with open(d / "out.pdf", "wb") as f:
            w.write(f)
        return str(d / "out.pdf")

    monkeypatch.setattr(public_share, "_build", fake_build)
    r = anon.get(f"/api/public/{tok}/pdf")
    assert r.status_code == 200 and built == ["original"]
    assert len(PdfReader(io.BytesIO(r.content)).pages) == 3
    # 再取：content.md 一致的构建已存在 ⇒ 不再构建
    anon.get(f"/api/public/{tok}/pdf")
    assert built == ["original"]

    # 撰写人明确选「含未决修订」：按接受渲染，并复用与之一致的陈旧 final 构建（1 页）
    tok2 = _link(su, baseline="final")["token"]
    m2 = anon.get(f"/api/public/{tok2}/meta").json()
    assert m2["baseline"] == "final" and m2["pending_revisions"] == 2
    ast2 = anon.get(f"/api/public/{tok2}/layout-ast").json()
    assert "碳预测模型的部署期" in flat(ast2) and "{++" not in flat(ast2)
    r2 = anon.get(f"/api/public/{tok2}/pdf")
    assert r2.status_code == 200 and len(PdfReader(io.BytesIO(r2.content)).pages) == 1 and built == ["original"]

    # 修订全部处理完：pending 归零，PDF 回到「最新构建」
    assert su.put("/api/projects/method/content", json={"content": content}).status_code == 200
    assert anon.get(f"/api/public/{tok}/meta").json()["pending_revisions"] == 0
    bad = {"scope": "read", "baseline": "markup"}
    assert anon.post("/api/projects/method/public-links", json=bad).status_code in (401, 422)
    assert su.post("/api/projects/method/public-links", json=bad).status_code == 422


def test_pdf_missing_build_404_and_watermark_fallback(on, tmp_path, monkeypatch):
    anon, su = _team(on)
    tok = _link(su)["token"]
    r = anon.get(f"/api/public/{tok}/pdf")
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"

    _write_pdf(tmp_path / "projects", pages=1)

    def boom(pdf_bytes, text):
        raise RuntimeError("no font")

    monkeypatch.setattr(public_share, "watermark", boom)
    r = anon.get(f"/api/public/{tok}/pdf")
    assert r.status_code == 200 and r.headers["x-watermark"] == "unavailable"
    assert len(PdfReader(io.BytesIO(r.content)).pages) == 1


def test_expired_410_unknown_404(on):
    anon, su = _team(on)
    link = _link(su, ttl_days=1)
    from app.auth.db import SessionLocal
    from app.auth.models import PublicShareLink

    async def expire():
        async with SessionLocal() as s:
            row = await s.get(PublicShareLink, link["token"])
            row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await s.commit()

    asyncio.run(expire())
    for path in ("meta", "pdf", "layout-ast", "comments"):
        r = anon.get(f"/api/public/{link['token']}/{path}")
        assert r.status_code == 410 and r.json()["detail"]["kind"] == "share.expired", path
    assert anon.post(f"/api/public/{link['token']}/confirm", json={"name": "王总"}).status_code == 410
    assert anon.get("/api/public/does-not-exist/meta").status_code == 404
    # 永不过期
    forever = _link(su, ttl_days=None)
    assert forever["expires_at"] is None and anon.get(f"/api/public/{forever['token']}/meta").status_code == 200


# ---------------- 客户批注 / 确认 ----------------

def test_client_comment_and_scope(on, tmp_path):
    anon, su = _team(on)
    tok = _link(su, scope="comment")["token"]
    r = anon.post(f"/api/public/{tok}/comments",
                  json={"name": "王总", "anchor": {"book": "claims", "block_id": "claims/1", "line": 9,
                                                  "quote": "其特征在于"}, "body": "这里的「装置」要不要改成「系统」？"})
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["source"] == "client" and c["author"] == {"id": None, "name": "王总"}
    assert c["anchor"]["book"] == "claims" and c["anchor"]["block_id"] == "claims/1"
    assert [x["id"] for x in anon.get(f"/api/public/{tok}/comments").json()] == [c["id"]]
    # 成员端同一份数据，可按 source 筛
    assert [x["id"] for x in su.get("/api/projects/method/comments?source=client").json()] == [c["id"]]
    assert su.get("/api/projects/method/comments?source=human").json() == []
    # comment 链接不能确认；read 链接不能批注
    assert anon.post(f"/api/public/{tok}/confirm", json={"name": "王总"}).json()["detail"]["kind"] == "share.scope"
    ro = _link(su, scope="read")["token"]
    r = anon.post(f"/api/public/{ro}/comments", json={"name": "王总", "anchor": {"block_id": "claims/1", "line": 9},
                                                       "body": "x"})
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "share.scope"
    # 缺 name ⇒ 422 validation
    r = anon.post(f"/api/public/{tok}/comments", json={"anchor": {"block_id": "claims/1", "line": 9}, "body": "x"})
    assert r.status_code == 422


def test_confirm_appends_case_and_timeline_and_emits(on, tmp_path):
    anon, su = _team(on)
    projects = tmp_path / "projects"
    tok = _link(su, scope="confirm")["token"]
    assert history.commit(str(projects / "method"), "save")  # 有一个版本可锁定
    confirmed = _events("share.confirmed")
    before = len(su.get("/api/projects/method/timeline").json()["items"])

    r = anon.post(f"/api/public/{tok}/confirm", json={"name": "王总", "note": "同意定稿"},
                  headers={"User-Agent": "client-ua", "X-Forwarded-For": "203.0.113.9, 10.0.0.1"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["name"] == "王总" and out["note"] == "同意定稿" and out["version"] >= 1 and len(out["sha"]) >= 7

    case = cases.load_case(str(projects / "method"))
    assert len(case.confirmations) == 1
    rec = case.confirmations[0]
    assert rec.actor == "client:王总" and rec.ip == "203.0.113.9" and rec.ua == "client-ua" and rec.token == tok
    assert rec.sha == out["sha"] and rec.version == out["version"]
    raw = json.loads((projects / "method" / "case.json").read_text(encoding="utf-8"))
    assert raw["confirmations"][0]["actor"] == "client:王总"

    assert len(confirmed) == 1 and confirmed[0].pid == "method" and confirmed[0].data["name"] == "王总"
    assert confirmed[0].actor is None

    items = su.get("/api/projects/method/timeline").json()["items"]
    assert len(items) == before + 1
    top = items[0]
    assert top["kind"] == "share.confirmed" and "王总" in top["text"] and top["data"]["sha"] == out["sha"]
    # meta 带最近一次确认
    assert anon.get(f"/api/public/{tok}/meta").json()["confirmation"]["name"] == "王总"

    # W12 R17-02：同链同人同版本重复提交幂等——不重复落账 / 不发第二个事件 / 不加时间线
    r = anon.post(f"/api/public/{tok}/confirm", json={"name": "王总", "note": "同意定稿"})
    assert r.status_code == 200 and r.json()["sha"] == out["sha"]
    case = cases.load_case(str(projects / "method"))
    assert len(case.confirmations) == 1 and len(confirmed) == 1
    items = su.get("/api/projects/method/timeline").json()["items"]
    assert len(items) == before + 1
    # 不同姓名 / 新版本仍各自落账
    r = anon.post(f"/api/public/{tok}/confirm", json={"name": "李秘书"})
    assert r.status_code == 200
    assert len(cases.load_case(str(projects / "method")).confirmations) == 2
    # 新版本（正文真改动 → commit）后同名再确认仍落账
    doc = projects / "method" / "docs" / "abstract.md"
    doc.write_text(doc.read_text(encoding="utf-8") + "\n追加一句。", encoding="utf-8")
    assert history.commit(str(projects / "method"), "v2") is not None
    r = anon.post(f"/api/public/{tok}/confirm", json={"name": "王总"})
    assert r.status_code == 200 and r.json()["version"] == out["version"] + 1
    assert len(cases.load_case(str(projects / "method")).confirmations) == 3


# ---------------- 纯函数 ----------------

def test_watermark_text_and_stamp():
    assert public_share.watermark_text("abcdef123456", datetime(2026, 9, 6).date()) == "审阅版 · abcdef · 2026-09-06"
    w = PdfWriter()
    w.add_blank_page(595, 842)
    w.add_blank_page(842, 595)  # 横页：各自尺寸的 stamp
    buf = io.BytesIO()
    w.write(buf)
    out = PdfReader(io.BytesIO(public_share.watermark(buf.getvalue(), "审阅版 · abc · 2026-01-01")))
    assert [p.extract_text() for p in out.pages] == ["审阅版 · abc · 2026-01-01"] * 2
    assert float(out.pages[1].mediabox.width) == 842
