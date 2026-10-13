# -*- coding: utf-8 -*-
"""F3 模板预设：schema、templates/*.json 落盘（PROJECTS_DIR 同级）、六条路由端到端、apply 走 normalize_settings。"""
import importlib
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BODY = {"name": "默认-宋体", "description": "d",
        "settings": {"style": {"page": {"margin_left_mm": 30}, "fonts": {"body_cjk": "宋体"}}, "abstract_limit": 280}}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    projects = tmp_path / "data" / "projects"
    projects.mkdir(parents=True)
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    from app import config, main
    from app.domain import build, templates, xml_export
    from app.domain import projects as projects_mod

    for m in (config, projects_mod, build, xml_export, templates, main):
        importlib.reload(m)
    return TestClient(main.app), tmp_path / "data" / "templates", templates


def test_template_schema(env):
    _, _, templates = env
    t = templates.TemplateIn(name="t1")
    assert t.document_type == "patent_cn_invention" and t.settings.style == {}
    with pytest.raises(ValidationError):
        templates.TemplateIn(name="a/b")
    with pytest.raises(ValidationError):
        templates.TemplateIn(name="t", document_type="thesis")
    assert templates.template_path("t1").replace(os.sep, "/").endswith("/data/templates/t1.json")
    assert templates.templates_dir().replace(os.sep, "/").endswith("/data/templates")
    with pytest.raises(templates.ProjectError):
        templates.template_path("../x")


def test_crud_and_json_roundtrip(env):
    c, tdir, _ = env
    assert c.get("/api/templates").json() == [] and not tdir.exists()
    r = c.post("/api/templates", json=BODY)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["name"] == "默认-宋体" and t["document_type"] == "patent_cn_invention"
    assert t["settings"] == {"style": BODY["settings"]["style"], "sub_except": None, "abstract_limit": 280}
    assert t["created_at"] == t["updated_at"] and t["created_at"].endswith("+00:00")
    # 落盘 = 导出 JSON 形状
    on_disk = json.load(open(tdir / "默认-宋体.json", encoding="utf-8"))
    assert on_disk == t
    assert c.get("/api/templates/默认-宋体").json() == t
    # 重复 409（ProjectError → main.py 统一的 {"detail": 消息}）
    r = c.post("/api/templates", json=BODY)
    assert r.status_code == 409 and "已存在" in r.json()["detail"]
    # 导出 JSON 原样导入为另一名字：时间戳由服务端重写
    exported = dict(t, name="副本", created_at="1999-01-01T00:00:00+00:00", updated_at="1999-01-01T00:00:00+00:00")
    r = c.post("/api/templates", json=exported)
    assert r.status_code == 201 and r.json()["created_at"] != "1999-01-01T00:00:00+00:00"
    assert [x["name"] for x in c.get("/api/templates").json()] == ["副本", "默认-宋体"]
    # PUT 覆盖：保留 created_at，路径名优先于 body.name
    r = c.put("/api/templates/默认-宋体", json=dict(BODY, name="别名", description="改"))
    assert r.status_code == 200 and r.json()["name"] == "默认-宋体" and r.json()["description"] == "改"
    assert r.json()["created_at"] == t["created_at"]
    assert not (tdir / "别名.json").exists()
    # PUT 新建
    assert c.put("/api/templates/新建", json={"name": "新建"}).status_code == 200
    assert c.get("/api/templates/新建").json()["settings"]["style"] == {}
    # 404 / 422 / 400
    assert c.get("/api/templates/不存在").status_code == 404
    assert c.delete("/api/templates/不存在").status_code == 404
    assert c.post("/api/templates", json={"name": "bad name!"}).status_code == 422
    assert c.put("/api/templates/bad name!", json={"name": "x"}).status_code == 400
    assert c.delete("/api/templates/默认-宋体").status_code == 204
    assert not (tdir / "默认-宋体.json").exists()
    assert sorted(x["name"] for x in c.get("/api/templates").json()) == ["副本", "新建"]


def test_list_skips_bad_files(env):
    c, tdir, _ = env
    tdir.mkdir(parents=True)
    (tdir / "坏.json").write_text("{not json", encoding="utf-8")
    (tdir / "缺字段.json").write_text('{"name": "x"}', encoding="utf-8")
    (tdir / "readme.txt").write_text("x", encoding="utf-8")
    assert c.get("/api/templates").json() == []
    assert c.post("/api/templates", json={"name": "好"}).status_code == 201
    assert [t["name"] for t in c.get("/api/templates").json()] == ["好"]


def test_apply_normalizes_and_persists(env):
    c, _, _ = env
    before = c.get("/api/projects/method").json()["settings"]
    assert before["style"] == {} and before["abstract_limit"] == 300
    assert c.post("/api/projects/method/templates/apply", json={"name": "无"}).status_code == 404
    assert c.post("/api/projects/无/templates/apply", json={"name": "无"}).status_code == 404
    c.post("/api/templates", json=BODY)
    r = c.post("/api/projects/method/templates/apply", json={"name": "默认-宋体"})
    assert r.status_code == 200, r.text
    s = r.json()["settings"]
    assert s["abstract_limit"] == 280
    assert s["style"] == {"page": {"margin_left_mm": 30}}  # fonts.body_cjk=宋体 等于默认 → style_diff 去掉
    assert s["abstract_figure"] == before["abstract_figure"] and s["spec_figures"] == before["spec_figures"]
    assert s["sub_except"] == before["sub_except"]  # 模板未给 sub_except → 保留案卷原值
    assert c.get("/api/projects/method").json()["settings"] == s  # 已写入 studio.json
    # 模板带 sub_except：整体替换；style 中等于默认的叶子被去掉，没给 abstract_limit 则保留上一次的 280
    t2 = {"style": {"page": {"margin_left_mm": 25, "margin_right_mm": 20}}, "sub_except": ["x_y"]}
    c.post("/api/templates", json={"name": "T2", "settings": t2})
    s = c.post("/api/projects/method/templates/apply", json={"name": "T2"}).json()["settings"]
    assert s["sub_except"] == ["x_y"] and s["abstract_limit"] == 280
    assert s["style"] == {"page": {"margin_right_mm": 20}}
