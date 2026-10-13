# -*- coding: utf-8 -*-
"""单元 E1-deliver-page（docs/plan/17 §2.3 / §8）：
GET /deliver 清单（六项、真实 at/size）、POST /deliver/bundle（zip 内容 + manifest.json、失败 422 不留半 zip、
无 LibreOffice 跳 PDF）、GET /deliver/bundle.zip、auth on 下 viewer 可读可打包。
"""
import io
import json
import os
import shutil
import zipfile

import pytest
import test_auth
from test_auth import _login, _register

from app import config
from app.routes.deliver import KINDS

client = test_auth.client  # pytest fixture
on = test_auth.on  # pytest fixture
HAS_RENDER = shutil.which(config.SOFFICE) is not None and shutil.which("pdftoppm") is not None
BAD_FIG = {"settings": {"spec_figures": [["nope.png", 15]]}}  # 构建第一步就失败：附图不存在


def _items(c, pid="method"):
    r = c.get(f"/api/projects/{pid}/deliver")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["pid"] == pid and d["title"]
    return {it["kind"]: it for it in d["items"]}, d


def _studio(tmp, *parts):
    return os.path.join(tmp, "projects", "method", ".studio", *parts)


def test_manifest_fresh_project(client):
    c, tmp = client
    items, d = _items(c)
    assert [it["kind"] for it in d["items"]] == list(KINDS)
    for k in ("docx", "pdf", "tracked", "figures"):
        assert items[k]["url"] and items[k]["at"] is None and items[k]["size"] is None
    assert items["xml"]["url"] is None and items["bundle"]["url"] is None
    assert items["figures"]["url"] == "/api/projects/method/figures/export.zip"
    r = c.get("/api/projects/method/deliver/bundle.zip")
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"
    assert c.get("/api/projects/nope/deliver").status_code == 404


def test_manifest_reports_real_artifacts(client):
    c, tmp = client
    r = c.post("/api/projects/method/build", json={"pdf": False})
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert c.get("/api/projects/method/export/docx?mode=tracked").status_code == 200
    items, _ = _items(c)
    docx = _studio(tmp, "builds", r.json()["build_id"], "out.docx")
    assert items["docx"]["size"] == os.path.getsize(docx) and items["docx"]["at"].endswith("+00:00")
    assert items["pdf"]["at"] is None and items["pdf"]["size"] is None  # 无 PDF 的构建
    assert items["tracked"]["size"] == os.path.getsize(_studio(tmp, "tracked", "out.docx"))
    assert items["xml"]["at"] is None


def test_manifest_keeps_last_success_after_failed_build(client):
    """W11 I-1：构建失败后清单仍指向上一次成功产物（url 带其 build_id，at/size 是旧文件的），
    不带 build_id 的 /export 也直接给旧产物而不是按当前正文重建出 422。"""
    c, tmp = client
    ok = c.post("/api/projects/method/build", json={"pdf": False})
    assert ok.status_code == 200 and ok.json()["status"] == "ok"
    ok_id = ok.json()["build_id"]
    bad = c.post("/api/projects/method/build", json={"pdf": False, **BAD_FIG})
    assert bad.status_code == 200 and bad.json()["status"] == "error"
    assert not os.path.exists(_studio(tmp, "builds", bad.json()["build_id"], "out.docx"))

    items, _ = _items(c)
    assert items["docx"]["url"] == f"/api/projects/method/export?fmt=docx&build_id={ok_id}"
    assert items["docx"]["size"] == os.path.getsize(_studio(tmp, "builds", ok_id, "out.docx"))
    assert items["pdf"]["url"] == "/api/projects/method/export?fmt=pdf" and items["pdf"]["at"] is None

    for url in (items["docx"]["url"], "/api/projects/method/export?fmt=docx"):
        r = c.get(url)
        assert r.status_code == 200, r.text
        assert r.content == open(_studio(tmp, "builds", ok_id, "out.docx"), "rb").read()


def test_bundle_failure_is_422_and_leaves_no_zip(client):
    c, tmp = client
    r = c.post("/api/projects/method/deliver/bundle", json=BAD_FIG)
    assert r.status_code == 422, r.text
    d = r.json()["detail"]
    assert d["kind"] == "bundle" and d["detail"] == "DOCX" and "nope.png" in d["message"]
    assert not os.path.exists(_studio(tmp, "deliver"))
    assert c.get("/api/projects/method/deliver/bundle.zip").status_code == 404
    assert _items(c)[0]["bundle"]["url"] is None


