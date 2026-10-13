# -*- coding: utf-8 -*-
"""W5 oa-import-backend（docs/plan/21 §2.1 R-OA-01 / R-OA-02、§2.2 R-OA-05）：
PDF 文字层导入拆条（claims/refs/kind/confidence）、扫描件 400 oa.pdf_no_text、OA 轮次记录与 oa_reply 期限。"""
import importlib
import json
import os
import shutil
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.domain import cases
from app.oa import parse, rounds

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FIX = os.path.join(HERE, "fixtures", "oa")


def _fixture(name: str) -> bytes:
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


# ---------------- parse：refs / kind / confidence ----------------

def test_refs_and_confidence_from_text():
    text = (
        "1. 权利要求1相对于对比文件1不具备新颖性。\n"
        "2. 权利要求2-4、6相对于对比文件1和对比文件2的结合不具备创造性。\n"
        "3. 权利要求5缺乏引用基础，保护范围不清楚。\n"
        "4. 说明书摘要超过300字。\n"
    )
    items, warnings = parse.parse(text)
    assert warnings == []
    assert [(it["claims"], it["refs"], it["kind"]) for it in items] == [
        ([1], [1], "novelty"),
        ([2, 3, 4, 6], [1, 2], "inventiveness"),
        ([5], [], "clarity"),
        ([], [], "formal"),
    ]
    assert [it["confidence"] for it in items] == [1.0, 1.0, 1.0, 0.67]
    assert all(0.0 <= it["confidence"] <= 1.0 for it in items)


def test_confidence_low_when_nothing_matches():
    items, warnings = parse.parse("这是一段没有编号、没有权项、也看不出类型的文字，长度足够。")
    assert len(items) == 1 and items[0]["kind"] == "other" and items[0]["confidence"] == 0.0
    assert warnings


def test_pdf_text_layer_and_scan():
    text = parse.pdf_text(_fixture("oa_text.pdf"))
    assert "Claim 1 lacks inventive step" in text
    with pytest.raises(parse.NoTextLayer):
        parse.pdf_text(_fixture("oa_scan.pdf"))
    with pytest.raises(parse.NoTextLayer):
        parse.pdf_text(b"%PDF-1.4 not really a pdf")


def test_synthetic_notice_pdf_three_items_two_refs():
    """合成一通（notice_synthetic.md → LibreOffice PDF）：3 条意见 + 2 份对比文件。"""
    items, warnings = parse.parse(parse.pdf_text(_fixture("notice_synthetic.pdf")))
    assert warnings == []
    assert [it["id"] for it in items] == ["oa-1", "oa-2", "oa-3"]
    assert [it["kind"] for it in items] == ["novelty", "inventiveness", "clarity"]
    assert [it["claims"] for it in items] == [[1], [2, 3, 4, 6], [5]]
    assert [it["refs"] for it in items] == [[1], [1, 2], []]
    assert sorted({r for it in items for r in it["refs"]}) == [1, 2]
    for it in items:
        assert set(it) >= {"id", "claims", "refs", "kind", "confidence", "text"}
        assert 0.0 <= it["confidence"] <= 1.0


# ---------------- rounds：日期与期限 ----------------

def test_add_months_and_reply_due_rules():
    assert rounds.add_months(date(2026, 3, 1), 4) == date(2026, 7, 1)
    assert rounds.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)  # 目标月无同日 ⇒ 月末
    assert rounds.served_on(date(2026, 3, 1), "mail") == date(2026, 3, 16)  # 邮寄 +15 日
    first = {"kind": "first", "issued_on": "2026-03-01", "delivery": "electronic", "extensions": []}
    assert rounds.reply_due(first)[0] == "2026-07-01"
    assert rounds.reply_due({**first, "extensions": [{"months": 2, "requested_at": "2026-06-01"}]})[0] == "2026-09-01"
    # 2026-05-01～05-05 劳动节（国办发明电〔2025〕7号，holidays/2026.json verified）⇒ 顺延到 05-06
    assert rounds.reply_due({**first, "kind": "subsequent"})[0] == "2026-05-06"
    assert rounds.reply_due({**first, "kind": "reexam"})[0] == "2026-04-01"
    # 批10：rejection（驳回决定）⇒ reexam_request 3 个月
    assert rounds.reply_due({**first, "kind": "rejection"})[0] == "2026-06-01"
    # 2026-08-01 是周六 ⇒ 顺延到周一 08-03
    assert rounds.reply_due({**first, "issued_on": "2026-04-01"})[0] == "2026-08-03"


# ---------------- 端到端 ----------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "mock")
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    for m in (config, projects_mod, build, xml_export, main):
        importlib.reload(m)
    with TestClient(main.app) as c:
        yield c, projects, main.app


def _case(projects):
    with open(projects / "method" / "case.json", encoding="utf-8") as f:
        return json.load(f)


