# -*- coding: utf-8 -*-
"""POST /api/projects/{pid}/critic（修订标记）+ /comments CRUD/replies/resolve/reopen（07 §4.2，W5 R-REV-02）。

author 来自 auth.current_user：off ⇒ {id:null, name:"本机"}；on ⇒ {id:str(user.id), name:display_name|email}。
GET /comments 在返回前按当前 AST 重锚（结构不成立时原样返回）；筛选参数 author / status / source / mention。
正文含 `@名字` ⇒ 解析 mentions；AUTH=on 时对成员 display_name / email / user_id 匹配，命中 ⇒ emit comment.mention
（events.py 的枚举名；规格 R-REV-03 写作 comment.mentioned）；off 时无成员表，只记 mentions 不发事件。
"""

import logging
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app import config
from app.ai import prompts, require_enabled
from app.ai.client import AiClient, AiError
from app.auth import CurrentUser, forbidden, my_role, role_at_least
from app.domain import comments as store_mod
from app.domain import events, review_meta
from app.domain.comments import Anchor, Author, Comment
from app.domain.org import require_org_ai
from patent_studio.kernel import critic
from patent_studio.kernel.ast import AstError, parse_ast

router = APIRouter(prefix="/api/projects/{pid}", tags=["review"])
log = logging.getLogger("patent_studio.review")


class CriticIn(BaseModel):
    content: str | None = None


class AnchorIn(BaseModel):
    """{block_id, line, quote} | {book, block_id, line_start, line_end?, quote?} | {file}。"""

    block_id: str = ""
    line: int | None = None
    quote: str = ""
    book: Literal["abstract", "claims", "description"] | None = None
    line_start: int | None = None
    line_end: int | None = None
    file: str | None = None

    def to_anchor(self) -> Anchor:
        if self.file is None and not self.block_id:
            raise HTTPException(422, "锚点需要 block_id 或 file")
        return store_mod.anchor_from_dict(self.model_dump(exclude_none=True))


class CommentIn(BaseModel):
    anchor: AnchorIn
    # 与 schemas.PublicCommentIn/NoteIn 同口径（4000）：站内批注此前无上限，客户端批注早就有
    body: str = Field(min_length=1, max_length=4000)
    source: Literal["human", "ai"] = "human"


class CommentPatch(BaseModel):
    body: str | None = Field(default=None, max_length=4000)
    anchor: AnchorIn | None = None


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    source: Literal["human", "ai"] = "human"


class ResolveIn(BaseModel):
    resolved: bool = True


def _author(user) -> Author:
    if user is None:
        return store_mod.LOCAL_AUTHOR
    return Author(id=str(user.id), name=user.display_name or user.email)


def _project_dir(request: Request, pid: str) -> str:
    return request.app.state.store.get(pid).dir


def _load(request: Request, pid: str) -> tuple[str, list[Comment]]:
    d = _project_dir(request, pid)
    return d, store_mod.load(d)


def _get(comments: list[Comment], cid: str) -> Comment:
    c = store_mod.find(comments, cid)
    if c is None:
        raise HTTPException(404, "批注不存在")
    return c


async def _comment_perm(pid: str, user, c: Comment, need: str) -> None:
    """批注写操作权属：作者本人，或本案 need 及以上角色；客户批注（author.id=None）只能角色管。
    AUTH off / 匿名 ⇒ 本机单人态放行；成员身份已由 project_access 兜过底。"""
    if not config.AUTH_ON or user is None or user.is_superuser:
        return
    if c.author.id is not None and c.author.id == str(user.id):
        return
    if not role_at_least(await my_role(pid, user), need):
        raise forbidden(need)


