# -*- coding: utf-8 -*-
"""一键转专利路由（docs/plan/09 §3.3，单元 E3-convert-oa）：POST /api/projects/convert（multipart）→ 202 Job。

字段 file（docx/pdf/md/txt）或 attachment_pid + attachment（案卷 attachments/ 内现有文件，二选一）、
questionnaire（JSON 字串）、target（"new" | pid）、ai_ack。AUTH=on 时读 attachment_pid 的附件需 viewer。
target=new ⇒ 需 ai_ack=true（无 pid 可查开关，前端勾选即明示外发），按文件名 slug 新建案卷，任务完成后 save_content；
target=pid ⇒ require_enabled(pid)，任务完成后 history.commit_draft（工作区不动）。
抽取在请求内同步完成（格式/大小/扫描件错误直接 4xx），AI 生成在后台 Job 里。
"""

import asyncio
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from app import auth
from app.ai import require_enabled
from app.convert import extract, pipeline, questionnaire
from app.domain import attachments, cases
from app.domain import org as org_domain
from app.domain.org import require_org_ai
from app.domain.projects import id_slug
from app.errors import error_detail
from app.routes import read_bounded

router = APIRouter(tags=["convert"], dependencies=[Depends(auth.require_login)])
UNIT = "E3-convert-oa"
_FILE = File(None)
_ATTACHMENT = Form("")
_ATTACHMENT_PID = Form("")
_QUESTIONNAIRE = Form("{}", alias="questionnaire")
_TARGET = Form("new")
_AI_ACK = Form(False)


def new_pid(store, filename: str) -> str:
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    return store.unique_pid(id_slug(stem, 40, "convert"))


@router.post("/api/projects/convert", status_code=202, dependencies=[Depends(require_org_ai)])
async def convert(
    request: Request,
    user: auth.CurrentUser,
    file: UploadFile | None = _FILE,
    attachment: str = _ATTACHMENT,
    attachment_pid: str = _ATTACHMENT_PID,
    questionnaire_json: str = _QUESTIONNAIRE,
    target: str = _TARGET,
    ai_ack: bool = _AI_ACK,
):
    store, ai, jobs = request.app.state.store, request.app.state.ai, request.app.state.jobs
    if (file is None) == (not attachment):
        raise HTTPException(
            422, error_detail("source", "需且只需一个输入：上传 file，或 attachment_pid + attachment", detail=UNIT)
        )
    try:
        q = questionnaire.parse(questionnaire_json)
    except questionnaire.QuestionnaireError as e:
        raise HTTPException(422, error_detail("questionnaire", str(e), detail=UNIT))
    is_new = target in ("", "new")
    if is_new:
        if not ai_ack:
            raise HTTPException(
                403, error_detail("ai_disabled", "转换会把文件内容发送到 AI 中转站，请先勾选确认", detail=UNIT)
            )
    else:
        # target 是表单字段不在路径参数里，project_access 不生效——必须手工校验目标案写权限
        await auth.check_access(request, user, target, "editor")
        require_enabled(store, target, UNIT)
        await org_domain.require_org_ai_pid(request, target)  # path 无 pid，机构策略按目标案重查
        if jobs.busy(target, "convert"):  # 快速失败；竞态兜底在下方 create_unless_busy（R75-01）
            raise HTTPException(409, error_detail("job_busy", "本案已有转换任务在进行中", detail=UNIT))
    if file is not None:
        # 上传侧也按抽取上限（20MB，extract.MAX_BYTES）截断
        data = await read_bounded(file, "convert", extract.MAX_BYTES)
        filename = file.filename or ""
    else:
        try:
            await auth.check_access(request, user, attachment_pid, "viewer")
            path = attachments.attachment_path(store, attachment_pid, attachment)
        except attachments.AttachmentsError as e:
            raise HTTPException(e.status, error_detail("attachments", str(e), detail=e.detail))
        with open(path, "rb") as f:
            data = f.read()
        filename = attachment
    try:
        extracted = await asyncio.to_thread(extract.extract, filename, data)
    except extract.ExtractError as e:
        raise HTTPException(e.status, error_detail(e.kind, str(e), detail=UNIT))
    if not extracted["text"].strip():
        raise HTTPException(422, error_detail("empty", "文件没有可用文字", detail=UNIT))

    if is_new:
        pid = new_pid(store, filename)
        p = store.create(pid, os.path.splitext(os.path.basename(filename))[0] or pid)
        cases.claim_owner(p.dir, str(user.id) if user is not None else None)
        await auth.grant_owner(pid, user)
        job = jobs.create("convert", pid)  # 新案 pid 独占，无 busy 语义
    else:
        pid = target
        # R75-01：extract 的 await 窗口内并发请求可双双过上方 busy 闸——create 侧原子再查
        job = jobs.create_unless_busy("convert", pid)
        if job is None:
            raise HTTPException(409, error_detail("job_busy", "本案已有转换任务在进行中", detail=UNIT))

    def factory():
        return pipeline.run(
            store=store,
            ai=ai,
            pid=pid,
            is_new=is_new,
            filename=filename,
            extracted=extracted,
            questionnaire=q,
            progress=lambda p, m: jobs.progress(job.id, p, m),
            job_id=job.id,
        )

    jobs.run(job, factory)
    return job.to_dict()
