# -*- coding: utf-8 -*-
"""单元 deadlines-backend（docs/plan/21-w5-spec.md R-HOME-05/06、R-CASE-02、§1.3 A1/A2/A5）：
规则表 + compute（送达推定 / 月加法 / 周末与节假日顺延）、case.json 兼容与 auto 重算、deadlines.add 契约、
期限中心 API（跨案聚合 / ACL / 改期 / 完成）、到期扫描 emit。"""
import importlib
import json
import os
import shutil
import sys
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import deadlines
from app.deadlines import compute, scan
from app.domain import cases, events, history

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SECRET = "test-secret-not-for-production-32bytes+"


# ---------------------------------------------------------------- 规则 + compute ----


def test_days_left_uses_shanghai_today_like_compute(monkeypatch):
    """台账 next_deadline（cases.days_left）与期限中心（compute.today）同一「今天」：
    UTC 17:30 = 北京次日 01:30，服务器 date.today() 会少算 1 天。"""
    from datetime import UTC
    from datetime import datetime as _dt

    class FixedDT(_dt):
        @classmethod
        def now(cls, tz=None):
            base = _dt(2026, 9, 6, 17, 30, tzinfo=UTC)
            return base.astimezone(tz) if tz else base.replace(tzinfo=None)

    monkeypatch.setattr(cases, "datetime", FixedDT)
    monkeypatch.setattr(compute, "datetime", FixedDT)
    assert cases.local_today() == compute.today() == date(2026, 9, 7)
    assert cases.days_left("2026-09-10") == (date(2026, 9, 10) - compute.today()).days == 3
    c = cases.Case(deadlines=[cases.Deadline(kind="oa_reply", due="2026-09-10")])
    assert cases.next_deadline(c)["days_left"] == 3


def test_target_filing_days_left_shares_shanghai_today(monkeypatch):
    """ux-04：目标递交倒计时与 days_left 同源（UTC 17:30 = 北京次日 01:30）；无 target_filing ⇒ None。"""
    from datetime import UTC
    from datetime import datetime as _dt

    class FixedDT(_dt):
        @classmethod
        def now(cls, tz=None):
            base = _dt(2026, 9, 6, 17, 30, tzinfo=UTC)
            return base.astimezone(tz) if tz else base.replace(tzinfo=None)

    monkeypatch.setattr(cases, "datetime", FixedDT)
    monkeypatch.setattr(compute, "datetime", FixedDT)
    assert cases.local_today() == compute.today() == date(2026, 9, 7)
    c = cases.Case(dates=cases.Dates(target_filing="2026-09-10"))
    assert cases.target_filing_days_left(c) == 3  # 服务器 UTC date.today() 会错算成 4
    assert cases.target_filing_days_left(cases.Case(dates=cases.Dates(target_filing="2026-09-07"))) == 0
    assert cases.target_filing_days_left(cases.Case(dates=cases.Dates(target_filing="2026-09-05"))) == -2
    assert cases.target_filing_days_left(cases.Case()) is None
    s = cases.summary(c)
    assert s["target_filing_days_left"] == 3 and s["next_deadline"] is None and s["deadlines"] == []
    assert cases.summary(cases.Case())["target_filing_days_left"] is None
    # 显式 today 与隐式一致
    assert cases.target_filing_days_left(c, date(2026, 9, 7)) == 3


def test_rules_have_required_fields_and_legal_basis_url():
    with open(compute.RULES_FILE, encoding="utf-8") as f:
        raw = json.load(f)["rules"]
    ids = [r["id"] for r in raw]
    assert ids == ["priority", "publication", "exam_request", "annual_fee",
                   "oa_first_reply", "oa_subsequent_reply", "reexam_notice_reply", "reexam_request"]
    for r in raw:
        assert r["kind"] in cases.DEADLINE_KINDS
        assert r["base_date"] and r["offset"]
        lb = r["legal_basis"]
        assert lb["law"] and lb["article"] and lb["url"].startswith("https://"), r["id"]
    assert compute.rule("exam_request").offset == {"years": 3}
    assert compute.rule("oa_first_reply").offset == {"months": 4}
    assert compute.rule("oa_subsequent_reply").offset == {"months": 2}
    assert compute.rule("reexam_request").offset == {"months": 3}
    assert compute.rule("priority").offset == {"months": 12}
    assert compute.rule("publication").offset == {"months": 18}
    with pytest.raises(KeyError):
        compute.rule("nope")


