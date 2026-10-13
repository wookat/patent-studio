# -*- coding: utf-8 -*-
"""W4-C C2-figures-attachments-api：/api/projects/{pid}/attachments* 四路由（docs/plan/15 §3.2）。

案子复制到临时目录，不触碰仓库文件。off 模式覆盖形状 / 白名单 / 大小 / 重名 / 原子性 / 下载头 / 删除；
on 模式覆盖 ACL（GET viewer 可、POST/DELETE viewer 403、editor 可）。
"""
import importlib
import io
import os
import shutil
import sys

import pytest
from fastapi.testclient import TestClient

from app.domain.attachments import ATTACHMENT_EXTS, ATTACHMENT_MAX_BYTES, KIND_OF_EXT, AttachmentsError, check_name

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SECRET = "test-secret-not-for-production-32bytes+"
PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
ERR_KEYS = {"kind", "message", "line", "detail"}


def _projects(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    return projects


def _reload_app(auth):
    import app.auth
    import app.auth.router
    from app import config, main
    from app.domain import attachments, build, xml_export
    from app.domain import projects as projects_mod
    from app.routes import attachments as routes_attachments

    importlib.reload(config)
    if auth:
        for name in ("db", "users", "acl", "schemas", "create_user"):
            sys.modules.pop(f"app.auth.{name}", None)
            app.auth.__dict__.pop(name, None)
        importlib.reload(app.auth)
        importlib.reload(app.auth.router)
    for m in (projects_mod, attachments, routes_attachments, build, xml_export):
        importlib.reload(m)
    return importlib.reload(main)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    main = _reload_app(False)
    return TestClient(main.app), projects / "method"


@pytest.fixture()
def on(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    main = _reload_app(True)
    yield main
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    _reload_app(True)


def _upload(c, *files, pid="method"):
    return c.post(f"/api/projects/{pid}/attachments",
                  files=[("files", (n, io.BytesIO(data), "application/octet-stream")) for n, data in files])


def _err(r, status, kind="attachments"):
    assert r.status_code == status, r.text
    d = r.json()["detail"]
    assert set(d) == ERR_KEYS and d["kind"] == kind and d["line"] is None
    return d


# ---------------- 服务层：白名单 ----------------

def test_check_name_whitelist_and_bad_names():
    for ext in ATTACHMENT_EXTS:
        assert check_name(f"a{ext}") == f"a{ext}" and check_name(f"A{ext.upper()}") == f"A{ext.upper()}"
    assert set(KIND_OF_EXT) == set(ATTACHMENT_EXTS)
    for bad in ("", ".hidden.pdf", "a/b.pdf", "a\\b.pdf", "../x.pdf", "noext", "x.exe", "x.pdf.sh"):
        with pytest.raises(AttachmentsError) as ei:
            check_name(bad)
        assert ei.value.status == 400


# ---------------- 列表 / 上传 ----------------

def test_list_empty_when_dir_missing(client):
    c, d = client
    assert not os.path.exists(d / "attachments")
    r = c.get("/api/projects/method/attachments")
    assert r.status_code == 200 and r.json() == {"items": []}
    assert not os.path.exists(d / "attachments"), "GET 不应创建目录"


def test_upload_all_kinds_and_list_shape(client):
    c, d = client
    files = [(f"现有技术{e}", PDF if e == ".pdf" else b"x" * 10) for e in ATTACHMENT_EXTS]
    r = _upload(c, *files)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [it["name"] for it in items] == sorted(n for n, _ in files)
    for it in items:
        assert set(it) == {"name", "ext", "size", "mtime", "kind", "url"}
        assert it["ext"] == os.path.splitext(it["name"])[1] and it["kind"] == KIND_OF_EXT[it["ext"]]
        assert it["size"] == os.path.getsize(d / "attachments" / it["name"])
        assert it["mtime"].endswith("Z") and len(it["mtime"]) == len("2026-09-05T11:49:00Z")
        assert it["url"].startswith("/api/projects/method/attachments/") and " " not in it["url"]
        assert c.get(it["url"]).status_code == 200, it["url"]
    assert sorted(os.listdir(d / "attachments")) == [it["name"] for it in items]
    assert c.get("/api/projects/method/attachments").json() == {"items": items}


def test_upload_strips_client_path_and_ignores_subdirs(client):
    c, d = client
    r = _upload(c, ("C:\\Users\\x\\资料.txt", b"hi"), ("dir/sub/说明.md", b"# md"))
    assert r.status_code == 200, r.text
    assert [it["name"] for it in r.json()["items"]] == ["说明.md", "资料.txt"]
    (d / "attachments" / "sub").mkdir()
    (d / "attachments" / "sub" / "deep.pdf").write_bytes(PDF)
    (d / "attachments" / ".DS_Store").write_bytes(b"")
    (d / "attachments" / "stray.exe").write_bytes(b"")
    assert [it["name"] for it in c.get("/api/projects/method/attachments").json()["items"]] == ["说明.md", "资料.txt"]


def test_upload_rejects_bad_type_and_name_400(client):
    c, d = client
    d1 = _err(_upload(c, ("恶意.exe", b"MZ")), 400)
    assert d1["message"].startswith("不支持的附件类型 .exe") and ".pdf" in d1["detail"]
    d2 = _err(_upload(c, ("noext", b"x")), 400)
    assert "(无扩展名)" in d2["message"]
    d3 = _err(_upload(c, (".hidden.pdf", PDF)), 400)
    assert d3["message"] == "非法文件名" and d3["detail"] == ".hidden.pdf"
    assert not os.path.exists(d / "attachments")


def test_upload_too_large_413(client):
    c, d = client
    r = _upload(c, ("big.zip", b"z" * (ATTACHMENT_MAX_BYTES + 1)))
    dd = _err(r, 413)
    assert dd["message"].startswith("文件过大：big.zip") and "50 MB" in dd["message"] and dd["detail"] == "big.zip"
    assert not os.path.exists(d / "attachments")
    # 正好上限可以
    assert _upload(c, ("edge.txt", b"e" * ATTACHMENT_MAX_BYTES)).status_code == 200


def test_upload_duplicate_409(client):
    c, d = client
    assert _upload(c, ("a.pdf", PDF)).status_code == 200
    dd = _err(_upload(c, ("a.pdf", PDF)), 409)
    assert dd["message"] == "attachments/a.pdf 已存在" and dd["detail"] == "a.pdf"
    # 同一批内重名也是 409
    _err(_upload(c, ("b.txt", b"1"), ("b.txt", b"2")), 409)
    assert sorted(os.listdir(d / "attachments")) == ["a.pdf"]


def test_upload_batch_is_atomic(client):
    c, d = client
    assert _upload(c, ("keep.md", b"k")).status_code == 200
    before = os.stat(d / "attachments" / "keep.md").st_mtime_ns
    _err(_upload(c, ("ok1.txt", b"1"), ("bad.exe", b"x"), ("ok2.txt", b"2")), 400)
    _err(_upload(c, ("ok3.txt", b"3"), ("keep.md", b"dup")), 409)
    _err(_upload(c, ("ok4.txt", b"4"), ("huge.pdf", b"h" * (ATTACHMENT_MAX_BYTES + 1))), 413)
    assert sorted(os.listdir(d / "attachments")) == ["keep.md"]
    assert os.stat(d / "attachments" / "keep.md").st_mtime_ns == before
    assert _upload(c, ("ok1.txt", b"1"), ("ok2.txt", b"2")).status_code == 200
    assert sorted(os.listdir(d / "attachments")) == ["keep.md", "ok1.txt", "ok2.txt"]


def test_upload_without_files_is_validation_error(client):
    c, _ = client
    r = c.post("/api/projects/method/attachments")
    assert r.status_code == 422
    assert r.json()["detail"]["kind"] == "validation"


# ---------------- 下载 ----------------

def test_get_attachment_inline_and_download_headers(client):
    c, _ = client
    r = _upload(c, ("现有技术.pdf", PDF), ("notes.txt", "中文\n".encode()), ("p.png", b"\x89PNG\r\n\x1a\n"))
    assert r.status_code == 200

    r = c.get("/api/projects/method/attachments/现有技术.pdf")
    assert r.status_code == 200 and r.content == PDF
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith('inline; filename="attachment.pdf"; filename*=UTF-8\'\'')
    assert "%E7%8E%B0%E6%9C%89%E6%8A%80%E6%9C%AF.pdf" in r.headers["content-disposition"]
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["content-length"] == str(len(PDF))

    r = c.get("/api/projects/method/attachments/现有技术.pdf", params={"download": 1})
    assert r.status_code == 200 and r.content == PDF
    assert r.headers["content-disposition"].startswith('attachment; filename="attachment.pdf"')

    r = c.get("/api/projects/method/attachments/notes.txt")
    assert r.headers["content-type"] == "text/plain; charset=utf-8" and r.text == "中文\n"
    assert r.headers["content-disposition"].startswith('inline; filename="notes.txt"')
    assert c.get("/api/projects/method/attachments/p.png").headers["content-type"] == "image/png"
    r = c.get("/api/projects/method/attachments/notes.txt", params={"download": "true"})
    assert r.headers["content-disposition"].startswith("attachment;")


def test_get_missing_and_bad_names(client):
    c, d = client
    dd = _err(c.get("/api/projects/method/attachments/none.pdf"), 404)
    assert dd["message"] == "附件不存在：none.pdf" and dd["detail"] == "none.pdf"
    _err(c.get("/api/projects/method/attachments/evil.exe"), 400)
    _err(c.get("/api/projects/method/attachments/.hidden.pdf"), 400)
    # 不在白名单的现存文件也拿不到（目录里手放的 stray）
    (d / "attachments").mkdir()
    (d / "attachments" / "stray.exe").write_bytes(b"MZ")
    _err(c.get("/api/projects/method/attachments/stray.exe"), 400)
    # 案子不存在 → 404（ProjectError 形状）
    r = c.get("/api/projects/nope/attachments")
    assert r.status_code == 404


# ---------------- 删除 ----------------

def test_delete_and_missing_404(client):
    c, d = client
    assert _upload(c, ("a.pdf", PDF), ("b.txt", b"b")).status_code == 200
    r = c.delete("/api/projects/method/attachments/a.pdf")
    assert r.status_code == 200 and [it["name"] for it in r.json()["items"]] == ["b.txt"]
    assert sorted(os.listdir(d / "attachments")) == ["b.txt"]
    _err(c.delete("/api/projects/method/attachments/a.pdf"), 404)
    _err(c.delete("/api/projects/method/attachments/x.exe"), 400)
    r = c.delete("/api/projects/method/attachments/b.txt")
    assert r.status_code == 200 and r.json() == {"items": []}
    # 删空后再上传同名可以（名字释放）
    assert _upload(c, ("a.pdf", PDF)).status_code == 200


def test_attachments_do_not_touch_docs_or_history_tracked(client):
    """附件不进 content.md / docs/，也不进 .studio/history（history.TRACKED 只有源文档，二进制不入库）。"""
    c, d = client
    snap = {p: (d / p).read_bytes() for p in ("content.md", "studio.json", "docs/figures.md")}
    before = c.get("/api/projects/method/history").json()
    assert _upload(c, ("a.pdf", PDF)).status_code == 200
    assert c.delete("/api/projects/method/attachments/a.pdf").status_code == 200
    assert {p: (d / p).read_bytes() for p in snap} == snap
    assert c.get("/api/projects/method/history").json() == before


# ---------------- 交底书模板（W19 批3）----------------

def test_seed_intake_template(client):
    c, d = client
    r = c.post("/api/projects/method/attachments/seed-intake")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [it["name"] for it in items] == ["技术交底书模板.md"]
    text = (d / "attachments" / "技术交底书模板.md").read_text(encoding="utf-8")
    for seg in ("发明点", "要解决的技术问题", "现有技术及缺陷", "技术方案", "有益效果", "可替代方案", "已公开情况"):
        assert seg in text
    # 二次生成 → 409，不覆盖已存在文件（发明人可能已填写）
    _err(c.post("/api/projects/method/attachments/seed-intake"), 409)
    assert c.get("/api/projects/method/attachments/技术交底书模板.md").status_code == 200


def test_on_seed_intake_requires_editor(on):
    anon = TestClient(on.app)
    for n in ("su", "viewer"):
        _register(anon, f"{n}@example.com")
    su, viewer = (_login(on, f"{n}@example.com") for n in ("su", "viewer"))
    r = su.put("/api/projects/method/members", json={"email": "viewer@example.com", "role": "viewer"})
    assert r.status_code == 200, r.text

    assert anon.post("/api/projects/method/attachments/seed-intake").status_code == 401
    r = viewer.post("/api/projects/method/attachments/seed-intake")
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "editor"
    assert su.post("/api/projects/method/attachments/seed-intake").status_code == 200


# ---------------- ACL（AUTH=on）----------------

def _register(c, email, password="pw-123456"):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "display_name": ""})
    assert r.status_code == 201, r.text


