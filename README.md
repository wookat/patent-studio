<div align="center">
  <img src="frontend/public/logo-mark.svg" alt="知撰 · Patent Studio Logo" width="88" />
  <h1>知撰 · Patent Studio</h1>
  <p><strong>面向中国发明专利的 AI 撰写与审阅工作台</strong></p>
  <p>AI 提出建议，人决定采纳。让技术材料、三书、附图与交付文件保持可追溯。</p>
  <p>A self-hosted AI workspace for drafting and reviewing Chinese invention patents.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-166534" alt="License: Apache-2.0" /></a>
    <a href="backend/pyproject.toml"><img src="https://img.shields.io/badge/Python-3.11%2B-3776AB" alt="Python 3.11+" /></a>
    <a href="frontend/package.json"><img src="https://img.shields.io/badge/React-19-149ECA" alt="React 19" /></a>
  </p>
  <p>
    <a href="#快速开始">快速开始</a> ·
    <a href="#产品预览">产品预览</a> ·
    <a href="docs/user-manual.md">使用手册</a> ·
    <a href="docs/mcp.md">MCP 接入</a> ·
    <a href="CONTRIBUTING.md">参与贡献</a>
  </p>
</div>

![知撰工作台：公开示例的三书源码、文档预览与附图管理](frontend/public/lp/workbench.png)

## 为什么是知撰

专利撰写不只是让 AI 生成文字。权利要求、说明书、摘要与附图需要相互对应，术语和标记号需要一致，每次修改需要能复核，最终还要交付可编辑的正式文档。

知撰将 **AI 建议、确定性检查、人工审阅与文档构建** 放在同一个工作台，面向专利代理人员、企业知识产权团队和科研人员：

- **以文稿为中心**：Markdown 是真源，三书、版面与导出文件由同一份材料组织。
- **把决定权留给人**：AI 修改以建议呈现，由作者接受或拒绝，不静默覆盖原稿。
- **让问题可定位**：将权项引用、术语、图号与附图标记等检查带回撰写过程。
- **不止聊天回答**：从材料整理、案件管理到 DOCX / PDF 导出，衔接实际交付流程。

## 产品预览

### 案件台账

在同一入口管理案卷，查看撰写状态、负责人、审阅与期限信息。

![案件台账：两个基于已公开专利重建的演示案卷](frontend/public/lp/dashboard.png)

### 附图与图文对应

将附图资源、图号、题注与正文引用放在一起核对；支持附图绘制与编辑，不让图和文字各自成为孤岛。

![公开专利示例的附图管理：图号、资源与引用信息](docs/assets/figures.png)

