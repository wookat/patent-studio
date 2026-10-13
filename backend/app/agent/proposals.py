# -*- coding: utf-8 -*-
"""Proposal 落地（docs/plan/21 §6.3、19 §4.6–4.7）：`.studio/ai-proposals/<pid>.jsonl` 读写 + apply / dismiss。

- 存储是追加日志：每次新建 / 状态变化追加一整行 Proposal（+ `by`、`ts`），读取时同 id 取最后一行。
- apply(critic)：把 `critic_markdown` 作为块的建议稿，经 `tools.suggest`（生成标记）→ `patch.patch_block`
  （重解析 + 落盘）
  写入；写入前断言 `critic.reject(new) == old` 逐字节成立，否则 422 —— 最终文本永不被直接改写。
- apply(patch)：块补丁整块包 `{++ ++}` 经 `patch.insert_block` 写入；文件补丁写 `docs/<name>.md` 并 history.commit。
- apply(comment)：写 comments 存储（author=ai:<model>）。
- 每次状态变化：emit `ai.proposal`（data.state = applied | dismissed）+ `audit.jsonl`（who=agent:<job_id>）。
"""
import asyncio
import json
import os
import re
import time
import uuid

from app import atomic
from app.agent import checks
from app.agent.types import (
    SCENARIO_BY_ID,
    Anchor,
    BlockAnchor,
    BlocksPatch,
    FilePatch,
    Patch,
    Proposal,
    ProposalApplyResult,
    ProposalState,
)
from app.domain import comments as comments_mod
from app.domain import events, history
from app.domain import figures as figures_mod
from app.domain.projects import normalize_settings
from app.errors import kind_error
from app.mcp import audit
from app.mcp.tools import suggest
from patent_studio.kernel import critic, patch
from patent_studio.kernel.ast import parse_ast

DIR = os.path.join(".studio", "ai-proposals")
FILE_RE = re.compile(r"^(docs/[A-Za-z0-9_.-]+\.md|figs-src/[A-Za-z0-9_-]{1,64}\.mmd)$")


def path(project_dir: str, pid: str) -> str:
    return os.path.join(project_dir, DIR, f"{pid}.jsonl")


def new_id() -> str:
    return "prop_" + uuid.uuid4().hex[:12]


