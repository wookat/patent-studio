# -*- coding: utf-8 -*-
"""可选邮件通知（docs/plan/21 B10）：`PATENT_STUDIO_SMTP_URL=smtp[s]://user:pass@host[:port][?from=addr]`。

未设 ⇒ `configured()` 为 False，`send()` 直接返回，不记日志、不报错。设了 ⇒ 标准库 smtplib 在线程里发送
（smtps 走 SMTP_SSL，smtp 端口非 25 时 STARTTLS）；失败只记 warning（不含 URL / 密码），不影响触发它的业务操作。
`status()` 是 /api/admin/settings 里的只读 smtp 字段：主机 / 端口 / 账号 / 发件人，密码永不出网。
"""
import asyncio
import logging
import os
import smtplib
from email.message import EmailMessage
from urllib.parse import parse_qs, unquote, urlsplit

from app.schemas import Smtp

ENV = "PATENT_STUDIO_SMTP_URL"
log = logging.getLogger("patent_studio.notify.mail")


def _url() -> str:
    return os.environ.get(ENV, "").strip()


def configured() -> bool:
    return bool(_url())


def _parse(url: str) -> tuple[Smtp, str]:
    """→ (只读状态, 密码)。"""
    u = urlsplit(url)
    ssl = u.scheme == "smtps"
    user = unquote(u.username or "")
    sender = parse_qs(u.query).get("from", [user])[0]
    port = u.port or (465 if ssl else 587)
    return Smtp(host=u.hostname or "", port=port, user=user, from_=sender, enabled=True), unquote(u.password or "")


def status() -> Smtp | None:
    url = _url()
    if not url:
        return None
    try:
        return _parse(url)[0]
    except ValueError:
        log.warning("%s 不是合法的 smtp:// 地址，邮件通知已关闭", ENV)
        return Smtp(enabled=False)


def _send_sync(url: str, to: str, subject: str, body: str) -> None:
    cfg, password = _parse(url)
    msg = EmailMessage()
    msg["From"] = cfg.from_ or cfg.user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    cls = smtplib.SMTP_SSL if url.startswith("smtps://") else smtplib.SMTP
    with cls(cfg.host, cfg.port, timeout=15) as s:
        if cls is smtplib.SMTP and cfg.port != 25:
            s.starttls()
        if cfg.user:
            s.login(cfg.user, password)
        s.send_message(msg)


async def send(to: str, subject: str, body: str) -> bool:
    """未配置 ⇒ False 且无任何输出；发送失败 ⇒ False + warning。"""
    url = _url()
    if not url or not to:
        return False
    try:
        await asyncio.to_thread(_send_sync, url, to, subject, body)
        return True
    except (OSError, smtplib.SMTPException, ValueError) as e:
        log.warning("邮件通知发送失败（%s）：%s", type(e).__name__, e)
        return False
