# 部署指南 — Patent Studio 平台

> 适用版本：B15 终态（`patent_studio.asgi:app` 为唯一服务入口；旧 `backend/app/` 树已退役）。
> 本文如实记录当前实现状态：**可用** / **脚手架（未接生产）** 均明确标注。

## 一、服务形态

| 进程 | 启动命令 | 说明 |
|---|---|---|
| API 服务（含前端静态托管） | `uvicorn patent_studio.asgi:app --host 0.0.0.0 --port 8000 --ws-ping-interval 15 --ws-ping-timeout 20` | 唯一入口。`PATENT_STATIC_DIR` 指向 `frontend/dist` 时直接挂载 SPA；缺省取仓库内 `frontend/dist`（存在才挂载） |
| Temporal worker | **脚手架**：`patent_studio.temporal.ReviewWorkflow` + `temporal_activities.py` 已定义，**代码内尚无 Worker 进程入口**（见 §四） | — |
| MCP / Agent 边界 | 由 API 进程内承载（`mcp/agent_server.py` 的 `MCPQueryService`），无独立端口 | — |

Docker 一体化（开发/演示用）：根目录 `Dockerfile` 多阶段构建（前端 build → Python 运行时），`docker-compose.yml` 拉起 `patent-studio` + `postgres:17-alpine` 两服务。注意 Dockerfile/entrypoint 里的 `PATENT_PROJECTS_DIR`、`SOFFICE_TIMEOUT`、`UNOSERVER_URL`、LibreOffice/unoserver 均为**旧文件目录模式遗留**，`patent_studio` 代码路径不读取它们——文档/附图/产物字节全部走 `PATENT_STUDIO_STORAGE_URL` 对象存储，DOCX 构建用 python-docx 无需 LibreOffice。

## 二、环境变量全表

所有平台配置统一前缀 `PATENT_STUDIO_`（`backend/src/patent_studio/settings.py`，pydantic-settings）。

### 必需

| 变量 | 默认 | 说明 |
|---|---|---|
| `PATENT_STUDIO_DATABASE_URL` | —（无默认） | PostgreSQL DSN，如 `postgresql://patent:patent@postgres:5432/patent_studio`。async 侧自动适配驱动。未配置时 API 能起但所有持久化路由报 5xx |
| `PATENT_STUDIO_STORAGE_URL` | — | 对象存储根：`file:///abs/dir`（本地）或 `s3://bucket[/prefix]`。所有正文/附图/构建产物字节按 `sha256/xx/yy/<digest>` 内容寻址写入 |
| `PATENT_STUDIO_LEGACY_DATABASE_URL` | `<dirname(PROJECTS_DIR)>/studio.db` | **B16 旧面 SQLite**：`sqlite:////abs/path` 或裸路径。旧 `/api/*` 面（projects/notify/deadlines/auth 等）的用户、ACL、通知、期限台账都在这里，与平台 PG 完全隔离。部署 `/data/studio.db` |
| `PATENT_PROJECTS_DIR` | `<repo>/examples` | 旧面案件目录（content.md/figs/studio.json 文件真源） |

### 认证

| 变量 | 默认 | 说明 |
|---|---|---|
| `PATENT_STUDIO_AUTH` | `off` | `on` 开启 cookie+JWT 登录（`/api/auth/register`、`/api/auth/cookie/login|logout`、`/api/users/me`）；`off` 时认证写路由一律 501，`GET /api/users/me` 返回 204 |
| `PATENT_STUDIO_SECRET` | `""` | JWT 签名密钥。`AUTH=on` 且未设置时，首个认证请求显式失败（`infra/auth.py:_users_stack`） |
| `PATENT_STUDIO_COOKIE_SECURE` | `off` | `on` 时 `studio_session` cookie 带 `Secure` 属性（HTTPS 部署必须开） |

### 对象存储（S3）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PATENT_STUDIO_S3_ENDPOINT_URL` | AWS 默认 | S3 兼容端点（MinIO/R2 等自建/第三方时设置） |
| `PATENT_STUDIO_S3_REGION` | — | S3 region |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | — | S3 凭证走标准 boto3 环境变量链 |

### LLM（Agent 执行体）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PATENT_STUDIO_LLM_BASE_URL` | — | OpenAI 兼容端点 |
| `PATENT_STUDIO_LLM_API_KEY` | — | API key |
| `PATENT_STUDIO_LLM_MODEL` | — | 模型名。**三变量缺一即保持 stub**：能力层的 agent 执行仍以占位结果返回，不联网 |

### SSE / 实时