def test_reexam_and_publication_have_dedicated_kinds(tmp_path, monkeypatch):
    """批8：publication / reexam 从 custom 归位为专属 DeadlineKind（rules.json + add 物化）。"""
    assert compute.rule("reexam_request").kind == "reexam"
    assert compute.rule("publication").kind == "publication"
    from app import config

    project = tmp_path / "p1"
    project.mkdir()
    (project / "content.md").write_text("# x\n", encoding="utf-8")
    monkeypatch.setattr(config, "PROJECTS_DIR", str(tmp_path))
    d = deadlines.add("p1", "reexam_request", "2026-03-01", {"delivery": "electronic"})
    assert d.id == "reexam_request:2026-03-01" and d.kind == "reexam" and d.due == "2026-06-01" and d.source == "auto"


@pytest.mark.parametrize("rule_id, base, delivery, due, verified", [
    ("oa_first_reply", "2026-03-01", "electronic", "2026-07-01", True),   # 发文日即送达日 +4 月
    ("oa_first_reply", "2026-03-01", "mail", "2026-07-16", True),         # +15 日推定送达
    ("oa_first_reply", "2026-01-31", "electronic", "2026-06-01", True),   # 5-31 周日 ⇒ 周一
    ("oa_subsequent_reply", "2026-08-01", "electronic", "2026-10-08", True),  # 10-01 国庆 ⇒ 10-08
    ("oa_subsequent_reply", "2025-12-31", "electronic", "2026-02-28", True),  # 月末夹紧；2-28 周六调休上班不顺延
    ("reexam_request", "2026-03-01", "mail", "2026-06-16", True),
    ("exam_request", "2026-03-01", None, "2029-03-01", False),            # 2029 无节假日表 ⇒ warning
    ("priority", "2025-06-30", None, "2026-06-30", True),
    ("publication", "2026-03-01", None, "2027-09-01", False),
])
def test_compute_table(rule_id, base, delivery, due, verified):
    got = compute.compute(compute.rule(rule_id), date.fromisoformat(base), delivery=delivery)
    assert got.due.isoformat() == due
    assert got.holidays_verified is verified


def test_add_months_clamps_and_roll_forward_uses_holiday_table():
    assert compute.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert compute.add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)
    assert compute.roll_forward(date(2026, 2, 15)) == (date(2026, 2, 24), True)     # 春节 2-15…2-23
    assert compute.roll_forward(date(2026, 9, 20)) == (date(2026, 9, 20), True)     # 周日但调休上班
    assert compute.roll_forward(date(2027, 1, 3)) == (date(2027, 1, 4), False)      # 无表：只按周末
    assert compute.deemed_received(date(2026, 3, 1), "mail") == date(2026, 3, 16)
    assert deadlines.load_holidays(2026)["verified"] is True
    assert deadlines.load_holidays(1999) == {"year": 1999, "source": "", "verified": False,
                                             "holidays": [], "workdays": []}


def test_annual_fee_is_next_filing_anniversary_after_grant():
    got = compute.compute(compute.rule("annual_fee"), date(2029, 5, 20), anniversary_of=date(2026, 3, 1))
    assert got.due == date(2030, 3, 1)
    got = compute.compute(compute.rule("annual_fee"), date(2029, 2, 1), anniversary_of=date(2026, 3, 1))
    assert got.due == date(2029, 3, 1)


