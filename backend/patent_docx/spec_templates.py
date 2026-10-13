"""计算机类发明专利附图图型分类法 + .spec 模板库（132 篇真实专利 916 题注统计）。

采样：Google Patents 计算机域（G06F/G06N/G06V/G06T/G06Q/H04L）专利 167 篇，
其中 132 篇含完整附图说明、登记题注 916 条（专利均图数≈6.9）。
覆盖：神经网络、图像识别、语音、区块链、推荐、加密、调度、自动驾驶、
医学影像、大模型/NLP、数据库、视频直播、物联网、数据通信等方向。

真实分布（按题注数占比 / 按专利覆盖率）：
  B 流程图        30.3% / 80% —— 方法权利要求主图，一案常 3-10 张分过程图
  A2 模块分解图    32.6% / 76% —— 装置/系统权利要求主图，与流程图双雄
  A1 系统架构图    9.1%  / 31% —— 应用环境/系统组成/拓扑，常任图1
  A4 模型结构图    6.8%  / 15% —— NN/算法拓扑（AI 案高频）
  A5 设备/介质图   5.6%  / 24% —— 设备/存储介质/程序产品权项载体框图
  E2 界面图        2.7%  / 7%  —— UI/显示界面（位图域）
  D 状态图         1.6%  / 3%
  C1 交互图        1.2%  / 5%
  E1 数据结构图    1.0%  / 4%
  F 曲线/数据图表  0.9%  / 3%  —— CNIPA 禁仅凭此类附图（位图域）
  A3 分层架构      0.8%  / 2%
  G 样例/对象图    0.8%  / 3%  —— 输入对象示意（胸片/车辆等，位图域）
  C2 时序/泳道     0.5%  / 3%
  B3 数据流        0.2%  / 1%
  （另：现有技术对照图散见各案图1-2，形态同其底层图型）
长尾 ≈ 63% 的图集中在「流程图+结构框图」两类——模板优先级即按此排。

统一归类（spec 可达性标注）：
  A 结构/框图类
    A0 应用环境图      —— 端-云-端实施环境（最常见图1）          spec: env_scene
    A1 系统架构图      —— 系统边界内模块互连                    spec: system_arch
    A2 模块分解图      —— 一模块拆子单元                        spec: module_decomp
    A3 分层架构图      —— 软硬/协议/服务分层堆叠                spec: layered_arch
    A4 模型结构图      —— NN/算法拓扑                          spec: model_arch
    A5 设备/介质/产品图 —— 权项载体框图                        spec: device_box
  B 流程图类
    B1 方法主流程      —— S101→Sn 单链直排                      spec: method_flow
    B2 分支流程        —— 含判据菱形+是/否回环                  spec: branch_flow
    B3 数据流流程      —— 采集→处理→输出带数据标注边            spec: data_flow
    B4 状态机流程      —— 步骤即状态的状态转移                  spec: state_flow
  C 交互/时序类
    C1 模块交互图      —— 同层多方块+带标注消息边               spec: interaction
    C2 时序/泳道图     —— 参与方分层、自上而下时间推进          spec: sequence
  D 状态图类
    D1 状态机图        —— 状态块+触发标注转移边                spec: state_diagram
  E 界面/数据结构类
    E1 数据结构图      —— 记录/字段横排+关联标注               spec: data_struct
    E2 UI 界面图      —— 超出 spec 表达域→走位图上传+标注模式
  F 数据图表类
    F1 曲线/效果图    —— 超出 spec 表达域→走位图上传（CNIPA 禁仅此类附图）
  G 样例类
    G1 输入对象示意图  —— 待处理对象样例（位图域）

每个模板是可渲染的 .spec 骨架（占位文案示意），模型按图型套骨架改文案。
"""
from __future__ import annotations

