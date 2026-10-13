# -*- coding: utf-8 -*-
"""v4 一轮重建：域过滤 + 切句 + 形库 + 权项骨架 + 案级/句级向量。"""
import json, math, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CS = "处理器|算法|计算机|数据库|数据|模型|神经网络|存储器|程序|终端|服务器|网络|图像|识别|模块|单元|接口|参数|输入|输出|存储|步骤|方法包括|装置包括|电子设备|存储介质|客户端"
NON_CS = "螺栓|螺母|齿轮|轴承|液压|气缸|活塞|连杆|铸造|焊接|刀具|注塑|弹簧|支架|壳体|管件|阀|泵|发酵|菌种|栽培|育种|饲料|药剂|口服液|合金|纤维|涂料|混凝土"
re_cs, re_ncs = re.compile(CS), re.compile(NON_CS)
pages = sorted(os.listdir(os.path.join(ROOT, "pages")))
keep, drop = [], []
for fn in pages:
    t = open(os.path.join(ROOT, "pages", fn), encoding="utf-8", errors="ignore").read()
    cs, ncs = len(re_cs.findall(t)), len(re_ncs.findall(t))
    (keep if cs >= max(15, ncs * 3) else drop).append((fn[:-4], cs, ncs))
print(f"pages={len(pages)} keep={len(keep)} drop={len(drop)}")
for p, c, n in drop[:15]:
    print("  drop", p, c, n)
open(os.path.join(ROOT, "tools/dropped_noncs.txt"), "w").write("\n".join(p for p, _, _ in drop))
keep_set = {p for p, _, _ in keep}
# sentences filter
sents = []
with open(os.path.join(ROOT, "sentences.jsonl"), encoding="utf-8") as f:
    for line in f:
        d = json.loads(line)
        if d["pub"] in keep_set:
            sents.append(d)
with open(os.path.join(ROOT, "sentences.jsonl"), "w", encoding="utf-8") as f:
    for d in sents:
        f.write(json.dumps(d, ensure_ascii=False) + "\n")
print("sentences:", len(sents), "pubs:", len(keep_set))
# drop non-CS page files too
for p, _, _ in drop:
    fp = os.path.join(ROOT, "pages", p + ".txt")
    if os.path.exists(fp):
        os.remove(fp)
# rebuild downstream via existing tools (they read sentences.jsonl/pages)
for tool in ["cluster_forms.py", "build_formlib.py", "claim_trees.py"]:
    print("run", tool, flush=True)
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", tool)], cwd=ROOT, check=False)