def test_bundle_without_libreoffice_skips_pdf(client, monkeypatch):
    """无 LibreOffice：PDF 跳过而非失败；XML 一步用桩（真实导出需要 LibreOffice 栅格化）。"""
    import app.routes.deliver as rd

    c, tmp = client
    monkeypatch.setattr(rd, "soffice_available", lambda: False)

    def fake_xml(store, pid, content, settings, mode="final"):
        d = _studio(tmp, "xml", "20260101-000000-stub")
        os.makedirs(d, exist_ok=True)
        with zipfile.ZipFile(os.path.join(d, "cnipa-xml.zip"), "w") as z:
            z.writestr("100001/100001.xml", "<x/>")
        return {"status": "ok", "xid": "20260101-000000-stub"}

    monkeypatch.setattr(rd, "run_xml_export", fake_xml)
    r = c.post("/api/projects/method/deliver/bundle", json={"mode": "final"})
    assert r.status_code == 200, r.text
    items = {it["kind"]: it for it in r.json()["items"]}
    assert items["bundle"]["url"] == "/api/projects/method/deliver/bundle.zip"
    assert items["bundle"]["size"] == os.path.getsize(_studio(tmp, "deliver", "bundle.zip"))
    assert items["pdf"]["at"] is None
    assert items["xml"]["url"] == "/api/projects/method/xml/20260101-000000-stub/zip"
    title = r.json()["title"]
    with zipfile.ZipFile(_studio(tmp, "deliver", "bundle.zip")) as z:
        names = set(z.namelist())
        m = json.loads(z.read("manifest.json"))
    assert names == {f"申请文件-{title}.docx", f"CNIPA-XML-{title}.zip", f"申请文件-{title}-修订.docx",
                     f"附图-{title}.zip", "manifest.json"}
    assert m["pid"] == "method" and m["pdf_skipped"] is True and m["mode"] == "final"
    assert [it["kind"] for it in m["items"]] == list(KINDS)
    assert not os.path.exists(_studio(tmp, "deliver", "bundle.zip.tmp"))


@pytest.mark.skipif(not HAS_RENDER, reason="需要 LibreOffice + pdftoppm")
def test_bundle_full_and_download(client):
    c, tmp = client
    r = c.post("/api/projects/method/deliver/bundle", json={"mode": "final"})
    assert r.status_code == 200, r.text
    d = r.json()
    items = {it["kind"]: it for it in d["items"]}
    for k in ("docx", "pdf", "xml", "tracked", "bundle"):
        assert items[k]["at"] and items[k]["size"] > 0, k
    assert items["xml"]["url"].startswith("/api/projects/method/xml/") and items["xml"]["url"].endswith("/zip")
    assert c.get(items["xml"]["url"]).status_code == 200

    z = c.get("/api/projects/method/deliver/bundle.zip")
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
    assert "filename*=UTF-8''" in z.headers["content-disposition"]
    assert len(z.content) == items["bundle"]["size"]
    title = d["title"]
    with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
        names = set(zf.namelist())
        m = json.loads(zf.read("manifest.json"))
        inner = zipfile.ZipFile(io.BytesIO(zf.read(f"CNIPA-XML-{title}.zip")))
        assert any(n.endswith("100001.xml") for n in inner.namelist())
        figs = zipfile.ZipFile(io.BytesIO(zf.read(f"附图-{title}.zip")))
        assert figs.namelist()
    assert names == {f"申请文件-{title}.docx", f"申请文件-{title}.pdf", f"CNIPA-XML-{title}.zip",
                     f"申请文件-{title}-修订.docx", f"附图-{title}.zip", "manifest.json"}
    assert m["pdf_skipped"] is False
    assert {it["kind"]: it for it in m["items"]}["xml"]["url"] == items["xml"]["url"]

    # 再打一次：单份覆盖，清单 bundle 尺寸随之更新
    r2 = c.post("/api/projects/method/deliver/bundle", json={"mode": "final"})
    assert r2.status_code == 200
    assert os.listdir(_studio(tmp, "deliver")) == ["bundle.zip"]


