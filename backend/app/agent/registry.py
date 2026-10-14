# -*- coding: utf-8 -*-
"""场景注册表（docs/plan/21 §6.2）：agent-scenarios-backend 单元用 `register()` 挂 handler，agent-core 的
loop 用 `get()` 取；两单元只经此表耦合，不互相 import。

    @register("s2")
    async def s2(ctx: "RunContext") -> None: ...

- 只接受 types.SCENARIO_IDS；FORBIDDEN_SCENARIOS 中的场景显式拒绝（s8 已解封为待检索诚实版）。
- 重复注册同一场景抛 ValueError（防两单元撞车），测试可 `reset()`。
- `available()` = 已注册场景的 ScenarioInfo（GET /agent/scenarios 用），顺序按 SCENARIOS。
"""

from collections.abc import Awaitable, Callable
from typing import Any

from app.agent.types import FORBIDDEN_SCENARIOS, SCENARIO_IDS, SCENARIOS, ScenarioInfo

# handler(ctx) -> None；ctx 由 agent-core 的 loop 定义（含 pid、job、emit_step、tools、budget、cancel token）
Handler = Callable[[Any], Awaitable[None]]

_handlers: dict[str, Handler] = {}


def validate_scenario(scenario: str) -> str:
    if scenario in FORBIDDEN_SCENARIOS:
        raise ValueError(f"场景 {scenario} 不提供（新颖性/创造性筛查无合规检索源）")
    if scenario not in SCENARIO_IDS:
        raise ValueError(f"未知场景 {scenario!r}")
    return scenario


def register(scenario: str) -> Callable[[Handler], Handler]:
    validate_scenario(scenario)

    def deco(fn: Handler) -> Handler:
        if scenario in _handlers:
            raise ValueError(f"场景 {scenario} 已注册：{_handlers[scenario].__qualname__}")
        _handlers[scenario] = fn
        return fn

    return deco


def get(scenario: str) -> Handler | None:
    return _handlers.get(validate_scenario(scenario))


def registered() -> tuple[str, ...]:
    return tuple(s.id for s in SCENARIOS if s.id in _handlers)


def available() -> list[ScenarioInfo]:
    return [s for s in SCENARIOS if s.id in _handlers]


def reset() -> None:
    """仅测试用。"""
    _handlers.clear()
