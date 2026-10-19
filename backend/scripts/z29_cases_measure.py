# -*- coding: utf-8 -*-
"""Z29 规模化台账测量：在一次性测试库灌 N∈{100,1000,10000} 合成案件，
采样 /api/v1/cases/page 与 /cases/by-key 的响应字节数与耗时，JSON 行输出。

用法（本机已起 PG）：
    PATENT_STUDIO_TEST_DATABASE_URL=postgresql://devin@localhost/postgres \
        uv run python scripts/z29_cases_measure.py [--sizes 100,1000,10000]

不落产物文件；stdout 逐行 JSON 供 report 引用。绝不连真实库——只读
PATENT_STUDIO_TEST_DATABASE_URL 并自行建/弃随机库。
"""

import argparse
import json
import os
import sys
import time
import uuid

os.environ.setdefault("PATENT_STUDIO_PRIOR_ART_PROVIDERS", "")


def _temp_db() -> str:
    test_url = os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL")
    if not test_url:
        sys.exit("需要 PATENT_STUDIO_TEST_DATABASE_URL（一次性测试库将建在其服务器上）")
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    from patent_studio.infra.db import database_url, upgrade_head

    url = make_url(test_url)
    name = f"ps_z29_{uuid.uuid4().hex[:10]}"
    admin = create_engine(database_url(url.set(database="postgres")), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    db_url = url.set(database=name).render_as_string(hide_password=False)
    upgrade_head(db_url)
    return db_url


def _app(db_url: str):
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import app.config  # noqa: F401 先缓存旧栈 AUTH_ON=False（与测试进程一致），使 /api/auth/* 走 v1 PG 栈

    os.environ["PATENT_STUDIO_DATABASE_URL"] = db_url
    os.environ["PATENT_STUDIO_AUTH"] = "on"
    os.environ.setdefault("PATENT_STUDIO_SECRET", "z29-measure-secret")
    from patent_studio.settings import get_settings

    get_settings.cache_clear()
    from patent_studio.asgi import create_app

    return create_app()


def _seed(app, n: int):
    from fastapi.testclient import TestClient
    from test_auth import _register

    email = f"z29-{uuid.uuid4().hex[:8]}@example.com"
    c0 = TestClient(app)
    _register(c0, email)
    client = TestClient(app)
    r = client.post("/api/auth/cookie/login", data={"username": email, "password": "pw-123456"})
    assert r.status_code == 204, r.text
    org = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "z29-org"},
        json={"slug": f"z29-{uuid.uuid4().hex[:8]}", "name": "Z29"},
    )
    if org.status_code != 201:
        sys.exit(f"org 创建失败 {org.status_code}: {org.text[:200]}")
    org = org.json()
    t0 = time.perf_counter()
    keys = []
    for i in range(n):
        client.post(
            f"/api/v1/organizations/{org['id']}/cases",
            headers={"Idempotency-Key": f"z29-c{i}"},
            json={"case_key": f"Z29-{i:05d}", "title": f"合成案件 {i}", "kind": "invention"},
        ).raise_for_status()
        if i % 10 == 0:
            keys.append(f"Z29-{i:05d}")
    return client, time.perf_counter() - t0, keys


def _sample(client, url: str) -> dict:
    t0 = time.perf_counter()
    r = client.get(url)
    ms = (time.perf_counter() - t0) * 1000
    return {"url": url, "status": r.status_code, "bytes": len(r.content), "ms": round(ms, 1)}


def measure(sizes: list[int]) -> None:
    db_url = _temp_db()
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tests"))
    app = _app(db_url)
    for n in sizes:
        client, seed_s, keys = _seed(app, n)
        out = {"n": n, "seed_s": round(seed_s, 1), "samples": []}
        for limit, offset in ((50, 0), (50, 500 if n > 500 else 0), (200, 0)):
            out["samples"].append(_sample(client, f"/api/v1/cases/page?limit={limit}&offset={offset}"))
        out["samples"].append(_sample(client, "/api/v1/cases/page?q=Z29-000"))
        for k in keys[:3]:
            out["samples"].append(_sample(client, f"/api/v1/cases/by-key/{k}"))
        out["samples"].append(_sample(client, "/api/v1/cases"))  # 旧全量端点对照
        print(json.dumps(out, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", default="100,1000")
    measure([int(x) for x in ap.parse_args().sizes.split(",")])