def test_on_viewer_can_read_manifest_and_bundle(on):
    anon = test_auth.TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "viewer@example.com")
    _register(anon, "stranger@example.com")
    su, viewer, stranger = (_login(on, f"{n}@example.com") for n in ("su", "viewer", "stranger"))
    r = su.put("/api/projects/method/members", json={"email": "viewer@example.com", "role": "viewer"})
    assert r.status_code == 200, r.text
    assert viewer.get("/api/projects/method/deliver").status_code == 200
    assert viewer.post("/api/projects/method/deliver/bundle", json=BAD_FIG).status_code == 422  # 过门槛，构建本身失败
    assert viewer.get("/api/projects/method/deliver/bundle.zip").status_code == 404
    assert stranger.get("/api/projects/method/deliver").status_code == 403
    assert stranger.post("/api/projects/method/deliver/bundle", json={}).status_code == 403


# ---------- W5 preflight-backend：字段级错误 + CPC 未验文案（docs/plan/21 §2.1 R-CHK-05 / §1.3 A12） ----------

def test_errors_missing_applicants_first(client):
    """examples/method 的 case.json 默认无申请人/发明人：errors[0].field == 'applicants'，且清单同步带 errors[]。"""
    c, tmp = client
    r = c.get("/api/projects/method/deliver/errors")
    assert r.status_code == 200, r.text
    errs = r.json()["errors"]
    assert errs and errs[0]["field"] == "applicants" and errs[0]["code"] == "request.applicants_missing"
    assert set(errs[0]) == {"field", "code", "message"} and errs[0]["message"]
    assert [e["field"] for e in errs] == ["applicants", "inventors"]
    items, d = _items(c)
    assert d["errors"] == errs
    assert [it["kind"] for it in d["items"]] == list(KINDS)  # 六项契约不变
    assert c.get("/api/projects/nope/deliver/errors").status_code == 404


def test_errors_clear_after_case_filled_and_application_no_format(client):
    c, tmp = client
    r = c.put("/api/projects/method/case", json={"applicants": ["某某科技有限公司"], "inventors": ["张三"],
                                                 "dates": {"application_no": "2026 1 0123456.7"}})
    assert r.status_code == 200, r.text
    assert c.get("/api/projects/method/deliver/errors").json() == {"errors": []}
    r = c.put("/api/projects/method/case", json={"dates": {"application_no": "CN2026-abc"}})
    assert r.status_code == 200, r.text
    errs = c.get("/api/projects/method/deliver/errors").json()["errors"]
    assert [(e["field"], e["code"]) for e in errs] == [("dates.application_no", "request.application_no_format")]
    # 空白申请人不算填了
    c.put("/api/projects/method/case", json={"applicants": ["  "], "dates": {"application_no": None}})
    assert [e["field"] for e in c.get("/api/projects/method/deliver/errors").json()["errors"]] == ["applicants"]


def test_xml_item_has_cpc_note(client):
    from app.routes.deliver import CPC_NOTE

    c, tmp = client
    items, _ = _items(c)
    assert CPC_NOTE == "未经 CPC 客户端验证"
    assert items["xml"]["note"] == CPC_NOTE
    assert all(items[k]["note"] is None for k in KINDS if k != "xml")


def test_on_viewer_can_read_errors(on):
    anon = test_auth.TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "viewer@example.com")
    _register(anon, "stranger@example.com")
    su, viewer, stranger = (_login(on, f"{n}@example.com") for n in ("su", "viewer", "stranger"))
    r = su.put("/api/projects/method/members", json={"email": "viewer@example.com", "role": "viewer"})
    assert r.status_code == 200, r.text
    r = viewer.get("/api/projects/method/deliver/errors")
    assert r.status_code == 200 and r.json()["errors"][0]["field"] == "applicants"
    assert stranger.get("/api/projects/method/deliver/errors").status_code == 403


def test_bundle_accepts_empty_body(client, monkeypatch):
    """R26-02：空 POST（无 body）应等同 {}——字段全有默认值，body 不该必填。"""
    import app.routes.deliver as rd

    c, _ = client
    monkeypatch.setattr(rd, "_run_bundle", lambda store, pid, body, author: rd.build_manifest(store, pid))
    r = c.post("/api/projects/method/deliver/bundle")
    assert r.status_code == 200, r.text
    assert r.json()["pid"] == "method"