async def mentioned_user_ids(pid: str, mentions: list[str]) -> list[str]:
    """成员表里 display_name / email / user_id / email 本地段与 @名字 相同者；off 或无匹配 ⇒ []。
    @名字 命中多个不同成员（重名 / 本地段撞名）⇒ 该条跳过，不盲发。"""
    if not mentions or not config.AUTH_ON:
        return []
    from app.auth import acl

    candidates = {
        m["user_id"]: {m["display_name"], m["email"], m["user_id"], m["email"].split("@", 1)[0]}
        for m in await acl.list_members(pid)
    }
    out: list[str] = []
    for name in mentions:
        hits = [uid for uid, tokens in candidates.items() if name in tokens]
        if len(hits) == 1 and hits[0] not in out:
            out.append(hits[0])
    return out


def emit_mentions_for(pid: str, user, data: dict) -> None:
    events.emit("comment.mention", pid=pid, actor=events.actor_of(user), data=data)


async def emit_mentions(pid: str, user, c: Comment, body_mentions: list[str], reply_id: str | None = None) -> None:
    ids = await mentioned_user_ids(pid, body_mentions)
    if ids:
        # cid 是 notify 契约键（notify docstring comment.mention {cid,...}）；comment_id 保留做台账/调试可读
        emit_mentions_for(
            pid,
            user,
            {
                "cid": c.id,
                "comment_id": c.id,
                "reply_id": reply_id,
                "mentions": body_mentions,
                "user_ids": ids,
                "block_id": c.anchor.block_id,
                "file": c.anchor.file,
            },
        )


@router.post("/critic")
async def critic_marks(pid: str, body: CriticIn, request: Request, user: CurrentUser):
    store = request.app.state.store
    content = body.content if body.content is not None else store.read_content(pid)
    pending = review_meta.author_of(user) if body.content is not None else None
    return {"marks": review_meta.attach(store.get(pid).dir, critic.parse(content), pending)}


def load_reanchored(store, pid: str) -> list[Comment]:
    project = store.get(pid)
    comments = store_mod.load(project.dir)
    if comments:
        content = store.read_content(pid)
        try:
            ast = parse_ast(critic.accept(content), project.settings)
        except AstError as e:
            log.info("comments %s: 结构不成立，跳过重锚（%s）", pid, e)
        else:
            store_mod.reanchor(comments, ast, content)
    return comments


@router.get("/comments")
async def list_comments(
    pid: str,
    request: Request,
    author: str | None = None,
    status: Literal["open", "resolved", "all"] = "all",
    source: Literal["human", "ai", "client"] | None = None,
    mention: str | None = None,
):
    comments = load_reanchored(request.app.state.store, pid)
    return [
        c.to_dict() for c in store_mod.select(comments, author=author, status=status, source=source, mention=mention)
    ]


@router.post("/comments", status_code=201)
async def create_comment(pid: str, body: CommentIn, request: Request, user: CurrentUser):
    d = _project_dir(request, pid)
    async with store_mod.ledger_lock(d):
        with store_mod.file_lock(d):  # R92：跨进程（stdio MCP）同写 comments.json——锁内重读+改写
            comments = store_mod.load(d)
            c = store_mod.create(body.anchor.to_anchor(), body.body, _author(user), source=body.source)
            comments.append(c)
            store_mod.save(d, comments)
    await emit_mentions(pid, user, c, c.mentions)
    return c.to_dict()


@router.patch("/comments/{cid}")
async def update_comment(pid: str, cid: str, body: CommentPatch, request: Request, user: CurrentUser):
    d = _project_dir(request, pid)
    async with store_mod.ledger_lock(d):
        comments = store_mod.load(d)
        c = _get(comments, cid)
        await _comment_perm(pid, user, c, "editor")
        before = set(c.mentions)
        with store_mod.file_lock(d):  # R92：perm 检查过后锁内重读——他进程删/改不丢
            comments = store_mod.load(d)
            c = _get(comments, cid)
            store_mod.update(c, body.body, body.anchor.to_anchor() if body.anchor else None)
            store_mod.save(d, comments)
    await emit_mentions(pid, user, c, [m for m in c.mentions if m not in before])
    return c.to_dict()


