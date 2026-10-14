# -*- coding: utf-8 -*-
"""PR5 Invitation / Grant 生命周期与关系授权回归：真实 PG 上的约束负例与领域函数判定。

pg_schema 提供迁移到 head（含 0004）的一次性库。DB 负例断言 IntegrityError 后 rollback；
领域拒绝断言 AuthorizationError / InvitationStateError / GrantConflict。
模型间无 ORM relationship，UOW 不保证插入序——fixtures 按依赖分层 flush。
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from patent_studio.domain.authorization import (
    AuthorizationError,
    Grant,
    GrantConflict,
    Invitation,
    InvitationStateError,
    accept_invitation,
    authorize_grant,
    decline_invitation,
    expire_grant,
    expire_invitation,
    revoke_grant,
    revoke_invitation,
)
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


def _future(minutes=60):
    return datetime.now(UTC) + timedelta(minutes=minutes)


def _past(minutes=60):
    return datetime.now(UTC) - timedelta(minutes=minutes)


def _user() -> User:
    return User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:12]}@t.example", hashed_password="x",
                is_active=True, is_superuser=False, is_verified=False, display_name="测试用户")


def _human(user: User) -> Principal:
    return Principal(kind="human", user_id=user.id, display_name=user.display_name or "人")


def _add_human(s: Session) -> Principal:
    u = _user()
    s.add(u)
    s.flush()
    p = _human(u)
    s.add(p)
    s.flush()
    return p


def _agent(key: str | None = None) -> Principal:
    return Principal(kind="agent", agent_key=key or f"agt-{uuid.uuid4().hex[:12]}",
                     display_name="代理")


def _add_agent(s: Session, key: str | None = None) -> Principal:
    p = _agent(key)
    s.add(p)
    s.flush()
    return p


def _org(creator: Principal, slug: str | None = None, **kw) -> Organization:
    return Organization(slug=slug or f"org-{uuid.uuid4().hex[:10]}", name="测试机构",
                        created_by_principal_id=creator.id, **kw)


def _member(org, principal, role="owner", status="active", invited_by=None) -> OrganizationMembership:
    return OrganizationMembership(organization_id=org.id, principal_id=principal.id, role=role,
                                  status=status, invited_by_principal_id=invited_by)


def _case(org, creator_pid, key=None, no=None, **kw) -> Case:
    return Case(organization_id=org.id, case_key=key or f"K-{uuid.uuid4().hex[:8]}",
                case_no=no, title="测试案件", created_by_principal_id=creator_pid, **kw)


def _member_with_org(s: Session, role="owner", status="active"):
    """add+flush 一组 user→human principal→org→member（分层 flush），调用方负责 commit。"""
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


def _invitation(org, invitee: Principal, inviter: Principal, role="member", case=None,
                **kw) -> Invitation:
    kw.setdefault("expires_at", _future())
    return Invitation(organization_id=org.id, case_id=case.id if case else None,
                      invitee_principal_id=invitee.id, invited_by_principal_id=inviter.id,
                      role=role, **kw)


def _grant(org, grantor: Principal, subject: Principal, case=None, **kw) -> Grant:
    kw.setdefault("capabilities", ["case.read"])
    kw.setdefault("not_before", _past(1))
    kw.setdefault("expires_at", _future())
    return Grant(organization_id=org.id, case_id=case.id if case else None,
                 grantor_principal_id=grantor.id, subject_principal_id=subject.id, **kw)


def test_invitation_grant_tables_migrated(db):
    """0004 升级后 invitations / grants 两表在（pg_schema 已跑到 head）。"""
    assert {"invitations", "grants"} <= set(inspect(db).get_table_names())


def test_org_invitation_accept_creates_active_membership(db):
    """机构级邀请接受 ⇒ 写入 active membership（角色沿用邀请、记录邀请人与 joined_at）。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        invitee = _add_human(s)
        s.commit()
        inv = _invitation(org, invitee, owner, role="member")
        s.add(inv)
        s.commit()

        accept_invitation(s, inv, invitee.id, at=datetime.now(UTC))
        s.commit()

        m = s.scalar(select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org.id,
            OrganizationMembership.principal_id == invitee.id))
        assert m is not None and m.status == "active" and m.role == "member"
        assert m.invited_by_principal_id == owner.id and m.joined_at is not None
        assert inv.status == "accepted" and inv.accepted_at is not None


