"""可选 webhook 通知外发（催办/S8 查新等站内信同步外推）。

URL 解析顺序：案级 settings.notify_webhook_url（设置›集成页可配）→ 环境变量
PATENT_STUDIO_NOTIFY_WEBHOOK → 日志通道兜底（INFO 落日志，永不丢通知）。
payload：{title, body, pid, href, kind, ts}——兼容 Server酱/Bark/企微通用 JSON
接收端与自建网关；外发失败只记日志不抛。
"""

import asyncio
import json
import logging
import os
import threading
import urllib.request

from app import config

log = logging.getLogger(__name__)
_URL_ENV = "PATENT_STUDIO_NOTIFY_WEBHOOK"


def _project_url(pid: str | None) -> str:
    if not pid:
        return ""
    try:
        raw = json.load(open(os.path.join(config.PROJECTS_DIR, pid, "studio.json"), encoding="utf-8"))
        return str(raw.get("notify_webhook_url") or "").strip()
    except Exception:
        return ""


def url_for(pid: str | None = None) -> str:
    return _project_url(pid) or os.environ.get(_URL_ENV, "").strip()


def configured(pid: str | None = None) -> bool:
    return bool(url_for(pid))


def _post(url: str, payload: dict) -> None:
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=8).close()
    except Exception as e:  # 外发失败不炸站内信
        log.warning("notify webhook post failed: %s", e)


def send(*, title: str, body: str = "", kind: str = "", pid: str | None = None, href: str | None = None) -> None:
    url = url_for(pid)
    payload = {"title": title, "body": body, "kind": kind, "pid": pid, "href": href}
    if not url:
        log.info("notify (webhook 未配置·日志通道): %s %s", title, body)
        return
    try:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, _post, url, payload)
    except RuntimeError:
        threading.Thread(target=_post, args=(url, payload), daemon=True).start()


def send_test(url: str) -> tuple[bool, str]:
    """「发送测试」按钮：同步 POST 一条 ping，返回 (ok, 错误信息)。"""
    payload = {
        "title": "Patent Studio 通知外发测试",
        "body": "webhook 通道联通成功",
        "kind": "test",
        "ts": int(__import__("time").time()),
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        code = urllib.request.urlopen(req, timeout=8).status
        return 200 <= code < 300, f"HTTP {code}"
    except Exception as e:
        return False, str(e)
