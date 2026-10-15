# -*- coding: utf-8 -*-
"""GET /api/projects/{pid}/style.css：项目排版参数 → 版面视图 CSS（16 §2）。

merge_style(p.settings["style"]) → style_css.render_css → text/css。每次请求现读 studio.json，
PUT /settings 后再 GET 即新值；Cache-Control: no-cache 让前端 bumpStyleCss 重取时不吃缓存。
"""

from fastapi import APIRouter, Request, Response

from patent_studio.kernel.style import merge_style
from patent_studio.kernel.style_css import render_css

router = APIRouter(prefix="/api/projects/{pid}", tags=["style"])


@router.get("/style.css")
async def get_style_css(pid: str, request: Request):
    p = request.app.state.store.get(pid)
    css = render_css(merge_style(p.settings.get("style")))
    return Response(css, media_type="text/css; charset=utf-8", headers={"Cache-Control": "no-cache"})
