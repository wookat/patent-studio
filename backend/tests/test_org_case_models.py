# -*- coding: utf-8 -*-
"""PR4 机构 / 成员 / 案件 / 案件参与（domain.organization）机械回归：真实 PG 上的约束正/负例。

pg_schema 给每个用例一套迁移到 head 的一次性库（含 0003 五张新表）；负例断言 IntegrityError
后 rollback。这里只验数据库约束，不覆盖授权策略（后续批次）。
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from patent_studio.domain.identity import Principal, User
from patent_studio.domain.organization import (
    Case,
    CaseParticipant,
    Organization,
    OrganizationMembership,
)
from patent_studio.infra.db import database_url

pytestmark = pytest.mark.skipif(not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"),
                                reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL")


@pytest.fixture()
def db(pg_schema):
    eng = create_engine(database_url(pg_schema))
    try:
        yield eng
    finally:
        eng.dispose()


def _user() -> User:
    return User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:12]}@t.example", hashed_password="x",
                is_active=True, is_superuser=False, is_verified=False, display_name="测试用户")


def _human(user: User) -> Principal:
    return Principal(kind="human", user_id=user.id, display_name=user.display_name or "人")


def _add_human(s: Session) -> Principal:
    """建一个落库的 human principal：users 无 ORM relationship，UOW 不保证插入序，先 flush user。"""
    u = _user()
    s.add(u)
    s.flush()
    p = _human(u)
    s.add(p)
    return p


def _agent(key: str | None = None) -> Principal:
    return Principal(kind="agent", agent_key=key or f"agt-{uuid.uuid4().hex[:12]}",
                     display_name="代理")


def _org(creator: Principal, slug: str | None = None, **kw) -> Organization:
    return Organization(slug=slug or f"org-{uuid.uuid4().hex[:10]}", name="测试机构",
                        created_by_principal_id=creator.id, **kw)


def _member(org, principal, role="owner", status="active", invited_by=None) -> OrganizationMembership:
    return OrganizationMembership(organization_id=org.id, principal_id=principal.id, role=role,
                                  status=status, invited_by_principal_id=invited_by)


def _case(org, creator_pid, key=None, no=None, **kw) -> Case:
    return Case(organization_id=org.id, case_key=key or f"K-{uuid.uuid4().hex[:8]}",
                case_no=no, title="测试案件", created_by_principal_id=creator_pid, **kw)


def _participant(case, principal, role="attorney", **kw) -> CaseParticipant:
    return CaseParticipant(case_id=case.id, principal_id=principal.id, role=role, **kw)


def _member_with_org(s: Session, role="owner", status="active"):
    """add 一组 user→human principal→org→member；按依赖分层 flush，调用方负责 commit。"""
    u = _user()
    s.add(u)
    s.flush()
    p = _human(u)
    s.add(p)
    s.flush()
    o = _org(p)
    s.add(o)
    s.flush()
    s.add(_member(o, p, role=role, status=status))
    s.flush()
    return o, p


def _violates(s: Session):
    return pytest.raises(IntegrityError)


def test_org_case_tables_migrated(db):
    """0003 升级后五张表都在（pg_schema 已跑到 head）。"""
    names = set(inspect(db).get_table_names())
    assert {"principals", "organizations", "organization_memberships", "cases",
            "case_participants"} <= names


def test_principal_human_agent_identity_source(db):
    """human 只能走 user_id、agent 只能走非空 agent_key；kind 域受限。"""
    with Session(db) as s:
        u = _user()
        s.add(u)
        s.flush()
        s.add(_human(u))
        s.add(_agent())
        s.commit()  # 正例：两种身份源各自成立

        s.add(Principal(kind="human", display_name="x"))  # human 缺 user_id
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(Principal(kind="agent", display_name="x"))  # agent 缺 agent_key
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(Principal(kind="agent", agent_key="   ", display_name="x"))  # 空白 agent_key
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(Principal(kind="human", user_id=u.id, agent_key="k", display_name="x"))  # human 带 agent_key
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(Principal(kind="robot", display_name="x"))  # kind 非法
        with _violates(s):
            s.flush()
        s.rollback()


def test_principal_agent_key_and_user_id_unique(db):
    """agent_key 全局唯一；一个 user 只能映射一个 human principal。"""
    with Session(db) as s:
        u = _user()
        s.add(u)
        s.flush()
        s.add(_human(u))
        s.add(_agent("shared-key"))
        s.commit()

        s.add(_agent("shared-key"))  # agent_key 撞唯一约束
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_human(u))  # user_id 撞唯一约束
        with _violates(s):
            s.flush()
        s.rollback()


def test_organization_slug_status_and_creator(db):
    """slug 小写去空格且唯一、status 域受限、创建者必须是存在的 principal。"""
    with Session(db) as s:
        u = _user()
        s.add(u)
        s.flush()
        p = _human(u)
        s.add(p)
        s.flush()
        s.add(_org(p, slug="acme-ip"))
        s.commit()

        s.add(_org(p, slug="Acme-Ip"))  # 大写 slug
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_org(p, slug=" padded "))  # 首尾空格 slug
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_org(p, status="bogus"))  # 非法 status
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(Organization(slug="orphan", name="x",
                           created_by_principal_id=uuid.uuid4()))  # 创建者不存在
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_org(p, slug="acme-ip"))  # 重复 slug
        with _violates(s):
            s.flush()
        s.rollback()


def test_membership_role_status_inviter_same_org(db):
    """角色 / 状态域受限；invited 必须有邀请者；邀请者必须是同一机构的成员。"""
    with Session(db) as s:
        org_a, owner_a = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        s.commit()

        pc = _add_human(s)
        s.flush()
        s.add(_member(org_a, pc, role="member", status="invited", invited_by=owner_a.id))
        s.commit()  # 正例：同机构 owner 邀请新成员

        pd = _add_human(s)
        s.commit()
        s.add(_member(org_a, pd, status="invited"))  # invited 但无邀请者
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_member(org_a, pd, status="invited", invited_by=owner_b.id))  # 跨机构邀请者
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_member(org_a, pd, role="boss", status="active"))  # 非法 role
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_member(org_a, pd, role="member", status="ghost"))  # 非法 status
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_member(org_a, owner_a))  # 同机构同 principal 重复成员行（PK）
        with _violates(s):
            s.flush()
        s.rollback()

        assert org_b.id != org_a.id  # 两个机构确实不同（跨机构邀请者断言才有意义）


def test_case_creator_must_be_member_of_org(db):
    """fk_cases_creator_membership：创建者必须是该机构成员；他机构成员/外部人都不行。"""
    with Session(db) as s:
        org_a, owner_a = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        outsider = _add_human(s)
        s.commit()

        s.add(_case(org_a, owner_a.id))
        s.commit()  # 正例：org_a 成员建案

        s.add(_case(org_a, outsider.id))  # 负例：外部人（哪都不是成员）
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_case(org_a, owner_b.id))  # 负例：org_b 成员在 org_a 建案
        with _violates(s):
            s.flush()
        s.rollback()


def test_case_key_case_no_unique_per_org(db):
    """case_key / case_no 机构内唯一、跨机构可重复；kind / status 域受限。"""
    with Session(db) as s:
        org_a, owner_a = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        s.commit()

        s.add(_case(org_a, owner_a.id, key="K-1", no="CN-1"))
        s.add(_case(org_b, owner_b.id, key="K-1", no="CN-1"))  # 同号跨机构允许
        s.commit()

        s.add(_case(org_a, owner_a.id, key="K-1"))  # 同机构重复 case_key
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_case(org_a, owner_a.id, no="CN-1"))  # 同机构重复 case_no
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_case(org_a, owner_a.id, kind="patent"))  # 非法 kind
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_case(org_a, owner_a.id, status="bogus"))  # 非法 status
        with _violates(s):
            s.flush()
        s.rollback()


def test_case_participant_external_human_agent_and_role_uniqueness(db):
    """案件参与不查成员表：受邀外部 human / Agent 可入同一案件；
    (case, principal, role) 唯一，role / status 域受限。"""
    with Session(db) as s:
        org_a, owner_a = _member_with_org(s)
        case = _case(org_a, owner_a.id)
        s.add(case)
        ext_human = _add_human(s)  # 非 org_a 成员的外部 human
        ext_agent = _agent()       # 非 org_a 成员的外部 Agent
        s.add(ext_agent)
        s.commit()

        s.add(_participant(case, owner_a, role="attorney"))
        s.add(_participant(case, ext_human, role="client"))
        s.add(_participant(case, ext_agent, role="agent"))
        s.add(_participant(case, owner_a, role="reviewer"))  # 同 principal 不同 role 可并存
        s.commit()  # 正例：成员 + 外部 human + 外部 Agent 同案参与

        s.add(_participant(case, owner_a, role="attorney"))  # (case, principal, role) 重复
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_participant(case, owner_a, role="boss"))  # 非法 role
        with _violates(s):
            s.flush()
        s.rollback()

        s.add(_participant(case, ext_agent, role="observer", status="ghost"))  # 非法 status
        with _violates(s):
            s.flush()
        s.rollback()


def test_audit_relationships_reject_physical_deletes(db):
    """案件、参与关系和 Principal 都是审计真源，撤离用状态而不是物理级联删除。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        case = _case(org, owner.id)
        ext_agent = _agent()
        s.add_all([case, ext_agent])
        s.flush()
        s.add(_participant(case, ext_agent, role="agent"))
        s.commit()

        s.delete(case)
        with _violates(s):
            s.flush()
        s.rollback()

        s.delete(ext_agent)
        with _violates(s):
            s.flush()
        s.rollback()

        s.delete(org)
        with _violates(s):
            s.flush()
        s.rollback()

        user = _user()
        s.add(user)
        s.flush()
        s.add(_human(user))
        s.commit()
        s.delete(user)
        with _violates(s):
            s.flush()
        s.rollback()
