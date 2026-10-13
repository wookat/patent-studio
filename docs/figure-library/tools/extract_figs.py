import json, re, os, sys, io, urllib.request, concurrent.futures
sys.path.insert(0, "/home/ubuntu/ps/backend/.venv/lib/python3.12/site-packages")
import pdfplumber

UA = {"User-Agent": "Mozilla/5.0"}
OUT = "/home/ubuntu/ps/survey/figlib"
PDFD = "/home/ubuntu/ps/survey/pdfs"

CAP_A = re.compile(r"图([0-9]+[A-Za-z]?)(?:是|为|示出|显示|给出|描绘)(.{2,80}?(?:图|示意|框图|架构|结构|拓扑|界面|布局))(?:；|;|。|，|$)")
CAP_B = re.compile(r"图([0-9]+[A-Za-z]?)([^\dA-Za-z图].{1,60}?(?:图|示意|框图|架构|结构|界面|布局|拓扑))(?:；|;|。|，|$)")
FIGLABEL = re.compile(r"^图\s*([0-9]+[A-Za-z]?)$")

RULES = [
    ("A5设备介质产品图", ["存储介质", "介质", "程序产品", "电子设备", "计算机设备", "计算设备", "终端设备", "硬件结构", "设备结构", "内部结构示意", "示意性框图", "示意性结构"]),
    ("A3分层架构图", ["分层", "层结构", "协议栈", "架构层", "软硬件", "层级", "数据层", "网络层"]),
    ("A4模型结构图", ["神经网络", "模型结构", "模型架构", "网络结构", "网络架构", "编码器", "解码器", "注意力", "卷积", "模型示意", "算法模型", "混淆网络", "词图", "模型的示意", "模型训练", "模型"]),
    ("A2模块分解图", ["模块组成", "组成示意", "装置结构", "系统结构", "内部结构", "功能模块", "模块结构", "结构框图", "组成框图", "装置示意", "装置的结构", "设备的结构", "终端的结构", "结构示意", "模块图", "组件图", "功能结构", "框图", "功能示意"]),
    ("A1系统架构图", ["系统架构", "架构图", "系统组成", "系统示意", "系统框图", "平台架构", "部署架构", "整体架构", "拓扑", "连接示意", "应用环境", "实施环境", "场景示意", "环境示意", "通信系统", "系统原理", "工作原理", "原理示意", "芯片功能", "电路", "硬件架构", "系统图", "原理图", "网络图"]),
    ("D状态图", ["状态图", "状态机", "状态转移", "状态变化", "状态示意", "应用状态"]),
    ("C2时序泳道图", ["时序图", "时序示意", "信令", "交互时序", "泳道", "时间轴", "序列图", "交互序列"]),
    ("C1交互示意图", ["交互示意", "交互图", "交互流程", "通信示意", "协同", "交互关系", "调用示意", "调用链路", "关系图"]),
    ("E1数据结构图", ["数据结构", "字段", "表结构", "记录结构", "格式示意", "报文", "帧结构", "实例图", "编码组成", "依赖关系", "交易记录", "有向无环", "DAG", "网格图", "链表", "树"]),
    ("E2界面示意图", ["界面", "页面", "显示屏", "图形用户", "视图界面", "操作界面", "展示界面", "显示界面", "界面变化"]),
    ("F曲线数据图", ["比较图", "对照", "曲线", "折线", "柱状图", "对比图", "效果图", "仿真图", "波形", "频谱", "散点", "统计图", "实验结果", "性能", "轨迹图"]),
    ("G样例对象图", ["胸片", "影像图", "对象的示意", "样图", "实物", "照片", "外观"]),
    ("H视图样图", ["主视图", "俯视图", "侧视图", "剖视", "截面图", "立体图", "仰视图", "后视图", "爆炸图", "电泳", "照片", "外观图", "透视图", "示意图的立体", "视图"]),
    ("B3数据流图", ["数据流", "信息流", "传输流程", "数据流向"]),
    ("B流程图", ["流程图", "流程示意", "方法流程", "步骤图", "流程框图", "实施流程", "工作流程", "处理流程", "逻辑流程", "流程简图", "主要步骤", "过程图", "实现流程", "流程设计", "流程"]),
]
def classify(cap):
    for name, kws in RULES:
        for kw in kws:
            if kw in cap:
                return name
    if "示意" in cap or "框图" in cap or "结构" in cap:
        return "A2模块分解图"
    return "Z未分类"

def captions_of(doc):
    full = "\n".join(pg.extract_text() or "" for pg in doc.pages)
    full = re.sub(r"说　明　书|\d+/\d+页|CN\s*\d+\s*[A-Z]|^\d+$", "", full, flags=re.M)
    m = re.search(r"附图说明(.{0,60000}?)\n\s*(?:具体实施方式|具体实施例)", full, re.S)
    zone = re.sub(r"\s+", "", m.group(1) if m else full)
    caps = {}
    for rx in (CAP_A, CAP_B):
        for mm in rx.finditer(zone):
            num = mm.group(1).strip()
            cap = re.sub(r"\s+", "", mm.group(2).strip(" ，。、：:；;是为示出了的种"))
            if 2 <= len(cap) <= 60 and num not in caps and "所示" not in cap and not cap.startswith("图"):
                caps[num] = cap
    return caps

def title_of(doc):
    t = doc.pages[0].extract_text() or ""
    m = re.search(r"发明名称[：\s]*(.{2,60})", t) or re.search(r"\(54\)(.{2,60})", t) or re.search(r"实用新型名称[：\s]*(.{2,60})", t)
    if m:
        return re.sub(r"\s+", "", m.group(1))
    for ln in t.split("\n"):
        ln = ln.strip()
        if 6 < len(ln) < 60 and ("方法" in ln or "系统" in ln or "装置" in ln):
            return ln
    return ""

