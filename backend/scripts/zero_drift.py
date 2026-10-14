# -*- coding: utf-8 -*-
"""零漂移证据：默认设置下两案 word/document.xml md5 与基准比对。

用法：cd backend && uv run python scripts/zero_drift.py [--projects-dir DIR]
对每个案子分别用三条路径构建并比对：
  1) 原脚本路径：examples/<case>/build_docx.py 的 CONFIG → build_patent(CONFIG)
  2) Studio 路径：docs/figures.md（附图真源）+ studio.json（style 默认）→ build_config → build_patent_ex
  3) 迁移路径（W4-C）：把案子拷到临时目录、删掉 docs/figures.md、把 CONFIG 的附图写回旧式 studio.json
     spec_figures / abstract_figure → 加载时迁移生成 figures.md → 构建；md5 仍须等于基准
退出码 0 = 全部一致；1 = 存在差异。
"""

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from app.domain.projects import ProjectStore  # noqa: E402
from patent_studio.kernel import build_patent, figures_md  # noqa: E402
from patent_studio.kernel.builder import build_patent_ex  # noqa: E402

# 基线刷新：b12a541 换 examples 语料（指纹私钥 / 神经网络可视化）后重录；
# method/system 三路径（legacy / figures.md+studio.json / 迁移）均同 md5。
BASELINE = {
    "method": "f58e308dc5dcb3c594eccd11142691e5",
    "system": "75b57c286a75b32527c301e1c8c700f4",
}


def md5_document_xml(path):
    with zipfile.ZipFile(path) as z:
        return hashlib.md5(z.read("word/document.xml")).hexdigest()


def legacy_config(case_dir, out):
    """导入 examples/<case>/build_docx.py，取其 CONFIG（只改输出路径），保证与原脚本完全一致。"""
    spec = importlib.util.spec_from_file_location("legacy_build", os.path.join(case_dir, "build_docx.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cfg = dict(mod.CONFIG)
    cfg["out"] = out
    return cfg


def legacy_project(case_dir, cfg, dest):
    """旧格式案子：无 docs/figures.md，附图只在 studio.json 的 spec_figures / abstract_figure（取自原脚本 CONFIG）。"""
    shutil.copytree(case_dir, dest, ignore=shutil.ignore_patterns(".studio", "*.docx", "*.pdf", "docs"))
    with open(os.path.join(case_dir, "studio.json"), encoding="utf-8") as f:
        s = json.load(f)
    s["spec_figures"] = [[f, w] for f, w in cfg["spec_figures"]]
    s["abstract_figure"] = list(cfg["abstract_figure"])
    with open(os.path.join(dest, "studio.json"), "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projects-dir", default=os.path.join(os.path.dirname(HERE), "examples"))
    args = ap.parse_args()
    store = ProjectStore(args.projects_dir)
    ok = True
    print(f"python-docx {importlib.metadata.version('python-docx')}  projects={args.projects_dir}")
    with tempfile.TemporaryDirectory() as tmp:
        for name, base in BASELINE.items():
            case_dir = os.path.join(args.projects_dir, name)
            legacy_out = os.path.join(tmp, f"{name}-legacy.docx")
            build_patent(legacy_config(case_dir, legacy_out))
            h1 = md5_document_xml(legacy_out)

            proj = store.get(name)
            cfg = store.build_config(
                proj, out=os.path.join(tmp, f"{name}-studio.docx"), content_md=os.path.join(case_dir, "content.md")
            )
            build_patent_ex(cfg)
            h2 = md5_document_xml(cfg["out"])

            mig_root = os.path.join(tmp, f"{name}-migrate")
            os.makedirs(mig_root)
            legacy_project(case_dir, legacy_config(case_dir, legacy_out), os.path.join(mig_root, name))
            mig_store = ProjectStore(mig_root)
            mig = mig_store.get(name)  # 加载即迁移：生成 docs/figures.md
            assert os.path.isfile(figures_md.path_of(mig.dir)), "迁移未生成 docs/figures.md"
            cfg3 = mig_store.build_config(mig, out=os.path.join(tmp, f"{name}-migrated.docx"))
            build_patent_ex(cfg3)
            h3 = md5_document_xml(cfg3["out"])

            good = h1 == base == h2 == h3
            ok &= good
            print(f"[{'OK ' if good else 'DIFF'}] {name:7s} baseline={base}")
            print(f"       legacy build_docx.py CONFIG → {h1}")
            print(f"       docs/figures.md + studio.json (style=默认) → {h2}")
            print(f"       旧 studio.json → 迁移生成 figures.md → 构建 → {h3}")
    print("零漂移：全部一致 ✅" if ok else "零漂移：存在差异 ❌")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
