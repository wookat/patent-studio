# -*- coding: utf-8 -*-
"""patent-studio CLI：当前只承载 `import`（旧文件目录 → 新模型迁移导入器）。

    patent-studio import <dir> --org <slug|uuid> --principal <uuid|email>
        [--case-key KEY] [--kind invention|utility|design]
        [--with-working-copy] [--dry-run] [--json]

数据库与对象存储默认读 PATENT_STUDIO_DATABASE_URL / PATENT_STUDIO_STORAGE_URL，
也可用 --database-url / --storage-url 覆盖。dry-run 只打印导入计划，不连库不写存储。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from patent_studio.domain.importer import (
    ImportPlanError,
    execute_import,
    plan_directory,
    resolve_organization_id,
    resolve_principal_id,
)
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import open_store
from patent_studio.settings import get_settings


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="patent-studio")
    sub = p.add_subparsers(dest="cmd", required=True)
    imp = sub.add_parser("import", help="旧案件目录导入新模型（Case + 三书 + 附图）")
    imp.add_argument("directory", help="旧案件目录（含 content.md 或 content.txt）")
    imp.add_argument("--org", required=True, help="机构 slug 或 UUID")
    imp.add_argument("--principal", required=True, help="Principal UUID 或用户 email（需为该机构 active 成员）")
    imp.add_argument("--case-key", help="案件键；缺省取目录名")
    imp.add_argument("--kind", default="invention", choices=["invention", "utility", "design"])
    imp.add_argument("--with-working-copy", action="store_true", help="为每个文稿补建 working copy")
    imp.add_argument("--dry-run", action="store_true", help="只输出导入计划，不写库不写存储")
    imp.add_argument("--json", action="store_true", dest="as_json", help="计划/结果按 JSON 输出")
    imp.add_argument("--database-url", help="覆盖 PATENT_STUDIO_DATABASE_URL")
    imp.add_argument("--storage-url", help="覆盖 PATENT_STUDIO_STORAGE_URL")
    return p


def _plan_dict(plan) -> dict:
    d = asdict(plan)
    return d


def _print_plan(plan, as_json: bool) -> None:
    if as_json:
        print(json.dumps(_plan_dict(plan), ensure_ascii=False, indent=2))
        return
    print(f"目录：{plan.source_dir}")
    print(f"标题：{plan.title}")
    for b in plan.books:
        print(f"  文稿 {b.book:<11} {b.size:>7}B  sha256={b.sha256[:16]}…")
    for fg in plan.figures:
        no = f"图{fg.figure_no}" if fg.figure_no else "摘要图"
        print(f"  附图 {no:<6} {fg.file:<20} {fg.size:>7}B  {fg.content_type}  {fg.title}")
    for s in plan.skipped:
        print(f"  跳过 {s.path}  ({s.reason})")
    for wn in plan.warnings:
        print(f"  警告 {wn}")


def _cmd_import(args) -> int:
    try:
        plan = plan_directory(args.directory)
    except ImportPlanError as e:
        print(f"导入计划失败：{e}", file=sys.stderr)
        return 2
    case_key = args.case_key or plan.source_dir.rstrip("/").rsplit("/", 1)[-1]
    if args.dry_run:
        _print_plan(plan, args.as_json)
        return 0

    settings = get_settings()
    db_url = args.database_url or settings.database_url
    storage_url = args.storage_url or settings.storage_url
    if not db_url:
        print("需要数据库：--database-url 或 PATENT_STUDIO_DATABASE_URL", file=sys.stderr)
        return 2
    if not storage_url:
        print("需要对象存储：--storage-url 或 PATENT_STUDIO_STORAGE_URL", file=sys.stderr)
        return 2

    engine = create_engine(database_url(db_url))
    try:
        with Session(engine) as session, session.begin():
            org_id = resolve_organization_id(session, args.org)
            principal_id = resolve_principal_id(session, args.principal)
            store = open_store(storage_url)
            result = asyncio.run(execute_import(
                session, store, plan,
                organization_id=org_id, principal_id=principal_id,
                case_key=case_key, kind=args.kind,
                with_working_copy=args.with_working_copy,
            ))
    except ImportPlanError as e:
        print(f"导入失败：{e}", file=sys.stderr)
        return 2
    finally:
        engine.dispose()

    if args.as_json:
        print(json.dumps({
            "status": result.status, "case_id": str(result.case_id), "case_key": result.case_key,
            "title": result.title,
            "documents": {k: str(v) for k, v in result.documents.items()},
            "revisions": {k: str(v) for k, v in result.revisions.items()},
            "figures": {k: str(v) for k, v in result.figures.items()},
            "working_copies": {k: str(v) for k, v in result.working_copies.items()},
        }, ensure_ascii=False, indent=2))
    else:
        state = "已存在（幂等命中，未重复写入）" if result.status == "existing" else "已导入"
        print(f"案件 {result.case_key} {state}：{result.case_id}")
        print(f"  文稿 {len(result.documents)} 附图 {len(result.figures)} working copy {len(result.working_copies)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.cmd == "import":
        return _cmd_import(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
