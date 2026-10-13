# -*- coding: utf-8 -*-
"""scripts/agent_eval.py：mock 全场景确定性判分 100%（进 make check 路径）；real 缺 key 不跑且不泄露 key。"""
import asyncio
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import agent_eval  # noqa: E402

from app import config  # noqa: E402
from app.agent import registry  # noqa: E402
from app.ai.client import AiClient  # noqa: E402
from app.ai.mock import MockProvider  # noqa: E402


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch):
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "mock")
    monkeypatch.setattr(config, "AI_KEY", "")
    registry.reset()
    yield
    registry.reset()


def test_mock_all_scenarios_all_criteria_100(tmp_path, capsys):
    out = tmp_path / "eval.json"
    rc = agent_eval.main(["--provider", "mock", "-o", str(out)])
    assert rc == 0, capsys.readouterr().err
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["provider"] == "mock" and data["models"] is None and "metrics" not in data
    assert len(data["rows"]) == len(agent_eval.CASES) * len(registry.SCENARIO_IDS)
    assert {r["scenario"] for r in data["rows"]} == set(registry.SCENARIO_IDS)
    assert all(r["status"] == "done" for r in data["rows"]), [r for r in data["rows"] if r["status"] != "done"]
    for c in agent_eval.CRITERIA:
        assert data["summary"][c]["rate"] == 1.0, (c, data["summary"][c])
    assert all(r["proposals"] >= 1 for r in data["rows"])
    printed = capsys.readouterr().out.strip().splitlines()
    assert json.loads(printed[-1]) == data["summary"]


def test_mock_single_case_single_scenario(tmp_path):
    rows = asyncio.run(agent_eval.run_one("method", "s6", AiClient(MockProvider()), str(tmp_path)))
    assert rows["case"] == "method" and rows["scenario"] == "s6" and rows["status"] == "done"
    assert set(rows["checks"]) == set(agent_eval.CRITERIA) and all(rows["checks"].values())
    assert rows["tokens"] > 0 and rows["seconds"] >= 0


def test_summary_marks_failure_and_exit_code(tmp_path, monkeypatch, capsys):
    async def bad(case, scenario, ai, workdir):
        return {"case": case, "scenario": scenario, "status": "done", "seconds": 0.0, "tokens": 0,
                "proposals": 0, "comments": 0,
                "checks": {c: c != "no_direct_write" for c in agent_eval.CRITERIA}}

    monkeypatch.setattr(agent_eval, "run_one", bad)
    rc = agent_eval.main(["--provider", "mock", "--scenario", "s6", "--case", "method"])
    assert rc == 1
    err = capsys.readouterr().err
    assert "no_direct_write" in err


def test_unknown_scenario_rejected(capsys):
    assert agent_eval.main(["--provider", "mock", "--scenario", "s11"]) == 2  # s8 已解封，非法样例换 s11
    assert "s11" in capsys.readouterr().err


def test_real_without_key_exits_2_and_never_prints_key(monkeypatch, capsys):
    monkeypatch.setattr(config, "AI_KEY", "")
    assert agent_eval.main(["--provider", "real"]) == 2
    assert "PATENT_STUDIO_AI_KEY" in capsys.readouterr().err


def test_real_metrics_has_19_fields_and_no_secret(tmp_path, monkeypatch):
    secret = "sk-agent-eval-secret-should-not-leak"
    monkeypatch.setattr(config, "AI_KEY", secret)
    calls = []

    async def fake(case, scenario, ai, workdir):
        calls.append(type(ai.provider).__name__)
        return {"case": case, "scenario": scenario, "status": "done", "seconds": 1.5, "tokens": 1234,
                "proposals": 2, "comments": 2 if scenario == "s2" else 0,
                "checks": dict.fromkeys(agent_eval.CRITERIA, True)}

    monkeypatch.setattr(agent_eval, "run_one", fake)
    out = tmp_path / "real.json"
    rc = agent_eval.main(["--provider", "real", "--case", "method", "-o", str(out)])
    assert rc == 0 and calls and set(calls) == {"OpenAICompatProvider"}
    raw = out.read_text(encoding="utf-8")
    assert secret not in raw
    data = json.loads(raw)
    assert len(data["metrics"]) == 19
    assert data["metrics"]["no_direct_write_rate"] == 1.0 and data["metrics"]["comments_per_case_e2_le_15"] is True
    assert data["metrics"]["s2_tokens_max"] == 1234 and data["metrics"]["s6_seconds_p50"] == 1.5
    assert data["models"] and "claude-sonnet-4.6" not in json.dumps(data["models"])
