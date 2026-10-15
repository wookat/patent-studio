# -*- coding: utf-8 -*-
"""attachments/：案卷任意材料（docs/plan/12-agency-workbench.md §4.4；15 §3.2）。W4-C C2 单元实现。

存储：<project>/attachments/<name>，平铺一层，不分子目录；文件名即 id（同名 → 409）。
白名单 ATTACHMENT_EXTS、单文件 ≤ ATTACHMENT_MAX_BYTES（domain.projects 常量，与前端 types/attachments.ts 同步）。
不进 content.md / docs/；不进 DOCX；不参与 zero-drift；不进 .studio/history（history.TRACKED 只有源文档，
≤50MB 二进制不入库，文件本身就是真源）。

列表项形状（GET /attachments 响应 items[]）：
    {"name": "现有技术.pdf", "ext": ".pdf", "size": 12345, "mtime": "2026-09-05T11:49:00Z",
     "kind": "pdf" | "docx" | "text" | "image" | "zip",
         # 预览路径：pdf→react-pdf；image→<img>；text（md/txt）→文本；docx/zip→仅下载
     "url": "/api/projects/{pid}/attachments/{name}"}
         # GET 原文件（Content-Disposition inline；?download=1 → attachment）

错误：AttachmentsError(message, detail, status) → 路由 {status} {"kind": "attachments", message, line: null, detail}；
越界名 / 类型 400、重名 409、超大 413、不存在 404。
"""

import os
from datetime import UTC, datetime
from urllib.parse import quote

from app import atomic
from app.domain.projects import ATTACHMENT_EXTS, ATTACHMENT_MAX_BYTES, ATTACHMENTS_DIR  # noqa: F401  （契约常量）

KIND_OF_EXT = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "docx",
    ".md": "text",
    ".txt": "text",
    ".png": "image",
    ".jpg": "image",
    ".zip": "zip",
}
MEDIA_OF_EXT = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".zip": "application/zip",
}


class AttachmentsError(Exception):
    def __init__(self, message, detail=None, status=422):
        super().__init__(message)
        self.detail = detail
        self.status = status


def check_name(name):
    """单段文件名、扩展名在白名单；否则 AttachmentsError(status=400)。"""
    base = os.path.basename(name)
    if not base or base != name or base.startswith(".") or "/" in name or "\\" in name:
        raise AttachmentsError("非法文件名", name, status=400)
    ext = os.path.splitext(base)[1].lower()
    if ext not in ATTACHMENT_EXTS:
        raise AttachmentsError(
            f"不支持的附件类型 {ext or '(无扩展名)'}", "允许：" + " ".join(ATTACHMENT_EXTS), status=400
        )
    return base


def _fmt_size(n):
    return f"{n / 1024 / 1024:.1f} MB" if n >= 1024 * 1024 else f"{n / 1024:.0f} KB"