# 模板骨架——占位 label 展示结构，实际图按文案替换；标号惯例三位数 101 起。
TEMPLATES: dict[str, dict] = {
    # A0 应用环境图：端-云-端实施环境（真实专利中最常见的图1 形态）
    "env_scene": {
        "kind": "A0 应用/实施环境示意图",
        "when": "系统运行环境总览（终端—网络—服务器，最常作图1）",
        "spec": {"bands": [
            {"title": "", "blocks": [
                {"id": "T1", "label": "用户终端 101"},
                {"id": "T2", "label": "采集终端 102"}]},
            {"title": "", "blocks": [{"id": "NET", "label": "通信网络 103"}]},
            {"title": "", "blocks": [{"id": "SVR", "label": "服务器 104"}]}],
            "edges": [
            {"from": "T1", "to": "NET"}, {"from": "T2", "to": "NET"},
            {"from": "NET", "to": "SVR"}]},
    },
    # A1 系统架构图：边界内模块互连，输入→核心处理→输出，辅助数据虚线
    "system_arch": {
        "kind": "A1 系统/装置架构图",
        "when": "系统、装置、平台类权利要求的总览图（通常作图1）",
        "spec": {"bands": [
            {"title": "输入", "blocks": [{"id": "IN", "label": "数据输入单元 101"}]},
            {"title": "处理", "blocks": [{"id": "A", "label": "第一处理模块 102"},
                                        {"id": "B", "label": "第二处理模块 103"}]},
            {"title": "输出", "blocks": [{"id": "OUT", "label": "结果输出模块 104"}]}],
            "edges": [
            {"from": "IN", "to": "A"}, {"from": "A", "to": "B"},
            {"from": "B", "to": "OUT"},
            {"from": "B", "to": "A", "label": "控制参数", "dashed": True}]},
    },
    # A2 模块分解图：一个模块拆成子单元，同层并置
    "module_decomp": {
        "kind": "A2 模块组成/分解示意图",
        "when": "说明书展开某一模块内部构成时",
        "spec": {"bands": [
            {"title": "XX模块 100", "blocks": [
                {"id": "S1", "label": "第一子单元 101"},
                {"id": "S2", "label": "第二子单元 102"},
                {"id": "S3", "label": "第三子单元 103"}]}],
            "edges": [
            {"from": "S1", "to": "S2"}, {"from": "S2", "to": "S3"}]},
    },
    # A3 分层架构图：应用/服务/数据/硬件层垂直堆叠
    "layered_arch": {
        "kind": "A3 分层架构示意图",
        "when": "软硬件分层、协议栈、服务分层（应用/服务/数据/硬件）",
        "spec": {"bands": [
            {"title": "应用层", "blocks": [{"id": "L1", "label": "应用接口模块 101"}]},
            {"title": "服务层", "blocks": [{"id": "L2", "label": "业务处理模块 102"},
                                         {"id": "L2b", "label": "调度模块 103"}]},
            {"title": "数据层", "blocks": [{"id": "L3", "label": "存储访问模块 104"}]},
            {"title": "硬件层", "blocks": [{"id": "L4", "label": "硬件资源 105"}]}],
            "edges": [
            {"from": "L1", "to": "L2"}, {"from": "L2", "to": "L3"},
            {"from": "L2b", "to": "L3"}, {"from": "L3", "to": "L4"}]},
    },
    # A4 模型/算法结构图：数据流阶段分层 + 并行支路 + 虚线辅助线
    "model_arch": {
        "kind": "A4 模型/算法结构图",
        "when": "神经网络/算法管线（编码→融合→输出头），AI 论文转专利主力",
        "spec": {"bands": [
            {"title": "输入", "blocks": [{"id": "X", "label": "多视图输入"}]},
            {"title": "编码", "blocks": [{"id": "E1", "label": "特征编码模块 101"},
                                       {"id": "E2", "label": "辅助编码模块 102"}]},
            {"title": "融合", "blocks": [{"id": "F", "label": "特征融合模块 103"}]},
            {"title": "输出", "blocks": [{"id": "G", "label": "结果输出模块 104"}]}],
            "edges": [
            {"from": "X", "to": "E1"}, {"from": "X", "to": "E2"},
            {"from": "E1", "to": "F"}, {"from": "E2", "to": "F"},
            {"from": "F", "to": "G"},
            {"from": "E2", "to": "E1", "label": "共享参数", "dashed": True}]},
    },
    # A5 设备/介质/产品框图：权项载体（处理器+存储器+总线 三件套）
    "device_box": {
        "kind": "A5 计算设备/存储介质/程序产品框图",
        "when": "设备/介质/程序产品权利要求的载体图（微软案惯例）",
        "spec": {"bands": [
            {"title": "", "blocks": [
                {"id": "CPU", "label": "处理器 101"},
                {"id": "MEM", "label": "存储器 102"},
                {"id": "BUS", "label": "总线 103"}]}],
            "edges": [
            {"from": "CPU", "to": "BUS"}, {"from": "MEM", "to": "BUS"}]},
    },
    # B1 方法主流程：单块逐层直排（每层一个 S10N 步骤）
    "method_flow": {
        "kind": "B1 方法流程图",
        "when": "方法权利要求对应步骤链（最常用，可拆多张子流程）",
        "spec": {"bands": [
            {"title": "", "blocks": [{"id": "S1", "label": "S101 获取输入数据"}]},
            {"title": "", "blocks": [{"id": "S2", "label": "S102 预处理"}]},
            {"title": "", "blocks": [{"id": "S3", "label": "S103 核心处理"}]},
            {"title": "", "blocks": [{"id": "S4", "label": "S104 输出结果"}]}],
            "edges": [
            {"from": "S1", "to": "S2"}, {"from": "S2", "to": "S3"},
            {"from": "S3", "to": "S4"}]},
    },
    # B2 分支流程：判据菱形 + 是/否分支 + 虚线回环
    "branch_flow": {
        "kind": "B2 分支/判据流程图",
        "when": "含条件判据的方法（菱形+是/否分支+不满足时回环）",
        "spec": {"bands": [
            {"title": "", "blocks": [{"id": "S1", "label": "S101 获取数据"}]},
            {"title": "", "blocks": [{"id": "S2", "label": "S102 初步处理"}]},
            {"title": "", "blocks": [{"id": "D", "label": "S103 是否满足条件",
                                     "shape": "diamond"}]},
            {"title": "", "blocks": [{"id": "S4", "label": "S104 满足时处理"}]},
            {"title": "", "blocks": [{"id": "S5", "label": "S105 输出结果"}]}],
            "edges": [
            {"from": "S1", "to": "S2"}, {"from": "S2", "to": "D"},
            {"from": "D", "to": "S4", "label": "是"},
            {"from": "S4", "to": "S5"},
            {"from": "D", "to": "S1", "label": "否", "dashed": True}]},
    },
    # B3 数据流流程：阶段分层 + 边上写数据名
    "data_flow": {
        "kind": "B3 数据/工作流流程图",
        "when": "数据在阶段间流转（采集→处理→输出），边标注数据名",
        "spec": {"bands": [
            {"title": "采集", "blocks": [{"id": "C1", "label": "数据采集单元 101"}]},
            {"title": "处理", "blocks": [{"id": "P1", "label": "清洗模块 102"},
                                       {"id": "P2", "label": "特征提取模块 103"}]},
            {"title": "输出", "blocks": [{"id": "O1", "label": "结果存储模块 104"}]}],
            "edges": [
            {"from": "C1", "to": "P1", "label": "原始数据"},
            {"from": "P1", "to": "P2", "label": "清洗数据"},
            {"from": "P2", "to": "O1", "label": "特征向量"}]},
    },
    # B4 状态机流程：步骤即状态、触发即边（可与 method_flow 混用）
    "state_flow": {
        "kind": "B4 状态机流程图",
        "when": "状态驱动的处理（防护激活→监控→解除），步骤即状态",
        "spec": {"bands": [
            {"title": "", "blocks": [{"id": "T1", "label": "S101 初始状态"}]},
            {"title": "", "blocks": [{"id": "T2", "label": "S102 激活状态"}]},
            {"title": "", "blocks": [{"id": "T3", "label": "S103 监控状态"}]},
            {"title": "", "blocks": [{"id": "T4", "label": "S104 解除状态"}]}],
            "edges": [
            {"from": "T1", "to": "T2", "label": "触发"},
            {"from": "T2", "to": "T3", "label": "进入监控"},
            {"from": "T3", "to": "T4", "label": "超时解除"},
            {"from": "T3", "to": "T2", "label": "再激活", "dashed": True}]},
    },
    # C1 模块交互图：同层多方 + 标注消息边
    "interaction": {
        "kind": "C1 模块交互示意图",
        "when": "多模块/多角色协同（客户端-服务端-数据端互调）",
        "spec": {"bands": [
            {"title": "", "blocks": [
                {"id": "U", "label": "用户终端 101"},
                {"id": "S", "label": "服务端 102"},
                {"id": "D", "label": "数据端 103"}]}],
            "edges": [
            {"from": "U", "to": "S", "label": "请求"},
            {"from": "S", "to": "D", "label": "查询"},
            {"from": "D", "to": "S", "label": "数据"},
            {"from": "S", "to": "U", "label": "响应"}]},
    },
    # C2 时序/泳道近似：参与方各一层，自上而下=时间推进
    "sequence": {
        "kind": "C2 时序/泳道示意图",
        "when": "多端交互有先后（前端→网关→后端），层=参与方、序=时间",
        "spec": {"bands": [
            {"title": "前端", "blocks": [{"id": "F1", "label": "发起请求 101"}]},
            {"title": "服务端", "blocks": [{"id": "S1", "label": "校验并转发 102"}]},
            {"title": "数据端", "blocks": [{"id": "D1", "label": "查询返回 103"}]},
            {"title": "服务端", "blocks": [{"id": "S2", "label": "组装响应 104"}]},
            {"title": "前端", "blocks": [{"id": "F2", "label": "展示结果 105"}]}],
            "edges": [
            {"from": "F1", "to": "S1", "label": "请求"},
            {"from": "S1", "to": "D1", "label": "查询"},
            {"from": "D1", "to": "S2", "label": "结果"},
            {"from": "S2", "to": "F2", "label": "响应"}]},
    },
    # D1 状态机图：同层状态块 + 触发标注边 + 虚线回环
    "state_diagram": {
        "kind": "D1 状态机/状态图",
        "when": "有限状态集合+转移条件（协议/控制器/状态对象）",
        "spec": {"bands": [
            {"title": "", "blocks": [
                {"id": "A", "label": "待机状态 101"},
                {"id": "B", "label": "工作状态 102"},
                {"id": "C", "label": "暂停状态 103"}]}],
            "edges": [
            {"from": "A", "to": "B", "label": "启动"},
            {"from": "B", "to": "C", "label": "暂停"},
            {"from": "C", "to": "B", "label": "恢复"},
            {"from": "B", "to": "A", "label": "结束", "dashed": True}]},
    },
    # E1 数据结构图：字段横排 + 关联标注
    "data_struct": {
        "kind": "E1 数据结构/字段示意图",
        "when": "记录/消息/表结构（字段组成+类型标注）",
        "spec": {"bands": [
            {"title": "XX记录", "blocks": [
                {"id": "f1", "label": "字段一 101"},
                {"id": "f2", "label": "字段二 102"},
                {"id": "f3", "label": "字段三 103"}]}],
            "edges": [
            {"from": "f1", "to": "f2", "label": "关联"},
            {"from": "f2", "to": "f3", "label": "关联"}]},
    },
}

