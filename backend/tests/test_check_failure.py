"""检查器故障不能成为零诊断或可交付的成功构建。"""

import test_api

from app.domain import build

client = test_api.client


def test_check_failure_blocks_formal_build_but_is_visible_in_preview(client, monkeypatch):
    c, _ = client

    def broken_checker(*args, **kwargs):
        raise RuntimeError("controlled checker failure")

    monkeypatch.setattr(build, "lint", broken_checker)
    store = c.app.state.store
    result = build.run_build(store, "method", None, None, want_pdf=False)
    assert result.status == "error" and result.docx_url is None
    assert result.diagnostics[0]["id"] == "checks.unavailable"
    assert result.diagnostics[0]["severity"] == "error"

    preview = c.post("/api/projects/method/build", json={"pdf": False}).json()
    assert preview["status"] == "ok", preview
    assert preview["diagnostics"][0]["id"] == "checks.unavailable"
    assert preview["diagnostics"][0]["severity"] == "error"


def test_invalid_settings_also_report_incomplete_check(client):
    c, _ = client
    store = c.app.state.store
    diagnostics = build.safe_lint(store, store.get("method"), store.read_content("method"), {"abstract_limit": []})
    assert len(diagnostics) == 1 and diagnostics[0]["id"] == "checks.unavailable"
