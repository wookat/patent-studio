# -*- coding: utf-8 -*-
"""客户免登录审阅链接（docs/plan/21 §1.3 A6 / §2.1 R-REV-05 / R-CHK-08）。share-confirm-backend 所有。

- 链接行在 SQLite `public_share_links`（auth/models.PublicShareLink；跨案数据进库，B5）。AUTH=off 无库 ⇒ 不能建链接，
  /api/public/* 一律 404 not_found。
- 有效权限 = 链接 ∧ 案级协作设置（access.get_settings）：allow_download / allow_comment 只能收紧不能放宽；
  allow_copy 现只有案级开关（链接表无此列）。
- 访问记录：链接行 visits / last_visit_at + 案内 `.studio/public_access.jsonl`（{ts, token, path, ip, ua}，随案迁移）。
- 基线（W9 domain-02）：链接列 baseline original|final 决定客户看到的正文 = critic.resolve(源码, baseline)；
  缺省 original（撰写人已定正文，未决修订不当定稿出现）。layout-ast 按此解析；PDF 在正文含未决修订时
  找 content.md 与之一致的构建，没有就按 baseline 构建一次；无未决修订时同下。
- PDF：最新成功构建的 out.pdf（不改 DOCX / 源码），pypdf 逐页叠加页脚「审阅版 · <token 前 6 位> · <日期>」；
  页脚文字由 matplotlib（已是依赖）用首个可用的开源 CJK 字体渲染成透明单页 PDF 再 merge。任何一步失败 ⇒ 原 PDF +
  响应头 X-Watermark: unavailable。
- 确认定稿 → case.json.confirmations[]（cases.Confirmation：version/sha/name/note/confirmed_at/actor/ip/ua/token）
  + emit share.confirmed；时间线从 confirmations 派生，不另存。
"""

from __future__ import annotations

import glob
import hashlib
import io
import json
import logging
import os
import secrets
import time
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from app import atomic, config
from app.auth import access
from app.domain import cases, events, history
from app.errors import kind_error
from patent_studio.kernel import critic

log = logging.getLogger("patent_studio.public")

ACCESS_LOG = "public_access.jsonl"
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
)
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.isfile(p)), "")
WATERMARK_FONT_PT = 9
WATERMARK_BOTTOM_PT = 24


# ---------------- 链接 ----------------


def _ts(dt: datetime | None) -> float | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.timestamp()


def link_out(row, creator) -> dict:
    """schemas.PublicShareLink 形状。"""
    return {
        "token": row.token,
        "pid": row.project_id,
        "scope": row.scope,
        "baseline": baseline_of(row),
        "allow_download": bool(row.allow_download),
        "expires_at": _ts(row.expires_at),
        "revoked": bool(row.revoked),
        "created_by": (
            events.actor_of(creator) if creator is not None else {"id": str(row.created_by), "display_name": "?"}
        ),
        "created_at": _ts(row.created_at) or 0.0,
        "visits": row.visits or 0,
        "last_visit_at": _ts(row.last_visit_at),
    }


async def effective_settings(pid: str) -> dict:
    """案级协作设置（缺行 ⇒ DEFAULT_SETTINGS）；off 时同默认。"""
    if not config.AUTH_ON:
        return dict(access.DEFAULT_SETTINGS)
    return await access.get_settings(pid)


def baseline_of(row) -> str:
    return row.baseline if row.baseline in ("original", "final") else "original"