def test_parse_pdf_multipart_and_scan_400(client):
    c, projects, _ = client
    r = c.post("/api/projects/method/oa/parse",
               files={"file": ("notice.pdf", _fixture("notice_synthetic.pdf"), "application/pdf")})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 3
    for it in items:
        assert isinstance(it["claims"], list) and isinstance(it["refs"], list)
        assert it["kind"] in ("novelty", "inventiveness", "clarity", "support", "formal", "other")
        assert 0.0 <= it["confidence"] <= 1.0
    assert (projects / "method" / ".studio" / "oa" / "items.json").exists()

    r = c.post("/api/projects/method/oa/parse",
               files={"file": ("scan.pdf", _fixture("oa_scan.pdf"), "application/pdf")})
    assert r.status_code == 400
    assert r.json()["detail"]["kind"] == "oa.pdf_no_text"

    # JSON 文本入口保持不变
    r = c.post("/api/projects/method/oa/parse", json={"text": "1. 权利要求1不具备新颖性。\n2. 权利要求2不清楚。"})
    assert r.status_code == 200 and [it["id"] for it in r.json()["items"]] == ["oa-1", "oa-2"]
    assert c.post("/api/projects/method/oa/parse", json={"txt": "x"}).status_code == 422


def test_parse_pdf_too_large_413(client, monkeypatch):
    """通知书 PDF 上限与附件一致（monkeypatch 缩小口径验证 413；此前无上限）。"""
    c, _, _ = client
    from app.routes import oa as routes_oa
    monkeypatch.setattr(routes_oa, "ATTACHMENT_MAX_BYTES", 1024)
    r = c.post("/api/projects/method/oa/parse",
               files={"file": ("big.pdf", _fixture("notice_synthetic.pdf") + b"x" * 2048, "application/pdf")})
    assert r.status_code == 413 and r.json()["detail"]["kind"] == "oa" and r.json()["detail"]["detail"] == "big.pdf"


def test_rounds_create_deadline_extend_and_order(client):
    c, projects, _ = client
    assert c.get("/api/projects/method/oa/rounds").json() == {"rounds": []}

    r = c.post("/api/projects/method/oa/rounds",
               json={"kind": "first", "issued_on": "2026-03-01", "delivery": "electronic"})
    assert r.status_code == 201, r.text
    r1 = r.json()
    assert r1["id"] == "1" and r1["kind"] == "first" and r1["deadline_id"] == "oa-1" and r1["items"] == 0
    assert (projects / "method" / ".studio" / "oa" / "rounds" / "1.json").exists()
    dl = [d for d in _case(projects)["deadlines"] if d["kind"] == "oa_reply"]
    assert len(dl) == 1 and dl[0]["due"] == "2026-07-01" and dl[0]["done"] is False

    r = c.post("/api/projects/method/oa/rounds/1/extend", json={"months": 2})
    assert r.status_code == 200, r.text
    assert r.json()["extensions"][0]["months"] == 2
    assert r.json()["extensions"][0]["requested_at"] == cases.local_today().isoformat()
    dl = [d for d in _case(projects)["deadlines"] if d["kind"] == "oa_reply"]
    assert len(dl) == 1 and dl[0]["due"] == "2026-09-01"
    # 累计超 2 个月 ⇒ 409
    assert c.post("/api/projects/method/oa/rounds/1/extend", json={"months": 1}).status_code == 409
    assert c.post("/api/projects/method/oa/rounds/1/extend", json={"months": 3}).status_code == 422

    # 第二轮：邮寄送达的二通，2026-08-10 + 15 日 = 08-25，+2 个月 = 10-25（周日）⇒ 10-26
    r = c.post("/api/projects/method/oa/rounds",
               json={"kind": "subsequent", "issued_on": "2026-08-10", "delivery": "mail"})
    assert r.status_code == 201
    dl = {d["note"]: d for d in _case(projects)["deadlines"] if d["kind"] == "oa_reply"}
    assert sorted(d["due"] for d in dl.values()) == ["2026-09-01", "2026-10-26"]

    lst = c.get("/api/projects/method/oa/rounds").json()["rounds"]
    assert [x["id"] for x in lst] == ["1", "2"]
    for x in lst:
        assert set(x) >= {"id", "kind", "issued_on", "delivery", "deadline_id",
                          "items", "extensions", "filed_on", "created_at"}
        assert x["filed_on"] is None

    # PDF 拆条挂到第 2 轮
    r = c.post("/api/projects/method/oa/parse", data={"round_id": "2"},
               files={"file": ("notice.pdf", _fixture("notice_synthetic.pdf"), "application/pdf")})
    assert r.status_code == 200
    full = c.get("/api/projects/method/oa/rounds/2").json()
    assert len(full["items"]) == 3 and full["notice_text_sha"] and full["due"] == "2026-10-26"
    assert c.get("/api/projects/method/oa/rounds").json()["rounds"][1]["items"] == 3

    # 递交答复 ⇒ 期限 done
    r = c.put("/api/projects/method/oa/rounds/2", json={"filed_on": "2026-10-20", "reply_refs": ["oa-reply-2.md"]})
    assert r.status_code == 200
    # R35-01：filed_on 透传到列表 API（前端轮次徽章用）
    assert r.json()["filed_on"] == "2026-10-20"
    assert c.get("/api/projects/method/oa/rounds").json()["rounds"][1]["filed_on"] == "2026-10-20"
    assert [d for d in _case(projects)["deadlines"] if d["due"] == "2026-10-26"][0]["done"] is True

    # 改发文日 ⇒ 期限重算
    r = c.put("/api/projects/method/oa/rounds/1", json={"issued_on": "2026-03-02"})
    assert r.status_code == 200 and r.json()["issued_on"] == "2026-03-02"
    assert sorted(d["due"] for d in _case(projects)["deadlines"] if d["kind"] == "oa_reply") == \
        ["2026-09-02", "2026-10-26"]

    assert c.get("/api/projects/method/oa/rounds/9").status_code == 404
    assert c.delete("/api/projects/method/oa/rounds/1").status_code == 204
    assert [x["id"] for x in c.get("/api/projects/method/oa/rounds").json()["rounds"]] == ["2"]
    assert [d["due"] for d in _case(projects)["deadlines"] if d["kind"] == "oa_reply"] == ["2026-10-26"]