@router.delete("/comments/{cid}", status_code=204)
async def delete_comment(pid: str, cid: str, request: Request, user: CurrentUser):
    d = _project_dir(request, pid)
    async with store_mod.ledger_lock(d):
        comments = store_mod.load(d)
        c = _get(comments, cid)
        await _comment_perm(pid, user, c, "editor")
        with store_mod.file_lock(d):
            comments = store_mod.load(d)
            _get(comments, cid)  # 锁外窗内他进程已删 → 404
            store_mod.save(d, [x for x in comments if x.id != cid])
    return None


@router.post("/comments/{cid}/replies")
async def reply_comment(pid: str, cid: str, body: ReplyIn, request: Request, user: CurrentUser):
    d = _project_dir(request, pid)
    async with store_mod.ledger_lock(d):
        with store_mod.file_lock(d):
            comments = store_mod.load(d)
            c = store_mod.reply(_get(comments, cid), body.body, _author(user), source=body.source)
            store_mod.save(d, comments)
    r = c.replies[-1]
    await emit_mentions(pid, user, c, r.mentions, reply_id=r.id)
    return c.to_dict()


@router.post("/comments/{cid}/resolve")
async def resolve_comment(pid: str, cid: str, body: ResolveIn, request: Request, user: CurrentUser):
    d = _project_dir(request, pid)
    async with store_mod.ledger_lock(d):
        comments = store_mod.load(d)
        c = _get(comments, cid)
        await _comment_perm(pid, user, c, "reviewer")
        with store_mod.file_lock(d):
            comments = store_mod.load(d)
            c = _get(comments, cid)
            store_mod.resolve(c, body.resolved, by=_author(user))
            store_mod.save(d, comments)
    return c.to_dict()


# ---------------- Z18 批注 → 修改提案 ----------------


def _block_range(ast: dict, block_id: str) -> tuple[str, int, int] | None:
    """块 id → (book, 全文起行, 全文止行)；与 routes_ai._block_ranges 同一分区，带 book。"""
    for book, blocks in (
        ("abstract", ast["abstract"]["paragraphs"]),
        ("claims", ast["claims"]),
        ("description", ast["description"]),
    ):
        off = ast["books"][book]["offset"]
        for b in blocks:
            if b["id"] == block_id:
                return book, off + b["lines"]["start"], off + b["lines"]["end"]
    return None


