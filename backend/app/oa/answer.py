# -*- coding: utf-8 -*-
"""OA 逐条答复（docs/plan/09 §3.4）：heavy 任务，每条一次 prompts.build("oa_answer") 调用。

answer(...) 返回 {item_id, points, claim_edits, amend_summary}：
  claim_edits 每项 {claim, block_id, line, critic_line, original}。AI 给的 critic_line 先 critic.accept 得到「修改后」，
  再由 to_critic(原权项, 修改后) 逐行生成 CriticMarkup ⇒ reject(critic_line) == 原权项恒成立（不静默改写用户源码）；
  再过 critic.lint_marks 与 patch.patch_block 试装（不落盘）；不合法的建议丢进 warnings。
  写回由前端经既有 POST /api/projects/{pid}/blocks/{block_id}（patch.py）完成，用户接受/拒绝。
"""

import difflib
import json
import os
import re

from app import atomic
from app.ai import prompts
from app.convert import runner
from app.oa.rounds import RoundError
from patent_studio.kernel import critic, patch, text_forms
from patent_studio.kernel.ast import AstError, parse_ast

OA_DIR = os.path.join(".studio", "oa")
ITEMS_FILE = "items.json"
_CLAIM_NUM = re.compile(r"^\s*\d+\s*[.、．]\s*")


def oa_dir(project_dir: str) -> str:
    return os.path.join(project_dir, OA_DIR)


def save_items(project_dir: str, items: list[dict], warnings: list[str]) -> None:
    d = oa_dir(project_dir)
    os.makedirs(d, exist_ok=True)
    for name in os.listdir(d):
        if name.startswith("oa-") and name.endswith(".json"):
            os.remove(os.path.join(d, name))
    atomic.write_json(os.path.join(d, ITEMS_FILE), {"items": items, "warnings": warnings})


def _items_raw(project_dir: str) -> dict:
    p = os.path.join(oa_dir(project_dir), ITEMS_FILE)
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            raw = json.load(f)
    except ValueError as e:
        raise RoundError(f"OA 拆条文件无法读取：{e}", 422) from e
    return raw if isinstance(raw, dict) else {}


def load_items(project_dir: str) -> list[dict]:
    return _items_raw(project_dir).get("items") or []


def load_items_bundle(project_dir: str) -> dict:
    """当前拆条工作集 + 告警 + 已生成答复——OA 面板刷新后重建前端状态。

    此前 items.json/答复文件只写不读：POST /parse 的响应是唯一获取途径，页面一刷新
    oaItems 就只剩轮次行上的条数而没有条目本体（D-OA-1）。

    每条意见透出证据链状态（Z23）：pending=未答 / answered=已有答复落盘 /
    delivered=所属轮次已登记递交（filed_on）；round_id 为拆条挂接的轮次（无则 None），
    同一 item 出现在多轮时取编号最大的轮次。"""
    raw = _items_raw(project_dir)
    items = raw.get("items") or []
    answers = load_answers(project_dir)
    answered = {a["item_id"] for a in answers}
    round_of = _item_rounds(project_dir)
    out = []
    for it in items:
        rid, filed = round_of.get(it["id"], (None, None))
        status = "delivered" if filed else ("answered" if it["id"] in answered else "pending")
        out.append({**it, "status": status, "round_id": rid})
    return {
        "items": out,
        "warnings": raw.get("warnings") or [],
        "answers": answers,
    }


def _item_rounds(project_dir: str) -> dict[str, tuple[str, str | None]]:
    """item_id → (round_id, filed_on)：拆条挂轮次的证据链（rounds.attach_items 写入）。"""
    from app.oa import rounds as rounds_mod

    out: dict[str, tuple[str, str | None]] = {}
    for rnd in rounds_mod.list_rounds(project_dir):
        for it in rnd.get("items") or []:
            out[it["id"]] = (rnd["id"], rnd.get("filed_on"))
    return out


def save_answer(project_dir: str, ans: dict) -> None:
    atomic.write_json(os.path.join(oa_dir(project_dir), ans["item_id"] + ".json"), ans)


def load_answers(project_dir: str) -> list[dict]:
    d = oa_dir(project_dir)
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(os.listdir(d), key=lambda n: int(re.sub(r"\D", "", n) or 0)):
        if name.startswith("oa-") and name.endswith(".json"):
            try:
                with open(os.path.join(d, name), encoding="utf-8") as f:
                    out.append(json.load(f))
            except ValueError as e:
                raise RoundError(f"OA 答复文件 {name} 无法读取：{e}", 422) from e
    return out


# ---------------- CriticMarkup 生成 ----------------


def _mark_line(old: str, new: str) -> str:
    if old == new:
        return old
    if not old:
        return "{++" + new + "++}"
    if not new:
        return "{--" + old + "--}"
    # 片段 (old_part, new_part)；相等片段 ≤2 字且夹在两处改动之间时并入改动，避免「{~~a~>b~~}的{~~c~>d~~}」式碎标记
    segs: list[list[str]] = []
    for op, a0, a1, b0, b1 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        segs.append([old[a0:a1], new[b0:b1], op])
    merged: list[list[str]] = []
    for s in segs:
        if merged and (s[2] != "equal" or len(s[0]) <= 2) and merged[-1][2] != "equal":
            merged[-1] = [merged[-1][0] + s[0], merged[-1][1] + s[1], "change"]
        elif merged and s[2] != "equal" and merged[-1][2] == "equal" and len(merged[-1][0]) <= 2 and len(merged) > 1:
            eq = merged.pop()
            merged[-1] = [merged[-1][0] + eq[0] + s[0], merged[-1][1] + eq[1] + s[1], "change"]
        else:
            merged.append([s[0], s[1], "equal" if s[2] == "equal" else "change"])
    out: list[str] = []
    for a, b, op in merged:
        if op == "equal" or a == b:
            out.append(a)
        elif not a:
            out.append("{++" + b + "++}")
        elif not b:
            out.append("{--" + a + "--}")
        else:
            out.append("{~~" + a + "~>" + b + "~~}")
    return "".join(out)


