<div align="center">
  <img src="frontend/public/logo-mark.svg" alt="知撰·AI 专利撰写与协同平台 Logo" width="88" />
  <h1>知撰·AI 专利撰写与协同平台</h1>
  <p><strong>面向中国发明专利的 AI 撰写与审阅工作台</strong></p>
  <p>AI 提出建议，人决定采纳。让技术材料、三书、附图与交付文件保持可追溯。</p>
  <p>An open-source, self-hosted workspace for drafting and reviewing Chinese invention patents.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-166534" alt="License: Apache-2.0" /></a>
    <a href="backend/pyproject.toml"><img src="https://img.shields.io/badge/Python-3.11%2B-3776AB" alt="Python 3.11+" /></a>
    <a href="frontend/package.json"><img src="https://img.shields.io/badge/React-19-149ECA" alt="React 19" /></a>
  </p>
  <p>
    <a href="#快速开始">快速开始</a> ·
    <a href="#界面预览">界面预览</a> ·
    <a href="docs/user-manual.md">使用手册</a> ·
    <a href="docs/project-intro.md">项目介绍</a> ·
    <a href="CONTRIBUTING.md">参与贡献</a>
  </p>
</div>

## 知撰是什么

知撰（正式名「知撰·AI 专利撰写与协同平台」）是一个开源、可私有部署的专利撰写工作台，面向中国发明专利申请，服务于专利撰写与代理人员、企业知识产权团队、高校与科研人员。它围绕一份 Markdown 源文，把技术材料、三书（摘要、权利要求书、说明书）、附图与交付文件组织在同一个案卷里，AI 辅助与协作审阅在其中完成。

它不是「一键生成专利」的工具：AI 辅助起草初稿、以修订和批注形式提出修改建议，默认经撰写人复核后才采纳进文稿，定稿与递交始终由人决定；术语一致性、权项引用、图号与附图标记等检查随写随跑。知撰辅助撰写与审阅，不提供法律意见，也不替代官方申请系统。

## 它想解决什么困扰

写一件发明专利时，真正的麻烦往往不是「AI 写得不够好」：

- 交底书、论文、附图和修改意见散在不同文件里，合稿靠人工记忆；
- AI 写的段落和人工写的混进同一份正文，事后难以区分、难以负责；
- 术语前后不一、权项引用错层、图号与附图标记对不上，常常到递交前才暴露；
- 导出的 Word / PDF 和手头的稿子是不是同一份内容，无从核对。

知撰把「写稿—检查—审阅—出稿」收进同一个工作区：每处修改可追溯，每条 AI 建议可裁决，每次导出有源可查。

## 围绕一份专利材料怎么用

工作以案卷为单位组织。典型用法是：

1. **建案**：在台账新建案卷，或把已有的 Word 文稿导入成案卷；
2. **整理材料**：导入技术交底书、论文 PDF 等（支持文本提取与 OCR 辅助）；配置 AI 后可以让它基于材料起草三书初稿；
3. **撰写与修改**：三书在同一案卷内编辑，可在源码、版面与 PDF 预览之间切换对照；
4. **随写随查**：术语一致性、权项引用、图号与附图标记等检查在工作台内运行，递交前用体检汇总；
5. **请人审阅**：邀请协作者批注与修订，或给客户发免登录确认链接；AI 修改建议同样由人复核后采纳或拒绝；
6. **导出交付**：导出 DOCX、PDF 与 CNIPA XML 文件，人工核对后走正式递交流程。

此外还有案件台账、期限提醒、附图管理与绘制、版本历史等日常管理能力，详见[使用手册](docs/user-manual.md)。

## 界面预览

![知撰工作台：公开示例的三书源码、文档预览与附图管理](frontend/public/lp/workbench.png)

![案件台账：两个基于已公开专利重建的演示案卷](frontend/public/lp/dashboard.png)

![公开专利示例的附图管理：图号、资源与引用信息](docs/assets/figures.png)