# ---------------------------------------------------------------- case.json 兼容 + 重算 ----

LEGACY = {"version": 1, "case_no": "P-1", "kind": "invention", "status": "oa", "owner_user_id": None,
          "client": "甲方", "applicants": [], "inventors": [], "tags": [],
          "dates": {"opened": "2025-01-01", "target_filing": None, "filed": None, "application_no": None},
          "deadlines": [{"kind": "filing", "due": "2099-01-01", "note": "旧", "done": False}], "archived": False}


def test_normalize_case_loads_legacy_json_without_new_fields():
    case = cases.normalize_case(LEGACY)
    assert case.priority == [] and case.attorney is None and case.fee_status is None and case.client_contact == ""
    assert case.dates.publication is None and case.dates.exam_request is None and case.dates.grant is None
    d, = case.deadlines
    assert d.id.startswith("m-") and d.source == "manual" and d.kind == "filing" and d.title == ""  # kind 原样保留
    assert d.due == "2099-01-01" and d.note == "旧" and d.legal_basis is None and d.override_reason is None
    assert cases.normalize_case({}).deadlines == []


def test_recompute_auto_keeps_manual_and_drops_stale():
    case = cases.normalize_case({**LEGACY, "dates": {**LEGACY["dates"], "filed": "2026-03-01"}})
    case, ok = deadlines.recompute(case)
    assert ok is False  # 2027 / 2029 无节假日表
    by_id = {d.id: d for d in case.deadlines}
    assert by_id["exam_request"].due == "2029-03-01" and by_id["exam_request"].source == "auto"
    assert by_id["exam_request"].legal_basis.url.startswith("https://")
    assert by_id["publication"].due == "2027-09-01"
    assert "priority" not in by_id and "annual_fee" not in by_id
    assert len(case.deadlines) == 3  # 旧手工条保留
    # 人工改期 ⇒ 之后重算不覆盖
    manual = by_id["exam_request"].model_copy(update={"due": "2028-12-01", "source": "manual",
                                                      "override_reason": "客户要求提前"})
    case = cases.replace_deadline(case, manual)
    case = case.model_copy(update={"priority": [cases.Priority(date="2025-06-30")]})
    case, _ = deadlines.recompute(case)
    by_id = {d.id: d for d in case.deadlines}
    assert by_id["exam_request"].due == "2028-12-01" and by_id["exam_request"].source == "manual"
    assert by_id["publication"].due == "2026-12-30"          # 有优先权 ⇒ 从最早优先权日起算
    assert by_id["priority"].due == "2026-06-30" and by_id["priority"].done is True  # 已提交 ⇒ 视为完成
    # 基准日没了 ⇒ auto 条目删除
    case = case.model_copy(update={"priority": []})
    case, _ = deadlines.recompute(case)
    assert case.deadline("priority") is None and case.deadline("exam_request").due == "2028-12-01"


def test_add_contract_for_oa_unit(tmp_path, monkeypatch):
    from app import config

    project = tmp_path / "p1"
    project.mkdir()
    (project / "content.md").write_text("# x\n", encoding="utf-8")
    monkeypatch.setattr(config, "PROJECTS_DIR", str(tmp_path))
    d = deadlines.add("p1", "oa_reply", "2026-03-01", {"round": 1, "round_id": "r1", "delivery": "mail"})
    assert d.id == "oa_first_reply:r1" and d.kind == "oa_reply" and d.due == "2026-07-16" and d.source == "auto"
    assert d.base_date == "2026-03-01" and d.note == "送达方式：mail" and d.legal_basis.url
    d2 = deadlines.add("p1", "oa_reply", "2026-09-01", {"round": 2, "round_id": "r2"})
    assert d2.id == "oa_subsequent_reply:r2" and d2.due == "2026-11-02"  # 11-01 周日
    saved = cases.load_case(str(project))
    assert [x.id for x in saved.deadlines] == ["oa_first_reply:r1", "oa_subsequent_reply:r2"]
    # 幂等覆盖；人工改期后不覆盖
    assert deadlines.add("p1", "oa_first_reply", "2026-03-02", {"round_id": "r1"}).due == "2026-07-02"
    manual = saved.deadline("oa_first_reply:r1").model_copy(update={"source": "manual", "due": "2026-08-01",
                                                                    "override_reason": "延期"})
    cases.save_case(str(project), cases.replace_deadline(cases.load_case(str(project)), manual))
    assert deadlines.add("p1", "oa_first_reply", "2026-03-03", {"round_id": "r1"}).due == "2026-08-01"
    with pytest.raises(ValueError):
        deadlines.add("p1", "exam_request", "2026-03-01")