def append(project_dir: str, pid: str, proposal: Proposal, by: str) -> None:
    p = path(project_dir, pid)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    row = proposal.model_dump(mode="json")
    row.update(by=by, ts=time.time())
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def load(project_dir: str, pid: str, state: ProposalState | None = None) -> list[Proposal]:
    """同 id 取最后一行；按 created_at 升序。"""
    p = path(project_dir, pid)
    if not os.path.isfile(p):
        return []
    last: dict[str, Proposal] = {}
    with open(p, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                row = json.loads(line)
                row.pop("by", None)
                row.pop("ts", None)
                prop = Proposal.model_validate(row)
                last[prop.id] = prop
    out = sorted(last.values(), key=lambda x: x.created_at)
    return [x for x in out if state is None or x.state == state]


def get(project_dir: str, pid: str, proposal_id: str) -> Proposal:
    for prop in load(project_dir, pid):
        if prop.id == proposal_id:
            return prop
    raise kind_error("not_found", f"提案不存在：{proposal_id}", detail=proposal_id)


def preview(proposal: Proposal, limit: int = 120) -> str:
    text = proposal.critic_markdown or proposal.comment_body or ""
    if not text and proposal.patch is not None:
        text = proposal.patch.content if isinstance(proposal.patch, FilePatch) else \
            "\n".join(b.markdown for b in proposal.patch.blocks)
    text = text.strip().replace("\n", " ")
    return text if len(text) <= limit else text[:limit - 1] + "…"


# ---------------------------------------------------------------- 生成标记 ----

def as_critic(orig: list[str], out: str) -> str | None:
    """模型输出 → 覆盖整段的 CriticMarkup；行数不同 ⇒ None。
    满足 reject(out)==原文 直接用；否则逐行包成 {~~原行~>模型终稿~~}（模型没打标记时仍走接受/拒绝）。"""
    lines = out.strip("\n").split("\n")
    while len(lines) > len(orig) and not lines[-1].strip():
        lines.pop()
    if len(lines) != len(orig):
        return None
    if critic.reject("\n".join(lines)) == "\n".join(orig) and not critic.lint_marks("\n".join(lines)):
        return "\n".join(lines)
    fixed = []
    for o, ln in zip(orig, lines):
        final = critic.accept(ln)
        fixed.append(o if final == o else f"{{~~{o}~>{final}~~}}")
    return "\n".join(fixed)


def critic_for_block(content: str, settings: dict, block_id: str, markdown: str) -> str:
    """块的建议稿（可含也可不含标记）→ 满足 reject == 原块 的 CriticMarkup 文本。"""
    ast = patch._reparse(content, settings)
    _book, _b, s, e = patch.find_block(ast, block_id)
    old = content.split("\n")[s:e]
    if critic.reject(markdown) == "\n".join(old) and not critic.lint_marks(markdown) \
            and not any(ln.startswith("## ") for ln in critic.accept(markdown).split("\n")):
        # 早退原样返回仅限接受视图无 `## ` 行——标记内粘进 `## 摘要<正文>` 胶水行的
        # 建议稿原样落正文会被 AST 当未知章节拒（prop_c8555a9895c3 实案 422），
        # 必须走 suggest 归一化（_block_lines 剥壳书头）。
        return markdown
    return "\n".join(suggest(old, patch._block_lines(critic.accept(markdown))))


# ---------------------------------------------------------------- apply / dismiss ----

def _settings(store, p) -> dict:
    return normalize_settings(p.settings, store.list_figs(p.dir))


def _file_target(project_dir: str, name: str) -> str:
    if not FILE_RE.match(name):
        raise kind_error("validation", f"补丁文件名不合法（只允许 docs/<name>.md 或 figs-src/<stem>.mmd）：{name}",
                         detail=name)
    return os.path.join(project_dir, *name.split("/"))


def _apply_critic(store, pid: str, p, prop: Proposal) -> tuple[str, str, dict]:
    if not isinstance(prop.anchor, BlockAnchor) or not prop.critic_markdown:
        raise kind_error("validation", "critic 提案缺少块锚点或修订文本", detail=prop.id)
    content = store.read_content(pid)
    s = _settings(store, p)
    try:
        marked = critic_for_block(content, s, prop.anchor.block_id, prop.critic_markdown)
        r = patch.patch_block(content, prop.anchor.block_id, marked, s, store.load_figures(p.dir))
    except patch.PatchError as e:
        raise kind_error("content", str(e), detail=prop.id, status=422 if e.kind != "stale" else 409)
    if critic.reject(r.content) != critic.reject(content):
        raise kind_error("content", "修订标记不可逆（拒绝后与原文不一致），已放弃写入", detail=prop.id)
    return content, r.content, r.changed_lines


def _nonblank(text: str) -> list[str]:
    return [ln for ln in text.split("\n") if ln.strip()]


def _apply_blocks(store, pid: str, p, prop: Proposal, bp: BlocksPatch) -> tuple[str, str, dict, list[str]]:
    content = store.read_content(pid)
    s = _settings(store, p)
    figures = store.load_figures(p.dir)
    cur = content
    # checks.apply_blocks と同じ不変量：块 id は书内全局序号——靠前插入会重排其后锚点，
    # 因此按锚点行位倒序应用；同一锚点后的多块用 tail 连锁保持给出顺序。
    tail: dict[str, str] = {}
    skipped: list[str] = []
    # base：基线文档——replace 的目标块若在标标记，cur 侧先压平再包新标记；
    # reject(cur) 因此还原的是压平文本而非原标记文本，不变量不再可比。
    # base 只同步「压平」这一步（不放新标记），reject(cur) 应与 reject(base) 一致
    base = content
    base_ok = True
    for b in checks._ordered_by_anchor(content, bp.blocks, s, figures):
        try:
            if b.replace_block_id:
                _, _, s_, e_ = patch.find_block(parse_ast(cur, s, figures=figures), b.replace_block_id)
                # 被替换块内若已带 {--}/{++} 标记，直接再包 {--} 会嵌套——
                # TOKEN 非嵌套单级，外层 {-- 遇内层 --} 提前闭合留下残符，
                # reject 不可逆（mamba 实案连环提案全 422）。先把该区间归一到
                # 接受视图（视同先收下在标修订），再按平文本包标记
                old_flat = critic.accept("\n".join(cur.split("\n")[s_:e_]))
                marked = "\n".join("{--%s--}" % ln for ln in old_flat.split("\n")) + "\n" \
                    + "\n".join("{++%s++}" % ln for ln in patch._block_lines(b.markdown))
                r = patch.patch_block(cur, b.replace_block_id, marked, s, figures)
                if base_ok:
                    try:
                        base = patch.patch_block(base, b.replace_block_id, old_flat, s, figures).content
                    except patch.PatchError:
                        base_ok = False
                # 三明治标记可能被 AST 拆成多块——同锚点的后续插入要连到最末一块
                tail[b.after_block_id] = patch.block_at_line(r.ast, r.changed_lines["end"]) or r.block_id
            else:
                marked = "\n".join("{++%s++}" % ln for ln in patch._block_lines(b.markdown))
                r = patch.insert_block(cur, "paragraph", tail.get(b.after_block_id, b.after_block_id),
                                       None, marked, s, figures)
        except patch.PatchError as e:
            # stale 锚点整块拒——一条过期锚点把 103 块整提案毙掉（mamba 实案：
            # eq12 过期使全新权项族随提案整体 409）。改为跳过该块、其余照落，
            # 跳过清单随结果透出；非 stale 错误仍按原语义抛出
            if e.kind != "stale":
                raise kind_error("content", str(e), detail=prop.id, status=422)
            skipped.append(b.replace_block_id or b.after_block_id or "?")
            continue
        cur = r.content
        if not b.replace_block_id and r.block_id:
            # 多行 {++} 标记文本可能被 AST 拆成多块（表头行成段、表体行另起段）——
            # r.block_id 是插入区首行所在块，续链必须落到末行所在块，否则后续插入
            # 挤进首块与残余行之间，残余表行被层层推到文末堆叠（vit-11 实案）
            tail[b.after_block_id] = (
                patch.block_at_line(r.ast, r.changed_lines["end"]) or r.block_id)
    if _nonblank(critic.reject(cur)) != _nonblank(critic.reject(base)):
        raise kind_error("content", "新块标记不可逆（拒绝后与原文不一致），已放弃写入", detail=prop.id)
    cur = _retitle(cur)
    marked_idx = [i for i, ln in enumerate(cur.split("\n")) if "{++" in ln]
    changed = {"start": min(marked_idx), "end": max(marked_idx) + 1} if marked_idx else {"start": 0, "end": 0}
    return content, cur, changed, skipped


_TITLE_PH = "XXX"
# 题名尾部元信息括注——bert-12 实案案名/迭代语境漏进书题（「…及装置（轮33验证）」），
# 授权件题名从不带轮次/版本/验证标记。锚行尾剥除，正文合法题名不受影响。
_TITLE_META_TAIL = re.compile(
    r"[（(][^（）()\n]{0,40}?(?:轮|迭代|验证|版次|测试|草稿|内部|draft|rev|v\d)[^（）()\n]{0,40}?[)）]\s*$",
    re.IGNORECASE)
# 权1 主语名：「一种<名>(方法|装置|设备|系统|介质|模型)」，独占一行起算（权利要求书内独立权项）
_CLAIM1_RE = re.compile(r"(?m)^\d+[\.、]?\s*(一种[^\n，。；]{2,60}?(方法|装置|设备|系统|介质|模型))")
_CARRIER_RE = re.compile(r"(?m)^\d+[\.、]?\s*一种[^\n，。；]{2,60}?(装置|设备|系统|介质|模型)")


def _retitle(cur: str) -> str:
    """成品题名派生：全案 patch 应用后书题仍是模板占位（`# 一种XXX…`）时按权1主语改写。
    书题在书块锚点之外、块提案覆盖不到——不补则占位题面原样落库（vit-11 实案印出
    「一种XXX方法及装置」）。存在装置/设备类第二类独权时按惯例补「及装置」尾。
    题尾迭代/验证类元信息括注恒定剥除（bert-12 实案「（轮33验证）」漏进书题）。"""
    lines = cur.split("\n")
    i = next((k for k, ln in enumerate(lines) if ln.startswith("# ")), None)
    if i is None:
        return cur
    for _ in range(3):
        s = _TITLE_META_TAIL.sub("", lines[i]).rstrip()
        if s == lines[i]:
            break
        lines[i] = s
    if _TITLE_PH not in lines[i]:
        return "\n".join(lines)
    acc = critic.accept(cur)
    m = _CLAIM1_RE.search(acc)
    if not m:
        return "\n".join(lines)
    title = m.group(1)
    if m.group(2) == "方法":
        c = _CARRIER_RE.search(acc)
        if c and c.group(1) not in title:
            title += "及" + c.group(1)
    lines[i] = "# " + title
    return "\n".join(lines)


def _apply_file(store, pid: str, p, prop: Proposal, fp: FilePatch, who: str) -> str | None:
    if fp.file.startswith("figs-src/"):
        # 走领域写口校验（stem 字符集/≤256KB/原子写），不重复原子写实现
        figures_mod.put_figure_source(store, pid, fp.file.split("/", 1)[1], fp.content)
    else:
        target = _file_target(p.dir, fp.file)
        atomic.write_text(target, fp.content if fp.content.endswith("\n") else fp.content + "\n")
    return history.commit(p.dir, f"AI 提案 {prop.scenario}：{fp.file}", author=who)


def _apply_comment(p, prop: Proposal) -> str:
    if not isinstance(prop.anchor, BlockAnchor) or not prop.comment_body:
        raise kind_error("validation", "comment 提案缺少块锚点或正文", detail=prop.id)
    lines = critic.accept(open(os.path.join(p.dir, "content.md"), encoding="utf-8").read()).split("\n")
    line = max(1, min(prop.anchor.line_start, len(lines)))
    quote = lines[line - 1].strip()[:40] if 1 <= line <= len(lines) else ""
    with comments_mod.file_lock(p.dir):  # R92：R84 漏网写点——台账 RMW 跨进程互斥
        existing = comments_mod.load(p.dir)
        c = comments_mod.create(comments_mod.Anchor(block_id=prop.anchor.block_id, line=line, quote=quote),
                                prop.comment_body, comments_mod.Author(id="ai", name=f"AI {prop.model}"))
        existing.append(c)
        comments_mod.save(p.dir, existing)
    return c.id


def _finish(store, pid: str, p, prop: Proposal, state: ProposalState, who: str, actor: dict | None,
            extra: dict) -> Proposal:
    prop = prop.model_copy(update={"state": state})
    append(p.dir, pid, prop, by=who)
    audit.record(p.dir, f"agent:{prop.job_id}", f"proposal.{'apply' if state == 'applied' else 'dismiss'}",
                 {"proposal_id": prop.id, "kind": prop.kind, "scenario": prop.scenario, "by": who, **extra}, "ok")
    events.emit("ai.proposal", pid=pid, actor=actor,
                data={"proposal_id": prop.id, "job_id": prop.job_id, "kind": prop.kind, "scenario": prop.scenario,
                      "state": state, "action": state, "title": f"{SCENARIO_BY_ID[prop.scenario].label}（{prop.kind}）",
                      "block_id": prop.anchor.block_id if isinstance(prop.anchor, BlockAnchor) else None, **extra})
    return prop


async def apply(store, pid: str, proposal_id: str, *, user=None, who: str = "本机",
                actor: dict | None = None) -> ProposalApplyResult:
    """pending → applied；写入方式按 kind（见模块注释）。非 pending ⇒ 409 conflict。"""
    from app import auth

    p = store.get(pid)
    prop = get(p.dir, pid, proposal_id)
    if prop.state != "pending":
        raise kind_error("conflict", f"提案已{ '应用' if prop.state == 'applied' else '忽略' }，不能再次应用",
                         detail=prop.id)
    extra: dict = {}
    content = backup = comment_id = sha = None
    changed = None
    if prop.kind == "critic":
        base, new, changed = _apply_critic(store, pid, p, prop)
        await auth.check_source_write(pid, user, base, new)
        # 批80：save_content 内含 git commit——offload 防阻塞事件循环
        backup = await asyncio.to_thread(store.save_content, pid, new)
        content = new
    elif prop.kind == "patch":
        if isinstance(prop.patch, BlocksPatch):
            base, new, changed, _skipped = _apply_blocks(store, pid, p, prop, prop.patch)
            if _skipped:
                extra["skipped_blocks"] = _skipped
            await auth.check_source_write(pid, user, base, new)
            backup = await asyncio.to_thread(store.save_content, pid, new)
            content = new
        elif isinstance(prop.patch, FilePatch):
            sha = await asyncio.to_thread(_apply_file, store, pid, p, prop, prop.patch, who)
            extra["file"] = prop.patch.file
        else:
            raise kind_error("validation", "patch 提案缺少补丁内容", detail=prop.id)
    else:
        comment_id = _apply_comment(p, prop)
        extra["comment_id"] = comment_id
    if changed:
        extra["changed_lines"] = changed
    if sha:
        extra["sha"] = sha
    prop = _finish(store, pid, p, prop, "applied", who, actor, extra)
    return ProposalApplyResult(proposal=prop, content=content, changed_lines=changed, backup=backup,
                               skipped_blocks=list(extra.get("skipped_blocks") or []))


async def apply_all(store, pid: str, *, user=None, who: str = "本机",
                    actor: dict | None = None) -> dict:
    """pending 提案按入档序逐条 apply——s1 成稿一批多份（BlocksPatch+figs FilePatch），
    逐条点应用是重复摩擦（往复轮88 观察池）。单条失败不中止，结果分桶回传。"""
    applied: list[str] = []
    failed: list[dict] = []
    content = None
    for prop in load(store.get(pid).dir, pid, "pending"):
        try:
            r = await apply(store, pid, prop.id, user=user, who=who, actor=actor)
            applied.append(r.proposal.id + (f"[+{len(r.skipped_blocks)}跳块]" if r.skipped_blocks else ""))
            if r.content is not None:
                content = r.content
        except Exception as e:  # noqa: BLE001 — 批量逐条容错，失败项带因由回传
            failed.append({"id": prop.id, "error": str(e)})
    return {"applied": applied, "failed": failed, "content": content}


def dismiss(store, pid: str, proposal_id: str, *, who: str = "本机", actor: dict | None = None) -> Proposal:
    p = store.get(pid)
    prop = get(p.dir, pid, proposal_id)
    if prop.state != "pending":
        raise kind_error("conflict", f"提案已{ '应用' if prop.state == 'applied' else '忽略' }，不能再忽略",
                         detail=prop.id)
    return _finish(store, pid, p, prop, "dismissed", who, actor, {})


__all__ = ["Anchor", "Patch", "append", "apply", "as_critic", "critic_for_block", "dismiss", "get", "load",
           "new_id", "path", "preview"]
