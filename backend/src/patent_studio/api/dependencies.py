# -*- coding: utf-8 -*-
"""会话身份依赖与统一错误壳。B2 批最小面：error + subject/CurrentUser；
DomainRoute 事务边界、Context、命令重放等随后续批次并入。"""

from typing import Annotated

from fastapi import Depends, HTTPException, Request

from patent_studio.domain.identity import User


def error(status: int, kind: str, message: str, detail=None) -> HTTPException:
    return HTTPException(status, {"kind": kind, "message": message, "line": None, "detail": detail})


async def subject(request: Request):
    """当前请求身份：off 恒 None；on 为 cookie 会话解出的 User（可空）。"""
    from patent_studio.infra import auth

    return await auth.current_user(request)


Subject = Depends(subject)
CurrentUser = Annotated[User | None, Depends(subject)]
