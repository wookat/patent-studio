# -*- coding: utf-8 -*-
"""案子（project）存储：PROJECTS_DIR/<id>/{content.md, docs/, figs/, attachments/, studio.json, .studio/}

W4-C（docs/plan/15-w4c-figures-files-design.md §2）：附图顺序 / 宽度 / 摘要图的真源是 docs/figures.md
（patent_studio.kernel.figures_md），studio.json 只存 style / sub_except / abstract_limit / ai_enabled。
运行期 settings dict 仍带 spec_figures / abstract_figure（由 figures.md 派生的只读视图，本波次内 lint / ast /
cnipa_xml / 设置页继续读它）；save_settings 收到这两个键时写回 figures.md。
"""

import json
import os
import re
import shutil
import time
from dataclasses import dataclass, field

from PIL import Image, ImageDraw

from app import atomic, collab
from app.domain import history, review_meta
from patent_studio.kernel import docset, figures_md
from patent_studio.kernel.builder import DEFAULT_SUB_EXCEPT
from patent_studio.kernel.style import merge_style, style_diff, validate_headings

SETTINGS_FILE = "studio.json"
STUDIO_DIR = ".studio"
FIG_EXTS = (".emf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".svg")
DOCX_FIG_EXTS = (".emf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff")
ID_RE = re.compile(r"^[A-Za-z0-9_\-\u4e00-\u9fff]{1,64}$")
_BAD_ID_CHARS = re.compile(r"[^A-Za-z0-9_\-\u4e00-\u9fff]+")
FIGURE_KEYS = ("abstract_figure", "spec_figures")


def id_slug(stem: str, limit: int, fallback: str) -> str:
    """文件名主干 → 合法案 id 前缀。字符集 ⊆ ID_RE 允许集，故非空结果恒匹配 ID_RE。"""
    return _BAD_ID_CHARS.sub("-", stem).strip("-")[:limit] or fallback


# attachments/（12 §4.4）：任意材料，白名单 + 单文件 50 MB；C2 的 app/domain/attachments.py 读这三个常量
ATTACHMENTS_DIR = "attachments"
ATTACHMENT_EXTS = (".pdf", ".docx", ".doc", ".md", ".txt", ".png", ".jpg", ".zip")
ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024

# 新案自带的占位附图（图1）：排版内核要求摘要附图必须存在（abstract_figure=None → TypeError），
# 有了它新建案子首屏就能构建预览；用户放入真实附图后在排版设置里替换。
TEMPLATE_FIG = "fig1.png"

TEMPLATE_MD = """# 一种XXX方法及装置

## 摘要

本发明公开了一种XXX方法及装置，涉及……技术领域，用于解决……的问题。方法包括：……。能够提高……（≤300 字）。

## 权利要求书

1.一种XXX方法，其特征在于，包括以下步骤：
步骤一，……；
步骤二，……。

2.根据权利要求1所述的方法，其特征在于，……。

## 说明书

### 技术领域

本发明涉及……技术领域，尤其涉及一种XXX方法及装置。

### 背景技术

……

### 发明内容

……

### 附图说明

图1为本发明实施例的总体流程图。

### 具体实施方式

下面结合附图对本发明作进一步说明。如图1所示，……
"""


def write_template_fig(path, size=(1200, 700)):
    """生成占位总体流程图：S1 → S2 → S3 三个步骤框（黑白线条，符合附图不着色的惯例）。"""
    w, h = size
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    bw, bh, gap = 260, 160, 110
    x0 = (w - (3 * bw + 2 * gap)) // 2
    y0 = (h - bh) // 2
    for i in range(3):
        x = x0 + i * (bw + gap)
        d.rectangle([x, y0, x + bw, y0 + bh], outline="black", width=4)
        d.text((x + bw // 2, y0 + bh // 2), f"S{i + 1}", fill="black", anchor="mm", font_size=56)
        if i < 2:
            ax0, ax1, ay = x + bw + 12, x + bw + gap - 12, y0 + bh // 2
            d.line([ax0, ay, ax1, ay], fill="black", width=4)
            d.polygon([(ax1, ay), (ax1 - 24, ay - 14), (ax1 - 24, ay + 14)], fill="black")
    img.save(path, "PNG")


class ProjectError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@dataclass
class Project:
    id: str
    dir: str
    title: str
    settings: dict = field(default_factory=dict)

    @property
    def content_path(self):
        return os.path.join(self.dir, "content.md")

    @property
    def figs_dir(self):
        return os.path.join(self.dir, "figs")

    @property
    def figsrc_dir(self):
        return os.path.join(self.dir, "figs-src")

    @property
    def studio_dir(self):
        return os.path.join(self.dir, STUDIO_DIR)

    @property
    def figures_md_path(self):
        return figures_md.path_of(self.dir)

    @property
    def attachments_dir(self):
        return os.path.join(self.dir, ATTACHMENTS_DIR)


def read_title(content):
    for ln in content.splitlines():
        if ln.startswith("# ") and not ln.startswith("## "):
            return ln[2:].strip()
    return ""


def default_settings(figs):
    """未提供 studio.json 时的推断：摘要附图=第一张图，说明书附图=全部（按图号排序）。"""
    docx_figs = [f for f in figs if f.lower().endswith(DOCX_FIG_EXTS)]
    return {
        "abstract_figure": [docx_figs[0], 14.5] if docx_figs else None,
        "spec_figures": [[f, 15.0] for f in docx_figs],
        "sub_except": list(DEFAULT_SUB_EXCEPT),
        "abstract_limit": 300,
        "style": {},
    }


def _deep_merge(base, patch):
    """dict+dict 递归合并，其余值覆盖（update_settings 用）。"""
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def normalize_settings(raw, figs):
    """补齐缺省字段；style 只保留相对默认值的差异；ai_daily_tokens（案级日预算，W5 §6.2）按原样透传。"""
    base = default_settings(figs)
    s = dict(base)
    if isinstance(raw, dict):
        for k in ("abstract_figure", "spec_figures", "sub_except", "abstract_limit"):
            if k in raw and raw[k] is not None:
                s[k] = raw[k]
        if isinstance(raw.get("style"), dict):
            validate_headings(raw["style"])
            s["style"] = style_diff(merge_style(raw["style"]))
        if "ai_enabled" in raw:
            s["ai_enabled"] = bool(raw["ai_enabled"])
        if isinstance(raw.get("preflight"), dict):
            disabled = raw["preflight"].get("disabled")
            if disabled is not None and not (isinstance(disabled, list) and all(isinstance(x, str) for x in disabled)):
                raise ValueError("settings.preflight.disabled 应为字符串数组")
            s["preflight"] = raw["preflight"]
        if isinstance(raw.get("ai_daily_tokens"), int) and not isinstance(raw["ai_daily_tokens"], bool):
            s["ai_daily_tokens"] = max(0, raw["ai_daily_tokens"])
        if "notify_webhook_url" in raw:
            u = str(raw.get("notify_webhook_url") or "").strip()
            if u and not re.match(r"^https?://", u):
                raise ValueError("settings.notify_webhook_url 应为 http(s) URL")
            s["notify_webhook_url"] = u
    try:
        if s["abstract_figure"] is not None:
            s["abstract_figure"] = [str(s["abstract_figure"][0]), float(s["abstract_figure"][1])]
        s["spec_figures"] = [[str(f), float(w)] for f, w in s["spec_figures"]]
        s["sub_except"] = [str(x) for x in s["sub_except"]]
        s["abstract_limit"] = int(s["abstract_limit"])
    except (TypeError, ValueError, KeyError, IndexError) as e:
        raise ValueError(f"settings 字段形态不合法：{e}") from e
    return s


def _fig_sort_key(name):
    m = re.search(r"(\d+)", name)
    return (int(m.group(1)) if m else 10**9, name)


class ProjectStore:
    def __init__(self, root):
        self.root = os.path.abspath(root)

    # --- 枚举与读取 ---
    def list_ids(self):
        if not os.path.isdir(self.root):
            return []
        out = []
        for name in sorted(os.listdir(self.root)):
            d = os.path.join(self.root, name)
            if os.path.isdir(d) and not os.path.islink(d) and os.path.isfile(os.path.join(d, "content.md")):
                out.append(name)
        return out

    def _dir(self, pid):
        if not ID_RE.match(pid) or pid in (".", ".."):
            raise ProjectError("非法案子 id", 400)
        d = os.path.join(self.root, pid)
        if not os.path.isfile(os.path.join(d, "content.md")):
            raise ProjectError(f"案子不存在：{pid}", 404)
        return d

    def unique_pid(self, base: str) -> str:
        """base → 未占用案 id（被占 ⇒ base-2、-3…）。list_ids 只收有 content.md 的案，
        再叠目录存在检查，挡空目录名被复用。"""
        taken = set(self.list_ids())
        pid, n = base, 2
        while pid in taken or os.path.exists(os.path.join(self.root, pid)):
            pid = f"{base}-{n}"
            n += 1
        return pid

    def list_figs(self, pid_or_dir):
        d = pid_or_dir if os.path.isabs(pid_or_dir) else self._dir(pid_or_dir)
        fd = os.path.join(d, "figs")
        if not os.path.isdir(fd):
            return []
        return sorted((f for f in os.listdir(fd) if f.lower().endswith(FIG_EXTS)), key=_fig_sort_key)

    def get(self, pid):
        d = self._dir(pid)
        with open(os.path.join(d, "content.md"), encoding="utf-8") as f:
            content = f.read()
        return Project(id=pid, dir=d, title=read_title(content), settings=self.load_settings(pid))

    def read_content(self, pid):
        d = self._dir(pid)
        with open(os.path.join(d, "content.md"), encoding="utf-8") as f:
            content = f.read()
        if not docset.has_mirror(d):
            docset.write_mirror(d, content)
        return content

    def _read_settings_file(self, d):
        p = os.path.join(d, SETTINGS_FILE)
        if not os.path.isfile(p):
            return None
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except ValueError as e:
            raise ProjectError(f"{SETTINGS_FILE} 无法读取：{e}", 422) from e

    # --- 附图真源 docs/figures.md ---
    def load_figures(self, pid_or_dir):
        """读 docs/figures.md；不存在则迁移生成（幂等：存在即只读，不动 studio.json）：
        studio.json 旧字段 spec_figures / abstract_figure → figures.md（alt 取说明书「图N为…」题注）；
        两者都没有 → 按 figs/ 推断（摘要图 = 第一张，说明书附图 = 全部）。"""
        d = pid_or_dir if os.path.isabs(pid_or_dir) else self._dir(pid_or_dir)
        doc = figures_md.read(d)
        if doc is not None:
            return doc
        raw = self._read_settings_file(d) or {}
        if raw.get("spec_figures") or raw.get("abstract_figure"):
            with open(os.path.join(d, "content.md"), encoding="utf-8") as f:
                content = f.read()
            doc = figures_md.from_legacy(raw.get("spec_figures") or [], raw.get("abstract_figure"), content)
        else:
            doc = figures_md.infer(self.list_figs(d), DOCX_FIG_EXTS)
        return figures_md.write(d, doc)

    def save_figures(self, pid, doc):
        """写 docs/figures.md 并 history commit（docs/ 已在 history.commit 的 add 路径内）。"""
        d = self._dir(pid)
        figures_md.write(d, doc)
        history.commit(d, "figures")
        return doc

    def load_settings(self, pid):
        d = self._dir(pid)
        raw = self._read_settings_file(d)
        return self._runtime_settings(d, raw, self.load_figures(d))

    def _runtime_settings(self, d, raw, doc):
        """studio.json 内容 + figures.md 派生的 spec_figures / abstract_figure（只读视图）。"""
        s = normalize_settings({**(raw or {}), **doc.legacy_view()}, self.list_figs(d))
        s["abstract_figure"] = doc.legacy_view()["abstract_figure"]
        return s

    def has_settings_file(self, pid):
        return os.path.isfile(os.path.join(self._dir(pid), SETTINGS_FILE))

    def update_settings(self, pid, partial):
        """PUT /settings 的 merge 入口：请求携带的键覆盖，未携带的键保留（dict 值深合并）。
        替换语义下部分客户端（MCP/脚本）漏发的键会被 normalize 重置回默认——merge 后
        客户端只需传改动项。studio.json 损坏时无基可并，退化为整体替换（PUT 仍是自愈路径）。"""
        d = self._dir(pid)
        try:
            raw = self._read_settings_file(d)
        except ProjectError:
            raw = None
        return self.save_settings(pid, _deep_merge(raw or {}, dict(partial or {})))

    def save_settings(self, pid, settings):
        """style / sub_except / abstract_limit / ai_enabled → studio.json；
        settings 里若带 spec_figures / abstract_figure（旧设置页 / R2 figures API / 导入器）
        → 套到 figures.md（保留已有 alt）。"""
        d = self._dir(pid)
        settings = dict(settings or {})
        doc = self.load_figures(d)
        if any(k in settings for k in FIGURE_KEYS):
            lv = normalize_settings(
                {**doc.legacy_view(), **{k: settings[k] for k in FIGURE_KEYS if k in settings}}, self.list_figs(d)
            )
            figures_md.apply_legacy(doc, lv["spec_figures"], lv["abstract_figure"])
            self.save_figures(pid, doc)
        s = normalize_settings(settings, self.list_figs(d))
        persisted = {k: v for k, v in s.items() if k not in FIGURE_KEYS}
        atomic.write_json(os.path.join(d, SETTINGS_FILE), persisted)
        return self._runtime_settings(d, persisted, doc)

    # --- 写内容（保存前备份）---
    def save_content(self, pid, content, backup=True):
        """写 content.md + 三书镜像 + history commit，末尾通知协同房间（R8）。
        backup=False 供协同去抖写回用（git 已是安全网）。"""
        with atomic.studio_lock(self._dir(pid), "content"):
            return self._save_content(pid, content, backup)

    def _save_content(self, pid, content, backup):
        d = self._dir(pid)
        path = os.path.join(d, "content.md")
        name = None
        if backup and os.path.isfile(path):
            ts = time.strftime("%Y%m%d-%H%M%S")
            name = f"content.md.bak-{ts}"
            bpath = os.path.join(d, name)
            i = 1
            while os.path.exists(bpath):
                bpath = os.path.join(d, f"{name}-{i}")
                i += 1
            shutil.copy2(path, bpath)
            name = os.path.basename(bpath)
        old = ""
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                old = f.read()
        atomic.write_text(path, content)
        review_meta.record(d, old, content)
        docset.write_mirror(d, content)
        history.commit(d, "save")
        collab.on_saved(pid, content)
        return name

    def list_backups(self, pid):
        d = self._dir(pid)
        out = []
        for name in os.listdir(d):
            if name.startswith("content.md.bak-"):
                st = os.stat(os.path.join(d, name))
                out.append({"name": name, "size": st.st_size, "mtime": st.st_mtime})
        return sorted(out, key=lambda x: x["name"], reverse=True)

    def read_backup(self, pid, name):
        d = self._dir(pid)
        if not name.startswith("content.md.bak-") or "/" in name or "\\" in name:
            raise ProjectError("非法备份名", 400)
        p = os.path.join(d, name)
        if not os.path.isfile(p):
            raise ProjectError("备份不存在", 404)
        with open(p, encoding="utf-8") as f:
            return f.read()

    # --- 新建 ---
    def create(self, pid, title):
        if not ID_RE.match(pid) or pid in (".", ".."):
            raise ProjectError("id 只能包含字母、数字、下划线、连字符或中文", 400)
        d = os.path.join(self.root, pid)
        if os.path.exists(d):
            raise ProjectError(f"已存在：{pid}", 409)
        os.makedirs(os.path.join(d, "figs"))
        os.makedirs(os.path.join(d, ATTACHMENTS_DIR))
        write_template_fig(os.path.join(d, "figs", TEMPLATE_FIG))
        md = TEMPLATE_MD.replace("一种XXX方法及装置", title.strip() or "一种XXX方法及装置", 1)
        atomic.write_text(os.path.join(d, "content.md"), md)
        self.save_settings(pid, default_settings(self.list_figs(d)))
        return self.get(pid)

    # --- 永久删除（W4-A 回收站 → 彻底删除；仅 owner，路由层校验；协同房间由路由先 collab.rooms.drop） ---
    def delete(self, pid):
        shutil.rmtree(self._dir(pid))

    # --- 构建配置 ---
    def build_config(self, project, out, content_md=None, settings=None):
        """docs/figures.md + studio.json（或传入的草稿 settings）→ patent_studio.kernel.build_patent 的 CONFIG。
        附图元组来自 project.settings 的派生视图（load_settings ← figures.md）；builder 的 CONFIG 契约不变，
        以便 examples/*/build_docx.py 与 make zero-drift 的原脚本路径继续作为基准。"""
        s = normalize_settings(settings if settings is not None else project.settings, self.list_figs(project.dir))
        if not s["abstract_figure"] and s["spec_figures"]:
            # 有说明书附图却未选摘要图 → 沿用产品原口径硬拦；纯方法无附图案卷允许无摘要图构建。
            raise ProjectError("未设置摘要附图（figs/ 目录为空或未在设置中选择）", 422)
        cfg = {
            "content_md": content_md or project.content_path,
            "out": out,
            "figs_dir": project.figs_dir,
            "abstract_figure": (s["abstract_figure"][0], s["abstract_figure"][1]) if s["abstract_figure"] else None,
            "spec_figures": [(f, w) for f, w in s["spec_figures"]],
            "sub_except": tuple(s["sub_except"]),
            "abstract_limit": s["abstract_limit"],
        }
        if s["style"]:
            cfg["style"] = s["style"]
        return cfg

    def fig_preview_path(self, pid, name):
        """浏览器可显示的附图路径：emf → 同名 png/svg/jpg；找不到返回 None。"""
        d = self._dir(pid)
        fd = os.path.join(d, "figs")
        if "/" in name or "\\" in name or name.startswith("."):
            raise ProjectError("非法文件名", 400)
        p = os.path.join(fd, name)
        stem, ext = os.path.splitext(name)
        if ext.lower() in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".bmp") and os.path.isfile(p):
            return p
        for alt in (".png", ".svg", ".jpg", ".jpeg"):
            q = os.path.join(fd, stem + alt)
            if os.path.isfile(q):
                return q
        return p if os.path.isfile(p) else None
