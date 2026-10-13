"""检索质量验收：抽 20 个真实案当「申请案交底」，测 prior-art 命中与相关性。

方法：每案取其 F1（技术领域起句）+ 发明内容段前 2 句当 query（模拟交底书），
排除自命中后看 top-8 命中案是否与 query 案同域——域标签用 query 句里的
领域关键词命中推断（简化但可复核）。
"""
import json, os, random, re, sys

D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # docs/text-corpus
ROOT = os.path.dirname(os.path.dirname(D))  # repo root
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.chdir(ROOT)  # so text_forms._find() locates docs/text-corpus

from patent_studio.kernel import text_forms

DOMAINS = {
    "对话问答": "对话|问答|意图识别|多轮",
    "知识图谱": "知识图谱|实体对齐|三元组|本体",
    "推荐系统": "推荐|召回|排序|点击率|画像",
    "图像视觉": "图像|视觉|分割|检测|识别|超分辨率|重建",
    "语音音频": "语音|音频|声学|声纹|唤醒",
    "视频分析": "视频|帧|行为识别|目标跟踪",
    "医学医疗": "医学|医疗|影像|病灶|诊断|生理",
    "区块链安全": "区块链|加密|脱敏|隐私|证书|水印",
    "网络通信": "通信|信道|波束|天线|基站|卫星",
    "工业制造": "工业|缺陷|质检|机器人|PLC|轴承|故障",
    "交通出行": "交通|车辆|驾驶|轨迹|路网|无人机",
    "能源电力": "电网|电力|继电|电池|光伏|充电",
    "大模型NLP": "大模型|语言模型|预训练|蒸馏|微调|提示|文本生成|翻译",
    "检索匹配": "检索|匹配|排序|搜索|索引|相似",
    "文档解析": "文档|版面|表格|公式|OCR|票据|解析",
    "三维点云": "点云|三维|配准|SLAM|建图|定位",
    "资源调度": "调度|任务分配|边缘计算|容器|负载|云原生",
    "数据挖掘": "数据挖掘|异常检测|时序|预测|聚类|分类",
    "金融风控": "金融|风控|信贷|支付|交易|反欺诈",
    "农业遥感": "遥感|农业|作物|气象|解译",
}

def domain_of(text):
    tags = [k for k, pat in DOMAINS.items() if re.search(pat, text)]
    return tags or ["其他"]

def main():
    vecs, pub_sents = text_forms._pub_vecs()
    pubs = sorted(vecs.keys())
    random.seed(42)
    f1x = {}
    bodyx = {}
    for line in open(os.path.join(D, "sentences.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        role = r.get("role", "")
        if role.startswith("F1") and r["pub"] not in f1x:
            f1x[r["pub"]] = r["text"]
        if role in ("F4发明内容", "F5方面枚举") and len(bodyx.get(r["pub"], "")) < 200:
            bodyx[r["pub"]] = bodyx.get(r["pub"], "") + r["text"]
    # 只抽有 F1+发明内容文本的案作 query（否则 query 没信息量不算真实交底）
    good = [p for p in pubs if len(f1x.get(p, "") + bodyx.get(p, "")) > 60]
    sample = random.sample(good, 20)
    # F1技术领域首句 + 发明内容段做 query 文本
    f1 = {}
    body = {}
    for line in open(os.path.join(D, "sentences.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        role = r.get("role", "")
        if role.startswith("F1") and r["pub"] not in f1:
            f1[r["pub"]] = r["text"]
        if role in ("F4发明内容", "F5方面枚举") and len(body.get(r["pub"], "")) < 200:
            body[r["pub"]] = body.get(r["pub"], "") + r["text"]
    report = []
    hits_total = 0
    relev_total = 0
    for pub in sample:
        q = (f1.get(pub, "") + body.get(pub, ""))[:400]
        res = text_forms.match_pubs(q, 9)
        res = [r for r in res if r != pub][:8]
        qdom = set(domain_of(f1.get(pub, "") + body.get(pub, ""))) - {"其他"}
        rel = 0
        for h in res:
            hdom = set(domain_of(f1.get(h, "") + body.get(h, ""))) - {"其他"}
            if qdom & hdom:
                rel += 1
        hits_total += len(res)
        relev_total += rel
        titles = text_forms.pub_titles()
        report.append({"pub": pub, "qdom": sorted(qdom), "hits": len(res), "relevant": rel,
                       "q_excerpt": q[:120],
                       "top": res[:3], "topdom": [sorted(domain_of(f1.get(h, "") + body.get(h, ""))) for h in res[:3]],
                       "top_titles": [titles.get(h, "") for h in res[:3]],
                       "top_f1": [f1.get(h, "")[:80] for h in res[:3]]})
    # 枢纽案检测：同一案号在 20 个 query 的 top8 里出现次数
    hub = {}
    for c in report:
        for h in c["top"]:
            hub[h] = hub.get(h, 0) + 1
    # top-3 人工抽判 5 案：导出 query 摘要+命中案标题/技术领域句，供人读判
    manual = [{"pub": c["pub"], "q_excerpt": c["q_excerpt"],
               "top3": [{"pub": p, "title": t, "f1": f} for p, t, f in zip(c["top"], c["top_titles"], c["top_f1"])]}
              for c in report[:5]]
    out = {"n_cases": len(sample), "avg_hits": hits_total / len(sample), "avg_relevant": relev_total / len(sample),
           "relevance_rate": relev_total / max(hits_total, 1),
           "hub_top3": sorted(hub.items(), key=lambda x: -x[1])[:6],
           "manual_check_5": manual, "cases": report}
    json.dump(out, open(os.path.join(D, "tools", "eval_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1)[:6000])

if __name__ == "__main__":
    main()
