# -*- coding: utf-8 -*-
"""项目内 git 历史（docs/plan/07 §4.3）：GIT_DIR=<project>/.studio/history，GIT_WORK_TREE=<project>。

只跟踪 content.md 与 docs/；每次 ProjectStore.save_content 末尾调用 commit()。
case.json（W4-A 台账）也在库内但不走 commit()：状态 / 台账变更由 commit_case() 单独提交为「case: …」事件。
git 不存在时 commit 返回 None（log.warning 一次），其余读操作抛 GitUnavailable。
首次建库时把旧的 content.md.bak-* 按时间顺序导入为最早的几个提交（.bak 由 integrate 停写）。
"""

import contextlib
import contextvars
import logging
import os
import re
import shutil
import subprocess
import tempfile

try:
    import fcntl

    def _flock(fd: int, exclusive: bool) -> None:
        fcntl.flock(fd, fcntl.LOCK_EX if exclusive else fcntl.LOCK_UN)
except ModuleNotFoundError:  # Windows 开发机：msvcrt.locking 等价挡同机跨进程/线程
    import msvcrt

    def _flock(fd: int, exclusive: bool) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_LOCK if exclusive else msvcrt.LK_UNLCK, 1)


HISTORY_DIR = os.path.join(".studio", "history")
_LOCK_FILE = "history.lock"  # <project>/.studio/history.lock（不入库：TRACKED 只含 content.md/docs）
TRACKED = ("content.md", "docs")
CASE_FILE = "case.json"
_EXCLUDE = "# Patent Studio：只跟踪 content.md、docs/ 与 case.json\n*\n!content.md\n!docs/\n!docs/**\n!case.json\n"
DEFAULT_AUTHOR = "studio"
WORK = "work"
_SHA_RE = re.compile(r"^[0-9a-f]{4,40}$")
_BAK_RE = re.compile(r"^content\.md\.bak-(\d{8})-(\d{6})(?:-\d+)?$")

logger = logging.getLogger(__name__)
_warned_missing = False

# restore 走 ProjectStore.save_content（三书镜像同一份逻辑），其内部钩子固定传 "save"；
# 用 contextvar 让这一次提交改用 "restore <sha7>" 与操作者身份。
_override: contextvars.ContextVar[tuple[str, str | None] | None] = contextvars.ContextVar(
    "history_override", default=None
)


class HistoryError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class GitUnavailable(HistoryError):
    def __init__(self):
        super().__init__("git 不可用：服务器未安装 git，版本历史无法使用", 503)


@contextlib.contextmanager
def repo_lock(project_dir: str):
    """互斥 git 写路径（add/commit/update-ref）：stdio MCP 与 web 是两进程共享同一 .studio/history；
    flock 按打开文件描述生效——跨进程与同进程线程/协程都挡（Windows 走 msvcrt.locking 等价）。
    读路径（log/show/diff）不加锁。"""
    os.makedirs(os.path.join(project_dir, ".studio"), exist_ok=True)
    with open(os.path.join(project_dir, ".studio", _LOCK_FILE), "w") as f:
        _flock(f.fileno(), True)
        try:
            yield
        finally:
            _flock(f.fileno(), False)


def git_dir(project_dir: str) -> str:
    return os.path.join(project_dir, HISTORY_DIR)


def _git_bin() -> str | None:
    global _warned_missing
    g = shutil.which("git")
    if g is None and not _warned_missing:
        _warned_missing = True
        logger.warning("git 未安装：项目版本历史（.studio/history）已停用，保存仍正常")
    return g


def _identity(author: str | None) -> tuple[str, str]:
    name = (author or DEFAULT_AUTHOR).strip() or DEFAULT_AUTHOR
    email = name if "@" in name else f"{name}@patent-studio.local"
    return name, email


def _run(
    project_dir: str,
    *args: str,
    author: str | None = None,
    date: int | None = None,
    check: bool = True,
    index: str | None = None,
    stdin: str | None = None,
) -> subprocess.CompletedProcess:
    g = _git_bin()
    if g is None:
        raise GitUnavailable()
    name, email = _identity(author)
    env = dict(
        os.environ,
        GIT_DIR=git_dir(project_dir),
        GIT_WORK_TREE=project_dir,
        LC_ALL="C",
        GIT_AUTHOR_NAME=name,
        GIT_AUTHOR_EMAIL=email,
        GIT_COMMITTER_NAME=name,
        GIT_COMMITTER_EMAIL=email,
    )
    if date is not None:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"{date} +0000"
    if index is not None:
        env["GIT_INDEX_FILE"] = index
    return subprocess.run(
        [g, "-c", "commit.gpgsign=false", "-c", "core.autocrlf=input", *args],
        cwd=project_dir,
        env=env,
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=check,
    )


