# -*- coding: utf-8 -*-
"""Z29 规模化台账：/api/v1/cases/page 服务端分页/稳定排序/筛选 + /cases/by-key 精确作用域。

需要 PATENT_STUDIO_TEST_DATABASE_URL（pg_schema 基建）；无 PG 时按既有约定 skip。
"""

import uuid

from fastapi.testclient import TestClient
from test_auth import _login, _register

pytest_plugins = ("test_auth",)


def _user(on, tag):
    client = TestClient(on.app)
    email = f"{tag}-{uuid.uuid4().hex[:10]}@example.com"
    _register(client, email)
    return _login(on, email)


def _mk(client, tag, n, org=None):
    if org is None:
        org = client.post(
            "/api/v1/organizations",
            headers={"Idempotency-Key": f"{tag}-org"},
            json={"slug": f"{tag}-{uuid.uuid4().hex[:8]}", "name": "Org"},
        ).json()
    cases = []
    for i in range(n):
        cases.append(
            client.post(
                f"/api/v1/organizations/{org['id']}/cases",
                headers={"Idempotency-Key": f"{tag}-c{i}"},
                json={"case_key": f"{tag.upper()}-{i:03d}", "title": f"案 {i}", "kind": "invention"},
            ).json()
        )
    return org, cases


def test_cases_page_paginates_with_stable_order(on):
    client = _user(on, "pg-a")
    _mk(client, "pa", 7)
    r = client.get("/api/v1/cases/page?limit=3&offset=0")
    assert r.status_code == 200
    p0 = r.json()
    assert p0["total"] == 7 and len(p0["items"]) == 3 and p0["limit"] == 3 and p0["offset"] == 0
    p1 = client.get("/api/v1/cases/page?limit=3&offset=3").json()
    p2 = client.get("/api/v1/cases/page?limit=3&offset=6").json()
    keys = [c["case_key"] for c in p0["items"] + p1["items"] + p2["items"]]
    assert len(keys) == len(set(keys)) == 7  # 页间不重复不遗漏
    assert len(p2["items"]) == 1


def test_cases_page_filters(on):
    client = _user(on, "pg-b")
    _mk(client, "pb", 5)
    r = client.get("/api/v1/cases/page?q=PB-00")
    assert r.json()["total"] == 5
    r = client.get("/api/v1/cases/page?q=PB-001")
    j = r.json()
    assert j["total"] == 1 and j["items"][0]["case_key"] == "PB-001"
    r = client.get("/api/v1/cases/page?status=drafting")
    assert r.json()["total"] == 0  # 新案默认 intake
    assert client.get("/api/v1/cases/page?status=intake").json()["total"] == 5
    assert client.get("/api/v1/cases/page?kind=design").json()["total"] == 0


def test_cases_page_scoped_to_visible_cases(on):
    owner = _user(on, "pg-c")
    outsider = _user(on, "pg-d")
    _mk(owner, "pc", 4)
    assert outsider.get("/api/v1/cases/page").json()["total"] == 0


def test_cases_by_key_exact_scope_and_ambiguity(on):
    a = _user(on, "pg-e")
    b = _user(on, "pg-f")
    _mk(a, "pe", 3)
    org_b = b.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "pf-org"},
        json={"slug": f"pf-{uuid.uuid4().hex[:8]}", "name": "OrgB"},
    ).json()
    b.post(
        f"/api/v1/organizations/{org_b['id']}/cases",
        headers={"Idempotency-Key": "pf-c0"},
        json={"case_key": "PE-000", "title": "跨机构重名", "kind": "invention"},
    )
    # a 视角：PE-000 仅自己机构一案；b 视角同理；互不越界
    mine = a.get("/api/v1/cases/by-key/PE-000").json()
    assert len(mine) == 1 and mine[0]["title"] == "案 0"
    theirs = b.get("/api/v1/cases/by-key/PE-000").json()
    assert len(theirs) == 1 and theirs[0]["title"] == "跨机构重名"
    assert a.get("/api/v1/cases/by-key/NOPE").json() == []
    # 同机构内 case_key 唯一 ⇒ 同一主体内至多 1 个精确匹配（歧义来自跨机构共享场景，
    # 此处验证返回列表语义即可）