def to_critic(original: str, revised: str) -> str:
    """逐行 CriticMarkup：行数对齐（多出的整行以 {++ ++} / {-- --} 呈现），标记不跨行；
    critic.reject(结果).rstrip("\\n") == original（整行新增处 reject 后只剩空行）。"""
    old, new = original.split("\n"), revised.split("\n")
    n = max(len(old), len(new))
    old += [""] * (n - len(old))
    new += [""] * (n - len(new))
    return "\n".join(_mark_line(a, b) for a, b in zip(old, new))


# ---------------- 权项上下文与建议校验 ----------------


def claim_blocks(content: str) -> dict[int, dict]:
    """{权项号: {block_id, line, text}}；text 为块原文（多行以 \\n 连接）。"""
    ast = parse_ast(content)
    off = ast["books"]["claims"]["offset"]
    lines = content.split("\n")
    out = {}
    for c in ast["claims"]:
        a, b = c["lines"]["start"], c["lines"]["end"]
        out[c["num"]] = {"block_id": c["id"], "line": off + a, "text": "\n".join(lines[off + a - 1 : off + b])}
    return out


def normalize_edits(content: str, edits: list, claims: dict[int, dict]) -> tuple[list[dict], list[str]]:
    out: list[dict] = []
    warnings: list[str] = []
    for e in edits or []:
        if not isinstance(e, dict):
            continue
        try:
            num = int(e.get("claim"))
        except (TypeError, ValueError):
            warnings.append(f"权项修改建议缺少权项号：{e!r}"[:200])
            continue
        blk = claims.get(num)
        if blk is None:
            warnings.append(f"权项修改建议指向不存在的权利要求 {num}")
            continue
        revised = critic.accept(str(e.get("critic_line") or "")).strip()
        head = revised.split("\n", 1)[0]
        if not head:
            warnings.append(f"权利要求 {num} 的修改建议为空")
            continue
        # AI 只需给正文；编号保持与块原文一致，避免把「1.」改掉
        revised_lines = revised.split("\n")
        revised_lines[0] = _CLAIM_NUM.match(blk["text"]).group(0) + _CLAIM_NUM.sub("", revised_lines[0])
        revised = "\n".join(ln for ln in revised_lines if ln.strip())
        line = to_critic(blk["text"], revised)
        if critic.reject(line).rstrip("\n") != blk["text"]:
            warnings.append(f"权利要求 {num} 的修改建议无法还原原文，已丢弃")
            continue
        marks = critic.lint_marks(line)
        if marks:
            warnings.append(f"权利要求 {num} 的修改建议标记不合法：{marks[0]['message']}")
            continue
        try:
            patch.patch_block(content, blk["block_id"], line)
        except (patch.PatchError, AstError) as ex:
            warnings.append(f"权利要求 {num} 的修改建议无法装入权利要求书：{ex}")
            continue
        if line == blk["text"]:
            continue
        out.append(
            {
                "claim": num,
                "block_id": blk["block_id"],
                "line": blk["line"],
                "critic_line": line,
                "original": blk["text"],
            }
        )
    return out, warnings


def _context(content: str, item: dict, claims: dict[int, dict]) -> str:
    focus = [n for n in item.get("claims") or [] if n in claims] or sorted(claims)
    parts = ["当前权利要求书（相关权项）："]
    parts += [claims[n]["text"] for n in focus[:12]]
    if focus:
        argue = text_forms.oa_argue_block(claims[focus[0]]["text"])
        if argue:
            parts.append(argue)
    return "\n\n".join(parts)


def _user(item: dict) -> str:
    return (
        "下面是一条审查意见，请给出申请人的答复要点（逐点，面向审查员的意见陈述），\n"
        "并对被指出的权利要求提出修改建议：\n"
        "claim_edits 中每项 {claim: 权项号, critic_line: 该权项修改后的完整正文（可用 CriticMarkup 标出改动）}；"
        "不需要修改就给空数组；amend_summary 用一两句话概括修改。\n\n审查意见：\n" + item["text"]
    )


async def answer(*, store, ai, pid: str, item: dict, job_id: str | None = None) -> dict:
    project_dir = store._dir(pid)
    content = store.read_content(pid)
    claims = claim_blocks(content)
    messages = prompts.build("oa_answer", _user(item), _context(content, item, claims))
    text, usage = await runner.heavy_chat(ai, messages, project_dir=project_dir, job_id=job_id)
    data = prompts.parse_json(text, prompts.SCHEMAS["oa_answer"])
    edits, warnings = normalize_edits(content, data.get("claim_edits"), claims)
    ans = {
        "item_id": item["id"],
        "points": [str(p) for p in data.get("points") or []],
        "claim_edits": edits,
        "amend_summary": str(data.get("amend_summary") or ""),
        "warnings": warnings,
        "usage": usage,
    }
    save_answer(project_dir, ans)
    return ans
