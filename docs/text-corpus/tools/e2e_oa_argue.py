# OA争辩端到端：真 OA 拆条 → s7 argue 提示词（含 oa_argue_block 引证位）→ 真模型 → 答复稿
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.chdir(ROOT)
from patent_studio.kernel import text_forms
from app.ai import prompts_agent
from app.oa import answer as oa_answer

content = open(os.path.join(ROOT, "examples/method/content.md"), encoding="utf-8").read()
claims = oa_answer.claim_blocks(content)

# 真实化 OA 拆条：创造性驳回（对比文件 1+公知常识评权 1-9）
item = {
    "id": "oa-1",
    "type": "创造性",
    "claims": [1, 2, 3, 4, 5, 6, 7, 8, 9],
    "refs": [1],
    "text": ("权利要求1-9不具备创造性。对比文件1（CN114994026A，一种时间序列预测方法）公开了"
             "对时间序列预测模型进行在线预测并基于预测误差更新模型的方法，权利要求1与对比文件1的"
             "区别在于：冻结基础预测模型设定安全锚输出、以成熟反馈队列结算成熟损失驱动信任系数"
             "门控自适应修正分支、并以e过程统计量监控回退。上述区别特征属于本领域技术人员为控制"
             "预测漂移而易想到的常规技术手段，故权利要求1不具备专利法第二十二条第三款规定的创造性。"
             "权利要求2-9的附加特征亦为常规选择，基于同样理由不具备创造性。"),
}

# 复刻 s7._context 的组装（无 RunContext 版：claims 文本 + 引证块）
focus = [n for n in item["claims"] if n in claims]
parts = []
for n in focus[:3]:
    parts.append(f"权利要求 {n}：{claims[n]['text']}")
parts.append(text_forms.oa_argue_block(claims[focus[0]]["text"]))
ctx_text = "\n\n".join(parts)

msgs = prompts_agent.build("s7", "argue", oa_answer._user(item), context=ctx_text, pid="method",
                           item=item["id"])
open(os.path.join(ROOT, "docs/text-corpus/tools/oa_argue_prompt.txt"), "w",
     encoding="utf-8").write(msgs[0]["content"] + "\n\n====USER====\n\n" + msgs[1]["content"])
print("prompt written, ctx chars:", len(ctx_text))

req = urllib.request.Request(
    "https://api.aicdks.com/v1/chat/completions",
    data=json.dumps({"model": "swe-2-max", "messages": msgs, "temperature": 0.3}).encode(),
    headers={"Authorization": "Bearer " + os.environ["AICDKS_KEY"], "Content-Type": "application/json"})
r = json.loads(urllib.request.urlopen(req, timeout=300).read())
text = r["choices"][0]["message"]["content"]
open(os.path.join(ROOT, "docs/text-corpus/tools/oa_argue_out.txt"), "w", encoding="utf-8").write(text)
m = re.search(r"\{.*\}", text, re.S)
data = json.loads(m.group(0))
print("points:", len(data.get("points") or []), "| edits:", len(data.get("claim_edits") or []))
for i, p in enumerate(data.get("points") or [], 1):
    print(f"{i}. {p[:150]}")
