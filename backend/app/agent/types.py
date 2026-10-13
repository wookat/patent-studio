# -*- coding: utf-8 -*-
"""智能体契约（docs/plan/21 §6.2 / §6.3）；与 frontend/src/types/agent.ts 逐字段对应。

prep 只定形状；agent-core-backend 单元的 loop / tools / budget / proposals 以此为准，不得另造同名模型。
S8（新颖性 / 创造性筛查）无合规检索源：不在 Scenario 内，不注册，不展示。
"""
import time
from typing import Literal

from pydantic import BaseModel, Field

Scenario = Literal["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"]
SCENARIO_IDS: tuple[str, ...] = ("s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10")
# 被封印的场景：有 ID 但禁止注册/调用。S8 曾封印（R-AI-S8 无合规检索源），解封为「待检索」诚实版：
# 只产发明点+检索式+待确认项（comment），不伪造检索结论；真实检索待合规源接入后升级同一场景。
FORBIDDEN_SCENARIOS: frozenset[str] = frozenset()

Weight = Literal["heavy", "interactive"]
MinRole = Literal["viewer", "reviewer", "editor"]
ProposalKind = Literal["critic", "comment", "patch"]
ProposalState = Literal["pending", "applied", "dismissed"]
StepEventKind = Literal["plan", "tool_call", "tool_result", "gen_delta", "check", "proposal", "done"]
BookName = Literal["abstract", "claims", "description"]

# 上下文硬上限（字符）；agent/budget.py 是唯一裁剪点（R-AI-08）
CONTEXT_MAX_CHARS = 40_000
# 每案日 token 预算缺省见 config.AI_DAILY_TOKENS（env 可覆盖），不在本模块另立常量
# 模型全局并发缺省（AI_CONCURRENCY 环境变量可覆盖）
CONCURRENCY_DEFAULT = 2


def heavy_queue_key(pid: str) -> str:
    """heavy 场景排 `{pid}:heavy` FIFO（同案串行，跨案并行受全局并发限制）。"""
    return f"{pid}:heavy"


def job_kind(scenario: str) -> str:
    return f"agent:{scenario}"


class ScenarioInfo(BaseModel):
    id: Scenario
    label: str
    hint: str
    produces: list[ProposalKind]
    weight: Weight
    min_role: MinRole = Field(alias="minRole")

    model_config = {"populate_by_name": True}


# 与 frontend/src/types/agent.ts SCENARIOS 同序同值（测试 test_w5_prep 对照）
SCENARIOS: tuple[ScenarioInfo, ...] = (
    ScenarioInfo(id="s1", label="交底书 → 三书初稿", hint="规划大纲后分书成稿（新案走导入管线，现案生成新块）",
                 produces=["patch"], weight="heavy", minRole="editor"),
    ScenarioInfo(id="s2", label="权项树批评", hint="逐独权检查支持性 / 清楚性 / 先行词，批注引 [00NN]",
                 produces=["comment"], weight="heavy", minRole="viewer"),
    ScenarioInfo(id="s3", label="支持性补全", hint="从批评结果补写说明书支持段（修订建议）",
                 produces=["critic"], weight="interactive", minRole="reviewer"),
    ScenarioInfo(id="s4", label="术语一致性", hint="确定性候选 + 选主术语，生成 {~~旧~>新~~}",
                 produces=["critic"], weight="interactive", minRole="reviewer"),
    ScenarioInfo(id="s5", label="附图标记对齐", hint="附图标记与说明书差分并解释",
                 produces=["comment"], weight="interactive", minRole="viewer"),
    ScenarioInfo(id="s6", label="摘要生成", hint="读权项与说明书生成 ≤300 字摘要",
                 produces=["critic", "patch"], weight="interactive", minRole="reviewer"),
    ScenarioInfo(id="s7", label="OA 争辩稿", hint="每条审查意见生成争辩要点，可选修改权项建议",
                 produces=["comment", "critic"], weight="heavy", minRole="reviewer"),
    ScenarioInfo(id="s8", label="查新笔记", hint="读三书提发明点与建议检索式，产出待检索查新笔记批注",
                 produces=["comment"], weight="interactive", minRole="viewer"),
    ScenarioInfo(id="s9", label="双语翻译", hint="分书翻译为 docs/<book>.en.md 并回译校验",
                 produces=["patch"], weight="interactive", minRole="editor"),
    ScenarioInfo(id="s10", label="客户简报", hint="生成 docs/brief.md 面向客户的简报",
                 produces=["patch"], weight="interactive", minRole="editor"),
)
SCENARIO_BY_ID: dict[str, ScenarioInfo] = {s.id: s for s in SCENARIOS}


# ---------- 步骤事件（SSE 每帧；job.steps 存摘要，不存 gen 全文） ----------

class StepEvent(BaseModel):
    seq: int
    kind: StepEventKind
    ts: float
    data: dict = Field(default_factory=dict)


def step_event(seq: int, kind: str, data: dict | None = None, ts: float | None = None) -> StepEvent:
    return StepEvent(seq=seq, kind=kind, ts=ts if ts is not None else time.time(), data=dict(data or {}))


class CheckResult(BaseModel):
    name: str
    ok: bool
    why: str = ""


class Usage(BaseModel):
    prompt: int = 0
    completion: int = 0


class BlockAnchor(BaseModel):
    book: BookName
    block_id: str
    line_start: int
    line_end: int


class FileAnchor(BaseModel):
    file: str


Anchor = BlockAnchor | FileAnchor


class PatchBlock(BaseModel):
    after_block_id: str
    markdown: str
    replace_block_id: str | None = None


class BlocksPatch(BaseModel):
    blocks: list[PatchBlock]


class FilePatch(BaseModel):
    file: str
    content: str


Patch = BlocksPatch | FilePatch


class Proposal(BaseModel):
    """永不直接改 content.md 最终文本：critic → 用户点「写入为修订」；comment → 批注；patch → 用户点「应用」。"""
    id: str
    job_id: str
    scenario: Scenario
    kind: ProposalKind
    anchor: Anchor
    critic_markdown: str | None = None
    comment_body: str | None = None
    patch: Patch | None = None
    checks: list[CheckResult] = Field(default_factory=list)
    model: str
    usage: Usage = Field(default_factory=Usage)
    created_at: float
    state: ProposalState = "pending"


class ProposalsResponse(BaseModel):
    proposals: list[Proposal]


class AgentRunIn(BaseModel):
    scenario: Scenario
    params: dict = Field(default_factory=dict)


class ChangedLines(BaseModel):
    start: int
    end: int


class ProposalApplyResult(BaseModel):
    proposal: Proposal
    content: str | None = None
    changed_lines: ChangedLines | None = None
    backup: str | None = None
    skipped_blocks: list[str] = Field(default_factory=list)


class AgentJobOut(BaseModel):
    """现有 AiJob + steps / queue_key（kind 增 `agent:<scenario>`）；routes_ai 的 job JSON 即此形状。"""
    id: str
    kind: str
    pid: str
    status: Literal["queued", "running", "done", "error", "interrupted"]
    progress: float
    message: str
    result: dict | None = None
    error: dict | None = None
    created_at: float
    updated_at: float
    steps: list[StepEvent] = Field(default_factory=list)
    queue_key: str | None = None


class AgentJobsResponse(BaseModel):
    jobs: list[AgentJobOut]
