# -*- coding: utf-8 -*-
"""案件元数据（docs/plan/13-w4a-case-dashboard-design.md §2，单元 A1-case-api）。

<project>/case.json            案件台账字段（Case）；旧案首次被列出时按 default_case 生成并落盘
                               （不碰 project.json / studio.json / content.md）
<projects_dir>/.studio/tags.json  机构级标签字典 {version, tags:[{name,color}]}
PostgreSQL project_list_state  用户视角的 归档 / 回收站（Overleaf 语义），(user_id, project_id, state)；
                               同步 SQLAlchemy 走共享引擎（notify.sink），auth=off 时 user_id="local"

prep 已落地：schema / 默认值 / 读写 / 期限倒计时 / 标签文件 / 列表状态表；路由见 routes/cases.py（A1 补齐）。

W5 R-CASE-02 扩展（旧 case.json 缺字段照常加载，normalize_case 补默认值）：
  dates.filed（申请日 = 规格里的 filing_date，沿用 W4 名，FilingDialog 已写此字段）/ dates.application_no /
  dates.publication（公布日）/ dates.exam_request（实审请求日）/ dates.grant（授权公告日）；
  priority[]{country, number, date}；attorney / reviewer（成员 user_id）；client_contact；fee_status；
  deadlines[]{id, kind, title, due, base_date, rule, note, source auto|manual, override_reason, done, done_at,
              legal_basis}。
期限规则与自动重算见 app/deadlines（本模块不依赖它）。
"""
import json
import os
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import atomic, auth, config
from app.domain import history

CASE_FILE = "case.json"
_UNSET = object()  # 区分「调用方预取了 None」与「没预取」
TAGS_FILE = os.path.join(".studio", "tags.json")
TAGS_VERSION = 1

CaseKind = Literal["invention", "utility", "design"]
CaseStatus = Literal[
    "intake", "drafting", "review", "client_review", "final", "filed", "oa", "granted", "rejected", "closed"
]
ListState = Literal["active", "archived", "trashed"]
DeadlineLevel = Literal["overdue", "red", "yellow", "normal"]
DeadlineSource = Literal["auto", "manual"]
FeeStatus = Literal["unpaid", "paid", "reduced", "overdue"]
RelatedKind = Literal["parent", "divisional", "associated"]
# 与 app/schemas.DeadlineKind 同步。case.json 里 kind 仍是自由字符串（W4 旧案 filing / client_review … 照旧保留），
# 出 API 时由 routes_deadlines.to_item 按此表归为 custom
DEADLINE_KINDS: tuple[str, ...] = (
    "oa_reply", "exam_request", "priority", "annual_fee", "review_due", "divisional", "reexam", "publication", "custom"
)

KINDS: tuple[str, ...] = ("invention", "utility", "design")
# 十档状态机：任意状态可跳到任意状态（撰写台账不是审批流），每次跳转写一条 history 事件
STATUSES: tuple[str, ...] = (
    "intake", "drafting", "review", "client_review", "final", "filed", "oa", "granted", "rejected", "closed"
)
LIST_STATES: tuple[str, ...] = ("active", "archived", "trashed")
DEFAULT_STATUS = "drafting"
# 倒计时阈值（天）：≤3 红、≤14 黄；<0 已逾期
RED_DAYS = 3
YELLOW_DAYS = 14
# 标签色板（Tailwind 500 系；前端 StatusBadge / 色点直接用 hex，不查表）
TAG_COLORS: tuple[str, ...] = (
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"
)


class CaseError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _iso_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v.isoformat()
    try:
        return date.fromisoformat(str(v)).isoformat()
    except ValueError:
        raise ValueError(f"日期须为 YYYY-MM-DD：{v!r}")


class Dates(BaseModel):
    # 未知键直接 422：前端字段名写错时不能 200 却静默丢弃（审计 I-2：申请日 / 公开日保存后消失）
    model_config = ConfigDict(extra="forbid")

    opened: str | None = None
    target_filing: str | None = None
    # 申请日（规格 R-CASE-02 的 filing_date）
    filed: str | None = None
    # 申请号原样存字符串（CNIPA 格式 2026 1 0123456.7，含校验位）
    application_no: str | None = None
    publication: str | None = None
    exam_request: str | None = None
    grant: str | None = None

    @field_validator("opened", "target_filing", "filed", "publication", "exam_request", "grant", mode="before")
    @classmethod
    def _dates(cls, v):
        return _iso_date(v)