def test_rejection_round_registers_reexam_request_deadline(client):
    """批10：驳回决定轮次 ⇒ reexam_request 期限（kind=reexam、3 个月），法定期限不可延期。"""
    c, projects, _ = client
    r = c.post("/api/projects/method/oa/rounds",
               json={"kind": "rejection", "issued_on": "2026-03-01", "delivery": "electronic"})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "rejection"
    dl = [d for d in _case(projects)["deadlines"] if d["kind"] == "reexam"]
    assert len(dl) == 1
    assert dl[0]["due"] == "2026-06-01" and dl[0]["rule"] == "reexam_request"
    assert dl[0]["title"] == "复审请求（第 1 轮）" and "驳回决定发文 2026-03-01" in dl[0]["note"]
    # 法定期限不可延期
    assert c.post("/api/projects/method/oa/rounds/1/extend", json={"months": 1}).status_code == 422
    # filed_on = 复审请求递交日 ⇒ 期限 done
    r = c.put("/api/projects/method/oa/rounds/1", json={"filed_on": "2026-05-20"})
    assert r.status_code == 200 and _case(projects)["deadlines"][0]["done"] is True
    # 带延期的普通轮次改成驳回决定 ⇒ 延期作废
    r = c.post("/api/projects/method/oa/rounds",
               json={"kind": "subsequent", "issued_on": "2026-08-10", "delivery": "mail"})
    assert r.status_code == 201
    assert c.post("/api/projects/method/oa/rounds/2/extend", json={"months": 1}).status_code == 200
    r = c.put("/api/projects/method/oa/rounds/2", json={"kind": "rejection"})
    assert r.status_code == 200 and r.json()["extensions"] == []
    dl2 = [d for d in _case(projects)["deadlines"] if d["rule"] == "reexam_request" and not d["done"]]
    assert dl2[0]["due"] == "2026-11-25"  # 2026-08-10 +15 日 +3 个月；无延期


def test_corrupt_round_file_422(client):
    """R38-03：oa_rounds/N.json 损坏 → 列表/详情 422 而非 500。"""
    c, projects, _ = client
    d = projects / "method" / ".studio" / "oa" / "rounds"
    d.mkdir(parents=True, exist_ok=True)
    (d / "3.json").write_text("{broken", encoding="utf-8")
    r = c.get("/api/projects/method/oa/rounds")
    assert r.status_code == 422, (r.status_code, r.text)
    r = c.get("/api/projects/method/oa/rounds/3")
    assert r.status_code == 422, (r.status_code, r.text)


def test_corrupt_oa_items_422(client):
    """R107：.studio/oa/items.json 损坏 → 读路径 422 而非 500（与 rounds 同口径）。"""
    c, projects, _ = client
    d = projects / "method" / ".studio" / "oa"
    d.mkdir(parents=True, exist_ok=True)
    (d / "items.json").write_text("{broken", encoding="utf-8")
    r = c.get("/api/projects/method/oa/export.docx")
    assert r.status_code == 422, (r.status_code, r.text)


def test_corrupt_oa_answer_file_422(client):
    """R107：.studio/oa/oa-N.json 损坏 → PUT/导出 422 而非 500。"""
    c, projects, _ = client
    d = projects / "method" / ".studio" / "oa"
    d.mkdir(parents=True, exist_ok=True)
    (d / "oa-1.json").write_text("{broken", encoding="utf-8")
    r = c.put("/api/projects/method/oa/answers/oa-1", json={"points": ["x"]})
    assert r.status_code == 422, (r.status_code, r.text)
    r = c.get("/api/projects/method/oa/export.docx")
    assert r.status_code == 422, (r.status_code, r.text)