# ---------------------------------------------------------------- API ----


def _reload_app():
    import app.auth
    import app.auth.router
    import app.routes
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod
    from app.routes import cases as routes_cases
    from app.routes import deadlines as routes_deadlines

    importlib.reload(config)
    for name in ("db", "users", "acl", "schemas", "create_user"):
        sys.modules.pop(f"app.auth.{name}", None)
        app.auth.__dict__.pop(name, None)
    importlib.reload(app.auth)
    importlib.reload(app.auth.router)
    importlib.reload(projects_mod)
    importlib.reload(app.routes)  # project_or_404 的 ProjectError 同样要重绑
    importlib.reload(routes_cases)
    importlib.reload(routes_deadlines)
    importlib.reload(build)
    importlib.reload(xml_export)
    return importlib.reload(main)


def _projects(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    for pid in ("method", "system"):
        shutil.copytree(os.path.join(ROOT, "examples", pid), projects / pid,
                        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    return projects


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    main = _reload_app()
    return TestClient(main.app), projects


@pytest.fixture()
def on(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    main = _reload_app()
    yield main, projects
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    _reload_app()


def _iso(days: int) -> str:
    return (compute.today() + timedelta(days=days)).isoformat()


# 两案各 3 条（含 1 条已完成不计数），分组：today 1 / 7d 2 / 30d 1 / overdue 1
SEED = {
    "method": [{"id": "a", "kind": "oa_reply", "due": _iso(0), "title": "一通答复"},
               {"id": "b", "kind": "exam_request", "due": _iso(3)},
               {"id": "c", "kind": "annual_fee", "due": _iso(-2)}],
    "system": [{"id": "d", "kind": "oa_reply", "due": _iso(7)},
               {"id": "e", "kind": "client_review", "due": _iso(20)},  # W4 自由 kind → API 上 custom
               {"id": "f", "kind": "priority", "due": _iso(1), "done": True}],
}


def _seed(c, client_names=("甲方", "乙方"), **fields):
    for (pid, items), name in zip(SEED.items(), client_names):
        r = c.put(f"/api/projects/{pid}/case", json={"client": name, "deadlines": items, **fields})
        assert r.status_code == 200, r.text


def test_list_deadlines_groups_counts_and_filters(client):
    c, projects = client
    _seed(c)
    r = c.get("/api/deadlines")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {"today": 1, "7d": 2, "30d": 1, "overdue": 1}
    assert body["holidays_missing"] is False
    assert [i["id"] for i in body["items"]] == ["c", "a", "b", "d", "e", "f"]  # 未完成按 due 升序，已完成最后
    by_id = {i["id"]: i for i in body["items"]}
    assert by_id["a"]["status"] == "due_soon" and by_id["a"]["days_left"] == 0 and by_id["a"]["title"] == "一通答复"
    assert by_id["c"]["status"] == "overdue" and by_id["c"]["days_left"] == -2
    assert by_id["e"]["status"] == "upcoming" and by_id["e"]["client"] == "乙方" and by_id["e"]["source"] == "manual"
    assert by_id["e"]["kind"] == "custom" and by_id["e"]["title"] == "client_review"
    assert by_id["f"]["status"] == "done" and by_id["f"]["done"] is True
    assert by_id["b"]["title"]  # 无 title ⇒ 用案件标题
    for rng, expect in (("today", ["a"]), ("7d", ["b", "d"]), ("30d", ["e"]), ("overdue", ["c"])):
        got = c.get(f"/api/deadlines?range={rng}").json()
        assert [i["id"] for i in got["items"]] == expect, rng
        assert got["counts"][rng] == len(expect)
    assert [i["id"] for i in c.get("/api/deadlines?kind=oa_reply").json()["items"]] == ["a", "d"]
    assert [i["id"] for i in c.get("/api/deadlines?kind=custom").json()["items"]] == ["e"]
    assert [i["id"] for i in c.get("/api/deadlines?client=甲方").json()["items"]] == ["c", "a", "b"]
    assert c.get("/api/deadlines?owner=nobody").json()["items"] == []
    assert c.get("/api/deadlines?range=yesterday").status_code == 422
    assert c.get("/api/deadlines?kind=filing").status_code == 422


def test_target_filing_exposed_on_projects_and_deadlines(client):
    """ux-04：GET /api/projects 每行 case.target_filing_days_left；GET /api/deadlines.target_filings 只读列表，
    不进 items / counts（rules.json 语义不变），受 range / client 筛选，已递交（dates.filed）不列。"""
    c, projects = client
    _seed(c)
    rows = {p["id"]: p for p in c.get("/api/projects").json()}
    assert rows["method"]["case"]["target_filing_days_left"] is None
    assert rows["system"]["case"]["target_filing_days_left"] is None
    assert c.get("/api/deadlines").json()["target_filings"] == []
    r = c.put("/api/projects/method/case", json={"dates": {"target_filing": _iso(5)}})
    assert r.status_code == 200, r.text
    assert r.json()["target_filing_days_left"] == 5
    rows = {p["id"]: p for p in c.get("/api/projects").json()}
    assert rows["method"]["case"]["target_filing_days_left"] == 5
    body = c.get("/api/deadlines").json()
    assert body["counts"] == {"today": 1, "7d": 2, "30d": 1, "overdue": 1}  # 不计入期限分组
    assert [i["id"] for i in body["items"]] == ["c", "a", "b", "d", "e", "f"]
    assert body["target_filings"] == [{"pid": "method", "case_no": rows["method"]["case"]["case_no"] or None,
                                       "title": rows["method"]["title"], "target_filing": _iso(5),
                                       "target_filing_days_left": 5, "owner": None, "client": "甲方"}]
    assert [t["pid"] for t in c.get("/api/deadlines?range=7d").json()["target_filings"]] == ["method"]
    assert c.get("/api/deadlines?range=30d").json()["target_filings"] == []
    assert c.get("/api/deadlines?client=乙方").json()["target_filings"] == []
    assert c.get("/api/deadlines?kind=oa_reply").json()["target_filings"] == []
    # 已过目标日 ⇒ 负数，归 overdue 组；已递交 ⇒ 列表不列但台账字段仍算
    c.put("/api/projects/system/case", json={"dates": {"target_filing": _iso(-3)}})
    overdue = c.get("/api/deadlines?range=overdue").json()["target_filings"]
    assert [t["target_filing_days_left"] for t in overdue] == [-3]
    c.put("/api/projects/system/case", json={"dates": {"filed": _iso(-1)}})
    assert [t["pid"] for t in c.get("/api/deadlines").json()["target_filings"]] == ["method"]
    rows = {p["id"]: p for p in c.get("/api/projects").json()}
    assert rows["system"]["case"]["target_filing_days_left"] == -3


def test_done_override_and_compute_routes(client):
    c, projects = client
    _seed(c)
    r = c.post("/api/projects/method/deadlines/b/done")
    assert r.status_code == 200, r.text
    assert r.json()["done"] is True and r.json()["status"] == "done" and r.json()["done_at"]
    assert c.get("/api/deadlines").json()["counts"]["7d"] == 1
    # W12 R15-01：撤销完成——{done:false} 回未态（修前端点忽略 body 恒置 done=true）
    r = c.post("/api/projects/method/deadlines/b/done", json={"done": False})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["done"] is False and body["done_at"] is None and body["status"] != "done"
    assert c.get("/api/deadlines").json()["counts"]["7d"] == 2
    r = c.post("/api/projects/method/deadlines/b/done")  # 恢复 done 供后续断言
    assert r.json()["done"] is True
    # 改期：due 可选，reason 必填
    r = c.put("/api/projects/method/deadlines/a", json={"due": _iso(10), "override_reason": "客户确认延期"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["due"] == _iso(10) and body["source"] == "manual" and body["override_reason"] == "客户确认延期"
    assert c.put("/api/projects/method/deadlines/a", json={"due": _iso(10)}).status_code == 422
    assert c.put("/api/projects/method/deadlines/zz", json={"override_reason": "x"}).status_code == 404
    assert c.post("/api/projects/method/deadlines/zz/done").status_code == 404
    assert c.post("/api/projects/nope/deadlines/a/done").status_code == 404
    # PUT /case 写 dates.filed ⇒ auto 期限出现；再 compute 幂等；manual 不动
    r = c.put("/api/projects/method/case", json={"dates": {"filed": "2026-03-01"}})
    assert r.status_code == 200, r.text
    case = cases.load_case(str(projects / "method"))
    assert case.dates.filed == "2026-03-01" and case.deadline("exam_request").due == "2029-03-01"
    assert case.deadline("exam_request").source == "auto" and case.deadline("a").due == _iso(10)
    r = c.post("/api/projects/method/deadlines/compute")
    assert r.status_code == 200, r.text
    body = r.json()
    assert {i["id"] for i in body["items"]} == {"a", "b", "c", "exam_request", "publication"}
    assert body["holidays_missing"] is True  # 2027 / 2029 无表
    ex = next(i for i in body["items"] if i["id"] == "exam_request")
    assert ex["legal_basis"]["url"].startswith("https://")
    assert ex["rule"] == "exam_request" and ex["base_date"] == "2026-03-01"
    # 部分 dates patch 不抹掉旧字段
    c.put("/api/projects/method/case", json={"dates": {"grant": "2029-05-20"}})
    case = cases.load_case(str(projects / "method"))
    assert case.dates.filed == "2026-03-01" and case.deadline("annual_fee").due == "2030-03-01"
    msgs = [v["message"] for v in history.log(str(projects / "method"))]
    assert msgs[:1] == ["case: update dates"]
    assert "case: deadline done b" in msgs and "case: deadlines recompute" not in msgs  # 重算无变化 ⇒ 不记事件
    assert "case: deadline undone b" in msgs
    assert any(m.startswith("case: deadline override a → ") for m in msgs)


def _register(main, email, password="pw-123456"):
    c = TestClient(main.app)
    r = c.post("/api/auth/register", json={"email": email, "password": password, "display_name": email.split("@")[0]})
    assert r.status_code == 201, r.text
    return r.json()


def _login(main, email, password="pw-123456"):
    c = TestClient(main.app)
    assert c.post("/api/auth/cookie/login", data={"username": email, "password": password}).status_code == 204
    return c


def test_on_list_is_acl_filtered_and_writes_need_agent(on):
    main, projects = on
    users = {email: _register(main, f"{email}@example.com")["id"] for email in ("boss", "agent", "viewer")}
    boss = _login(main, "boss@example.com")
    for email, role in (("agent", "agent"), ("viewer", "viewer")):
        r = boss.put("/api/projects/method/members", json={"email": f"{email}@example.com", "role": role})
        assert r.status_code == 200, r.text
    boss_uid = users["boss"]
    _seed(boss, owner_user_id=boss_uid)
    assert TestClient(main.app).get("/api/deadlines").status_code == 401
    body = boss.get("/api/deadlines").json()
    assert body["counts"] == {"today": 1, "7d": 2, "30d": 1, "overdue": 1}
    assert body["items"][0]["owner"]["display_name"] == "boss"
    assert body["items"][0]["owner"]["avatar_color"] == ""  # 未选 ⇒ 空串，前端按名派生
    assert boss.put("/api/users/me", json={"avatar_color": "teal"}).status_code == 200
    assert boss.get("/api/deadlines").json()["items"][0]["owner"]["avatar_color"] == "teal"
    agent = _login(main, "agent@example.com")
    got = agent.get("/api/deadlines").json()
    assert {i["pid"] for i in got["items"]} == {"method"}
    assert got["counts"] == {"today": 1, "7d": 1, "30d": 0, "overdue": 1}
    assert agent.post("/api/projects/method/deadlines/b/done").status_code == 200
    assert agent.post("/api/projects/system/deadlines/d/done").status_code == 403
    viewer = _login(main, "viewer@example.com")
    assert viewer.get("/api/deadlines").status_code == 200
    for r in (viewer.post("/api/projects/method/deadlines/a/done"),
              viewer.put("/api/projects/method/deadlines/a", json={"override_reason": "x"}),
              viewer.post("/api/projects/method/deadlines/compute")):
        assert r.status_code == 403 and r.json()["detail"]["kind"] == "forbidden", r.text
    assert {i["pid"] for i in boss.get(f"/api/deadlines?owner={boss_uid}").json()["items"]} == {"method", "system"}
    assert boss.get("/api/deadlines?owner=nobody").json()["items"] == []


def test_on_owner_account_gone_shows_placeholder_not_id(on):
    """owner_user_id 指向已删 / 非法账号 ⇒ display_name 是人话占位，不把 uuid 当姓名露给用户。"""
    from app.routes.deadlines import OWNER_GONE

    main, projects = on
    _register(main, "boss@example.com")
    boss = _login(main, "boss@example.com")
    gone = "00000000-0000-4000-8000-000000000001"
    _seed(boss, owner_user_id=gone)
    items = boss.get("/api/deadlines").json()["items"]
    assert items and all(i["owner"]["id"] == gone for i in items)
    assert all(i["owner"]["display_name"] == OWNER_GONE for i in items)
    assert gone not in {i["owner"]["display_name"] for i in items}


def test_done_emits_event_and_scan_emits_due_soon(client):
    c, projects = client
    _seed(c)
    got = []
    unsub = events.subscribe("*", lambda ev: got.append((ev.kind, ev.pid, ev.data)))
    try:
        c.post("/api/projects/method/deadlines/a/done")
        assert got == [("deadline.done", "method", {"id": "a", "kind": "oa_reply", "due": _iso(0)})]
        got.clear()
        today = compute.today()
        cases.save_case(str(projects / "system"), cases.load_case(str(projects / "system")).model_copy(update={
            "deadlines": [cases.Deadline(id="x30", due=(today + timedelta(days=30)).isoformat()),
                          cases.Deadline(id="x7", due=(today + timedelta(days=7)).isoformat()),
                          cases.Deadline(id="x1", due=(today + timedelta(days=1)).isoformat()),
                          cases.Deadline(id="x1d", due=(today + timedelta(days=1)).isoformat(), done=True),
                          cases.Deadline(id="x2", due=(today + timedelta(days=2)).isoformat())]}))
        assert scan.scan_once(str(projects), today) == 3
        assert [(k, d["id"], d["days"]) for k, _, d in got] == [
            ("deadline.due", "x30", 30), ("deadline.due", "x7", 7), ("deadline.due", "x1", 1)]
        assert scan.scan_once(str(projects), today + timedelta(days=60)) == 0
    finally:
        unsub()
