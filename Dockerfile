# syntax=docker/dockerfile:1.7
# ---------- 前端构建 ----------
# 基础镜像按 digest 固化（2026-09-27，deploy/vps/pull-image.sh 场景）：保证父链不变 →
# `cache_from` 能命中远端拉回镜像里的 apt/依赖层，`--delta` 增量不漂移。升基线时手动换 digest。
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS web
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
# 前端 types/ast.ts 与 tsc -b 覆盖的测试文件按相对路径读后端 AST schema / golden / fixtures（单解析器契约）
COPY backend/src/patent_studio/kernel/ast_schema.json /app/backend/src/patent_studio/kernel/ast_schema.json
COPY backend/tests/golden /app/backend/tests/golden
COPY backend/tests/fixtures /app/backend/tests/fixtures
COPY examples/method/studio.json /app/examples/method/studio.json
COPY examples/system/studio.json /app/examples/system/studio.json
RUN pnpm build

# ---------- 运行时：Python + LibreOffice + 中文字体 ----------
FROM python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# LibreOffice（headless 转 PDF）+ 字体：
#   fonts-arphic-uming / fonts-wqy-microhei —— 宋体/黑体的度量相近替身（行高 1.05/1.17 em，OFL）
#   fonts-noto-cjk —— Unicode 覆盖兜底（行高 1.44 em，不作正文替身，否则页数会膨胀 ~60%）
#   不再随仓分发宋体/黑体等受限字体；用户可自装授权字体，fontconfig <accept> 别名会让其自动优先
#   libreoffice-math —— OMML 公式渲染；缺它时 Writer 把 $$公式$$ 画成空白（PDF 预览与 XML 栅格化都会丢公式）
#   poppler-utils —— pdftoppm：CNIPA XML 导出时把公式/表格/附图栅格化为 300 dpi JPG
#   git —— 项目版本历史（.studio/history，history.py）；缺它时保存仍正常但历史/恢复整体停用（/api/…/history 恒为空）
# 国内 VPS 构建慢救：--build-arg APT_MIRROR=mirrors.cloud.tencent.com（替换 debian+debian-security 两 URI）
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends \
        git libreoffice-writer libreoffice-math libreoffice-calc libreoffice-java-common python3-uno poppler-utils \
        fonts-arphic-uming fonts-wqy-microhei fonts-noto-cjk fonts-dejavu-core fonts-liberation2 fonts-crosextra-caladea fonts-opensymbol fontconfig \
        libxinerama1 libxrender1 libxrandr2 libgl1 libcairo2 libcups2 libdbus-1-3 \
        graphviz \
    && rm -rf /var/lib/apt/lists/*

# graphviz —— 复杂拓扑 .mmd 图源的 dot 正交布局引擎；缺失时 mmd_render 自动回落 PIL 布局（功能不断，观感旧画法）

# 专利附图图库（/api/figlib + 生成提示词题注参照）：随仓 docs/figure-library 入镜像
COPY docs/figure-library/ /app/docs/figure-library/

# 专利文形库（生成提示词真实例句注入 + 语料重叠哨兵）：只拷运行时产物，raw/pdf 不入镜像
COPY docs/text-corpus/forms_library.json docs/text-corpus/corpus_index.json docs/text-corpus/claim_skeletons.json docs/text-corpus/claim_trees.json docs/text-corpus/pub_vectors.json docs/text-corpus/pub_sents.json docs/text-corpus/sent_vectors.json /app/docs/text-corpus/

# 字体别名（accept：用户自装授权字体存在时自动优先，缺省时落到 OFL 替身）
COPY docker/fonts-cjk-alias.conf /etc/fonts/conf.d/64-patent-studio-cjk-alias.conf
RUN fc-cache -f && fc-match 宋体 && fc-match 黑体 && fc-match "Times New Roman" && fc-match "Cambria Math"

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

# 国内 VPS 构建慢救：--build-arg PYPI_MIRROR=https://mirrors.cloud.tencent.com/pypi/simple（uv 读 UV_INDEX_URL）
ARG PYPI_MIRROR=

# unoserver：让 LibreOffice 常驻（UNO 桥），单次 DOCX→PDF 从 ~1.5–2 s 降到 ~0.6 s。
# 必须跑在带 python3-uno 的系统 Python（Debian 3.11）里，故独立安装到 /opt/unoserver，而非应用 venv。
RUN UV_INDEX_URL="${PYPI_MIRROR:-https://pypi.org/simple}" uv pip install --python /usr/bin/python3 --target /opt/unoserver "unoserver==3.7"

WORKDIR /app/backend
COPY --chown=1000:1000 backend/pyproject.toml backend/uv.lock ./
# venv 缓存兜底：push-src.sh 在锁未变时把上一版镜像的 .venv 放进 .venv-cache/venv/（避开 **/.venv dockerignore）。
# 用 --mount=bind 而非 COPY：缓存不落成独立层（否则 286MB 会在镜像历史里重复）。命中则拷贝即完成依赖层，
# 绕过 VPS 出站拉 wheel 的限速；无缓存（目录仅 .gitkeep，本地/全新机）时照常 uv sync。
RUN --mount=type=bind,source=.venv-cache,target=/tmp/venv-cache \
    if [ -d /tmp/venv-cache/venv/lib ]; then cp -a /tmp/venv-cache/venv ./.venv; \
    else UV_INDEX_URL="${PYPI_MIRROR:-https://pypi.org/simple}" uv sync --frozen --no-dev --no-install-project; fi
COPY --chown=1000:1000 backend/ ./
# 安装项目自身（patent_studio 包，含 kernel），示例案与 check_all.py 直接 import，不再软链接
RUN UV_INDEX_URL="${PYPI_MIRROR:-https://pypi.org/simple}" uv sync --frozen --no-dev
COPY --chown=1000:1000 examples/ /app/examples/
COPY --from=web --chown=1000:1000 /app/frontend/dist /app/frontend/dist

ENV PATH="/app/backend/.venv/bin:$PATH" \
    PATENT_PROJECTS_DIR=/data/projects \
    PATENT_STATIC_DIR=/app/frontend/dist \
    LO_PROFILE_DIR=/data/.lo_profile \
    UNOSERVER_URL=http://127.0.0.1:2003 \
    HOME=/data

# 首次启动若 /data/projects 为空，则用示例案子（method/system）初始化
COPY docker/entrypoint.sh /entrypoint.sh
# 属主已在各 COPY --chown 就位；/data 只需建目录+属主（空目录，快）
RUN chmod +x /entrypoint.sh && mkdir -p /data/projects && chown -R 1000:1000 /data

VOLUME ["/data"]
EXPOSE 8000
USER 1000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "patent_studio.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--ws-ping-interval", "15", "--ws-ping-timeout", "20"]
