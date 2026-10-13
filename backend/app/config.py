# -*- coding: utf-8 -*-
"""运行配置（环境变量）。"""
import os
import shutil
from zoneinfo import ZoneInfo

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BACKEND_DIR)

PROJECTS_DIR = os.path.abspath(os.environ.get("PATENT_PROJECTS_DIR", os.path.join(REPO_ROOT, "examples")))
CHECK_SCRIPT = os.environ.get("PATENT_CHECK_SCRIPT", os.path.join(PROJECTS_DIR, "check_all.py"))
SOFFICE = os.environ.get("SOFFICE_BIN") or shutil.which("soffice") or shutil.which("libreoffice") or "soffice"
LO_PROFILE_DIR = os.path.abspath(os.environ.get("LO_PROFILE_DIR", os.path.join(REPO_ROOT, ".lo_profile")))
STATIC_DIR = os.environ.get("PATENT_STATIC_DIR", os.path.join(REPO_ROOT, "frontend", "dist"))
KEEP_BUILDS = int(os.environ.get("PATENT_KEEP_BUILDS", "3"))
SOFFICE_TIMEOUT = int(os.environ.get("SOFFICE_TIMEOUT", "120"))
# 常驻 LibreOffice（unoserver XML-RPC 地址）；置空则始终用 soffice CLI。连接失败后退避 UNOSERVER_RETRY_S 秒再试。
UNOSERVER_URL = os.environ.get("UNOSERVER_URL", "http://127.0.0.1:2003").strip()
UNOSERVER_RETRY_S = int(os.environ.get("UNOSERVER_RETRY_S", "30"))
# R6（docs/plan/07 §3）：账号开关只在启动时读一次；off 时不建 DB、不 import fastapi-users
AUTH_ON = os.environ.get("PATENT_STUDIO_AUTH", "off").strip().lower() == "on"
DB_PATH = os.path.join(os.path.dirname(PROJECTS_DIR), "studio.db")
AUTH_SECRET = os.environ.get("PATENT_STUDIO_SECRET", "")
COOKIE_SECURE = os.environ.get("PATENT_STUDIO_COOKIE_SECURE", "off").strip().lower() == "on"
# 轨道 E（docs/plan/09 §2）：AI 中转站 key 只从这一个变量读；provider=mock 时不出站
AI_KEY = os.environ.get("PATENT_STUDIO_AI_KEY", "").strip()

# 业务统一本地时区：期限倒计时/日历语义一律按此（UTC 容器内不得用本地 tz）
TZ = ZoneInfo("Asia/Shanghai")
AI_PROVIDER = os.environ.get("PATENT_STUDIO_AI_PROVIDER", "aicdks").strip().lower() or "aicdks"
# R8（docs/plan/11 §3）：实时协同开关，默认 on；off 时 /collab 返回 {enabled:false}、WebSocket 拒绝握手，
# 其余行为与现状一致
COLLAB_ON = os.environ.get("PATENT_STUDIO_COLLAB", "on").strip().lower() == "on"
# W5（docs/plan/21 §6.2）：模型全局并发（heavy+interactive 共用）与每案日 token 预算缺省；机构设置可覆盖预算
AI_CONCURRENCY = max(1, int(os.environ.get("PATENT_STUDIO_AI_CONCURRENCY", "2") or 2))
AI_DAILY_TOKENS = max(0, int(os.environ.get("PATENT_STUDIO_AI_DAILY_TOKENS", "200000") or 200000))

# s8 先行技术检索（app/agent/prior_art.py）：provider 逗号序 + 各源凭证；全空则 s8 降级「待检索」
PRIOR_ART_PROVIDERS = os.environ.get("PATENT_STUDIO_PRIOR_ART_PROVIDERS", "patsnap,openalex").strip()
PATSNAP_KEY = os.environ.get("PATENT_STUDIO_PATSNAP_KEY", "").strip()
OPS_KEY = os.environ.get("PATENT_STUDIO_OPS_KEY", "").strip()
OPS_SECRET = os.environ.get("PATENT_STUDIO_OPS_SECRET", "").strip()
PRIOR_ART_MAILTO = os.environ.get("PATENT_STUDIO_PRIOR_ART_MAILTO", "").strip()
