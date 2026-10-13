# -*- coding: utf-8 -*-
"""节假日年表 holidays/<year>.json 的读取（compute 与包入口共用，避免循环导入）。"""
import json
import os

HOLIDAYS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "holidays")


def load_holidays(year: int) -> dict:
    """读取 holidays/<year>.json；缺文件 ⇒ 空表且 verified=False（fail-closed）。"""
    p = os.path.join(HOLIDAYS_DIR, f"{year}.json")
    if not os.path.isfile(p):
        return {"year": year, "source": "", "verified": False, "holidays": [], "workdays": []}
    with open(p, encoding="utf-8") as f:
        return json.load(f)
