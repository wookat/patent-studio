# A/B：同一交底书，claims 提示词 旧（无树形块）vs 新（claim_tree_block），真模型各跑一遍
import ast, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.chdir(ROOT)
from patent_studio.kernel import text_forms

# 1) 从 s1.py 抽出 claims 步的真实规则串（隐式拼接字面量）
src_code = open(os.path.join(ROOT, "backend/app/agent/plans/s1.py"), encoding="utf-8").read()
tree = ast.parse(src_code)
RULES = None
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "build":
        args = node.args
        if len(args) >= 2 and isinstance(args[1], ast.Constant) and args[1].value == "claims":
            lit = args[2]
            parts = []
            def collect(n):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    parts.append(n.value); return True
                if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Add):
                    collect(n.left); collect(n.right); return True
                return False  # 函数调用等动态段跳过
            collect(lit)
            RULES = "".join(parts)
            break
assert RULES and len(RULES) > 1500, f"rules too short: {len(RULES or '')}"

# 2) 交底书：examples/method/content.md 全文当 src（title+正文）
doc = open(os.path.join(ROOT, "examples/method/content.md"), encoding="utf-8").read()
title = doc.split("\n", 1)[0].lstrip("# ")
src_text = doc[:4000]
outline_text = "（按交底书组织：方法独权+装置+设备+介质四型束）"
q = (title + "\n" + src_text + "\n" + outline_text)[:4000]
ctx_text = title + "\n\n" + src_text + "\n\n大纲：\n" + outline_text

blocks_old = "\n" + text_forms.claims_skeleton_block() + "\n" + text_forms.claims_block()
dom = text_forms.domain_exemplar_block(q)
blocks_new = "\n" + text_forms.claims_skeleton_block() + "\n" + (text_forms.claim_tree_block(q) or "") + "\n" + text_forms.claims_block()

def build_prompt(rules, extra):
    msgs = [{"role": "system", "content": "你是资深专利代理人，输出 JSON。"},
            {"role": "user", "content": rules + extra + ("\n" + dom if dom else "") + "\n\n" + ctx_text}]
    return msgs

KEY = os.environ["AICDKS_KEY"]
def gen(msgs):
    req = urllib.request.Request(
        "https://api.aicdks.com/v1/chat/completions",
        data=json.dumps({"model": "swe-2-medium", "messages": msgs, "temperature": 0.3}).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=180).read())
    return r["choices"][0]["message"]["content"]

def parse_claims(text):
    m = re.search(r"\{.*\}", text, re.S)
    d = json.loads(m.group(0))
    return d["claims"]

for tag, extra in [("OLD", blocks_old), ("NEW", blocks_new)]:
    out = gen(build_prompt(RULES, extra))
    claims = parse_claims(out)
    fn = os.path.join(ROOT, "docs/text-corpus/tools", f"ab_{tag.lower()}_claims.txt")
    open(fn, "w", encoding="utf-8").write("\n\n".join(f"{i+1}.{c}" for i, c in enumerate(claims)))
    print(f"=== {tag}: {len(claims)} claims -> {fn}")
    # 拓扑摘要：独权种类 + 引用链
    indeps = [i+1 for i, c in enumerate(claims) if not re.match(r"根据权利要求", c.strip())]
    print("indep nums:", indeps)