def test_case_invitation_accept_creates_participant(db):
    """案件级邀请接受 ⇒ 写入 CaseParticipant；受邀者不必是机构成员。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        case = _case(org, owner.id)
        s.add(case)
        invitee = _add_human(s)
        s.commit()
        inv = _invitation(org, invitee, owner, role="reviewer", case=case)
        s.add(inv)
        s.commit()

        accept_invitation(s, inv, invitee.id)
        s.commit()

        cp = s.scalar(select(CaseParticipant).where(
            CaseParticipant.case_id == case.id,
            CaseParticipant.principal_id == invitee.id))
        assert cp is not None and cp.role == "reviewer" and cp.status == "active"
        assert inv.status == "accepted"
        assert s.scalar(select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org.id,
            OrganizationMembership.principal_id == invitee.id)) is None  # 未顺带成成员


def test_accept_invitation_rechecks_issuer_and_serializes_state(db):
    """接受前重查邀请人/受邀人；并发或陈旧 Invitation 不能二次转换。"""
    with Session(db, expire_on_commit=False) as a, Session(db, expire_on_commit=False) as b:
        org, owner = _member_with_org(a)
        invitee = _add_human(a)
        agent = _add_agent(a)
        a.add(_member(org, agent, role="admin"))
        a.commit()

        invitation = _invitation(org, invitee, owner, role="member")
        a.add(invitation)
        a.commit()
        stale = a.get(Invitation, invitation.id)
        assert stale is not None

        owner_membership = b.scalar(select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org.id,
            OrganizationMembership.principal_id == owner.id))
        owner_membership.role = "member"
        b.commit()
        with pytest.raises(AuthorizationError):
            accept_invitation(a, stale, invitee.id)
        a.rollback()

        owner_membership = b.scalar(select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org.id,
            OrganizationMembership.principal_id == owner.id))
        owner_membership.role = "owner"
        b.commit()

        invitee_user = b.get(User, invitee.user_id)
        assert invitee_user is not None
        invitee_user.is_active = False
        b.commit()
        with pytest.raises(AuthorizationError):
            accept_invitation(a, stale, invitee.id)
        a.rollback()
        invitee_user.is_active = True
        b.commit()

        second_invitee = _add_human(b)
        b.commit()
        second = _invitation(org, second_invitee, owner, role="member")
        b.add(second)
        b.commit()
        stale_second = a.get(Invitation, second.id)
        assert stale_second is not None

        accept_invitation(b, b.get(Invitation, second.id), second_invitee.id)
        b.commit()
        with pytest.raises(InvitationStateError):
            accept_invitation(a, stale_second, second_invitee.id)
        a.rollback()

        agent_invitation = _invitation(org, invitee, agent, role="member")
        b.add(agent_invitation)
        b.commit()
        with pytest.raises(AuthorizationError):
            accept_invitation(b, agent_invitation, invitee.id)
        b.rollback()


def test_accept_invitation_two_session_competition_has_one_winner(db):
    """两个真实 PG Session 同时接受同一邀请时，行锁只允许一个生命周期转换。"""
    from threading import Barrier

    with Session(db) as setup:
        org, owner = _member_with_org(setup)
        invitee = _add_human(setup)
        setup.commit()
        invitation = _invitation(org, invitee, owner, role="member")
        setup.add(invitation)
        setup.commit()
        invitation_id, invitee_id = invitation.id, invitee.id

    barrier = Barrier(2)

    def accept_once():
        with Session(db) as current:
            stale = current.get(Invitation, invitation_id)
            assert stale is not None
            barrier.wait(timeout=10)
            try:
                accept_invitation(current, stale, invitee_id)
                current.commit()
                return "accepted"
            except InvitationStateError:
                current.rollback()
                return "InvitationStateError"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: accept_once(), range(2)))
    assert sorted(results) == ["InvitationStateError", "accepted"]


def test_authorization_uses_current_principal_and_organization_state(db):
    """停用 human、机构暂停/归档时，在线授权判定立即拒绝。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        subject = _add_human(s)
        s.add(_member(org, subject, role="member"))
        s.commit()

        grant = _grant(org, owner, subject)
        s.add(grant)
        s.commit()

        owner_user = s.get(User, owner.user_id)
        assert owner_user is not None
        owner_user.is_active = False
        s.flush()
        decision = authorize_grant(s, subject.id, org.id, "case.read", grant_id=grant.id)
        assert not decision.allowed and decision.reason == "grantor_not_authorized"
        owner_user.is_active = True

        subject_user = s.get(User, subject.user_id)
        assert subject_user is not None
        subject_user.is_active = False
        s.flush()
        decision = authorize_grant(s, subject.id, org.id, "case.read", grant_id=grant.id)
        assert not decision.allowed and decision.reason == "subject_inactive"
        subject_user.is_active = True

        org.status = "suspended"
        s.flush()
        decision = authorize_grant(s, subject.id, org.id, "case.read", grant_id=grant.id)
        assert not decision.allowed and decision.reason == "organization_inactive"

        org.status = "archived"
        s.flush()
        decision = authorize_grant(s, subject.id, org.id, "case.read", grant_id=grant.id)
        assert not decision.allowed and decision.reason == "organization_inactive"

        s.rollback()


