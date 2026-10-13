# -*- coding: utf-8 -*-
"""POST /api/projects/{pid}/critic（修订标记）+ /comments CRUD/replies/resolve/reopen（07 §4.2，W5 R-REV-02）。

author 来自 auth.current_user：off ⇒ {id:null, name:"本机"}；on ⇒ {id:str(user.id), name:display_name|email}。
GET /comments 在返回前按当前 AST 重锚（结构不成立时原样返回）；筛选参数 author / status / source / mention。
正文含 `@名字` ⇒ 解析 mentions；AUTH=on 时对成员 display_name / email / user_id 匹配，命中 ⇒ emit comment.mention
（events.py 的枚举名；规格 R-REV-03 写作 comment.mentioned）；off 时无成员表，只记 mentions 不发事件。
"""
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app import config
from app.auth import CurrentUser, forbidden, my_role, role_at_least
from app.domain import comments as store_mod
from app.domain import events, review_meta
from app.domain.comments import Anchor, Author, Comment
from patent_docx import critic
from patent_docx.ast import AstError, parse_ast

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
        emit_mentions_for(pid, user, {"cid": c.id, "comment_id": c.id, "reply_id": reply_id, "mentions": body_mentions,
                                      "user_ids": ids, "block_id": c.anchor.block_id, "file": c.anchor.file})


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
async def list_comments(pid: str, request: Request, author: str | None = None,
                        status: Literal["open", "resolved", "all"] = "all",
                        source: Literal["human", "ai", "client"] | None = None, mention: str | None = None):
    comments = load_reanchored(request.app.state.store, pid)
    return [c.to_dict() for c in store_mod.select(comments, author=author, status=status, source=source,
                                                   mention=mention)]


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