| 变量 | 默认 | 说明 |
|---|---|---|
| `PATENT_STUDIO_SSE_POLL_SECONDS` | `0.5` | Run 事件 SSE 库轮询间隔 |
| `PATENT_STUDIO_SSE_HEARTBEAT_SECONDS` | `15` | 心跳注释帧间隔（反向代理 idle 超时应大于此值） |
| `PATENT_STUDIO_SSE_MAX_SECONDS` | `300` | 单连接最长时间，到期客户端重连 |

Yjs 协同走 WebSocket `GET /api/v1/working-copies/{id}/collab`，无额外配置；反向代理需放行 WS upgrade 并放宽读超时。

### Temporal

| 变量 | 默认 | 说明 |
|---|---|---|
| `PATENT_STUDIO_TEMPORAL_ADDRESS` | `localhost:7233` | Temporal gRPC 前端地址 |
| `PATENT_STUDIO_TEMPORAL_NAMESPACE` | `default` | namespace |
| `PATENT_STUDIO_TEMPORAL_TASK_QUEUE` | `patent-studio` | task queue 名 |

### 其他

| 变量 | 默认 | 说明 |
|---|---|---|
| `PATENT_STATIC_DIR` | `<repo>/frontend/dist` | 前端产物目录（存在即挂载到 `/`） |
| `PATENT_FORMS_LIBRARY` | — | kernel 文本形态库（`kernel/text_forms.py`），一般无需设置 |
| `PATENT_STUDIO_TEST_DATABASE_URL` | — | **仅测试**：指向可建库的 PG（如 `postgresql://postgres@localhost:55432/ps_test`），设置后 pytest 跑全量 PG 用例（每用例建独立临时库） |

## 三、认证 / OIDC / OAuth 现状

**当前实现（可用）**：本机账号体系——邮箱+密码注册登录，cookie（`studio_session`，HttpOnly+SameSite=Lax）承载 JWT，fastapi-users 栈；改密后旧 token 即时失效（`password_changed_at` 时闸）；首个注册用户自动成为 superuser。代码：`api/auth_routes.py` + `infra/auth.py`。

**B16 双栈共存**：旧 `backend/app/` 应用整体挂载在 `/`（`asgi.py`），旧 `/api/*`（projects/notify/deadlines/admin/deliver 等）全部可用；`/api/v1/*`、`/api/health` 先注册优先命中。`PATENT_STUDIO_AUTH=on` 时 `/api/auth/*` 与 `/api/users/me` 以旧面为准（注册/登录走旧 sqlite 栈）；off 时走新面 501/204。两侧 cookie 同名同 secret——JWT 签名互认，但**各自在各自的库查用户**：经旧面注册的账号要在 `/api/v1` 被认出，须同名存在于 PG users 表（反之亦然）；cookie 本身可共享。旧面 sqlite 位置用 `PATENT_STUDIO_LEGACY_DATABASE_URL` 指定。

**Agent 通道（可用）**：`agt_` 前缀 bearer token，`domain/agents.py:issue_agent_token` 颁发（明文只在颁发时返回一次，库中只存 sha256），`mcp/agent_server.py:MCPQueryService` 做 bearer 认证 + token scope 收窄，能力授权/幂等/审批由 `capabilities/registry.py` fail-closed 强制。

**OIDC/OAuth（未实现，接入点已就绪）**：代码库中**没有** OIDC 授权码流、JWKS 校验或第三方 OAuth transport——fastapi-users 只注册了 cookie backend（`infra/auth.py:_users_stack` 的 `AuthenticationBackend(name="cookie")`）。接 OIDC 的落点：

1. `infra/auth.py` 内新增 `AuthenticationBackend`（bearer transport + JWKS 验签的自定义 `JWTStrategy`，或 `httpx-oauth` 的 OAuth2 authorize/callback 路由），塞进 `FastAPIUsers(get_user_manager, [cookie_backend, oidc_backend])`；
2. 上游 IdP 用户以 `sub`/`email` 映射到 `domain/identity.py:User`（`fastapi_users_db_sqlalchemy` 支持 `oauth_accounts` 关联表，迁移需新增 Alembic revision）；
3. `api/dependencies.py:CurrentUser` 已按「解析成功即 User、否则 None」抽象，新 backend 无需动业务路由；
4. 反向代理方案也可行：NGINX/oauth2-proxy 前置认证后签发内部 JWT，`SessionJWTStrategy` 换成验上游公钥即可。

## 四、Temporal 现状与起法

**代码现状（脚手架）**：`temporal.py` 定义 `TemporalSettings`（env 读取）、`connect_temporal()`、`ReviewWorkflow`（执行 `mark_run_running` → `request_review_approval` → 等 `approve`/`reject` 信号 → `finalize_review`/`reject_review`）；`temporal_activities.py` 的四个 activity 直接操作 Run 域服务。**仓库内没有 Worker 入口**（无 `Worker(...).run()` 引导），REST 侧 `POST /runs` 目前走同步域转移而非启动 workflow——Temporal 是预置的编排基建，非生产必需。

