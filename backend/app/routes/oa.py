# -*- coding: utf-8 -*-
"""OA 答复路由（docs/plan/09 §3.4，单元 E3-convert-oa）。

POST /parse         确定性拆条（不需 AI 开关），落 .studio/oa/items.json（重新拆条会清掉旧答复）→ {items, warnings}
                    JSON {text} 或 multipart {file: application/pdf, round_id?}；PDF 用 pypdf 抽文字层，扫描件 /
                    文字太少 ⇒ 400 oa.pdf_no_text；带 round_id 时拆条结果与通知书文本 sha 同时写进该轮记录
                    （W5 R-OA-01，单元 oa-import-backend）
POST /answer        202 Job(kind=oa_answer)：require_enabled；对 item_ids（缺省全部）逐条 heavy 生成答复；
                    result={answers, warnings}
PUT  /answers/{item_id}  用户改过的答复要点落盘（{points}）→ 更新后的答复；导出即以落盘答复为准
GET  /export.docx   意见陈述书：无任何答复 ⇒ 409 error_detail("oa_empty", …)

W5 R-OA-02 / R-OA-05（单元 oa-import-backend，.studio/oa/rounds/<n>.json，见 oa/rounds.py）：
GET  /rounds                 {rounds: [schemas.OaRound]}（按 n 升序）
POST /rounds                 schemas.OaRoundIn → 201 OaRound；登记 case.json.deadlines[] oa_reply 期限，emit oa.round
GET  /rounds/{rid}           该轮完整记录（含 items[] 全文、reply_refs、filed_on）
PUT  /rounds/{rid}           OaRoundPatch（kind / issued_on / delivery / extension_months）+ filed_on / reply_refs
                             → OaRound；期限重算
POST /rounds/{rid}/extend    {months: 1|2} → OaRound；累计 > 2 个月 ⇒ 409 conflict
DELETE /rounds/{rid}         204；同时删去对应期限
"""
import asyncio
import urllib.parse

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError

from app import auth
from app.ai import require_enabled
from app.domain import events
from app.domain.projects import ATTACHMENT_MAX_BYTES
from app.errors import error_detail, kind_error
from app.oa import answer as oa_answer_mod
from app.oa import export, parse, rounds
from app.routes import read_bounded
from app.schemas import OaRound, OaRoundIn, OaRoundPatch, OaRoundsResponse
from patent_studio.kernel import docset

router = APIRouter(prefix="/api/projects/{pid}/oa", tags=["oa"])
UNIT = "E3-convert-oa"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class OaParseIn(BaseModel):
    text: str


class OaAnswerIn(BaseModel):
    item_ids: list[str] | None = None


class OaPointsIn(BaseModel):
    points: list[str]


class OaRoundUpdateIn(OaRoundPatch):
    filed_on: str | None = None
    reply_refs: list[str] | None = None


class OaExtendIn(BaseModel):
    months: int = Field(ge=1, le=2)


async def _notice_text(request: Request) -> tuple[str, str | None]:
    """(通知书文本, round_id)：multipart 走 PDF 文字层，其余按 JSON {text}。"""
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        f = form.get("file")
        if f is None or isinstance(f, str):
            raise kind_error("validation", "缺少 PDF 文件字段 file")
        try:
            # 通知书 PDF 上限与附件一致（50MB）
            text = parse.pdf_text(await read_bounded(f, "oa", ATTACHMENT_MAX_BYTES))
        except parse.NoTextLayer as e:
            raise kind_error("oa.pdf_no_text", f"{e}，请粘贴通知书文本或上传带文字层的 PDF", status=400,
                             detail=UNIT_W5)
        rid = form.get("round_id")
        return text, (rid if isinstance(rid, str) and rid else None)
    try:
        body = OaParseIn.model_validate(await request.json())
    except ValidationError as e:
        raise RequestValidationError(e.errors())
    return body.text, None


@router.post("/parse")
async def oa_parse(pid: str, request: Request):
    store = request.app.state.store
    project_dir = store._dir(pid)
    text, rid = await _notice_text(request)
    items, warnings = parse.parse(text)
    oa_answer_mod.save_items(project_dir, items, warnings)
    if rid is not None:
        _rounds_call(rounds.attach_items, project_dir, rid, text, items)
    return {"items": items, "warnings": warnings}


@router.post("/answer", status_code=202)
async def oa_answer(pid: str, body: OaAnswerIn, request: Request):
    store, ai, jobs = request.app.state.store, request.app.state.ai, request.app.state.jobs
    require_enabled(store, pid, UNIT)
    project_dir = store._dir(pid)
    items = oa_answer_mod.load_items(project_dir)
    if body.item_ids is not None:
        wanted = set(body.item_ids)
        items = [it for it in items if it["id"] in wanted]
    if not items:
        raise HTTPException(409, error_detail("oa_empty", "没有可答复的审查意见条目，请先拆条", detail=UNIT))
    if jobs.busy(pid, "oa_answer"):
        raise HTTPException(409, error_detail("job_busy", "本案已有 OA 答复任务在进行中", detail=UNIT))
    job = jobs.create("oa_answer", pid)

    async def work():
        answers, warnings = [], []
        for k, item in enumerate(items):
            jobs.progress(job.id, k / len(items), f"生成第 {k + 1}/{len(items)} 条答复")
            ans = await oa_answer_mod.answer(store=store, ai=ai, pid=pid, item=item, job_id=job.id)
            answers.append(ans)
            warnings += [f"{item['id']}：{w}" for w in ans.get("warnings") or []]
        return {"answers": answers, "warnings": warnings}

    jobs.run(job, work)
    return job.to_dict()