async def create_link(
    pid: str,
    user,
    *,
    scope: str,
    ttl_days: int | None,
    allow_download: bool,
    allow_comment: bool | None = None,
    baseline: str = "original",
) -> dict:
    """链接不得放宽案级设置：案级禁下载 ⇒ allow_download=False；案级禁批注或 allow_comment=False ⇒ scope=read。"""
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PublicShareLink

    st = await effective_settings(pid)
    allow_download = allow_download and bool(st["allow_download"])
    if allow_comment is False or not st["allow_comment"]:
        scope = "read"
    now = datetime.now(UTC)
    await init_db()
    async with SessionLocal() as s:
        row = PublicShareLink(
            token=secrets.token_urlsafe(24),
            project_id=pid,
            scope=scope,
            baseline=baseline,
            allow_download=allow_download,
            expires_at=now + timedelta(days=ttl_days) if ttl_days else None,
            revoked=False,
            created_by=user.id,
            created_at=now,
            visits=0,
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        out = link_out(row, user)
    events.emit(
        "share.created",
        pid=pid,
        actor=events.actor_of(user),
        data={"token": row.token, "scope": scope, "baseline": baseline, "expires_at": out["expires_at"]},
    )
    return out


async def list_links(pid: str) -> list[dict]:
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PublicShareLink, User

    await init_db()
    async with SessionLocal() as s:
        rows = await s.execute(
            select(PublicShareLink, User)
            .join(User, User.id == PublicShareLink.created_by, isouter=True)
            .where(PublicShareLink.project_id == pid)
            .order_by(PublicShareLink.created_at.desc())
        )
        return [link_out(r, u) for r, u in rows]


async def revoke_link(pid: str, token: str, user) -> bool:
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PublicShareLink

    await init_db()
    async with SessionLocal() as s:
        row = await s.get(PublicShareLink, token)
        if row is None or row.project_id != pid:
            return False
        row.revoked = True
        await s.commit()
    events.emit("share.revoked", pid=pid, actor=events.actor_of(user), data={"token": token})
    return True


class Grant:
    """一次 token 校验的结果：pid / scope / allow_download / allow_copy / allow_comment / expires_at。"""

    def __init__(self, row, settings: dict):
        self.token: str = row.token
        self.pid: str = row.project_id
        self.scope: str = row.scope if settings["allow_comment"] else "read"
        self.baseline: str = baseline_of(row)
        self.allow_download: bool = bool(row.allow_download) and bool(settings["allow_download"])
        self.allow_copy: bool = bool(settings["allow_copy"])
        self.expires_at: float | None = _ts(row.expires_at)

    @property
    def allow_comment(self) -> bool:
        return self.scope in ("comment", "confirm")

    @property
    def allow_confirm(self) -> bool:
        return self.scope == "confirm"


def _not_found():
    return kind_error("not_found", "审阅链接不存在")


async def resolve(token: str, *, path: str, ip: str | None, ua: str | None, store) -> Grant:
    """校验 token（不存在 404 / 撤销 410 share.revoked / 过期 410 share.expired），记访问，返回 Grant。"""
    if not config.AUTH_ON:
        raise _not_found()
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PublicShareLink

    await init_db()
    now = datetime.now(UTC)
    async with SessionLocal() as s:
        row = await s.get(PublicShareLink, token)
        if row is None:
            raise _not_found()
        if row.revoked:
            raise kind_error("share.revoked", "审阅链接已撤销")
        exp = row.expires_at
        if exp is not None and (exp if exp.tzinfo else exp.replace(tzinfo=UTC)) <= now:
            raise kind_error("share.expired", "审阅链接已过期")
        row.visits = (row.visits or 0) + 1
        row.last_visit_at = now
        await s.commit()
        pid = row.project_id
        grant_row = row
    try:
        project_dir = store.get(pid).dir
    except Exception:  # noqa: BLE001 — 案子已删：链接失效
        raise _not_found() from None
    record_access(project_dir, token, path, ip, ua)
    return Grant(grant_row, await effective_settings(pid))


def access_log_path(project_dir: str) -> str:
    return os.path.join(project_dir, ".studio", ACCESS_LOG)


def record_access(project_dir: str, token: str, path: str, ip: str | None, ua: str | None) -> None:
    p = access_log_path(project_dir)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": time.time(), "token": token, "path": path, "ip": ip, "ua": ua}, ensure_ascii=False))
        f.write("\n")


def read_access_log(project_dir: str) -> list[dict]:
    p = access_log_path(project_dir)
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [json.loads(ln) for ln in f if ln.strip()]


# ---------------- 版本 / 元信息 ----------------


def version_of(project_dir: str) -> tuple[int, str]:
    """(版本号 = 提交数, HEAD sha)；无 git 库 ⇒ (0, "")。"""
    versions = history.log(project_dir)
    return len(versions), (versions[0]["sha"] if versions else "")


def content_sha(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def require_revision(store, project, version: int | None, sha: str | None, digest: str | None) -> None:
    """读和确认共用同一版本约束；调用方在 content 锁内执行。"""
    if version is None and sha is None and digest is None:
        return
    if (version, sha) != version_of(project.dir) or digest != content_sha(store.read_content(project.id)):
        raise kind_error("conflict", "审阅版本已更新，请重新打开并阅读后再确认。")


def _build_dirs(project) -> list[str]:
    return sorted(glob.glob(os.path.join(project.studio_dir, "builds", "*")), key=os.path.getmtime, reverse=True)


def latest_pdf(project) -> str | None:
    """最新一次含 out.pdf 的构建（构建可能因无 LibreOffice 只有 docx）。"""
    for d in _build_dirs(project):
        p = os.path.join(d, "out.pdf")
        if os.path.isfile(p):
            return p
    return None


PENDING_KINDS = ("ins", "del", "sub")


def pending_revisions(content: str) -> int:
    """正文里尚未接受 / 拒绝的修订数（批注 / 高亮不算）。"""
    if "{" not in content:
        return 0
    return sum(1 for m in critic.parse(content) if m["kind"] in PENDING_KINDS)


def _build(store, pid: str, mode: str) -> str | None:
    """按 mode 构建一次（含 PDF），返回 out.pdf 路径；失败 / 无 PDF → None。测试可替换。"""
    from app.domain.build import run_build

    out = run_build(store, pid, None, None, want_pdf=True, mode=mode)
    if out.status != "ok" or not out.build_id:
        return None
    p = os.path.join(store.get(pid).studio_dir, "builds", out.build_id, "out.pdf")
    return p if os.path.isfile(p) else None


def baseline_pdf(store, project, baseline: str) -> str | None:
    """只复用与审阅正文一致的 PDF；已过期的构建不得冒充当前版本。"""
    raw = store.read_content(project.id)
    if latest_pdf(project) is None:
        return None
    want = critic.resolve(raw, baseline)
    for d in _build_dirs(project):
        p, md = os.path.join(d, "out.pdf"), os.path.join(d, "content.md")
        if os.path.isfile(p) and os.path.isfile(md):
            with open(md, encoding="utf-8") as f:
                if f.read() == want:
                    return p
    return _build(store, project.id, baseline)


def confirmation_out(c: cases.Confirmation) -> dict:
    """schemas.Confirmation 形状。"""
    return {
        "version": c.version,
        "sha": c.sha,
        "content_sha": c.content_sha,
        "name": c.name,
        "note": c.note,
        "confirmed_at": c.confirmed_at,
    }


def meta(project, grant: Grant, org_name: str, content: str = "") -> dict:
    case = cases.ensure_case(project.dir)
    version, sha = version_of(project.dir)
    last = case.confirmations[-1] if case.confirmations else None
    return {
        "org_name": org_name,
        "title": project.title,
        "case_no": case.case_no or None,
        "status": case.status,
        "version": version,
        "sha": sha,
        "content_sha": content_sha(content),
        "scope": grant.scope,
        "baseline": grant.baseline,
        "pending_revisions": pending_revisions(content),
        "allow_download": grant.allow_download,
        "sub_except": [str(x) for x in project.settings.get("sub_except", [])],
        "allow_copy": grant.allow_copy,
        "allow_comment": grant.allow_comment,
        "expires_at": grant.expires_at,
        "confirmation": confirmation_out(last) if last else None,
        "pdf_ready": latest_pdf(project) is not None,
    }


# ---------------- 确认定稿 ----------------


def confirm(
    store,
    project,
    grant: Grant,
    name: str,
    note: str | None,
    ip: str | None,
    ua: str | None,
    expected_version: int,
    expected_sha: str,
    expected_content_sha: str,
) -> cases.Confirmation:
    """追加 case.json.confirmations[] 并 emit share.confirmed（actor 为访客：client:<name>，无用户 id）。
    同链同人同版本重复提交（双击/重试）幂等返回既有记录，不重复落账/发事件。"""
    with (
        atomic.studio_lock(project.dir, "case"),
        atomic.studio_lock(project.dir, "content"),
        history.repo_lock(project.dir),
    ):
        require_revision(store, project, expected_version, expected_sha, expected_content_sha)
        version, sha = expected_version, expected_sha
        if not sha:
            raise kind_error("conflict", "此案尚无已保存版本，请联系撰写人保存后重新审阅。")
        case = cases.ensure_case(project.dir)
        for c in reversed(case.confirmations):
            if (
                c.token == grant.token
                and c.version == version
                and c.sha == sha
                and c.content_sha == expected_content_sha
                and c.name == name
            ):
                return c
        rec = cases.Confirmation(
            version=version,
            sha=sha,
            content_sha=expected_content_sha,
            name=name,
            note=note,
            confirmed_at=time.time(),
            actor=f"client:{name}",
            ip=ip,
            ua=ua,
            token=grant.token,
        )
        case.confirmations.append(rec)
        cases.save_case(project.dir, case)
    events.emit(
        "share.confirmed",
        pid=project.id,
        actor=None,
        data={
            "token": grant.token,
            "name": name,
            "version": version,
            "sha": sha,
            "content_sha": expected_content_sha,
            "note": note,
        },
    )
    return rec


# ---------------- PDF 水印 ----------------


def watermark_text(token: str, today: date | None = None) -> str:
    return f"审阅版 · {token[:6]} · {(today or cases.local_today()).isoformat()}"


def _stamp_page(width_pt: float, height_pt: float, text: str) -> bytes:
    """透明单页 PDF：页脚居中一行 text（simhei 缺失时退到 fontconfig 里的中文字体）。"""
    import matplotlib
    from matplotlib.backends.backend_pdf import FigureCanvasPdf
    from matplotlib.figure import Figure
    from matplotlib.font_manager import FontProperties

    fp = (
        FontProperties(fname=FONT_PATH)
        if os.path.isfile(FONT_PATH)
        else FontProperties(family=["SimHei", "Noto Sans CJK SC", "Noto Serif CJK SC", "sans-serif"])
    )
    fig = Figure(figsize=(width_pt / 72, height_pt / 72), dpi=72)
    FigureCanvasPdf(fig)
    fig.text(
        0.5,
        WATERMARK_BOTTOM_PT / height_pt,
        text,
        ha="center",
        va="bottom",
        fontsize=WATERMARK_FONT_PT,
        color="0.45",
        fontproperties=fp,
    )
    buf = io.BytesIO()
    with matplotlib.rc_context({"pdf.fonttype": 42}):
        fig.savefig(buf, format="pdf", transparent=True)
    return buf.getvalue()


def watermark(pdf_bytes: bytes, text: str) -> bytes:
    """每页叠加页脚；页面尺寸不同各自生成一张 stamp。失败抛异常，由调用方退回原 PDF。"""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    stamps: dict[tuple[int, int], bytes] = {}
    for page in reader.pages:
        w, h = float(page.mediabox.width), float(page.mediabox.height)
        key = (round(w), round(h))
        if key not in stamps:
            stamps[key] = _stamp_page(w, h, text)
        page.merge_page(PdfReader(io.BytesIO(stamps[key])).pages[0])
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def watermarked_pdf(path: str, token: str) -> tuple[bytes, bool]:
    """→ (bytes, ok)。ok=False ⇒ 原 PDF（响应头 X-Watermark: unavailable）。"""
    with open(path, "rb") as f:
        raw = f.read()
    try:
        return watermark(raw, watermark_text(token)), True
    except Exception:  # noqa: BLE001 — 水印是派生物，失败不能挡住审阅
        log.exception("公开 PDF 水印失败：%s", path)
        return raw, False