# 超 spec 表达域的图型——不走模板（走位图上传 + 画板标注模式）
OUT_OF_SCOPE = {
    "ui_mockup": "E2 UI 界面示意图——像素级版式，用上传附图+「画板改图」标注模式",
    "curve_chart": "F1 曲线/效果对比图——需坐标轴，CNIPA 亦禁仅凭此类图，用位图",
    "sample_image": "G1 输入对象示意图——胸片/场景照片等样例，用位图上传",
}


def catalog() -> str:
    """给提示词用的紧凑模板目录（图型名 → 何时用）。"""
    lines = []
    for name, t in TEMPLATES.items():
        lines.append(f"{name}={t['kind']}（{t['when']}）")
    out = "；".join(lines)
    out += ("；界面/曲线类图不属 spec 域（走位图）。"
            "选用后保留骨架、替换成本案文案与标号即可。")
    return out


_EXEMPLAR_CACHE: list[str] | None = None


def _manifest_path():
    from pathlib import Path
    return Path(__file__).resolve().parents[2] / "docs" / "figure-library" / "manifest.json"


def exemplar_captions(per_kind: int = 2, max_kinds: int = 8) -> str:
    """真实专利附图题注参照——从 docs/figure-library/manifest.json 按图型抽样。

    模型不读图，真实题注是它能直接模仿的参照（图型命名习惯 + 一案图型配比）。
    manifest 缺失（如裁剪部署）返回 ""。结果进程内缓存，确定性抽样。
    """
    global _EXEMPLAR_CACHE
    if _EXEMPLAR_CACHE is None:
        import json
        _EXEMPLAR_CACHE = []
        p = _manifest_path()
        if p.exists():
            try:
                import re
                figs = json.loads(p.read_text(encoding="utf-8"))["figures"]
                kinds: dict[str, list[str]] = {}
                for e in figs:
                    cap = (e.get("caption") or "").strip()
                    cap = re.sub(r"\d+/\d+页", "", cap)  # PDF 页码残留
                    if (cap and len(cap) >= 12
                            and e["kind"] not in ("Z未分类", "H视图样图")):
                        kinds.setdefault(e["kind"], []).append(cap)
                # 按图库量排序取头部图型，每型确定性取前 per_kind 条
                for kind, caps in sorted(kinds.items(), key=lambda kv: -len(kv[1]))[:max_kinds]:
                    for cap in caps[:per_kind]:
                        _EXEMPLAR_CACHE.append(f"{kind}如「{cap}」")
            except Exception:
                _EXEMPLAR_CACHE = []
    return "；".join(_EXEMPLAR_CACHE)


def get(name: str) -> dict | None:
    """取模板 spec 骨架（深拷贝语义由调用方保证）。"""
    t = TEMPLATES.get(name)
    return None if t is None else dict(t)