def ensure_repo(project_dir: str) -> bool:
    """不存在则 `git init -q -b main` 并写 info/exclude（只放行 content.md 与 docs/，status 干净）；返回是否新建。"""
    gd = git_dir(project_dir)
    exclude = os.path.join(gd, "info", "exclude")
    if os.path.isfile(os.path.join(gd, "HEAD")):
        _write_exclude(exclude)
        return False
    os.makedirs(gd, exist_ok=True)
    _run(project_dir, "init", "-q", "-b", "main")
    os.makedirs(os.path.join(gd, "info"), exist_ok=True)
    _write_exclude(exclude)
    return True


def _write_exclude(path: str) -> None:
    """旧库的 exclude 没放行 case.json ⇒ 重写（内容一致时不动文件）。"""
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == _EXCLUDE:
                return
    except OSError:
        pass
    with open(path, "w", encoding="utf-8") as f:
        f.write(_EXCLUDE)


def _import_backups(project_dir: str) -> int:
    """旧 .bak 备份 → 最早的提交（按文件名时间序，日期取备份文件 mtime）；只用 plumbing，不碰工作区。"""
    baks = sorted(n for n in os.listdir(project_dir) if _BAK_RE.match(n))
    parent, parent_tree, n = None, None, 0
    for name in baks:
        m = _BAK_RE.match(name)
        ymd, hms = m.group(1), m.group(2)
        stamp = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]} {hms[:2]}:{hms[2:4]}:{hms[4:]}"
        path = os.path.join(project_dir, name)
        blob = _run(project_dir, "hash-object", "-w", "--", path).stdout.strip()
        _run(project_dir, "update-index", "--add", "--cacheinfo", f"100644,{blob},content.md")
        tree = _run(project_dir, "write-tree").stdout.strip()
        if tree == parent_tree:
            continue
        args = ["commit-tree", tree, "-m", f"backup {stamp}"] + (["-p", parent] if parent else [])
        parent = _run(project_dir, *args, date=int(os.stat(path).st_mtime)).stdout.strip()
        parent_tree = tree
        n += 1
    if parent:
        _run(project_dir, "update-ref", "refs/heads/main", parent)
    return n


@contextlib.contextmanager
def override(message: str, author: str | None = None):
    """在此上下文内，commit() 的 message/author 以此为准（restore 用）。"""
    token = _override.set((message, author))
    try:
        yield
    finally:
        _override.reset(token)


def commit(project_dir: str, message: str = "save", author: str | None = None) -> str | None:
    """add -A -- content.md docs；有变化才 commit；返回 sha（无变化 / git 缺失 ⇒ None）。"""
    if _git_bin() is None:
        return None
    ov = _override.get()
    if ov is not None:
        message, author = ov[0], ov[1] or author
    with repo_lock(project_dir):
        if ensure_repo(project_dir):
            _import_backups(project_dir)
        paths = [p for p in TRACKED if os.path.exists(os.path.join(project_dir, p))]
        _run(project_dir, "add", "-A", "--", *paths)
        if _run(project_dir, "diff", "--cached", "--quiet", check=False).returncode == 0:
            return None
        _run(project_dir, "commit", "-q", "-m", message, author=author)
        return head(project_dir)


def commit_case(project_dir: str, message: str, author: str | None = None) -> str | None:
    """只提交 case.json（台账 / 状态事件，W4-A）：add -- case.json；无变化 / git 缺失 ⇒ None。
    与 commit() 分开：保存正文不会顺手把台账改动混进「save」版本，状态事件在 log 里独立成行（added/deleted 都是 0）。"""
    if _git_bin() is None or not os.path.isfile(os.path.join(project_dir, CASE_FILE)):
        return None
    with repo_lock(project_dir):
        if ensure_repo(project_dir):
            _import_backups(project_dir)
        _run(project_dir, "add", "--", CASE_FILE)
        if _run(project_dir, "diff", "--cached", "--quiet", "--", CASE_FILE, check=False).returncode == 0:
            return None
        _run(project_dir, "commit", "-q", "--only", "-m", message, "--", CASE_FILE, author=author)
        return head(project_dir)