class Priority(BaseModel):
    country: str = "CN"
    number: str = ""
    date: str

    @field_validator("date", mode="before")
    @classmethod
    def _date(cls, v):
        d = _iso_date(v)
        if d is None:
            raise ValueError("优先权缺少 date")
        return d


class LegalBasis(BaseModel):
    law: str
    article: str
    url: str


def new_deadline_id() -> str:
    return "m-" + uuid.uuid4().hex[:8]


class Deadline(BaseModel):
    """期限一条。auto = 规则引擎按 dates.* / oa 发文日算出（rule / base_date / legal_basis 齐），
    manual = 人工录入或人工改期（改期必带 override_reason；重算不覆盖 manual）。"""
    id: str = Field(default_factory=new_deadline_id)
    kind: str = "custom"
    title: str = ""
    due: str
    base_date: str | None = None
    rule: str | None = None
    note: str = ""
    source: DeadlineSource = "manual"
    override_reason: str | None = None
    done: bool = False
    done_at: float | None = None
    legal_basis: LegalBasis | None = None

    @field_validator("due", "base_date", mode="before")
    @classmethod
    def _due(cls, v, info):
        d = _iso_date(v)
        if d is None and info.field_name == "due":
            raise ValueError("期限缺少 due")
        return d


class Confirmation(BaseModel):
    """客户确认定稿（W5 R-REV-05，share-confirm-backend 写入）：version/sha 为确认时版本；actor = client:<name>。"""
    version: int
    sha: str
    name: str
    note: str | None = None
    confirmed_at: float
    actor: str
    ip: str | None = None
    ua: str | None = None
    token: str | None = None


class RelatedCase(BaseModel):
    """案间关联（W19 批7 ⑪c）：分案↔母案双向指针 + 一般关联；与 priority（在先申请号）是两回事。"""
    pid: str = Field(min_length=1, max_length=64)
    kind: RelatedKind = "associated"
    note: str = ""


class Case(BaseModel):
    version: int = 1
    case_no: str = ""
    kind: CaseKind = "invention"
    status: CaseStatus = DEFAULT_STATUS
    owner_user_id: str | None = None
    client: str = ""
    applicants: list[str] = Field(default_factory=list)
    inventors: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    dates: Dates = Field(default_factory=Dates)
    priority: list[Priority] = Field(default_factory=list)
    # 代理师 / 内审人：成员 user_id（owner_user_id 是责任人）
    attorney: str | None = None
    reviewer: str | None = None
    client_contact: str = ""
    fee_status: FeeStatus | None = None
    deadlines: list[Deadline] = Field(default_factory=list)
    confirmations: list[Confirmation] = Field(default_factory=list)
    # 机构级「已归档」（案子本身结束），与用户视角的列表状态（project_list_state）是两回事
    archived: bool = False
    related: list[RelatedCase] = Field(default_factory=list)

    def deadline(self, deadline_id: str) -> Deadline | None:
        return next((d for d in self.deadlines if d.id == deadline_id), None)


class CasePatch(BaseModel):
    """PUT /case 请求体：全部可选，只改给出的字段（status 不在此改，走 POST /case/status 记事件）。
    未知键（含 status）422，不静默忽略。"""
    model_config = ConfigDict(extra="forbid")

    case_no: str | None = None
    kind: CaseKind | None = None
    owner_user_id: str | None = None
    client: str | None = None
    applicants: list[str] | None = None
    inventors: list[str] | None = None
    tags: list[str] | None = None
    dates: Dates | None = None
    priority: list[Priority] | None = None
    attorney: str | None = None
    reviewer: str | None = None
    client_contact: str | None = None
    fee_status: FeeStatus | None = None
    deadlines: list[Deadline] | None = None
    archived: bool | None = None
    related: list[RelatedCase] | None = None


# 改了这些字段就要重算 source=auto 的期限（routes_cases.put_case → app.deadlines.recompute）
DEADLINE_INPUT_FIELDS: frozenset[str] = frozenset({"dates", "priority"})


class StatusIn(BaseModel):
    status: CaseStatus
    note: str = ""


class Tag(BaseModel):
    name: str
    color: str = TAG_COLORS[5]

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = v.strip()
        if not v or len(v) > 32:
            raise ValueError("标签名 1–32 字")
        return v


class TagPatch(BaseModel):
    name: str | None = None
    color: str | None = None


class ListStateIn(BaseModel):
    state: ListState


