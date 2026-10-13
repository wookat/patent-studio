# -*- coding: utf-8 -*-
"""法定期限规则引擎（docs/plan/21-w5-spec.md §1.3 A1/A2，§2.1 R-HOME-05）。

规则表 rules.json（每条 id / kind / title / base_date / offset / delivery / legal_basis{law,article,url}）；
计算全部按 Asia/Shanghai 的日历日：
- 细则第四条：邮寄文件自发文日起满 15 日推定送达；电子送达以进入电子系统之日（= 发文日）为送达日；
- 细则第五条：起算当日不计，按月/年计算以最后一月相应日届满、无相应日取月末；
  届满日是法定休假日的顺延到休假日后第一个工作日 —— 周末与 holidays/<year>.json 的 holidays 都算休假日，
  workdays（调休上班的周末）算工作日；
- 年表缺失或 verified=false 时只按周末顺延，并把 holidays_verified=False 带出去（响应里的 holidays_missing）。
"""
import calendar
import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from app import config
from app.deadlines.tables import load_holidays

RULES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json")
MAIL_DAYS = 15

Delivery = Literal["electronic", "mail"]
BaseDate = Literal["dates.filed", "effective_filing", "priority", "dates.grant", "event"]


@dataclass(frozen=True)
class LegalBasis:
    law: str
    article: str
    url: str

    @property
    def text(self) -> str:
        return f"{self.law} {self.article}"


@dataclass(frozen=True)
class Rule:
    id: str
    kind: str
    title: str
    base_date: BaseDate
    offset: dict
    delivery: bool
    legal_basis: LegalBasis


@dataclass(frozen=True)
class Computed:
    due: date
    base: date
    holidays_verified: bool


def _load_rules() -> dict[str, Rule]:
    with open(RULES_FILE, encoding="utf-8") as f:
        data = json.load(f)
    out: dict[str, Rule] = {}
    for r in data["rules"]:
        out[r["id"]] = Rule(id=r["id"], kind=r["kind"], title=r["title"], base_date=r["base_date"],
                            offset=r["offset"], delivery=r["delivery"], legal_basis=LegalBasis(**r["legal_basis"]))
    return out


RULES: dict[str, Rule] = _load_rules()


def rule(rule_id: str) -> Rule:
    if rule_id not in RULES:
        raise KeyError(f"未知期限规则：{rule_id}")
    return RULES[rule_id]


def today() -> date:
    return datetime.now(config.TZ).date()


def add_months(d: date, months: int) -> date:
    """细则第五条：最后一月相应日届满；该月无相应日取该月最后一日。"""
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def deemed_received(issued: date, delivery: Delivery) -> date:
    """细则第四条：邮寄 = 发文日 + 15 日推定收到；电子送达 = 发文日。"""
    return issued + timedelta(days=MAIL_DAYS) if delivery == "mail" else issued


def _table(year: int, cache: dict[int, dict]) -> dict:
    if year not in cache:
        cache[year] = load_holidays(year)
    return cache[year]


def holidays_verified(year: int) -> bool:
    return bool(load_holidays(year)["verified"])


def is_workday(d: date, cache: dict[int, dict] | None = None) -> bool:
    t = _table(d.year, cache if cache is not None else {})
    s = d.isoformat()
    if t["verified"]:
        if s in t["workdays"]:
            return True
        if s in t["holidays"]:
            return False
    return d.weekday() < 5


def roll_forward(d: date) -> tuple[date, bool]:
    """届满日落在休假日 ⇒ 顺延到下一个工作日。返回 (顺延后日期, 涉及年份的节假日表是否全部已核对)。"""
    cache: dict[int, dict] = {}
    while not is_workday(d, cache):
        d += timedelta(days=1)
    verified = all(t["verified"] for t in cache.values())
    return d, verified


def raw_due(rule_: Rule, base: date, *, anniversary_of: date | None = None) -> date:
    off = rule_.offset
    if "anniversary_of" in off:
        if anniversary_of is None:
            raise ValueError(f"规则 {rule_.id} 需要 {off['anniversary_of']} 作为周年基准")
        years = base.year - anniversary_of.year
        d = add_months(anniversary_of, 12 * years)
        return d if d > base else add_months(anniversary_of, 12 * (years + 1))
    if "years" in off:
        return add_months(base, 12 * off["years"])
    if "months" in off:
        return add_months(base, off["months"])
    return base + timedelta(days=off["days"])


def compute(rule_: Rule, base: date, *, delivery: Delivery | None = None,
            anniversary_of: date | None = None, extension_months: int = 0) -> Computed:
    """base = 规则 base_date 所指的日期（event 类规则为发文日，delivery 决定推定送达日）。
    extension_months：已批准的延长期限月数（细则第六条，OA 答复累计 ≤ 2 个月），先加月再顺延。"""
    start = deemed_received(base, delivery or "electronic") if rule_.delivery else base
    raw = raw_due(rule_, start, anniversary_of=anniversary_of)
    if extension_months:
        raw = add_months(raw, extension_months)
    due, verified = roll_forward(raw)
    return Computed(due=due, base=base, holidays_verified=verified)