@router.post("/comments/{cid}/proposal", status_code=201, dependencies=[Depends(require_org_ai)])
async def comment_to_proposal(pid: str, cid: str, request: Request, user: CurrentUser):
    """Z18 批注一键转修改提案：以批注正文为指令让 AI 对锚块产出 CriticMarkup，走既有
    jobs（kind=comment2proposal）+ agent/proposals 管线落盘（source 记批注 id/quote，job_id 记诊断链）。
    权限 reviewer 起（与提案应用一致）；AI 关 / 文件锚 / 锚块缺失 ⇒ 403/422。"""
    from app.agent import proposals as proposals_mod
    from app.agent.types import BlockAnchor, CheckResult, Proposal, ProposalSource, Usage

    store = request.app.state.store
    ai: AiClient = request.app.state.ai
    jobs = request.app.state.jobs
    require_enabled(store, pid, "comment2proposal")
    role = await my_role(pid, user)
    if role is not None and not role_at_least(role, "reviewer"):
        raise forbidden("reviewer")
    p = store.get(pid)
    c = _get(store_mod.load(p.dir), cid)
    if c.anchor.file is not None or not c.anchor.block_id:
        raise HTTPException(422, "只有挂在正文块上的批注能转修改提案")
    content = store.read_content(pid)
    try:
        ast = parse_ast(critic.accept(content), p.settings)
    except AstError as e:
        raise HTTPException(422, f"案卷结构不成立：{e}")
    rng = _block_range(ast, c.anchor.block_id)
    if rng is None:
        raise HTTPException(422, "批注锚定的块已不存在，不能转提案")
    book, a, b = rng
    orig = content.split("\n")[a - 1 : b]
    who = "本机" if user is None else str(user.email)
    job = jobs.create("comment2proposal", pid, payload={"comment_id": cid})

    async def work() -> dict:
        jobs.progress(job.id, 0.2, "按批注生成修改建议")
        ctx = f"批注作者：{c.author.name}\n锚定引文：{c.anchor.quote or '（无）'}"
        msgs = prompts.rewrite_messages("polish", "\n".join(orig), ctx, instruction=c.body)
        r = await ai.chat(msgs, "interactive", project_dir=p.dir, job_id=job.id, user=None if user is None else who)
        marked = proposals_mod.as_critic(orig, prompts.strip_fence(r.text))
        if marked is None:
            r = await ai.chat(
                prompts.format_retry(msgs, r.text, "行数与原文不一致"),
                "interactive",
                project_dir=p.dir,
                job_id=job.id,
                user=None if user is None else who,
            )
            marked = proposals_mod.as_critic(orig, prompts.strip_fence(r.text))
        if marked is None:
            raise AiError("format", "AI 输出与批注锚块行数不一致，未生成提案")
        prop = Proposal(
            id=proposals_mod.new_id(),
            job_id=job.id,
            scenario="s3",
            kind="critic",
            anchor=BlockAnchor(book=book, block_id=c.anchor.block_id, line_start=a, line_end=b),
            critic_markdown=marked,
            checks=[
                CheckResult(
                    name="roundtrip", ok=critic.reject(marked) == "\n".join(orig), why="拒绝视图须等于锚块原文"
                )
            ],
            model=r.model,
            usage=Usage(prompt=r.usage.prompt_tokens, completion=r.usage.completion_tokens),
            created_at=time.time(),
            source=ProposalSource(
                comment_id=c.id, quote=c.anchor.quote, author=c.author.name, body=c.body[:400]
            ),
        )
        proposals_mod.append(p.dir, pid, prop, by=who)
        cur = jobs.get(job.id)
        if cur is not None and prop.id not in cur.proposal_ids:
            jobs.update(cur, proposal_ids=[*cur.proposal_ids, prop.id])
        return {"proposals": [prop.id], "comment_id": c.id}

    await jobs.run(job, work)
    job = jobs.get(job.id)
    if job.status != "done":
        err = job.error or {"kind": "internal", "message": "提案生成失败"}
        raise HTTPException(502 if str(err.get("kind", "")).startswith("ai_") else 500, err)
    prop_id = (job.result or {}).get("proposals", [None])[0]
    prop = proposals_mod.get(p.dir, pid, prop_id) if prop_id else None
    events.emit(
        "ai.proposal",
        pid=pid,
        actor=events.actor_of(user),
        data={
            "proposal_id": prop_id,
            "job_id": job.id,
            "kind": "critic",
            "scenario": "s3",
            "state": "pending",
            "action": "created",
            "title": "批注转提案（修订建议）",
            "block_id": c.anchor.block_id,
            "comment_id": c.id,
        },
    )
    return {"job": job.to_dict(), "proposal": prop.model_dump(mode="json") if prop else None}


@router.post("/comments/{cid}/reopen")
async def reopen_comment(pid: str, cid: str, request: Request, user: CurrentUser):
    d = _project_dir(request, pid)
    async with store_mod.ledger_lock(d):
        comments = store_mod.load(d)
        c = _get(comments, cid)
        await _comment_perm(pid, user, c, "reviewer")
        with store_mod.file_lock(d):
            comments = store_mod.load(d)
            c = _get(comments, cid)
            store_mod.resolve(c, False, by=_author(user))
            store_mod.save(d, comments)
    return c.to_dict()
