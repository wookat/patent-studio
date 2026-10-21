"""chat 续跑回执（P05）：服务端 HMAC 签名把 continuation 绑定 pid+actor+content_sha+scope+payload。

回执结构：{v, pid, actor, sha, scope, ph, sig}
- ph = sha256(canonical({assistant, calls}))——待续跑的负载本体也盖进回执，客户端只能原样回显；
- sig = HMAC-SHA256(key, canonical(body))；
- key = 案级随机密钥 {project}/.studio/chat_receipt_key（0600，首次生成 32B）
  混入 PATENT_STUDIO_SECRET（AUTH=on 时）——本地文件模式同样不可伪造，跨案不可复用。
验证顺序：签名 → 案卷/身份 → 正文版本 → 负载哈希 → scope 覆盖（stored ⊆ current）。
任何不符都 409 冲突，且发生在调用模型之前（零上游）。
"""

import hashlib
import hmac
import json
import os
import secrets

from fastapi import HTTPException

from app import config
from app.errors import error_detail

UNIT = "E1-ai-client"


def _key(store, pid: str) -> bytes:
    """案级回执密钥：.studio/chat_receipt_key（0600）。混入全局会话密钥后作为 HMAC key。"""
    p = store.get(pid)
    d = os.path.join(p.dir, ".studio")
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, "chat_receipt_key")
    try:
        with open(f, "rb") as fh:
            k = fh.read()
        if len(k) >= 32:
            base = k
        else:
            base = None
    except FileNotFoundError:
        base = None
    if base is None:
        base = secrets.token_bytes(32)
        try:
            fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(base)
        except FileExistsError:
            # 复核8：并发首次签名——另一方已写同一 key，重读共享而不是各用各的/随机 500
            try:
                with open(f, "rb") as fh:
                    base = fh.read()
            except OSError as e:
                raise HTTPException(500, error_detail("internal", "回执密钥状态损坏，请重试", detail=UNIT)) from e
            if len(base) < 32:
                raise HTTPException(500, error_detail("internal", "回执密钥状态损坏，请重试", detail=UNIT))
    return base + (config.AUTH_SECRET or "").encode()


def _canon(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


def _payload_hash(payload: dict) -> str:
    return hashlib.sha256(_canon({"assistant": payload.get("assistant"), "calls": payload.get("calls")})).hexdigest()


def _scope_norm(scope: dict | None) -> dict:
    s = scope or {}
    return {"source": s.get("source"), "materials": sorted(s.get("materials") or [])}


def sign_receipt(store, pid: str, actor: str | None, content_sha: str, scope: dict, payload: dict) -> dict:
    """服务端在 confirm 事件里盖章的续跑回执。"""
    body = {
        "v": 1,
        "pid": pid,
        "actor": actor,
        "sha": content_sha,
        "scope": _scope_norm(scope),
        "ph": _payload_hash(payload),
    }
    sig = hmac.new(_key(store, pid), _canon(body), hashlib.sha256).hexdigest()
    return {**body, "sig": sig}


def scope_covers(current: dict | None, required: dict | None) -> bool:
    """当前授权是否覆盖回执声明的授权（stored ⊆ current）。
    复核8：lines 是真实区间授权——换书/换选区/范围缩小都不被覆盖：
    - req full  ⇒ cur 必须 full
    - req book（无 lines）⇒ cur full，或 cur 同书且无更窄 lines（全书授权才可覆盖全书）
    - req lines [a,b] ⇒ cur full；或 cur 同书无 lines（全书覆盖行段）；或 cur 同书
      lines [a2,b2] 且 a2≤a 且 b2≥b（区间真包含）
    """
    req = required or {}
    src_req, src_cur = req.get("source"), (current or {}).get("source")
    if src_req is not None:
        if src_cur is None:
            return False
        if src_req.get("full"):
            if not src_cur.get("full"):
                return False
        elif src_req.get("lines"):
            a, b = src_req["lines"]
            if src_cur.get("full"):
                pass
            elif src_cur.get("book") == src_req.get("book") and not src_cur.get("lines"):
                pass  # 同书全书授权覆盖其内任意行段
            else:
                cl = src_cur.get("lines")
                if not (
                    src_cur.get("book") == src_req.get("book") and isinstance(cl, list) and cl[0] <= a and cl[1] >= b
                ):
                    return False
        elif src_req.get("book"):
            if not (src_cur.get("full") or (src_cur.get("book") == src_req.get("book") and not src_cur.get("lines"))):
                return False
    return set(req.get("materials") or []) <= set((current or {}).get("materials") or [])


def verify_receipt(store, pid: str, actor: str | None, content_sha: str, scope: dict, resume: dict) -> dict:
    """校验客户端回显的续跑负载，返回 {assistant, calls}；任何不符 → 409。"""
    rec = resume.get("receipt") if isinstance(resume, dict) else None
    payload = {"assistant": resume.get("assistant"), "calls": resume.get("calls")} if isinstance(resume, dict) else {}
    if not isinstance(rec, dict) or not rec.get("sig"):
        raise HTTPException(409, error_detail("conflict", "续跑回执缺失或来自旧版本——请开始新对话", detail=UNIT))
    body = {k: rec.get(k) for k in ("v", "pid", "actor", "sha", "scope", "ph")}
    sig = hmac.new(_key(store, pid), _canon(body), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, str(rec["sig"])):
        raise HTTPException(409, error_detail("conflict", "续跑回执被篡改或来源不明", detail=UNIT))
    if rec["pid"] != pid or rec["actor"] != actor:
        raise HTTPException(409, error_detail("conflict", "续跑回执与当前案卷或身份不符", detail=UNIT))
    if rec["sha"] != content_sha:
        raise HTTPException(409, error_detail("conflict", "正文版本已变化，续跑被拒绝——请开启新对话", detail=UNIT))
    if rec["ph"] != _payload_hash(payload):
        raise HTTPException(409, error_detail("conflict", "续跑负载与回执不符（工具或参数被改动）", detail=UNIT))
    if not scope_covers(scope, rec["scope"]):
        raise HTTPException(
            409, error_detail("conflict", "上下文范围已缩小，旧任务不可续跑——请开始新对话", detail=UNIT)
        )
    return payload