class BulkIn(BaseModel):
    """POST /api/projects/bulk：对多案执行同一动作；逐案校验 ACL，失败案在 results 里给 error，不整体回滚。"""
    pids: list[str]
    action: Literal["status", "tags", "owner", "list_state"]
    status: CaseStatus | None = None
    add_tags: list[str] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)
    owner_user_id: str | None = None
    state: ListState | None = None


# ---------- case.json ----------

def case_path(project_dir: str) -> str:
    return os.path.join(project_dir, CASE_FILE)


def project_dir(pid: str) -> str:
    """无 request 上下文时（oa 单元 deadlines.add、定时扫描）按 config.PROJECTS_DIR 定位案子目录。"""
    return os.path.join(config.PROJECTS_DIR, pid)


def default_case(project_dir: str, today: date | None = None) -> Case:
    """旧案默认值：opened = 目录 mtime 的日期（拿不到用今天），status = drafting，其余空。"""
    try:
        opened = datetime.fromtimestamp(os.path.getmtime(project_dir)).date()
    except OSError:
        opened = today or local_today()
    return Case(dates=Dates(opened=opened.isoformat()))


def has_case(project_dir: str) -> bool:
    return os.path.isfile(case_path(project_dir))


def normalize_case(data: dict) -> Case:
    """旧 case.json（W4：无 priority / attorney / … ，deadlines 无 id / source / title，kind 为自由字符串）
    → 当前 Case：缺字段取默认值，缺 id 的期限补 m-xxxx；kind 原样保留（归类在 API 层）。"""
    return Case.model_validate(data)


def load_case(project_dir: str) -> Case:
    """读 case.json；不存在 ⇒ 默认值（不落盘）。文件坏了抛 CaseError 422。"""
    p = case_path(project_dir)
    if not os.path.isfile(p):
        return default_case(project_dir)
    try:
        with open(p, encoding="utf-8") as f:
            return normalize_case(json.load(f))
    except (OSError, ValueError) as e:
        raise CaseError(f"case.json 无法读取：{e}", 422)


def save_case(project_dir: str, case: Case) -> Case:
    atomic.write_json(case_path(project_dir), case.model_dump())
    return case


def add_related(case: Case, pid: str, kind: RelatedKind, note: str = "") -> bool:
    """追加案间关联（pid+kind 去重）；返回是否真有新增。跨案写由调用方在各自 studio_lock 内做。"""
    if any(r.pid == pid and r.kind == kind for r in case.related):
        return False
    case.related.append(RelatedCase(pid=pid, kind=kind, note=note))
    return True


def claim_owner(project_dir: str, user_id: str | None) -> Case:
    """新建 / 导入 / 一键转专利建案后统一落盘 case.json；owner 空且有登录用户时填为责任人。"""
    with atomic.studio_lock(project_dir, "case"):
        case = load_case(project_dir)
        if user_id is not None and case.owner_user_id is None:
            case = case.model_copy(update={"owner_user_id": user_id})
        return save_case(project_dir, case)


def ensure_case(project_dir: str) -> Case:
    """列表 / 详情读取时调用：没有 case.json 就用默认值生成一份（opened 从此固定，不随目录 mtime 漂）。"""
    if has_case(project_dir):
        return load_case(project_dir)
    return save_case(project_dir, default_case(project_dir))


def apply_patch(case: Case, patch: CasePatch) -> Case:
    data = {**case.model_dump(), **patch.model_dump(exclude_unset=True)}
    if patch.dates is not None:
        # dates 只改给出的子字段（FilingDialog 只发 {filed, application_no}，不能把其余日期抹成 None）
        data["dates"] = {**case.dates.model_dump(), **patch.dates.model_dump(exclude_unset=True)}
    return Case.model_validate(data)


def replace_deadline(case: Case, deadline: Deadline) -> Case:
    """按 id 替换（无则追加），保持顺序。"""
    if case.deadline(deadline.id) is None:
        return case.model_copy(update={"deadlines": [*case.deadlines, deadline]})
    return case.model_copy(update={"deadlines": [deadline if d.id == deadline.id else d for d in case.deadlines]})


def patched_fields(patch: CasePatch) -> list[str]:
    """请求体里显式给出的字段名（按 schema 顺序），用于 history 事件文案「case: update a, b」。"""
    return [k for k in CasePatch.model_fields if k in patch.model_fields_set]


def status_message(old: str, new: str, note: str = "") -> str:
    return f"case: status {old} → {new}" + (f" · {note}" if note.strip() else "")