@router.get("/items")
def oa_items(pid: str, request: Request):
    """当前拆条工作集：{items, warnings, answers}——刷新后重建 OA 面板（原只写不读，刷新即丢）"""
    return _rounds_call(oa_answer_mod.load_items_bundle, request.app.state.store._dir(pid))


@router.put("/answers/{item_id}")
async def oa_put_answer(pid: str, item_id: str, body: OaPointsIn, request: Request):
    store = request.app.state.store
    project_dir = store._dir(pid)
    ans = next((a for a in _rounds_call(oa_answer_mod.load_answers, project_dir) if a["item_id"] == item_id),
               None)
    if ans is None:
        raise HTTPException(404, error_detail("oa_answer_missing", f"条目 {item_id} 尚无答复", detail=UNIT))
    ans["points"] = [p.strip() for p in body.points if p.strip()]
    oa_answer_mod.save_answer(project_dir, ans)
    return ans


@router.get("/export.docx")
async def oa_export(pid: str, request: Request):
    store = request.app.state.store
    project = store.get(pid)
    items = _rounds_call(oa_answer_mod.load_items, project.dir)
    answers = _rounds_call(oa_answer_mod.load_answers, project.dir)
    if not answers:
        raise HTTPException(409, error_detail("oa_empty", "尚无任何 OA 答复，请先拆条并生成答复", detail=UNIT))
    claims_md = docset.split(store.read_content(pid)).claims
    data = await asyncio.to_thread(export.export_docx, project={"title": project.title, "app_no": None},
                                   items=items, answers=answers, claims_md=claims_md)
    name = urllib.parse.quote(f"意见陈述书-{project.title}.docx")
    return Response(data, media_type=DOCX_MIME,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{name}"})


# ---------- W5 oa-import-backend：OA 轮次（docs/plan/21 §2.1 R-OA-02、§2.2 R-OA-05） ----------
UNIT_W5 = "oa-import-backend"


def _rounds_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except rounds.RoundError as e:
        raise kind_error(e.kind, str(e), status=e.status, detail=UNIT_W5)


@router.get("/rounds", response_model=OaRoundsResponse)
def oa_rounds(pid: str, request: Request):
    project_dir = request.app.state.store._dir(pid)
    return {"rounds": [rounds.to_api(r) for r in _rounds_call(rounds.list_rounds, project_dir)]}


@router.post("/rounds", status_code=201, response_model=OaRound)
def create_oa_round(pid: str, body: OaRoundIn, request: Request, user: auth.CurrentUser):
    project_dir = request.app.state.store._dir(pid)
    rnd = _rounds_call(rounds.create_round, project_dir, kind=body.kind, issued_on=body.issued_on,
                       delivery=body.delivery)
    due, _ = rounds.reply_due(rnd)
    events.emit("oa.round", pid=pid, actor=events.actor_of(user),
                data={"round_id": rnd["id"], "kind": rnd["kind"], "issued_on": rnd["issued_on"], "due": due})
    return rounds.to_api(rnd)


@router.get("/rounds/{rid}")
def get_oa_round(pid: str, rid: str, request: Request):
    project_dir = request.app.state.store._dir(pid)
    rnd = _rounds_call(rounds.load_round, project_dir, rid)
    due, holidays_verified = rounds.reply_due(rnd)
    return {**rnd, "due": due, "holidays_verified": holidays_verified}


@router.put("/rounds/{rid}", response_model=OaRound)
def update_oa_round(pid: str, rid: str, body: OaRoundUpdateIn, request: Request):
    project_dir = request.app.state.store._dir(pid)
    rnd = _rounds_call(rounds.update_round, project_dir, rid, **body.model_dump(exclude_unset=True))
    return rounds.to_api(rnd)


@router.post("/rounds/{rid}/extend", response_model=OaRound)
def extend_oa_round(pid: str, rid: str, body: OaExtendIn, request: Request):
    project_dir = request.app.state.store._dir(pid)
    return rounds.to_api(_rounds_call(rounds.extend_round, project_dir, rid, body.months))


@router.delete("/rounds/{rid}", status_code=204)
def delete_oa_round(pid: str, rid: str, request: Request):
    project_dir = request.app.state.store._dir(pid)
    _rounds_call(rounds.delete_round, project_dir, rid)
    return Response(status_code=204)