def test_accept_invitation_rejects_inactive_organization(db):
    """暂停机构不接受新邀请；撤销通道仍由当前 human owner/admin 保留。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        invitee = _add_human(s)
        s.commit()
        invitation = _invitation(org, invitee, owner, role="member")
        s.add(invitation)
        s.commit()

        org.status = "suspended"
        s.flush()
        with pytest.raises(AuthorizationError):
            accept_invitation(s, invitation, invitee.id)
        s.rollback()

        grant_subject = _add_human(s)
        s.add(_member(org, grant_subject, role="member"))
        grant = _grant(org, owner, grant_subject)
        s.add(grant)
        s.commit()
        org.status = "archived"
        s.flush()
        with pytest.raises(AuthorizationError):
            accept_invitation(s, invitation, invitee.id)
        s.rollback()
        org = s.get(Organization, org.id)
        assert org is not None and org.status == "active"
        org.status = "archived"
        s.flush()
        revoked = revoke_grant(s, grant.id, owner.id, expected_epoch=1)
        s.commit()
        assert revoked.status == "revoked" and revoked.fencing_epoch == 2


def test_authorization_reads_fresh_rows_across_sessions(db):
    """长生命周期 Session 不得复用被另一事务降权或撤销的 membership / grant。"""
    with Session(db) as setup:
        org, owner = _member_with_org(setup)
        subject = _add_human(setup)
        setup.add(_member(org, subject, role="member"))
        grant = _grant(org, owner, subject)
        setup.add(grant)
        setup.commit()
        org_id, owner_id, subject_id, grant_id = org.id, owner.id, subject.id, grant.id
        subject_user_id = subject.user_id

    with Session(db, expire_on_commit=False) as a, Session(db, expire_on_commit=False) as b:
        assert a.get(OrganizationMembership, (org_id, owner_id)) is not None
        assert a.get(Grant, grant_id) is not None
        assert a.get(User, subject_user_id) is not None
        assert authorize_grant(a, subject_id, org_id, "case.read", grant_id=grant_id).allowed

        membership_b = b.get(OrganizationMembership, (org_id, owner_id))
        assert membership_b is not None
        membership_b.role = "member"
        b.commit()
        decision = authorize_grant(a, subject_id, org_id, "case.read", grant_id=grant_id)
        assert not decision.allowed and decision.reason == "grantor_not_authorized"

        membership_b.role = "owner"
        b.commit()
        subject_user_b = b.get(User, subject_user_id)
        assert subject_user_b is not None
        subject_user_b.is_active = False
        b.commit()
        decision = authorize_grant(a, subject_id, org_id, "case.read", grant_id=grant_id)
        assert not decision.allowed and decision.reason == "subject_inactive"
        subject_user_b.is_active = True
        b.commit()

        grant_b = b.get(Grant, grant_id)
        assert grant_b is not None
        revoked_at = datetime.now(UTC)
        revoke_grant(b, grant_id, owner_id, expected_epoch=1, at=revoked_at)
        b.commit()

        decision = authorize_grant(
            a, subject_id, org_id, "case.read", grant_id=grant_id, expected_epoch=1
        )
        assert not decision.allowed
        assert decision.reason == "grant_epoch_conflict"
        assert decision.grant_id == grant_id and decision.fencing_epoch == 2
        with pytest.raises(GrantConflict):
            revoke_grant(a, grant_id, owner_id, expected_epoch=1)
        a.rollback()

        b.expire_all()
        current = b.get(Grant, grant_id)
        assert current is not None
        assert current.status == "revoked" and current.fencing_epoch == 2
        assert current.revoked_by_principal_id == owner_id
        assert current.revoked_at == revoked_at


def test_authorize_foreign_grant_diagnostic_is_opaque(db):
    """外部机构 grant 不得通过 no_grants 诊断泄漏 id、epoch 或撤销状态。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        subject = _add_human(s)
        s.add(_member(org, subject, role="member"))
        foreign = _grant(org_b, owner_b, subject, fencing_epoch=7, status="revoked",
                         revoked_at=datetime.now(UTC), revoked_by_principal_id=owner_b.id)
        s.add(foreign)
        s.commit()

        decision = authorize_grant(s, subject.id, org.id, "case.read", grant_id=foreign.id,
                                   expected_epoch=1)
        assert not decision.allowed and decision.reason == "grant_missing"
        assert decision.grant_id is None and decision.fencing_epoch is None

        other_subject = _add_human(s)
        same_org_other_subject = _grant(
            org,
            owner,
            other_subject,
            fencing_epoch=8,
            status="revoked",
            revoked_at=datetime.now(UTC),
            revoked_by_principal_id=owner.id,
        )
        s.add(same_org_other_subject)
        case = _case(org, owner.id)
        s.add(case)
        s.commit()
        same_subject_case = _grant(
            org,
            owner,
            subject,
            case=case,
            fencing_epoch=9,
            status="revoked",
            revoked_at=datetime.now(UTC),
            revoked_by_principal_id=owner.id,
        )
        s.add(same_subject_case)
        s.commit()

        for hidden in (same_org_other_subject, same_subject_case):
            decision = authorize_grant(
                s,
                subject.id,
                org.id,
                "case.read",
                grant_id=hidden.id,
                expected_epoch=1,
            )
            assert not decision.allowed and decision.reason == "grant_missing"
            assert decision.grant_id is None and decision.fencing_epoch is None


