# -*- coding: utf-8 -*-
"""三书文档集：content.md ⇄ docs/{abstract,claims,description}.md（docs/plan/04-r1-design.md §2）。

  split(md)                -> DocSet   按 `## 摘要 / ## 权利要求书 / ## 说明书` 原始行切分，逐字节保留
  assemble(ds)             -> str      反向拼接；对任意输入 assemble(split(md)) == md（split 只切不改）
  validate(ds)                         规范性：三书各一次且顺序为 BOOKS、标题非空；否则 DocsetError
  offsets(ds)              -> dict     各书 `## ` 标题行在 content.md 中的行号（1-based；AST 坐标基）
  replace(ds, book, body)  -> DocSet   换掉一书正文（非末书补齐行尾换行，保证下一书标题独占一行）
  write_mirror(dir, md)    -> bool     写 project.json 与 docs/<book>.md；不规范时不动镜像并返回 False
  check(paths)             -> list     对每个项目目录做往返 + 规范性断言，返回失败描述（空 = 全绿）

行的定义与内核 content.parse_md 一致：只以 "\\n" 分行（"\\r" 留在行内），因此 offsets 与
内核诊断 / 编辑器行号同一坐标。书标题行的识别也与内核一致：`## ` 后去首尾空白等于书名。

`python -m patent_docx.docset --check <项目目录>...` 是 `make roundtrip` 的入口。
"""
import argparse
import dataclasses
import json
import os
import sys
from dataclasses import dataclass

BOOKS = ("abstract", "claims", "description")
BOOK_HEADINGS = {"abstract": "## 摘要", "claims": "## 权利要求书", "description": "## 说明书"}
_NAME_TO_BOOK = {v[3:]: k for k, v in BOOK_HEADINGS.items()}

DOCS_DIR = "docs"
PROJECT_FILE = "project.json"


class DocsetError(Exception):
    """content.md 不是规范三书文件（缺书 / 乱序 / 无标题）。split/assemble 永不抛它。"""


@dataclass(frozen=True)
class DocSet:
    """head：第一个书标题行之前的原文（含 `# 标题` 行与空行）。
    abstract/claims/description：标题行之后、下一书标题行之前的原文（docs/<book>.md 的内容）。
    headings：各书标题行原文（含行尾）；None = 该书在 content.md 中不存在。
    order：书在原文中的出现顺序（规范文件为 BOOKS）。
    所有字段保留行尾，便于逐字节往返。"""

    head: str
    abstract: str
    claims: str
    description: str
    headings: dict
    order: tuple = BOOKS

    @property
    def title(self):
        for ln in self.head.split("\n"):
            if ln.startswith("# ") and not ln.startswith("## "):
                return ln[2:].strip()
        return None

    def book(self, name):
        if name not in BOOKS:
            raise KeyError(name)
        return getattr(self, name)


def _lines(text):
    """按 "\\n" 切成保留行尾的行；"" → []，"a\\nb" → ["a\\n", "b"]。"""
    parts = text.split("\n")
    out = [p + "\n" for p in parts[:-1]]
    if parts[-1]:
        out.append(parts[-1])
    return out


def _heading_book(ln):
    if ln.startswith("## "):
        return _NAME_TO_BOOK.get(ln[3:].strip())
    return None


def split(md):
    """content.md 全文 → DocSet。只切分不改写；重复出现的书标题按普通正文归入当前书。"""
    bodies = {"head": [], "abstract": [], "claims": [], "description": []}
    headings = {b: None for b in BOOKS}
    order = []
    cur = "head"
    for ln in _lines(md):
        book = _heading_book(ln)
        if book is not None and headings[book] is None:
            headings[book] = ln
            order.append(book)
            cur = book
            continue
        bodies[cur].append(ln)
    return DocSet(head="".join(bodies["head"]), abstract="".join(bodies["abstract"]),
                  claims="".join(bodies["claims"]), description="".join(bodies["description"]),
                  headings=headings, order=tuple(order))


def assemble(ds):
    """DocSet → content.md 全文。按 order 输出存在的书（缺失的书跳过）。"""
    text = ds.head
    for b in ds.order:
        if ds.headings.get(b) is not None:
            text += ds.headings[b] + ds.book(b)
    return text


def validate(ds):
    missing = [BOOK_HEADINGS[b] for b in BOOKS if ds.headings.get(b) is None]
    if missing:
        raise DocsetError(f"content.md 缺少书标题：{'、'.join(missing)}")
    if ds.order != BOOKS:
        raise DocsetError("三书顺序须为：" + " → ".join(BOOK_HEADINGS[b] for b in BOOKS))
    if not ds.title:
        raise DocsetError("content.md 缺少 `# 标题` 行")


def offsets(ds):
    """各书 `## ` 标题行在 content.md 的行号（1-based）；docs/<book>.md 第 k 行 ⇔ content.md 第 offset+k 行。"""
    out = {}
    line = len(_lines(ds.head))
    for b in ds.order:
        if ds.headings.get(b) is None:
            continue
        line += 1
        out[b] = line
        line += len(_lines(ds.book(b)))
    return out


def replace(ds, book, body):
    """返回换掉 `book` 正文的新 DocSet。非末书的正文若非空且不以换行结尾则补 "\\n"，否则下一书标题会粘到该行尾。"""
    if book not in BOOKS:
        raise KeyError(book)
    if body and not body.endswith("\n") and ds.order and ds.order[-1] != book:
        body += "\n"
    return dataclasses.replace(ds, **{book: body})


def write_mirror(project_dir, md):
    """把 content.md 派生为 project.json + docs/<book>.md。不规范（validate 失败）则不动镜像，返回 False。"""
    ds = split(md)
    try:
        validate(ds)
    except DocsetError:
        return False
    docs = os.path.join(project_dir, DOCS_DIR)
    os.makedirs(docs, exist_ok=True)
    for b in BOOKS:
        with open(os.path.join(docs, f"{b}.md"), "w", encoding="utf-8", newline="") as f:
            f.write(ds.book(b))
    with open(os.path.join(project_dir, PROJECT_FILE), "w", encoding="utf-8") as f:
        json.dump({"title": ds.title}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return True


def has_mirror(project_dir):
    """docs/ 里还放附图真源 figures.md，镜像是否存在以三书文件为准。"""
    return all(os.path.isfile(os.path.join(project_dir, DOCS_DIR, f"{b}.md")) for b in BOOKS)


def check(project_dirs):
    """对每个项目目录断言 assemble(split(md)) == md 且规范；返回失败描述列表。"""
    failures = []
    for d in project_dirs:
        path = os.path.join(d, "content.md")
        if not os.path.isfile(path):
            failures.append(f"{d}: 缺少 content.md")
            continue
        with open(path, encoding="utf-8", newline="") as f:
            md = f.read()
        ds = split(md)
        if assemble(ds) != md:
            failures.append(f"{d}: assemble(split(md)) != md")
        try:
            validate(ds)
        except DocsetError as e:
            failures.append(f"{d}: {e}")
    return failures


def main(argv=None):
    ap = argparse.ArgumentParser(prog="patent_docx.docset")
    ap.add_argument("--check", nargs="+", metavar="PROJECT_DIR", help="往返断言 assemble(split(md)) == md")
    args = ap.parse_args(argv)
    if not args.check:
        ap.print_help()
        return 2
    failures = check(args.check)
    for f in failures:
        print("[FAIL]", f)
    if failures:
        return 1
    print(f"roundtrip：{len(args.check)} 案全部一致 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
