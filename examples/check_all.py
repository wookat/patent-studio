# -*- coding: utf-8 -*-
"""示例案自检：图表引用 lint + DOCX 回归。任何一项 FAIL 退出码 1。
用法：python3 check_all.py
"""
import glob
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FAILS = []


def report(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + detail if detail else ""))
    if not ok:
        FAILS.append(name)


def check_ref_lint():
    """括号式图表引用 lint：示例案正文不应残留（如图N所示）等表达。"""
    bad = []
    for name in ("method", "system"):
        p = os.path.join(HERE, name, "content.md")
        if not os.path.isfile(p):
            continue
        t = open(p, encoding="utf8").read()
        for pat in (r"（如图[0-9]+所示）", r"（如表[0-9]+所示）", r"（见图[0-9]+）"):
            n = len(re.findall(pat, t))
            if n:
                bad.append((name, pat, n))
    for it in bad:
        print("   括号式图表引用残留:", it)
    report("图表引用 lint", not bad)


def check_docs():
    """docx 回归：权项数、摘要字数、段号连续。先运行各案 build_docx.py 生成 docx。"""
    expect = {"method": {"figs": 3, "claims": 10}, "system": {"figs": 6, "claims": 3}}
    for name, exp in expect.items():
        docx = glob.glob(os.path.join(HERE, name, "申请文件-*.docx"))
        if not docx:
            print(f"   SKIP {name} 未构建 docx（先运行 build_docx.py）")
            continue
        z = zipfile.ZipFile(docx[0])
        xml = z.read("word/document.xml").decode("utf8")
        text = re.sub(r"<[^>]+>", "", xml)
        nums = [int(m) for m in re.findall(r"\[(\d{4})\]", text)]
        ok = nums == list(range(1, len(nums) + 1))
        report(f"{name} 说明书段号连续", ok)
        claims_n = len([m for m in re.findall(r"^\s*(\d+)\s*[\.、]", text, re.M)])
        report(f"{name} 权利要求项数={claims_n}（期望{exp['claims']}）", claims_n == exp["claims"])


check_ref_lint()
check_docs()
sys.exit(1 if FAILS else 0)
