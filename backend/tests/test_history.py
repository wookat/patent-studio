# -*- coding: utf-8 -*-
"""R6 历史地基（docs/plan/07 §4.3 / §9 A7）：项目内 git 库 + list/show/diff/restore 路由 + .bak 迁移 + git 缺失降级。"""

import os
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.domain import history

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
    import importlib

    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(build)
    importlib.reload(xml_export)
    importlib.reload(main)
    return TestClient(main.app), projects / "method"


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _git(pdir, *args):
    env = dict(os.environ, GIT_DIR=history.git_dir(str(pdir)), GIT_WORK_TREE=str(pdir))
    return subprocess.run(["git", *args], cwd=pdir, env=env, capture_output=True, text=True, check=True).stdout


# --- 纯函数层 ---


def test_commit_creates_repo_and_tracks_only_content_and_docs(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("# T\n\n## 摘要\n\na\n", encoding="utf-8")
    (d / "docs").mkdir()
    (d / "docs" / "claims.md").write_text("1.x\n", encoding="utf-8")
    (d / "studio.json").write_text("{}", encoding="utf-8")
    (d / ".studio").mkdir()
    (d / ".studio" / "junk.txt").write_text("x", encoding="utf-8")

    sha = history.commit(str(d), "save")
    assert sha and len(sha) == 40
    assert os.path.isfile(os.path.join(history.git_dir(str(d)), "HEAD"))
    assert "!docs/**" in _read(os.path.join(history.git_dir(str(d)), "info", "exclude"))
    tracked = _git(d, "ls-files").split()
    assert tracked == ["content.md", "docs/claims.md"]
    assert _git(d, "status", "--porcelain").strip() == ""  # studio.json / .studio 不入库也不算脏

    # 无变化 ⇒ None，且不产生新提交
    assert history.commit(str(d), "save") is None
    assert len(history.log(str(d))) == 1

    (d / "content.md").write_text("# T\n\n## 摘要\n\nb\n", encoding="utf-8")
    sha2 = history.commit(str(d), "save", author="alice@example.com")
    assert sha2 and sha2 != sha
    versions = history.log(str(d))
    assert [v["sha"] for v in versions] == [sha2, sha]
    assert versions[0]["author"] == "alice@example.com" and versions[1]["author"] == "studio"
    assert versions[0]["message"] == "save"
    assert versions[0]["added"] == 1 and versions[0]["deleted"] == 1
    assert versions[1]["added"] == 5 and versions[1]["deleted"] == 0  # 只算 content.md，不含 docs/claims.md
    assert isinstance(versions[0]["at"], int) and versions[0]["at"] >= versions[1]["at"]


def test_show_diff_and_resolve(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("line1\nline2\n", encoding="utf-8")
    a = history.commit(str(d))
    (d / "content.md").write_text("line1\nline2 改\n", encoding="utf-8")
    b = history.commit(str(d))

    assert history.show(str(d), a) == "line1\nline2\n"
    assert history.show(str(d), a[:7]) == "line1\nline2\n"
    diff_ab = history.diff(str(d), a, b)
    assert "-line2\n" in diff_ab and "+line2 改\n" in diff_ab and "\x1b" not in diff_ab
    assert history.diff(str(d), a, b) == history.diff(str(d), a)  # 工作区 == b
    assert history.diff(str(d), b) == ""
    (d / "content.md").write_text("line1\nline2 改\nline3\n", encoding="utf-8")
    assert "+line3" in history.diff(str(d), b, "work")

    with pytest.raises(history.HistoryError) as ei:
        history.show(str(d), "0000000")
    assert ei.value.status == 404
    with pytest.raises(history.HistoryError) as ei:
        history.diff(str(d), "HEAD~1")  # 只接受十六进制 sha，不透传任意 revision 语法
    assert ei.value.status == 400
    assert history.resolve(str(d), b[:8]) == b


def test_log_without_repo_is_empty(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("x\n", encoding="utf-8")
    assert history.log(str(d)) == []
    assert history.head(str(d)) is None
    assert not os.path.exists(history.git_dir(str(d)))


def test_old_backups_become_first_commits(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("v3\n", encoding="utf-8")
    (d / "content.md.bak-20260101-090000").write_text("v1\n", encoding="utf-8")
    os.utime(d / "content.md.bak-20260101-090000", (1_767_258_000, 1_767_258_000))
    (d / "content.md.bak-20260102-100000").write_text("v2\n", encoding="utf-8")
    (d / "content.md.bak-20260102-100000-1").write_text("v2\n", encoding="utf-8")  # 同内容 ⇒ 不重复提交
    (d / "content.md.bak-broken").write_text("ignored\n", encoding="utf-8")

    sha = history.commit(str(d), "save")
    versions = history.log(str(d))
    assert [v["message"] for v in versions] == ["save", "backup 2026-01-02 10:00:00", "backup 2026-01-01 09:00:00"]
    assert versions[0]["sha"] == sha
    assert versions[2]["at"] == 1_767_258_000
    assert history.show(str(d), versions[2]["sha"]) == "v1\n"
    assert history.show(str(d), versions[1]["sha"]) == "v2\n"
    assert history.show(str(d), sha) == "v3\n"
    assert _git(d, "ls-files").split() == ["content.md"]
    assert (d / "content.md.bak-20260101-090000").exists()  # 不删 .bak（integrate 处理）


def test_git_missing_degrades(tmp_path, monkeypatch, caplog):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("x\n", encoding="utf-8")
    monkeypatch.setattr(history.shutil, "which", lambda name: None)
    monkeypatch.setattr(history, "_warned_missing", False)
    with caplog.at_level("WARNING", logger="app.domain.history"):
        assert history.commit(str(d)) is None
        assert history.commit(str(d)) is None
    assert sum("git 未安装" in r.message for r in caplog.records) == 1
    assert history.log(str(d)) == []
    assert not os.path.exists(history.git_dir(str(d)))
    with pytest.raises(history.GitUnavailable) as ei:
        history.show(str(d), "abcdef0")
    assert ei.value.status == 503


def test_override_replaces_message_and_author(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("x\n", encoding="utf-8")
    with history.override("restore abc1234", "bob@example.com"):
        history.commit(str(d), "save")
    (d / "content.md").write_text("y\n", encoding="utf-8")
    history.commit(str(d), "save")
    msgs = [(v["message"], v["author"]) for v in history.log(str(d))]
    assert msgs == [("save", "studio"), ("restore abc1234", "bob@example.com")]


# --- 路由层（A7：保存 3 次 → 3 条；diff 含 +/-；restore 后 content 相同且新增 commit）---


def test_save_three_times_then_list_diff_restore(client):
    c, pdir = client
    md = _read(pdir / "content.md")
    assert c.get("/api/projects/method/history").json() == []

    versions_md = [md + "\n第一版追加\n", md + "\n第二版追加\n", md + "\n第三版追加\n"]
    for v in versions_md:
        r = c.put("/api/projects/method/content", json={"content": v})
        assert r.status_code == 200 and r.json()["ok"] is True

    r = c.get("/api/projects/method/history")
    assert r.status_code == 200
    versions = r.json()
    # 首次保存前 save_content 先写了 .bak（原文）→ 建库时迁移为首个提交，再加 3 次 save
    assert [v["message"] for v in versions[:3]] == ["save", "save", "save"]
    assert versions[-1]["message"].startswith("backup ")
    assert len(versions) == 4
    assert set(versions[0]) == {"sha", "at", "message", "author", "added", "deleted"}
    assert versions[0]["author"] == "studio"

    first, second = versions[2]["sha"], versions[1]["sha"]
    r = c.get(f"/api/projects/method/history/{first}")
    assert r.status_code == 200 and r.json() == {"sha": first, "content": versions_md[0]}

    r = c.get(f"/api/projects/method/history/diff?a={first}&b={second}")
    assert r.status_code == 200
    body = r.json()
    assert body["a"] == first and body["b"] == second
    assert "-第一版追加" in body["diff"] and "+第二版追加" in body["diff"]

    r = c.get(f"/api/projects/method/history/diff?a={first}")
    assert r.json()["b"] == "work" and "+第三版追加" in r.json()["diff"]

    r = c.post(f"/api/projects/method/history/{first[:7]}/restore")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["content"] == versions_md[0] and body["changed"] is True
    assert _read(pdir / "content.md") == versions_md[0]
    desc = _read(pdir / "docs" / "description.md")  # 走 save_content ⇒ 三书镜像同步
    assert "第一版追加" in desc and "第三版追加" not in desc
    after = c.get("/api/projects/method/history").json()
    assert len(after) == 5
    assert after[0]["sha"] == body["sha_new"] and after[0]["message"] == f"restore {first[:7]}"
    assert c.get(f"/api/projects/method/history/diff?a={first}&b={body['sha_new']}").json()["diff"] == ""

    # 再 restore 同一版：内容无变化 ⇒ 不新增提交，sha_new 仍是 HEAD
    r = c.post(f"/api/projects/method/history/{first}/restore")
    assert r.status_code == 200 and r.json()["sha_new"] == body["sha_new"] and r.json()["changed"] is False
    assert len(c.get("/api/projects/method/history").json()) == 5


def test_route_errors(client):
    c, pdir = client
    r = c.get("/api/projects/method/history/deadbeef")
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "history"
    r = c.get("/api/projects/method/history/diff?a=HEAD")
    assert r.status_code == 400 and r.json()["detail"]["detail"] == "C3-history"
    r = c.post("/api/projects/method/history/deadbeef/restore")
    assert r.status_code == 404
    assert c.get("/api/projects/nope/history").status_code == 404


def test_concurrent_commits_serialized(tmp_path):
    """R85：跨进程/线程共享同一 .studio/history——并发 commit 不再撞 index.lock 或丢 update-ref。"""
    from concurrent.futures import ThreadPoolExecutor

    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("# T\n", encoding="utf-8")
    assert history.commit(str(d), "init")

    # commit_draft 各自写独立 blob（不动工作区），保证每次提交内容唯一
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(lambda i: history.commit_draft(str(d), f"# T {i}\n", f"draft {i}"), range(20)))
    assert all(results) and len(set(results)) == 20
    assert len(history.log(str(d))) == 21  # init + 20 draft——update-ref 串行，不丢


def test_restore_drill_recovers_case_and_lint_clean(client):
    """Z28 恢复演练：工作区 content.md 被毁后，从 .studio/history 恢复案卷，
    恢复稿能过 lint（无新增 error）且带备份迁移提交——恢复路径可用断言。"""
    c, pdir = client
    original = _read(pdir / "content.md")
    v2 = original + "\n第二版追加句。\n"
    assert c.put("/api/projects/method/content", json={"content": v2}).json()["ok"] is True
    versions = c.get("/api/projects/method/history").json()
    target = next(v["sha"] for v in versions if v["message"].startswith("backup "))

    # 模拟损坏：截断 content.md 并删掉三书镜像
    with open(pdir / "content.md", "w", encoding="utf-8") as f:
        f.write("# 损坏\n\n## 说明书\n\n只剩一半")
    for name in ("abstract.md", "claims.md", "description.md"):
        os.remove(pdir / "docs" / name)

    r = c.post(f"/api/projects/method/history/{target[:7]}/restore")
    assert r.status_code == 200 and r.json()["changed"] is True
    assert _read(pdir / "content.md") == original
    assert "摘要" in _read(pdir / "docs" / "abstract.md") or _read(pdir / "docs" / "abstract.md")

    # 恢复后 lint 可运行且结构完整（spec.sections/abstract.empty 等结构 error 不应出现）
    import app.config as cfg
    from app.domain import lint as lint_mod
    from app.domain.projects import ProjectStore

    store = ProjectStore(cfg.PROJECTS_DIR)
    rep = lint_mod.lint(original, store.get("method").settings, store.get("method").figs_dir, with_preflight=True)
    structural = [
        d
        for d in rep["diagnostics"]
        if d["severity"] == "error"
        and d["id"].split("#")[0] in ("abstract.empty", "spec.sections", "spec.unknown_section")
    ]
    assert structural == []
