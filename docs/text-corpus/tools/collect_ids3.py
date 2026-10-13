# -*- coding: utf-8 -*-
import re, glob, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ids = set()
for f in glob.glob(os.path.expanduser("~/.devin-files/devin-remote.exe-overflows/*/content.txt")):
    t = open(f, encoding="utf-8", errors="ignore").read()
    if "patents.google.com" not in t:
        continue
    ids |= set(re.findall(r"patent/(CN\d+[A-Z]?)", t))
old = set(open(os.path.join(ROOT, "tools/pubids.txt"), encoding="utf-8").read().split())
old |= set(open(os.path.join(ROOT, "tools/pubids2.txt"), encoding="utf-8").read().split())
have = {f[:-4] for f in os.listdir(os.path.join(ROOT, "pages"))}
new = sorted(i for i in ids - old if i not in have and len(i) > 8)
print("new ids:", len(new))
open(os.path.join(ROOT, "tools/pubids3.txt"), "w", encoding="utf-8").write("\n".join(new) + "\n")