> 上述图片来自本地运行的公开版，使用 [CN109840487A](https://patents.google.com/patent/CN109840487A/zh) 重建案例；台账同时展示 [CN109002879B](https://patents.google.com/patent/CN109002879B/zh) 重建案例。截图仅展示界面，不代表真实 AI 生成效果或完整质量验收。语料与完整附图库为可选数据，不随代码仓分发。

## 核心能力

| 环节 | 可以做什么 |
| --- | --- |
| 材料整理 | 导入技术交底、论文等材料；PDF 文本提取与 OCR 辅助；AI 起草三书初稿 |
| 撰写与审阅 | 三书编辑、AI 修改建议、批注与修订、版本历史；源码 / 版面 / PDF 视图 |
| 一致性检查 | 术语、权项引用、摘要、图号与标记号检查；递交前体检 |
| 附图处理 | 附图资源管理、绘制与编辑；图号声明、题注与正文引用核对 |
| 排版与交付 | Markdown → DOCX → LibreOffice → PDF；文档导出与递交材料辅助 |
| 案件与协作 | 案件台账、期限、多人协同、审阅与客户确认流程 |
| Agent 集成 | 通过 MCP 读取案件、检查文稿、构建文档或提出建议，遵循账号与案件权限 |

**推荐体验路径**：打开示例 → 编辑三书 → 查看术语 / 图文诊断 → 人工审阅建议 → 构建并导出 DOCX / PDF。

## 快速开始

### Docker 部署

需要 Git、Docker 及 Docker Compose 插件。

```bash
git clone https://github.com/wookat/patent-studio.git
cd patent-studio
docker compose up --build -d
```

浏览器打开 **http://localhost:8000**。首次启动时，空数据卷会初始化 `method`、`system` 两个公开演示案例。案件和构建结果保存在命名卷 `patent-data` 中；**不要用 `docker compose down -v` 清理需要保留的案件数据**。

Compose 同时启动一个 `postgres`（PostgreSQL 17）服务，承载账号、协作、通知、列表状态等应用数据（卷 `patent-pgdata`）。应用通过 `PATENT_STUDIO_DATABASE_URL` 连接，开发默认 `postgresql://patent:patent@postgres:5432/patent_studio`；自建数据库时只需覆盖该变量。数据库 schema 在**首次用到数据库时**由 Alembic 自动迁移建表，无启动迁移要求。

- `PATENT_STUDIO_AUTH=off` 且未配数据库时仍可正常浏览 / 编辑案件；归档、回收站等**写库状态变更**需要 PostgreSQL（未配置时接口返回 503 并提示设置 `PATENT_STUDIO_DATABASE_URL`）。
- 本版本不再读写 SQLite（`studio.db`）；旧部署里的存量数据需另行一次性导入工具迁移，请勿将本版本直接切换到有数据的生产部署上。

```bash
docker compose logs -f patent-studio  # 查看日志
docker compose down                 # 停止服务，保留数据卷
```

> **安全提醒**：默认未启用鉴权，Compose 默认发布 8000 端口。本配置仅用于受信任的本机开发环境，不要直接暴露到公网或共享网络。对外部署前需限制端口访问、配置 HTTPS、启用 `PATENT_STUDIO_AUTH=on` 并设置 `PATENT_STUDIO_SECRET`；HTTPS 下还需配置 `PATENT_STUDIO_COOKIE_SECURE=on`。

### AI 配置

没有模型密钥也可以使用编辑、检查与文档构建；真实 AI 功能需另行配置模型服务凭证，可能产生费用。

当前默认 provider 为 `aicdks`，服务地址与模型路由见 [调用层实现](backend/app/ai/client.py)。实现使用 OpenAI 兼容协议，但**尚不支持通过环境变量任意切换服务地址，也不承诺所有兼容服务即插即用**。

Compose 不会自动透传宿主机的 AI 密钥。可在本地新建 `docker-compose.override.yml`，添加以下环境映射，并在运行 Compose 的终端安全设置 `PATENT_STUDIO_AI_KEY` 后重新执行启动命令：

```yaml
services:
  patent-studio:
    environment:
      PATENT_STUDIO_AI_PROVIDER: aicdks
      PATENT_STUDIO_AI_KEY: ${PATENT_STUDIO_AI_KEY:?请先设置模型服务密钥}
```

不要将真实密钥写入文件或提交到 Git。`PATENT_STUDIO_AI_PROVIDER=mock` 仅用于离线开发和测试，不能作为真实 AI 效果证明。

**数据边界**：远端模型与检索服务可能接收你提供的技术材料。私有部署不自动意味着数据不出网；处理未公开发明或客户资料前，请核对服务商政策及材料授权。

<details>
<summary><strong>本地开发与检查命令</strong></summary>

准备 Python 3.11+、uv、Node.js 22.12+、pnpm、LibreOffice 及可用的中文字体。Linux 下可使用 fontconfig 配置字体别名，字体说明见 [fonts/README.md](fonts/README.md)。

```bash
# 安装依赖
cd backend && uv sync && cd ..
cd frontend && pnpm install --frozen-lockfile && cd ..

# 开发模式：后端 :8000，前端 :5173
make dev

# 前端构建 / 后端托管
make build
make serve
```

LibreOffice 未在 PATH 中时可通过 `SOFFICE_BIN` 指定可执行文件。不同系统的字体及 LibreOffice 版本可能影响分页，不保证与 Microsoft Word 完全一致。

```bash
make lint           # 后端 ruff + 前端 lint
make typecheck      # TypeScript
make test           # 后端 pytest
make test-frontend  # 前端 Vitest
make roundtrip      # 三书拆合检查
```

**质量状态**：当前仍有已知 lint / 测试基线问题，部分检查还依赖字体、LibreOffice 或数据资源；不承诺全量检查全绿。提交贡献时请记录环境、命令与结果，不新增已有告警。历史测试数量不作为当前版本的验收结论。

</details>

## 技术结构

```text
技术材料 / 已有文稿
        ↓
React + TypeScript 工作台
        ↓
FastAPI ── AI 建议 / 确定性检查 / 案件协作 / MCP
        ↓
Markdown 真源 → patent_studio.kernel → DOCX → LibreOffice → PDF
        ↑
可选的本地语料与附图库（独立审核来源与使用许可）
```

前端使用 React、Vite、CodeMirror、PDF 预览与附图编辑组件；后端使用 FastAPI 和 Python 文档构建工具。技术细节见 [系统设计](docs/design.md)。

## 文档与公开示例

| 入口 | 内容 |
| --- | --- |
| [使用手册](docs/user-manual.md) | 工作台操作、撰写、审阅与交付流程 |
| [系统设计](docs/design.md) | 数据结构、文档管线与实现约定 |
| [MCP 接入](docs/mcp.md) | 外部 Agent 的接入与权限边界 |
| [method 案例](examples/method) | 基于已公开 CN109840487A 重建：10 项权利要求、3 张附图 |
| [system 案例](examples/system) | 基于已公开 CN109002879B 重建：3 项权利要求、6 张附图 |
| [语料来源与重建](docs/text-corpus/README.md) | 数据来源、使用边界与构建工具 |
| [附图库来源与重建](docs/figure-library/README.md) | 分类 manifest、图像提取工具与使用边界 |
| [字体说明](fonts/README.md) | 开源替代字体、别名与用户自装字体 |

公开案例用于演示和回归测试，并非原申请文件的无损复刻或可直接套用的法律模板。案例与数据相关权利归相应权利人所有，不因代码采用 Apache-2.0 而自动转授；公开可访问不等于可任意再分发。

## 参与贡献

开发主线为 `main`，所有 PR 以 `main` 为目标。欢迎从可复现的问题、文档和小范围改进开始：

- **报告问题**：通过 [Issues](https://github.com/wookat/patent-studio/issues) 提供复现步骤、环境与脱敏材料。
- **提交改进**：阅读 [贡献指南](CONTRIBUTING.md)，优先补充确定性规则测试、模型适配、版式验证与公开示例。
- **安全问题**：按 [安全政策](SECURITY.md) 私下报告，不在公开 Issue 中贴密钥、客户案件或未公开技术信息。
- **协作约定**：遵循 [行为准则](CODE_OF_CONDUCT.md)，保持讨论具体、尊重与可复核。

近期重点是公开版的全新环境复现、完整案例验收、模型配置易用性，以及可校验的权项结构约束。欢迎用实际使用反馈帮助确定优先级。

## 许可证与使用声明

代码采用 **[Apache-2.0](LICENSE)**；署名与第三方声明见 [NOTICE](NOTICE)。本仓库不分发受限字体、完整语料 / 图库数据包或未公开申请稿。

知撰用于辅助专利材料撰写与审阅，**不提供法律意见，不承诺新颖性、创造性、受理或授权结果**。初稿、扫描件识别、图文关系与最终交付材料均需专业人员复核；工具不能替代未公开发明信息的保密责任，也不替代官方申请系统。