def last_author(project_dir: str) -> str | None:
    """最近一次提交的作者（面板「最近修改人」）；无库 / git 缺失 ⇒ None。"""
    if _git_bin() is None or head(project_dir) is None:
        return None
    return _run(project_dir, "log", "-1", "--format=%an").stdout.strip() or None


def commit_draft(project_dir: str, content: str, message: str, author: str | None = None) -> str | None:
    """把一份不在工作区的 content.md 提交为新版本（一键转专利的「草稿版本」，docs/plan/09 §3.3）。

    只用 plumbing + 临时 GIT_INDEX_FILE：工作区与库内索引都不动；HEAD 前进到草稿，因此它出现在 log 里，
    可用 show / diff(a=<sha>) / restore 预览与采纳；下一次 commit() 仍以工作区为准。git 缺失 ⇒ None。
    """
    if _git_bin() is None:
        return None
    with repo_lock(project_dir):
        if ensure_repo(project_dir):
            _import_backups(project_dir)
        parent = head(project_dir)
        return _commit_draft_locked(project_dir, content, message, author, parent)


def _commit_draft_locked(project_dir: str, content: str, message: str, author: str | None, parent: str | None) -> str:
    fd, index = tempfile.mkstemp(prefix="draft-index-", dir=git_dir(project_dir))
    os.close(fd)
    os.unlink(index)
    try:
        if parent:
            _run(project_dir, "read-tree", parent, index=index)
        # 落临时文件再 hash-object——stdin 走 text 管道在 Windows 会被翻成 CRLF，
        # 与 add 路径归一化后的 LF blob 不一致，diff 会显示全文改写
        fd, tmp = tempfile.mkstemp(prefix="draft-blob-", dir=git_dir(project_dir))
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(content.replace("\r\n", "\n").encode("utf-8"))
            blob = _run(project_dir, "hash-object", "-w", "--", tmp).stdout.strip()
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp)
        _run(project_dir, "update-index", "--add", "--cacheinfo", f"100644,{blob},content.md", index=index)
        tree = _run(project_dir, "write-tree", index=index).stdout.strip()
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(index)
    args = ["commit-tree", tree, "-m", message] + (["-p", parent] if parent else [])
    sha = _run(project_dir, *args, author=author).stdout.strip()
    _run(project_dir, "update-ref", "refs/heads/main", sha)
    return sha


def head(project_dir: str) -> str | None:
    r = _run(project_dir, "rev-parse", "--verify", "-q", "HEAD", check=False)
    return r.stdout.strip() or None


def resolve(project_dir: str, ref: str) -> str:
    if not _SHA_RE.match(ref):
        raise HistoryError(f"非法版本号：{ref}", 400)
    r = _run(project_dir, "rev-parse", "--verify", "-q", f"{ref}^{{commit}}", check=False)
    sha = r.stdout.strip()
    if r.returncode != 0 or not sha:
        raise HistoryError(f"版本不存在：{ref}", 404)
    return sha


def log(project_dir: str) -> list[dict]:
    """[{sha, at, message, author, added, deleted}] 新→旧；无库 ⇒ []。变更行数只算 content.md（docs/ 是它的镜像）。"""
    if _git_bin() is None or head(project_dir) is None:
        return []
    out = _run(project_dir, "log", "--format=%x1e%H%x1f%at%x1f%an%x1f%s", "--numstat").stdout
    versions = []
    for rec in out.split("\x1e"):
        if not rec.strip():
            continue
        header, _, stat = rec.partition("\n")
        sha, at, author, message = header.split("\x1f", 3)
        added = deleted = 0
        for ln in stat.splitlines():
            parts = ln.split("\t")
            if len(parts) == 3 and parts[2] == "content.md" and parts[0].isdigit() and parts[1].isdigit():
                added += int(parts[0])
                deleted += int(parts[1])
        versions.append(
            {"sha": sha, "at": int(at), "message": message, "author": author, "added": added, "deleted": deleted}
        )
    return versions


def show(project_dir: str, sha: str) -> str:
    """该版 content.md 全文。"""
    sha = resolve(project_dir, sha)
    r = _run(project_dir, "show", f"{sha}:content.md", check=False)
    if r.returncode != 0:
        raise HistoryError(f"该版本不含 content.md：{sha[:7]}", 404)
    return r.stdout


def diff(project_dir: str, a: str, b: str = WORK) -> str:
    """unified diff（--no-color）；b="work" 表示工作区。"""
    a = resolve(project_dir, a)
    refs = [a] if b == WORK else [a, resolve(project_dir, b)]
    return _run(project_dir, "diff", "--no-color", *refs, "--", "content.md").stdout