> 界面截图取自更名前版本的公开示例（图中保留旧技术名，不影响现行项目名称）；演示案卷基于已公开专利 [CN109840487A](https://patents.google.com/patent/CN109840487A/zh) 与 [CN109002879B](https://patents.google.com/patent/CN109002879B/zh) 重建，仅展示界面形态，不代表 AI 产出质量或授权前景。

## 快速开始

### Docker 部署（推荐体验方式）

需要 Git、Docker 及 Docker Compose 插件。

```bash
git clone https://github.com/wookat/patent-studio.git
cd patent-studio
docker compose up --build -d
```

浏览器打开 **http://localhost:8000**。首次启动会初始化 `method`、`system` 两个公开演示案卷；案件与数据保存在命名卷 `patent-data` / `patent-pgdata` 中——**不要用 `docker compose down -v` 清理需要保留的数据**。

```bash
docker compose logs -f patent-studio  # 查看日志
docker compose down                   # 停止服务，保留数据卷
```

> **安全提醒**：默认未启用鉴权，Compose 默认发布 8000 端口，仅用于受信任的本机环境，不要直接暴露到公网或共享网络。对外部署前需限制端口访问、配置 HTTPS、启用 `PATENT_STUDIO_AUTH=on` 并设置 `PATENT_STUDIO_SECRET`；HTTPS 下还需 `PATENT_STUDIO_COOKIE_SECURE=on`。

鉴权、数据库与对象存储、AI 通道等完整配置项见[部署指南](docs/deploy.md)。

### 本地开发

需要 Python 3.11+、uv、Node.js 22.12+、pnpm；PDF 预览依赖 LibreOffice 与中文字体（字体说明见 [fonts/README.md](fonts/README.md)）。

```bash
cd backend && uv sync && cd ..
cd frontend && pnpm install --frozen-lockfile && cd ..

make dev      # 开发模式：后端 :8000，前端 :5173
make build    # 前端构建
make serve    # 后端托管构建产物，单进程 :8000
```

常用检查：`make lint`（ruff + 前端 lint）、`make typecheck`、`make test`、`make test-frontend`。当前仍有少量既有 lint / 测试基线问题，部分检查依赖字体与 LibreOffice，不承诺全量全绿；提交改动请保持不新增告警。

## AI 与数据注意事项

- **不配密钥也能用**：编辑、检查、构建与导出不依赖模型服务；AI 起草、修改建议、检索等需要另行配置模型凭证，费用由所选服务商决定。工作台 AI 与平台 Agent 是两组独立配置，详见[部署指南](docs/deploy.md)；`mock` provider 完全离线，仅供开发测试，不代表真实 AI 效果。
- **AI 产出是辅助而非定稿**：修改默认以修订或批注建议形式给出，经人复核采纳后才进入文稿；经 MCP 接入的外部 Agent 按其授权权限读写案卷（边界见 [MCP 接入](docs/mcp.md)）。定稿与递交由人决定；AI 可能出错，正式材料需专业人员复核。
- **私有部署不等于数据不外发**：案卷保存在部署方自己的存储中；但一旦配置远端模型或检索服务，相关材料会发送到对应服务商的网关。处理未公开发明或客户资料前，请核对服务商政策与材料授权。
- **不替代正式流程**：知撰辅助撰写、检查与审阅，不提供法律意见，不承诺新颖性、创造性、受理或授权结果，也不替代官方申请系统。

## 文档与公开示例

| 入口 | 内容 |
| --- | --- |
| [项目介绍](docs/project-intro.md) | 面向新读者的项目定位与使用方式说明 |
| [使用手册](docs/user-manual.md) | 工作台操作、撰写、审阅与交付流程 |
| [系统设计](docs/design.md) | 数据结构、文档管线与实现约定 |
| [部署指南](docs/deploy.md) | 服务形态、环境变量全表与迁移导入器 |
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
- **提交改进**：阅读[贡献指南](CONTRIBUTING.md)，优先补充确定性规则测试、模型适配、版式验证与公开示例。
- **安全问题**：按[安全政策](SECURITY.md)私下报告，不在公开 Issue 中贴密钥、客户案件或未公开技术信息。
- **协作约定**：遵循[行为准则](CODE_OF_CONDUCT.md)，保持讨论具体、尊重与可复核。

近期重点是公开版的全新环境复现、完整案例验收、模型配置易用性，以及可校验的权项结构约束。欢迎用实际使用反馈帮助确定优先级。

## 许可证与使用声明

代码采用 **[Apache-2.0](LICENSE)**；署名与第三方声明见 [NOTICE](NOTICE)。本仓库不分发受限字体、完整语料 / 图库数据包或未公开申请稿。

知撰用于辅助专利材料撰写与审阅，**不提供法律意见，不承诺新颖性、创造性、受理或授权结果**。初稿、扫描件识别、图文关系与最终交付材料均需专业人员复核；工具不能替代未公开发明信息的保密责任，也不替代官方申请系统。
