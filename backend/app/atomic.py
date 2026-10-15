"""小 JSON 台账文件的原子落盘（R36-01）。

`open(p,"w")` 先截断再写，进程被杀/断电会留下半个 JSON，之后每次读取都 422
（case.json 坏了 → 台账面板/期限列表全挂）。与 deliver bundle / ai jobs /
collab rooms 同一手法：同目录写 `path + ".tmp"` 再 `os.replace`。
"""

import json
import os
import uuid
from contextlib import contextmanager
from typing import Any

try:
    import fcntl

    def _flock(fd: int, exclusive: bool) -> None:
        fcntl.flock(fd, fcntl.LOCK_EX if exclusive else fcntl.LOCK_UN)
except ModuleNotFoundError:  # Windows 开发机：msvcrt.locking 等价挡同机跨进程/线程
    import msvcrt

    def _flock(fd: int, exclusive: bool) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_LOCK if exclusive else msvcrt.LK_UNLCK, 1)


def _tmp_path(path: str) -> str:
    """tmp 名带随机段：同路径并发写（线程/进程）不共用同一 tmp 互撕。"""
    return f"{path}.tmp-{uuid.uuid4().hex[:8]}"


def write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = _tmp_path(path)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def write_text(path: str, text: str) -> None:
    """同上，纯文本版（content.md / docs/*.md / 模板 md）。"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = _tmp_path(path)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def write_bytes(path: str, data: bytes) -> None:
    """二进制件同款（附图/附件上传）。"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = _tmp_path(path)
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


@contextmanager
def studio_lock(project_dir: str, name: str):
    """`.studio/<name>.lock` 上的 flock：跨进程台账写互斥——web 与 stdio MCP 是两个进程（R93）。

    锁内必须纯同步（不夹 await）：协程持锁 await 期间，其他协程的 flock() 会阻塞整个事件循环→死锁。
    约定用法：锁内重新 load → mutate → save；锁外窗内他进程的改动因此不丢。锁序约定：case 先于 history。"""
    studio = os.path.join(project_dir, ".studio")
    os.makedirs(studio, exist_ok=True)
    with open(os.path.join(studio, f"{name}.lock"), "w") as f:
        _flock(f.fileno(), True)
        try:
            yield
        finally:
            _flock(f.fileno(), False)