def test_invitation_rejection_matrix(db):
    """错误接收人 / 过期 / 撤销 / 已拒绝 / 重复接受 / 已有成员关系都必须拒绝。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        case = _case(org, owner.id)
        s.add(case)
        invitee = _add_human(s)
        other = _add_human(s)
        s.commit()

        inv = _invitation(org, invitee, owner)
        s.add(inv)
        s.commit()
        with pytest.raises(AuthorizationError):
            accept_invitation(s, inv, other.id)  # 错误接收人
        with pytest.raises(AuthorizationError):
            decline_invitation(s, inv, other.id)
        s.rollback()

        inv_exp = _invitation(org, invitee, owner, expires_at=_future(10))
        s.add(inv_exp)
        s.commit()
        with pytest.raises(InvitationStateError):
            accept_invitation(s, inv_exp, invitee.id, at=_future(20))  # 已过期
        s.rollback()
        expire_invitation(s, inv_exp, at=_future(30))  # 过期落地
        s.commit()
        assert inv_exp.status == "expired"
        with pytest.raises(InvitationStateError):
            accept_invitation(s, inv_exp, invitee.id, at=_future(40))
        s.rollback()

        inv_rev = _invitation(org, invitee, owner)
        s.add(inv_rev)
        s.commit()
        with pytest.raises(AuthorizationError):
            revoke_invitation(s, inv_rev, invitee.id)  # 只有邀请人能撤
        s.rollback()
        revoke_invitation(s, inv_rev, owner.id)
        s.commit()
        assert inv_rev.status == "revoked" and inv_rev.revoked_at is not None
        with pytest.raises(InvitationStateError):
            accept_invitation(s, inv_rev, invitee.id)
        s.rollback()

        inv_dec = _invitation(org, invitee, owner)
        s.add(inv_dec)
        s.commit()
        decline_invitation(s, inv_dec, invitee.id)
        s.commit()
        assert inv_dec.status == "declined" and inv_dec.declined_at is not None
        with pytest.raises(InvitationStateError):
            accept_invitation(s, inv_dec, invitee.id)
        s.rollback()

        inv_ok = _invitation(org, invitee, owner)
        s.add(inv_ok)
        s.commit()
        accept_invitation(s, inv_ok, invitee.id)
        s.commit()
        with pytest.raises(InvitationStateError):
            accept_invitation(s, inv_ok, invitee.id)  # 重复接受（状态门）
        s.rollback()

        inv_dup = _invitation(org, invitee, owner)  # 已有成员关系的新邀请
        s.add(inv_dup)
        s.commit()
        with pytest.raises(GrantConflict):
            accept_invitation(s, inv_dup, invitee.id)
        s.rollback()

        inv_fresh = _invitation(org, invitee, owner)  # expire_invitation 过早调用
        s.add(inv_fresh)
        s.commit()
        with pytest.raises(InvitationStateError):
            expire_invitation(s, inv_fresh, at=datetime.now(UTC))
        s.rollback()


def test_invitation_check_and_fk_negatives(db):
    """scope-role / expiry / lifecycle / status 域 / inviter 同机构 / case 同机构——真实 CK/FK 负例。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        case = _case(org, owner.id)
        case_b = _case(org_b, owner_b.id)
        s.add(case)
        s.add(case_b)
        invitee = _add_human(s)
        s.commit()

        s.add(_invitation(org, invitee, owner, role="reviewer"))  # 机构级用案件角色
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_invitation(org, invitee, owner, role="owner", case=case))  # 案件级用机构角色
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_invitation(org, invitee, owner, expires_at=_past()))  # expires_at <= created_at
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_invitation(org, invitee, owner, status="accepted"))  # accepted 缺 accepted_at
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_invitation(org, invitee, owner, status="revoked", revoked_at=datetime.now(UTC),
                          accepted_at=datetime.now(UTC)))  # 多戳并存违反 lifecycle
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_invitation(org, invitee, owner, status="ghost"))  # 非法 status
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_invitation(org, invitee, owner_b))  # 邀请人非本机构成员（复合 FK）
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_invitation(org, invitee, owner, case=case_b))  # case 属别机构（复合 FK）
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()


