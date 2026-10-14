# -*- coding: utf-8 -*-
"""管理员开号 / 重置密码 CLI（无 SMTP，07 §1/§10）。

    cd backend && uv run python -m app.auth.create_user admin@example.com '密码' [--display-name 张三] [--superuser]
    cd backend && uv run python -m app.auth.create_user someone@example.com '新密码' --reset

DB 位置随 PATENT_PROJECTS_DIR（同级 studio.db）；不需要 PATENT_STUDIO_AUTH=on 或 PATENT_STUDIO_SECRET。
第一个用户自动 superuser。
"""

import argparse
import asyncio
import sys

from fastapi_users.db import SQLAlchemyUserDatabase

from app import config
from app.auth.db import SessionLocal, UserManager, init_db
from app.auth.models import User
from app.auth.schemas import UserCreate


async def _run(args) -> int:
    await init_db()
    async with SessionLocal() as session:
        manager = UserManager(SQLAlchemyUserDatabase(session, User))
        existing = await manager.user_db.get_by_email(args.email)
        if args.reset:
            if existing is None:
                print(f"用户不存在：{args.email}", file=sys.stderr)
                return 1
            await manager.user_db.update(existing, {"hashed_password": manager.password_helper.hash(args.password)})
            print(f"已重置密码：{existing.email}")
            return 0
        if existing is not None:
            print(f"用户已存在：{args.email}（重置密码加 --reset）", file=sys.stderr)
            return 1
        user = await manager.create(
            UserCreate(
                email=args.email, password=args.password, display_name=args.display_name, is_superuser=args.superuser
            )
        )
        await session.refresh(user)
        print(f"已创建：{user.email} superuser={user.is_superuser} db={config.DB_PATH}")
        return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m app.auth.create_user", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("email")
    ap.add_argument("password")
    ap.add_argument("--display-name", default="")
    ap.add_argument("--superuser", action="store_true", help="强制 superuser（第一个用户本就自动是）")
    ap.add_argument("--reset", action="store_true", help="已存在用户：重置密码")
    return asyncio.run(_run(ap.parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