def _login(main, email, password="pw-123456"):
    c = TestClient(main.app)
    r = c.post("/api/auth/cookie/login", data={"username": email, "password": password})
    assert r.status_code == 204, r.text
    return c


def test_on_viewer_reads_only_editor_writes(on):
    anon = TestClient(on.app)
    for n in ("su", "editor", "viewer"):
        _register(anon, f"{n}@example.com")
    su, editor, viewer = (_login(on, f"{n}@example.com") for n in ("su", "editor", "viewer"))
    for role in ("editor", "viewer"):
        r = su.put("/api/projects/method/members", json={"email": f"{role}@example.com", "role": role})
        assert r.status_code == 200, r.text

    assert anon.get("/api/projects/method/attachments").status_code == 401
    assert _upload(editor, ("现有技术.pdf", PDF)).status_code == 200

    assert viewer.get("/api/projects/method/attachments").status_code == 200
    assert viewer.get("/api/projects/method/attachments/现有技术.pdf").content == PDF
    r = _upload(viewer, ("v.txt", b"v"))
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "forbidden"
    assert r.json()["detail"]["detail"] == "editor"
    r = viewer.delete("/api/projects/method/attachments/现有技术.pdf")
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "editor"
    assert [it["name"] for it in viewer.get("/api/projects/method/attachments").json()["items"]] == ["现有技术.pdf"]

    assert editor.delete("/api/projects/method/attachments/现有技术.pdf").json() == {"items": []}