def test_grant_check_and_fk_negatives(db):
    """capabilities 非空 / 时间窗 / epoch>0 / status 域 / 撤销一致性 / 三类 FK——真实负例。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        case_b = _case(org_b, owner_b.id)
        s.add(case_b)
        subj = _add_human(s)
        s.commit()

        s.add(_grant(org, owner, subj, capabilities=[]))
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_grant(org, owner, subj, not_before=_future(10), expires_at=_future(5)))
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_grant(org, owner, subj, fencing_epoch=0))
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_grant(org, owner, subj, status="ghost"))
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_grant(org, owner, subj, status="revoked"))  # revoked 缺戳/缺人
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_grant(org, owner, subj, revoked_at=datetime.now(UTC)))  # active 却带撤销戳
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_grant(org, owner_b, subj))  # grantor 非本机构成员
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        s.add(_grant(org, owner, subj, case=case_b))  # case 属别机构
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()

        ghost = Principal(kind="agent", agent_key=f"ghost-{uuid.uuid4().hex[:8]}",
                          display_name="ghost")
        s.add(_grant(org, owner, ghost))  # subject 不存在
        with pytest.raises(IntegrityError):
            s.flush()
        s.rollback()


def test_grant_issuer_must_be_active_human_owner_or_admin(db):
    """签发门槛：本机构 active human owner/admin。member / Agent-admin / suspended / 跨机构都拒绝。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        plain = _add_human(s)
        s.add(_member(org, plain, role="member"))
        admin = _add_human(s)
        s.add(_member(org, admin, role="admin"))
        agent_admin = _add_agent(s)
        s.add(_member(org, agent_admin, role="admin"))  # Agent 占 admin 席位也不算人
        susp_owner = _add_human(s)
        s.add(_member(org, susp_owner, role="owner", status="suspended"))
        subj = _add_human(s)
        s.add(_member(org, subj, role="member"))
        s.commit()

        for grantor in (plain, agent_admin, susp_owner):
            g = _grant(org, grantor, subj)
            s.add(g)
            s.commit()
            d = authorize_grant(s, subj.id, org.id, "case.read", grant_id=g.id)
            assert not d.allowed and d.reason == "grantor_not_authorized"

        g_admin = _grant(org, admin, subj)  # admin human 可签发
        s.add(g_admin)
        s.commit()
        assert authorize_grant(s, subj.id, org.id, "case.read",
                               grant_id=g_admin.id).allowed

        g = _grant(org, owner, subj)
        s.add(g)
        s.commit()
        for actor in (plain, agent_admin, susp_owner, owner_b):  # member/Agent/suspended/跨机构
            with pytest.raises(AuthorizationError):
                revoke_grant(s, g.id, actor.id, expected_epoch=g.fencing_epoch)
        s.rollback()


