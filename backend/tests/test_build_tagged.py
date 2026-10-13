# -*- coding: utf-8 -*-
"""tagged PDF 开关（docs/plan/21 §1.4 B2 / §5.4）：
- lo.docx_to_pdf(..., tagged=True) 只在 unoserver 路径写 UseTaggedPDF；CLI 回退忽略并报 last_tagged()=False；
- 预览构建 POST /build 传 tagged=True 并把 pdf_tagged 写进结果；
- 导出 PDF / 递交包 / CNIPA XML 资产三条路径调用 docx_to_pdf 时 tagged 未传或 False。
LibreOffice 全部用桩替代，测试不依赖 soffice / unoserver。
"""
import importlib
import inspect
import os
import shutil

import pytest
from fastapi.testclient import TestClient

from app import lo

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _fake_pdf(docx_path, out_dir):
    pdf = os.path.join(out_dir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    with open(pdf, "wb") as f:
        f.write(b"%PDF-1.7 fake")
    return pdf


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("LO_PROFILE_DIR", str(tmp_path / "lo"))
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(build)
    importlib.reload(xml_export)
    importlib.reload(main)
    return TestClient(main.app), build


@pytest.fixture()
def spy_convert(monkeypatch):
    """替换 lo 的两条转换路径：记录每次调用走的后端与 tagged，产出假 PDF。"""
    calls = []

    def uno(docx_path, pdf_path, timeout, tagged=False):
        calls.append(("unoserver", tagged))
        _fake_pdf(docx_path, os.path.dirname(pdf_path))

    def cli(docx_path, out_dir, timeout):
        calls.append(("cli", None))
        return _fake_pdf(docx_path, out_dir)

    monkeypatch.setattr(lo, "_uno_convert", uno)
    monkeypatch.setattr(lo, "_cli_convert", cli)
    monkeypatch.setattr(lo, "_uno_down_until", 0.0)
    return calls


def test_docx_to_pdf_signature_default_untagged():
    p = inspect.signature(lo.docx_to_pdf).parameters["tagged"]
    assert p.default is False and p.kind is inspect.Parameter.KEYWORD_ONLY


def test_unoserver_path_honours_tagged(tmp_path, monkeypatch, spy_convert):
    monkeypatch.setattr(lo.config, "UNOSERVER_URL", "http://127.0.0.1:2003")
    docx = tmp_path / "a.docx"
    docx.write_bytes(b"x")
    lo.docx_to_pdf(str(docx), str(tmp_path), tagged=True)
    assert spy_convert == [("unoserver", True)] and lo.last_tagged() is True and lo.last_backend() == "unoserver"
    lo.docx_to_pdf(str(docx), str(tmp_path))
    assert spy_convert[-1] == ("unoserver", False) and lo.last_tagged() is False


def test_cli_fallback_ignores_tagged(tmp_path, monkeypatch, spy_convert):
    monkeypatch.setattr(lo.config, "UNOSERVER_URL", "")
    docx = tmp_path / "a.docx"
    docx.write_bytes(b"x")
    pdf = lo.docx_to_pdf(str(docx), str(tmp_path), tagged=True)
    assert os.path.isfile(pdf)
    assert spy_convert == [("cli", None)] and lo.last_backend() == "cli" and lo.last_tagged() is False


def test_uno_convert_passes_use_tagged_pdf_filter_option(monkeypatch, tmp_path):
    """真正传给 unoserver convert() 的过滤器选项：tagged → ['UseTaggedPDF=true']，否则 []。"""
    seen = []

    class Proxy:
        def convert(self, *args):
            seen.append(args)
            _fake_pdf(args[0], os.path.dirname(args[2]))

    monkeypatch.setattr(lo, "_proxy", lambda timeout: Proxy())
    docx = tmp_path / "a.docx"
    docx.write_bytes(b"x")
    lo._uno_convert(str(docx), str(tmp_path / "a.pdf"), 5, tagged=True)
    lo._uno_convert(str(docx), str(tmp_path / "a.pdf"), 5)
    assert seen[0][3] == "pdf" and seen[0][5] == ["UseTaggedPDF=true"]
    assert seen[1][5] == []


def test_preview_build_is_tagged_only_on_unoserver(client, monkeypatch, spy_convert):
    c, build = client
    monkeypatch.setattr(lo.config, "UNOSERVER_URL", "http://127.0.0.1:2003")
    j = c.post("/api/projects/method/build", json={}).json()
    assert j["status"] == "ok", j
    assert j["pdf_tagged"] is True and spy_convert[-1] == ("unoserver", True)

    monkeypatch.setattr(lo.config, "UNOSERVER_URL", "")
    j = c.post("/api/projects/method/build", json={}).json()
    assert j["status"] == "ok", j
    assert j["pdf_tagged"] is False and spy_convert[-1] == ("cli", None)

    j = c.post("/api/projects/method/build", json={"pdf": False}).json()
    assert j["status"] == "ok" and j["pdf_tagged"] is False


def test_run_build_default_untagged(client, monkeypatch, spy_convert):
    """run_build 不传 tagged（导出 / MCP / 递交包的调用形态）→ unoserver 也产普通 PDF。"""
    c, build = client
    monkeypatch.setattr(lo.config, "UNOSERVER_URL", "http://127.0.0.1:2003")
    out = build.run_build(build.ProjectStore(build.config.PROJECTS_DIR), "method", None, None, True, "final")
    assert out.status == "ok" and out.pdf_tagged is False
    assert spy_convert == [("unoserver", False)]


def test_export_pdf_path_untagged(client, monkeypatch, spy_convert):
    c, _ = client
    monkeypatch.setattr(lo.config, "UNOSERVER_URL", "http://127.0.0.1:2003")
    r = c.get("/api/projects/method/export?fmt=pdf")
    assert r.status_code == 200, r.text
    assert spy_convert == [("unoserver", False)]


def test_deliver_bundle_calls_run_build_untagged(client, monkeypatch):
    import app.routes.deliver as rd

    c, build = client
    seen = {}

    def spy(store, pid, content, settings, **kw):
        seen.update(kw)
        return build.BuildOutcome(status="error", error={"message": "stub"})

    monkeypatch.setattr(rd, "run_build", spy)
    r = c.post("/api/projects/method/deliver/bundle", json={"mode": "final"})
    assert r.status_code == 422
    assert "want_pdf" in seen and not seen.get("tagged", False)


def test_cnipa_xml_receives_plain_docx_to_pdf(client, monkeypatch):
    """xml_export 把 lo.docx_to_pdf 原样交给 cnipa_xml（回调形态 (docx, out_dir)，tagged 用默认 False）。"""
    from app.domain import xml_export

    seen = {}

    def spy(cfg, out_dir, cb, **kw):
        seen["cb"] = cb
        raise RuntimeError("stub")

    monkeypatch.setattr(xml_export, "export_cnipa_xml", spy)
    c, _ = client
    r = c.post("/api/projects/method/export/xml", json={"mode": "final"})
    assert r.status_code == 200 and r.json()["status"] == "error"
    assert seen["cb"] is lo.docx_to_pdf
    assert inspect.signature(seen["cb"]).parameters["tagged"].default is False
