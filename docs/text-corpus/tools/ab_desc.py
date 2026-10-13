# A/B：说明书「技术领域+背景技术」同节成稿 —— 旧（案级范例）vs 新（+句级检索范例）
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.chdir(ROOT)
from patent_docx import text_forms

doc = open(os.path.join(ROOT, "examples/method/content.md"), encoding="utf-8").read()
title = doc.split("\n", 1)[0].lstrip("# ")
src_text = doc[:4000]
outline_text = "（按交底书组织：方法独权+装置+设备+介质四型束）"
names = ("技术领域", "背景技术")

# 复刻 s1 该节组的 ask 组装
names_s = "、".join(names)
q = (title + "\n" + src_text + "\n" + outline_text)[:4000]
dom = text_forms.domain_exemplar_block(q)
sent = text_forms.section_sent_block((title + "\n" + outline_text + "\n" + names_s)[:3000],
                                     ["F1技术领域", "F3痛点转折"], k=6, label="/".join(names))
META = ("正文只写技术内容——不得出现交底书、建议核对、请核对、暂按、疑似、待补、"
        "待补充、拟定等撰写性/存疑措辞；不得出现论文式评论/类比句；不得出现宣传性用语。")
SEC = ("「技术领域」一两句即可；「背景技术」按应用场景→技术路线演进→现有方案的具体不足"
       "逐条枚举（每条不足给出技术成因，不只写结论性描述）→本发明切入点逐段展开，不少于 1200 字。")

def ask_for(with_sent: bool) -> str:
    return (f"请按大纲写说明书以下各节：{names_s}，"
            "输出 {description: {节名: 多段纯文本，段落之间空一行}}。"
            + "\n" + text_forms.description_block()
            + (with_sent and sent and "\n" + sent or "")
            + (dom and "\n" + dom or "") + SEC + META)

ctx_text = title + "\n\n" + src_text + "\n\n大纲：\n" + outline_text
KEY = os.environ["AICDKS_KEY"]

def gen(ask):
    msgs = [{"role": "system", "content": "你是资深专利代理人，输出 JSON。\n\n案卷上下文：\n" + ctx_text},
            {"role": "user", "content": ask}]
    req = urllib.request.Request(
        "https://api.aicdks.com/v1/chat/completions",
        data=json.dumps({"model": "swe-2-max", "messages": msgs, "temperature": 0.3}).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=300).read())
    return r["choices"][0]["message"]["content"]

for tag, ws in [("old", False), ("new", True)]:
    out = gen(ask_for(ws))
    m = re.search(r"\{.*\}", out, re.S)
    d = json.loads(m.group(0))
    fn = os.path.join(ROOT, "docs/text-corpus/tools", f"ab_{tag}_desc.txt")
    open(fn, "w", encoding="utf-8").write(json.dumps(d.get("description", d), ensure_ascii=False, indent=1))
    print(f"=== {tag} -> {fn}")
print("\n注入的句级范例：\n" + (sent or "EMPTY"))
