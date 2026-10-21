# -*- coding: utf-8 -*-
"""C0/P02 保存—预览—导出一致性：完整输入指纹 + 可信产物校验 + 陈旧请求拒绝。

覆盖：仅 settings 变更、仅图资源变更、manifest 缺失、产物 hash 篡改、
expected_sha 陈旧请求、export 使用本次 outcome.build_id、空正文门禁。
"""

import glob
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("LO_PROFILE_DIR", str(tmp_path / "lo"))
    import importlib

    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(build)
    importlib.reload(xml_export)
    importlib.reload(main)
    return TestClient(main.app), projects


def _builds(projects):
    return sorted(glob.glob(os.path.join(str(projects / "method"), ".studio", "builds", "*")))


def _dir_for(projects, build_id):
    """按 build_id 精确定位构建目录——同秒构建词法序按 uuid 尾排，[-1] 词法最新≠本次。"""
    return os.path.join(str(projects / "method"), ".studio", "builds", build_id)


def _manifest(d):
    with open(os.path.join(d, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def _build(c):
    r = c.post("/api/projects/method/build", json={"pdf": False})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "ok", j
    return j


def test_build_returns_input_fingerprint(client):
    c, projects = client
    j = _build(c)
    fp = j.get("input") or {}
    for k in ("raw_sha", "content_sha", "settings_sha", "figs_sha", "mode"):
        assert fp.get(k), k
    m = _manifest(_dir_for(projects, j["build_id"]))
    assert m["input"] == fp  # outcome 与 manifest 同源
    assert m["output"]["docx_sha"]
    assert m["renderer"]["python"]


def test_settings_change_rebuilds_on_export(client):
    c, projects = client
    j1 = _build(c)
    n0 = len(_builds(projects))
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    assert len(_builds(projects)) == n0  # 指纹一致 ⇒ 复用，不重建
    c.put("/api/projects/method/settings", json={"abstract_limit": 500})  # 文档摘要 286 字——合法但指纹变化
    r2 = c.get("/api/projects/method/export?fmt=docx")
    assert r2.status_code == 200
    assert len(_builds(projects)) == n0 + 1  # settings 变了 ⇒ 指纹不符 ⇒ 重建
    # 新目录 = 词法序外唯一新增者——按 build_id 集合差定位，不猜 [-1]
    new = (set(os.listdir(os.path.join(str(projects / "method"), ".studio", "builds"))) - {j1["build_id"]}).pop()
    m = _manifest(_dir_for(projects, new))
    assert m["input"]["settings_sha"] != _manifest(_dir_for(projects, j1["build_id"]))["input"]["settings_sha"]


def test_fig_resource_change_rebuilds(client):
    c, projects = client
    _build(c)
    n0 = len(_builds(projects))
    fig = projects / "method" / "figs" / "newfig.png"
    fig.write_bytes(b"\x89PNG" + os.urandom(16))
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    assert len(_builds(projects)) == n0 + 1


def test_missing_manifest_not_trusted(client):
    c, projects = client
    j = _build(c)
    d = _dir_for(projects, j["build_id"])
    os.remove(os.path.join(d, "manifest.json"))
    n0 = len(_builds(projects))
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    assert len(_builds(projects)) == n0 + 1  # 无清单 ⇒ 不信任 ⇒ 重建


def test_tampered_artifact_rebuilds(client):
    c, projects = client
    j = _build(c)
    d = _dir_for(projects, j["build_id"])
    with open(os.path.join(d, "out.docx"), "ab") as f:
        f.write(b"tampered")
    n0 = len(_builds(projects))
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    assert len(_builds(projects)) == n0 + 1  # 产物 hash 不符 ⇒ 不信任 ⇒ 重建


def test_expected_sha_conflict_409(client):
    c, _ = client
    _build(c)
    assert c.get("/api/projects/method/export?fmt=docx&expected_sha=deadbeef").status_code == 409
    sha = c.get("/api/projects/method/context").json()["content_sha"]
    assert c.get(f"/api/projects/method/export?fmt=docx&expected_sha={sha}").status_code == 200


def test_export_uses_this_build_not_latest(client):
    """并发安全：导出落到的目录必须是匹配本次指纹的构建（j2.build_id 精确定位），不是词法最新目录。"""
    c, projects = client
    j = _build(c)
    orig = c.get("/api/projects/method/content").json()["content"]
    c.put("/api/projects/method/content", json={"content": orig + "\n\n新增段落 X"})
    j2 = _build(c)
    assert j2["input"]["raw_sha"] != j["input"]["raw_sha"]
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    # 用本次响应的 build_id 精确定位——不猜目录序（同秒构建词法序按 uuid 尾排，[-1] 非最新）
    d = os.path.join(str(projects / "method"), ".studio", "builds", j2["build_id"])
    with open(os.path.join(d, "out.docx"), "rb") as f:
        assert r.content == f.read()
    m = _manifest(d)
    assert m["input"]["raw_sha"] == j2["input"]["raw_sha"]
    # 恢复内容（夹具目录一次性，无需但保险）
    c.put("/api/projects/method/content", json={"content": orig})


def test_export_uses_this_build_lexical_trap(client, monkeypatch):
    """复核12 根因钉死：构造词法序倒置的同秒构建目录（旧构建 uuid 尾更大），导出仍须给指纹匹配的 j2 产物。"""
    c, projects = client
    j = _build(c)
    orig = c.get("/api/projects/method/content").json()["content"]
    c.put("/api/projects/method/content", json={"content": orig + "\n\n新增段落 Y"})
    j2 = _build(c)
    builds_dir = os.path.join(str(projects / "method"), ".studio", "builds")
    # 造一个词法必排在 j2 之后的旧构建目录（同秒前缀 + ffffff=最大 uuid 尾），拷旧构建产物进去
    stamp = j2["build_id"].rsplit("-", 1)[0]
    trap = os.path.join(builds_dir, f"{stamp}-ffffff")
    os.makedirs(trap, exist_ok=True)
    old_dir = os.path.join(builds_dir, j["build_id"])
    for name in ("out.docx", "manifest.json"):
        shutil.copy2(os.path.join(old_dir, name), os.path.join(trap, name))
    assert sorted(os.listdir(builds_dir))[-1] == os.path.basename(trap)  # 词法序确实是陷阱目录
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    d2 = os.path.join(builds_dir, j2["build_id"])
    with open(os.path.join(d2, "out.docx"), "rb") as f:
        assert r.content == f.read()  # 指纹匹配的 j2 产物，不是词法最新的 trap
    c.put("/api/projects/method/content", json={"content": orig})


def test_export_snapshot_survives_midflight_save(client, monkeypatch):
    """复核2：排队/构建期间盘文变化不污染本次导出——快照进构建，产物是已验证的版本。"""
    c, projects = client
    orig = c.get("/api/projects/method/content").json()["content"]
    changed = orig + "\n\n并发写入"
    import hashlib

    import app.main as app_main

    real = app_main.run_build

    def race(store, pid, content, settings, *a, **kw):
        store.save_content(pid, changed)  # 模拟队列等待期间的并发 save：盘文已变 B
        return real(store, pid, content, settings, *a, **kw)

    monkeypatch.setattr(app_main, "run_build", race)
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    m = _manifest(_builds(projects)[-1])
    assert m["input"]["raw_sha"] == hashlib.sha256(orig.encode()).hexdigest()  # 产物是 A
    c.put("/api/projects/method/content", json={"content": orig})


def test_renderer_version_change_rebuilds(client):
    """复核3：renderer 版本参与指纹——manifest 里版本不同 ⇒ 不复用重建。"""
    c, projects = client
    _build(c)
    n0 = len(_builds(projects))
    d = _builds(projects)[-1]
    m = _manifest(d)
    m["input"]["renderer"]["python-docx"] = "0.0.0-bogus"
    with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False)
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    assert len(_builds(projects)) == n0 + 1


def test_figs_sha_none_not_trusted(client, monkeypatch):
    """复核3：图指纹取不到（None）⇒ 指纹不可信，即使旧 manifest 也不能命中复用。"""
    c, projects = client
    _build(c)
    n0 = len(_builds(projects))
    from app.domain import build as build_mod

    monkeypatch.setattr(build_mod, "_figs_sha", lambda p: None)
    # 导出路径在 main.py 顶层导入了 input_fingerprint——_figs_sha 经函数内调用仍被命中
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 200
    assert len(_builds(projects)) == n0 + 1


def test_embed_pdf_meta_preserves_structure(tmp_path):
    """复核1：_embed_pdf_meta 用 clone_from 保留 /Root 的 Outlines/MarkInfo——逐页重建会丢。"""
    from pypdf import PdfReader, PdfWriter

    from app.domain.build import _embed_pdf_meta

    src = tmp_path / "tagged.pdf"
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    w.add_outline_item("章节一", 0)  # /Root/Outlines
    w.marked_as_true_pdf = True  # StructTreeRoot/MarkInfo 标记
    with open(src, "wb") as f:
        w.write(f)
    assert _embed_pdf_meta(str(src), "b-1", {"raw_sha": "a" * 64, "settings_sha": "b" * 64})
    r = PdfReader(str(src))
    assert r.metadata.title == "知撰构建 b-1"
    assert len(r.outline) == 1 and r.outline[0].title == "章节一"  # 书签树保留


def test_empty_content_export_error(client):
    c, projects = client
    c.put("/api/projects/method/content", json={"content": ""})
    r = c.get("/api/projects/method/export?fmt=docx")
    assert r.status_code == 422
    # 空正文不产生成功构建
    assert not _builds(projects) or all(not os.path.isfile(os.path.join(d, "out.docx")) for d in _builds(projects))