def test_authorize_grant_scope_capability_window_epoch(db):
    """判定矩阵：关系来源、机构/案件 scope、能力命中、时间窗、status 与 fencing_epoch。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        org_b, owner_b = _member_with_org(s)
        case = _case(org, owner.id)
        case_b = _case(org_b, owner_b.id)
        s.add(case)
        s.add(case_b)
        member = _add_human(s)
        s.add(_member(org, member, role="member"))
        outsider = _add_human(s)
        s.commit()

        g_org = _grant(org, owner, member, capabilities=["case.read"])
        s.add(g_org)
        s.commit()
        d = authorize_grant(s, member.id, org.id, "case.read")
        assert d.allowed and d.grant_id == g_org.id and d.fencing_epoch == 1
        assert authorize_grant(s, member.id, org.id, " CASE.READ ").allowed  # 能力串规范化
        assert authorize_grant(s, member.id, org.id, "case.read",
                               case_id=case.id).allowed  # 机构 grant 覆盖案件 scope
        d = authorize_grant(s, member.id, org.id, "case.delete")
        assert not d.allowed and d.reason == "grant_missing"  # 能力不在清单
        with pytest.raises(AuthorizationError):
            authorize_grant(s, member.id, org.id, "bad cap")  # 含空白非法

        # 外部 Agent 只挂案件参与：案件 grant 可用，但拿不到机构 scope
        ext_agent = _add_agent(s)
        s.add(CaseParticipant(case_id=case.id, principal_id=ext_agent.id, role="agent"))
        s.commit()
        g_case = _grant(org, owner, ext_agent, case=case)
        s.add(g_case)
        s.commit()
        d = authorize_grant(s, ext_agent.id, org.id, "case.read", case_id=case.id)
        assert d.allowed and d.grant_id == g_case.id
        d = authorize_grant(s, ext_agent.id, org.id, "case.read")
        assert not d.allowed and d.reason == "relationship_missing"

        d = authorize_grant(s, outsider.id, org.id, "case.read")
        assert not d.allowed and d.reason == "relationship_missing"

        # 跨机构与缺失对象
        d = authorize_grant(s, member.id, org.id, "case.read", case_id=case_b.id)
        assert not d.allowed and d.reason == "cross_organization"
        d = authorize_grant(s, member.id, org.id, "case.read", case_id=uuid.uuid4())
        assert not d.allowed and d.reason == "case_missing"

        # 时间窗：not_before 未到 → 查无有效 grant；expires_at 已过 → grant_expired
        g_future = _grant(org, owner, member, not_before=_future(30), expires_at=_future(60))
        s.add(g_future)
        s.commit()
        d = authorize_grant(s, member.id, org.id, "case.read", grant_id=g_future.id)
        assert not d.allowed and d.reason == "grant_missing"

        g_dead = _grant(org, owner, member, not_before=_past(120), expires_at=_past(60))
        s.add(g_dead)
        s.commit()
        d = authorize_grant(s, member.id, org.id, "case.read", grant_id=g_dead.id)
        assert not d.allowed and d.reason == "grant_expired"

        # fencing_epoch：匹配放行，不匹配冲突
        assert authorize_grant(s, member.id, org.id, "case.read", expected_epoch=1).allowed
        d = authorize_grant(s, member.id, org.id, "case.read", expected_epoch=99)
        assert not d.allowed and d.reason == "grant_epoch_conflict"


def test_revoke_grant_epoch_increment_and_denial(db):
    """revoke_grant 递增 fencing_epoch；旧 epoch / 已撤销 / 不存在 grant / 撤销后判定都拒绝。"""
    with Session(db) as s:
        org, owner = _member_with_org(s)
        subj = _add_human(s)
        s.add(_member(org, subj, role="member"))
        s.commit()

        g_exp = _grant(org, owner, subj, not_before=_past(10), expires_at=_future(10))
        s.add(g_exp)
        s.commit()
        with pytest.raises(GrantConflict):
            expire_grant(s, g_exp, at=datetime.now(UTC))  # 未到期不能 expire
        s.rollback()
        expire_grant(s, g_exp, at=_future(20))
        s.commit()
        assert g_exp.status == "expired"
        d = authorize_grant(s, subj.id, org.id, "case.read", grant_id=g_exp.id, at=_future(25))
        assert not d.allowed and d.reason == "grant_expired"

        g = _grant(org, owner, subj)
        s.add(g)
        s.commit()
        with pytest.raises(GrantConflict):
            revoke_grant(s, g.id, owner.id, expected_epoch=99)  # epoch 不符
        s.rollback()

        revoke_grant(s, g.id, owner.id, expected_epoch=1)
        s.commit()
        assert g.status == "revoked" and g.fencing_epoch == 2
        assert g.revoked_at is not None and g.revoked_by_principal_id == owner.id

        d = authorize_grant(s, subj.id, org.id, "case.read", grant_id=g.id)
        assert not d.allowed and d.reason == "grant_revoked"

        d = authorize_grant(s, subj.id, org.id, "case.read", grant_id=g.id, expected_epoch=1)
        assert not d.allowed and d.reason == "grant_epoch_conflict"  # 旧 epoch 先报冲突

        with pytest.raises(GrantConflict):
            revoke_grant(s, g.id, owner.id, expected_epoch=1)  # 已撤销再撤
        s.rollback()
        with pytest.raises(GrantConflict):
            revoke_grant(s, uuid.uuid4(), owner.id, expected_epoch=1)  # 不存在
        s.rollback()
        with pytest.raises(GrantConflict):
            expire_grant(s, g)  # 非 active 不能 expire
        s.rollback()
