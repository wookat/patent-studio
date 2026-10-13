# -*- coding: utf-8 -*-
"""运行 examples/check_all.py（附图越界 + 语料审计 + 文档回归）并结构化输出。

check_all.py 会重放 make_figs.py（重写 figs/*.png|svg）并读取 <案子>/申请文件-*.docx，
因此在临时目录里复制 method/、system/（content.md、make_figs.py、figs/）后运行，
docx 使用 Studio 最近一次构建的 out.docx（若无则现场用 studio.json 构建），不污染仓库文件。
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from app import config
from app.domain.build import latest_artifact_dir
from app.domain.projects import ProjectStore
from patent_studio.kernel.builder import build_patent_ex

CASES = ("method", "system")
_LINE_RE = re.compile(r"^(PASS|FAIL|SKIP)\s+(.*)$")


def _prepare_case(store: ProjectStore, pid: str, dst: str):
    proj = store.get(pid)
    os.makedirs(dst, exist_ok=True)
    for name in ("content.md", "make_figs.py"):
        src = os.path.join(proj.dir, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dst, name))
    if os.path.isdir(proj.figs_dir):
        shutil.copytree(proj.figs_dir, os.path.join(dst, "figs"), dirs_exist_ok=True)
    docx_out = os.path.join(dst, f"申请文件-{proj.title or pid}.docx")
    latest = latest_artifact_dir(store, pid, "out.docx")
    if latest:
        shutil.copy2(os.path.join(latest, "out.docx"), docx_out)
        return "latest_build"
    build_patent_ex(store.build_config(proj, out=docx_out))
    return "fresh_build"


def run_check_all(store: ProjectStore, timeout=600):
    script = config.CHECK_SCRIPT
    if not os.path.isfile(script):
        return {"ok": False, "exit_code": None, "duration_ms": 0, "output": f"未找到回归脚本：{script}",
                "results": [], "docx_source": {}}
    t0 = time.perf_counter()
    sources = {}
    with tempfile.TemporaryDirectory(prefix="patent-check-") as tmp:
        shutil.copy2(script, os.path.join(tmp, "check_all.py"))
        for pid in CASES:
            try:
                sources[pid] = _prepare_case(store, pid, os.path.join(tmp, pid))
            except Exception as e:  # noqa: BLE001
                sources[pid] = f"error: {e}"
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join(filter(None, [config.BACKEND_DIR, env.get("PYTHONPATH", "")]))
        env["MPLBACKEND"] = "Agg"
        try:
            r = subprocess.run([sys.executable, os.path.join(tmp, "check_all.py")], cwd=tmp,
                               capture_output=True, text=True, timeout=timeout, env=env)
            output = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr.strip() else "")
            code = r.returncode
        except subprocess.TimeoutExpired as e:
            output = ((e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) + "\n[超时]"
            code = -1
    return {"ok": code == 0, "exit_code": code, "duration_ms": round((time.perf_counter() - t0) * 1000),
            "output": output.strip(), "results": _parse(output), "docx_source": sources}


def _parse(output):
    out = []
    for ln in output.splitlines():
        m = _LINE_RE.match(ln.strip())
        if m:
            out.append({"status": m.group(1), "name": m.group(2)})
    return out