def figpages(doc):
    out = []
    for i, pg in enumerate(doc.pages):
        t = pg.extract_text() or ""
        if "附 图" in t or "附　图" in t or re.search(r"说\s*明\s*书\s*附\s*图", t):
            out.append(i)
    if not out:
        for i in range(max(0, len(doc.pages) - 4), len(doc.pages)):
            if len(doc.pages[i].images) >= 1:
                out.append(i)
    return out

def raster_bands(page):
    import numpy as np
    im = page.to_image(resolution=110).original.convert("L")
    arr = np.asarray(im, dtype=np.uint8)
    ink = (arr < 200).sum(axis=1)
    rows = ink > 4
    bands = []
    y = 0
    n = len(rows)
    while y < n:
        if rows[y]:
            a = y
            gap = 0
            while y < n and (rows[y] or gap < 4):
                gap = 0 if rows[y] else gap + 1
                y += 1
            bands.append((a, y - gap))
        else:
            y += 1
    merged = []
    for b in bands:
        if merged and b[0] - merged[-1][1] < 30:
            merged[-1] = (merged[-1][0], b[1])
        else:
            merged.append(b)
    # 去页眉页脚（顶部 8% 内的小带、底部 6%）
    H = len(rows)
    out = []
    for a, b in merged:
        if (b - a) < 40:
            continue
        if a < H * 0.07 and (b - a) < 60:
            continue
        if a > H * 0.94:
            continue
        out.append((a / im.height * page.height, b / im.height * page.height))
    return out

def page_figs(doc, pno):
    """页内「图N」标签 → 上一标签尾到本标签头之间的区域裁剪 → [(num, png_bytes)]"""
    page = doc.pages[pno]
    words = page.extract_words()
    labels = sorted(
        [(w["top"], w["bottom"], FIGLABEL.match(w["text"].strip()).group(1))
         for w in words if FIGLABEL.match(w["text"].strip())],
        key=lambda t: t[0])
    out = []
    prev_end = 30.0
    W = page.width

    def gray_png(bbox):
        im = page.crop(bbox).to_image(resolution=170).original.convert("L")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue()

    for y0, y1, num in labels:
        top = prev_end
        bot = y0 - 2
        if bot - top < 40:
            prev_end = y1 + 2
            continue
        out.append((num, gray_png((36, top, W - 30, bot))))
        prev_end = y1 + 2
    if not out and not labels:
        # 无「图N」标签（扫描页）→ 墨带分带
        for i, (y0, y1) in enumerate(raster_bands(page), 1):
            out.append((f"r{i}", gray_png((30, y0 - 2, W - 26, y1 + 2))))
    return out

def process(pid, url):
    pdf = f"{PDFD}/{pid}.pdf"
    if not os.path.exists(pdf):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
            if len(data) < 5000 or not data.startswith(b"%PDF"):
                return {"id": pid, "err": "bad pdf"}
            open(pdf, "wb").write(data)
        except Exception as e:
            return {"id": pid, "err": repr(e)[:80]}
    try:
        doc = pdfplumber.open(pdf)
    except Exception as e:
        return {"id": pid, "err": repr(e)[:80]}
    title = title_of(doc)
    caps = captions_of(doc)
    entries = []
    for pno in figpages(doc):
        for num, png in page_figs(doc, pno):
            cap = caps.get(num, "")
            if not cap and pid in STATS2:
                seq_cap = STATS2[pid]
                try:
                    if num.startswith("r"):
                        idx = len(entries)
                    else:
                        idx = int(re.sub(r"[A-Z]$", "", num)) - 1
                    if 0 <= idx < len(seq_cap):
                        cap = seq_cap[idx]
                except Exception:
                    pass
            kind = classify(cap) if cap else "Z未分类"
            kd = os.path.join(OUT, kind)
            os.makedirs(kd, exist_ok=True)
            fn = f"{pid}_fig{num}.png"
            fp = os.path.join(kd, fn)
            if os.path.exists(fp):
                fn = f"{pid}_fig{num}_p{pno+1}.png"
                fp = os.path.join(kd, fn)
            with open(fp, "wb") as f:
                f.write(png)
            entries.append({"file": f"{kind}/{fn}", "patent": pid, "fig": num,
                            "kind": kind, "caption": cap, "title": title, "page": pno + 1})
    return {"id": pid, "title": title, "caps": len(caps), "figs": entries}

links = json.load(open("/home/ubuntu/ps/survey/links.json"))
_stats = json.load(open("/home/ubuntu/ps/survey/stats2.json"))
STATS2 = {p: c for p, c in _stats.get("rows", {}).items()}
rows = []
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    futs = {ex.submit(process, p, u): p for p, u in links.items()}
    for fut in concurrent.futures.as_completed(futs):
        rows.append(fut.result())
manifest = [e for r in rows for e in r.get("figs", [])]
json.dump({"patents": [{k: r[k] for k in r if k != "figs"} for r in rows],
           "figures": manifest},
          open("/home/ubuntu/ps/survey/figlib/manifest.json", "w"), ensure_ascii=False, indent=1)
import collections
per = collections.Counter(e["kind"] for e in manifest)
print("patents:", len(rows), "figures:", len(manifest))
for k, n in per.most_common():
    print(f"  {k}: {n}")
for r in rows:
    if r.get("err") or not r.get("figs"):
        print("low:", r["id"], r.get("err"), r.get("caps", 0))
