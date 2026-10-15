# -*- coding: utf-8 -*-
"""`python -m app.mcp`：stdio 传输。AUTH=off 身份为 local；
AUTH=on 读 env PATENT_STUDIO_PAT 并核验，缺失/无效 → stderr + 退出码 2。"""

import asyncio
import os
import sys

from app import config
from app.mcp.auth import CURRENT_ACTOR, LOCAL, PAT_PREFIX, verify_pat
from app.mcp.server import server


def _fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)


def _actor():
    if not config.AUTH_ON:
        return LOCAL
    token = os.environ.get("PATENT_STUDIO_PAT", "").strip()
    if not token:
        _fail("PATENT_STUDIO_AUTH=on：stdio 需要 env PATENT_STUDIO_PAT=pat_…（在「设置 › 集成」里创建）")
    if not token.startswith(PAT_PREFIX):
        _fail("PATENT_STUDIO_PAT 须以 pat_ 开头")
    actor = asyncio.run(verify_pat(token))
    if actor is None:
        _fail("PATENT_STUDIO_PAT 无效或已撤销")
    return actor


if __name__ == "__main__":
    CURRENT_ACTOR.set(_actor())
    server.run("stdio")