def _item(pid, d, name):
    st = os.stat(os.path.join(d, name))
    ext = os.path.splitext(name)[1].lower()
    return {
        "name": name,
        "ext": ext,
        "size": st.st_size,
        "mtime": datetime.fromtimestamp(st.st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "kind": KIND_OF_EXT[ext],
        "url": f"/api/projects/{pid}/attachments/{quote(name)}",
    }


def _names(d):
    if not os.path.isdir(d):
        return []
    out = []
    for n in sorted(os.listdir(d)):
        if n.startswith(".") or not os.path.isfile(os.path.join(d, n)):
            continue
        if os.path.splitext(n)[1].lower() in ATTACHMENT_EXTS:
            out.append(n)
    return out


def list_attachments(store, pid):
    """→ {"items": [...]}（按名排序）。目录不存在视为空。"""
    p = store.get(pid)
    d = p.attachments_dir
    return {"items": [_item(pid, d, n) for n in _names(d)]}


def upload_attachments(store, pid, files):
    """files: [(filename, bytes)]；整批校验（名 / 类型 / 大小 / 重名）后再写，任一失败整批不写。→ list_attachments。"""
    p = store.get(pid)
    d = p.attachments_dir
    taken = set(_names(d))
    planned = []
    for filename, data in files:
        name = check_name(os.path.basename((filename or "").replace("\\", "/")))
        if len(data) > ATTACHMENT_MAX_BYTES:
            raise AttachmentsError(
                f"附件过大：{name}（{_fmt_size(len(data))}，上限 {_fmt_size(ATTACHMENT_MAX_BYTES)}）", name, status=413
            )
        if name in taken:
            raise AttachmentsError(f"attachments/{name} 已存在", name, status=409)
        taken.add(name)
        planned.append((name, data))
    for name, data in planned:
        atomic.write_bytes(os.path.join(d, name), data)
    return list_attachments(store, pid)


def attachment_path(store, pid, name):
    """校验名后返回绝对路径；不存在 → AttachmentsError(status=404)。GET 原文件用。"""
    p = store.get(pid)
    name = check_name(name)
    path = os.path.join(p.attachments_dir, name)
    if not os.path.isfile(path):
        raise AttachmentsError(f"附件不存在：{name}", name, status=404)
    return path


def delete_attachment(store, pid, name):
    """删文件 → list_attachments；不存在 404。"""
    os.remove(attachment_path(store, pid, name))
    return list_attachments(store, pid)


INTAKE_TEMPLATE_NAME = "技术交底书模板.md"

# W19 批3：交底书七段式（发明点→技术问题→现有技术缺陷→技术方案→有益效果→可替代方案→已公开情况），
# 发明人下载→按提示填写→回传附件，agent 据此起草。提示句式随 1001 件授权语料反哺沉淀。
INTAKE_TEMPLATE_MD = """# 技术交底书

> 发明人填写说明：每节给了要点提示，按实填写即可，写不出的小节留空并标注「待讨论」，不要硬凑——宁缺勿假。

## 一、发明点（一句话）

本发明最核心的改进是什么？
（示例句式：提出一种「……」的方法 / 装置 / 系统，解决……）
- 拟申请类型：发明 / 实用新型 / 外观（可多选，由代理人评估）

## 二、要解决的技术问题

现有技术在哪一步卡住：代价高 / 精度差 / 速度慢 / 不安全 / 依赖人工？
写具体：发生在什么场景、什么环节、造成什么后果。
- 问题 1：
- 问题 2：

## 三、现有技术及缺陷

你了解到最接近的现有方案（产品 / 论文 / 专利）是什么？给出名称或链接。
- 方案 A（名称 / 出处）：做法……；缺陷……
- 方案 B：做法……；缺陷……

## 四、技术方案（怎么做的）

按步骤或模块写清楚：输入是什么、怎么加工、输出是什么、关键参数怎么选、分支怎么判。
- 步骤 / 模块 1：
- 步骤 / 模块 2：
- 涉及的公式 / 参数 / 阈值（如有）：
- 依赖的硬件 / 软件环境（如有）：

## 五、有益效果

针对第三节每个缺陷，对应改善了什么？能量化的给量化（提速 X%、精度提升 X、节省 X 人力）。
- 效果 1（对应缺陷 1）：
- 效果 2（对应缺陷 2）：

## 六、可替代方案

还能怎么实现同样效果？（等同变换直接决定授权后的保护范围，尽量写全）
- 部件 / 步骤 X 可以替换为：
- 步骤顺序能否调换：
- 参数范围能否放宽 / 取其他值：

## 七、已公开情况

本方案是否已发表 / 展示 / 销售 / 申请过？（在先公开会破坏新颖性，务必如实）
- 论文 / 预印本（arXiv 号等）：
- 产品发布 / 演示日期：
- 已有相关申请号 / 专利号：
- 其他需要代理人知道的情况：
"""


def seed_intake_template(store, pid):
    """内置技术交底书模板进 attachments/（W19 批3）；已存在 → AttachmentsError(409)。"""
    p = store.get(pid)
    d = p.attachments_dir
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, INTAKE_TEMPLATE_NAME)
    if os.path.isfile(path):
        raise AttachmentsError(f"attachments/{INTAKE_TEMPLATE_NAME} 已存在", INTAKE_TEMPLATE_NAME, status=409)
    atomic.write_text(path, INTAKE_TEMPLATE_MD)
    return list_attachments(store, pid)