def _dedupe(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    return [t for t in tags if not (t in seen or seen.add(t))]


def retag(case: Case, add: list[str] = (), remove: list[str] = ()) -> Case:
    """加 / 减标签（去重、保持原顺序）。"""
    tags = [t for t in case.tags if t not in remove] + [t for t in add if t not in remove]
    return case.model_copy(update={"tags": _dedupe(tags)})


def retag_projects(project_dirs, old: str, new: str | None) -> int:
    """标签改名（new）/ 删除（None）的级联：重写含 old 的 case.json，返回改写案数。
    标签是机构元数据，不写 history 事件；无 case.json 的案子跳过（不物化）。"""
    n = 0
    for d in project_dirs:
        if not has_case(d):
            continue
        with atomic.studio_lock(d, "case"):
            case = load_case(d)
            if old not in case.tags:
                continue
            tags = [new if t == old else t for t in case.tags] if new else [t for t in case.tags if t != old]
            save_case(d, case.model_copy(update={"tags": _dedupe(tags)}))
        n += 1
    return n


# ---------- 期限倒计时 ----------

def local_today() -> date:
    """北京时间的今天：与 app/deadlines/compute.today() 同一口径，服务器时区（UTC 容器）不得影响倒计时。"""
    return datetime.now(config.TZ).date()


def days_left(due: str, today: date | None = None) -> int:
    return (date.fromisoformat(due) - (today or local_today())).days


def deadline_level(days: int) -> DeadlineLevel:
    if days < 0:
        return "overdue"
    if days <= RED_DAYS:
        return "red"
    if days <= YELLOW_DAYS:
        return "yellow"
    return "normal"


def next_deadline(case: Case, today: date | None = None) -> dict | None:
    """未完成期限里 due 最早的一条 + 倒计时；没有 ⇒ None。已逾期的也算（最早的那条最该看到）。"""
    pending = sorted((d for d in case.deadlines if not d.done), key=lambda d: d.due)
    if not pending:
        return None
    d = pending[0]
    n = days_left(d.due, today)
    return {"kind": d.kind, "due": d.due, "note": d.note, "days_left": n, "level": deadline_level(n)}


def target_filing_days_left(case: Case, today: date | None = None) -> int | None:
    """只读「目标递交」倒计时：dates.target_filing 距今天数（负数 = 已过目标日），与 days_left 同一 Asia/Shanghai 口径；
    无 target_filing ⇒ None。不进 deadlines[]（rules.json 语义不变），只供台账 / 期限中心显示。"""
    if not case.dates.target_filing:
        return None
    return days_left(case.dates.target_filing, today)


def summary(case: Case, today: date | None = None) -> dict:
    """GET /api/projects 每行的 case 摘要：Case 全字段 + next_deadline + target_filing_days_left（服务端算日期）。"""
    return {**case.model_dump(), "next_deadline": next_deadline(case, today),
            "target_filing_days_left": target_filing_days_left(case, today)}


def collaborators_of(pid: str, members: list[dict], seen: dict[str, str]) -> list[dict]:
    """collaborators 的纯数据版：members/seen 由调用方批量预取（members_map_for_pids / last_seen_for_pids）。
    online = 协同房间当前连着（collab.rooms.online_user_ids）；auth=off ⇒ []。"""
    if not config.AUTH_ON:
        return []
    from app.collab import rooms

    online = rooms.online_user_ids(pid)
    return [{**m, "online": m["user_id"] in online, "last_seen": seen.get(m["user_id"])}
            for m in members]


async def collaborators(pid: str) -> list[dict]:
    """ACL 成员（{user_id,email,display_name,role,online,last_seen}，面板画头像用）；auth=off ⇒ []。
    online = 协同房间当前连着（collab.rooms.online_user_ids）；last_seen = 访问记录 project_access（W4-B）。"""
    if not config.AUTH_ON:
        return []
    from app.auth import access, acl

    seen = await access.last_seen_by_user(pid)
    return collaborators_of(pid, await acl.list_members(pid), seen)


async def owner_brief(case: Case, cache: dict[str, dict | None] | None = None) -> dict | None:
    """owner_user_id → {user_id,email,display_name,avatar_color}；不经 ACL
    （owner 可能是无 ACL 行的 superuser / 已移出成员）。
    无 owner / auth=off / 用户不存在 ⇒ None；cache 供一次 GET /api/projects 内同一 owner 只查一次。"""
    uid = case.owner_user_id
    if not uid or not config.AUTH_ON:
        return None
    if cache is not None and uid in cache:
        return cache[uid]
    from app.auth import acl

    out = await acl.get_user_brief(uid)
    if cache is not None:
        cache[uid] = out
    return out


async def list_extra(project_dir: str, pid: str, user, states: dict[str, str], today: date | None = None,
                     owners: dict[str, dict | None] | None = None,
                     my_role: str | None | object = _UNSET, collab: list[dict] | None = None) -> dict:
    """GET /api/projects 每行在 {id,title,mtime} 之外的新字段（旧字段不动，前端现有调用不破）。
    my_role/collab 预取版传入可跳库（聚合列表调用方批量算好，见 main.list_projects 的 R82-02）。"""
    case = ensure_case(project_dir)
    return {
        "case": summary(case, today),
        "owner": await owner_brief(case, owners),
        "collaborators": collab if collab is not None else await collaborators(pid),
        "last_modified_by": history.last_author(project_dir),
        "my_role": my_role if my_role is not _UNSET else await auth.my_role(pid, user),
        "list_state": states.get(pid, "active"),
    }


# ---------- 机构级标签 ----------

def tags_path(projects_dir: str | None = None) -> str:
    return os.path.join(projects_dir or config.PROJECTS_DIR, TAGS_FILE)


def load_tags(projects_dir: str | None = None) -> list[Tag]:
    p = tags_path(projects_dir)
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    return [Tag.model_validate(t) for t in data.get("tags", [])]


def save_tags(tags: list[Tag], projects_dir: str | None = None) -> list[Tag]:
    p = tags_path(projects_dir)
    atomic.write_json(p, {"version": TAGS_VERSION, "tags": [t.model_dump() for t in tags]})
    return tags


# ---------- 用户视角列表状态（归档 / 回收站） ----------

LOCAL_USER = "local"


def user_key(user) -> str:
    """auth=on ⇒ str(user.id)；off（user None）⇒ "local"（单机单人）。"""
    return LOCAL_USER if user is None else str(user.id)


def _engine():
    """共享同步引擎（app.notify.sink 的 PostgreSQL engine；off 模式连同一个库）。"""
    from app.notify import sink

    return sink.engine()


def _db_available() -> bool:
    """未配置 PATENT_STUDIO_DATABASE_URL ⇒ False：off 单机无库部署里列表状态降级为全 active。"""
    from app.notify import sink

    return sink.available()


def list_states(user_id: str) -> dict[str, str]:
    """{pid: 'archived'|'trashed'}；未出现的案子即 active。"""
    if not _db_available():
        return {}
    from sqlalchemy import select

    from patent_studio.domain.identity import ProjectListState

    with _engine().begin() as conn:
        rows = conn.execute(
            select(ProjectListState.project_id, ProjectListState.state)
            .where(ProjectListState.user_id == user_id))
        return {pid: state for pid, state in rows}


def get_state(user_id: str, pid: str) -> str:
    return list_states(user_id).get(pid, "active")


def set_state(user_id: str, pid: str, state: str) -> str:
    if state not in LIST_STATES:
        raise CaseError(f"非法列表状态：{state}", 422)
    if not _db_available():
        # 无库不落行——绝不能回报已存：列表状态只有库里才有持久性
        raise CaseError("归档 / 回收站需要数据库：请配置 PATENT_STUDIO_DATABASE_URL（PostgreSQL）后重试", 503)
    from sqlalchemy import delete, func
    from sqlalchemy.dialects.postgresql import insert

    from patent_studio.domain.identity import ProjectListState

    with _engine().begin() as conn:
        if state == "active":
            conn.execute(delete(ProjectListState).where(
                ProjectListState.user_id == user_id, ProjectListState.project_id == pid))
        else:
            stmt = insert(ProjectListState).values(user_id=user_id, project_id=pid, state=state)
            conn.execute(stmt.on_conflict_do_update(
                index_elements=["user_id", "project_id"],
                set_={"state": stmt.excluded.state, "updated_at": func.now()}))
    return state


def forget_project(pid: str) -> None:
    """永久删除案子后清掉所有人的列表状态行。"""
    if not _db_available():
        return
    from sqlalchemy import delete

    from patent_studio.domain.identity import ProjectListState

    with _engine().begin() as conn:
        conn.execute(delete(ProjectListState).where(ProjectListState.project_id == pid))