**Temporal server 起法**（供开发联调）：

```bash
# 方式一：Temporal CLI dev server（含 Web UI :8233）
temporal server start-dev

# 方式二：docker compose（官方）
git clone https://github.com/temporalio/docker-compose.git
cd docker-compose && docker compose up   # postgres 版，7233 + Web UI 8233
```

接入时新增一个 worker 进程模块（约 20 行）：

```python
# patent_studio/temporal_worker.py（示例，尚未入库）
from temporalio.worker import Worker
from patent_studio.temporal import ReviewWorkflow, TemporalSettings, connect_temporal
from patent_studio import temporal_activities as acts

async def main():
    client = await connect_temporal()
    s = TemporalSettings.from_env()
    await Worker(client, task_queue=s.task_queue, workflows=[ReviewWorkflow],
                 activities=[acts.mark_run_running, acts.request_review_approval,
                             acts.finalize_review, acts.reject_review]).run()
```

## 五、Ingest 管线现状

**可用**：

- **目录导入器** `patent-studio import <dir> --org <slug|uuid> --principal <uuid|email> [--kind ...] [--with-working-copy] [--dry-run] [--json]`（`cli.py` → `domain/importer.py`）：旧文件目录（`content.md`/`content.txt` + `figs/` + `studio.json`）→ Case + 三书 Document + 不可变 Revision + FigureDocument/FigureRevision，字节进对象存储。幂等键自动生成，支持 dry-run 预览计划。
- **DOCX 内核导入** `kernel/docx_import.py`：DOCX → 内核 Markdown 的尽力映射（标题/段落/表格/OMML 公式/图片抽取），产出 `ImportReport` 列出不可映射项。**当前仅由测试与 CLI 辅助路径使用**，未暴露为 REST 端点。
- **材料域**（B10）：`POST /cases/{id}/materials` 上传案件材料 → `/materials/{id}/anchors` 源锚点 → `/cases/{id}/facts` 事实提案 → confirm/reject 工作流。已有 REST 面，供「论文/交底书 → 锚定事实 → 撰稿」链路使用。

**未实现**：无异步抓取/解析队列；无 LLM 自动抽取事实（LLM 三件套未配时全 stub）；`docx_import` 未挂 REST。

## 六、生产部署 Checklist

- [ ] **PostgreSQL 17+**：建库建账号 → `PATENT_STUDIO_DATABASE_URL`；首连自动跑 Alembic `upgrade_head`（`infra/auth.py:init_db`，幂等可重跑）；**独立跑迁移**可用 `alembic -c` 指向 `infra/db/migrations`（env.py 读同一 env 变量）
- [ ] **对象存储**：生产用 `s3://bucket/prefix` + `PATENT_STUDIO_S3_REGION`（+ 自建端点时 `S3_ENDPOINT_URL`）；`file://` 仅限单机/演示；桶开版本控制与生命周期策略
- [ ] **认证**：`PATENT_STUDIO_AUTH=on` + 强随机 `PATENT_STUDIO_SECRET`（≥32B）；HTTPS 下 `PATENT_STUDIO_COOKIE_SECURE=on`
- [ ] **前端**：`pnpm build` 产物经 `PATENT_STATIC_DIR` 由后端挂载，或独立 CDN/NGINX 托管 + 反代 `/api`
- [ ] **反向代理**：放行 `/api/v1/working-copies/*/collab` 的 WebSocket upgrade；SSE 路由读超时 > `SSE_HEARTBEAT_SECONDS`；body 上限与应用 `BodyLimitMiddleware` 对齐
- [ ] **机密**：SECRET / DB DSN / AWS 凭证走 secret manager，不进镜像与仓库
- [ ] **健康检查**：`GET /api/health`（Dockerfile HEALTHCHECK 已内置 30s 探活）
- [ ] **首账号**：`AUTH=on` 后第一个注册账号自动 superuser——生产部署后应立即注册管理账号再开放注册，或前置网关限制 `/api/auth/register`
- [ ] **Temporal**（可选）：需要审批编排时部署 server + 自建 worker（§四）；不部署时审批流走 REST 同步路径，功能不受影响
- [ ] **备份**：PG 定期 `pg_dump` + 对象存储桶级备份；revision/artifact 均不可变，sha256 可校验完整性
- [ ] **可观测**：uvicorn access log + 结构化错误（`error(kind, code, message)` 统一错误体）；SSE/WS 连接数与 outbox 表长度建议纳入监控
