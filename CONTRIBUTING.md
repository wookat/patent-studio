# 贡献指南

感谢关注知撰 · Patent Studio。

## 分支与流程

- 唯一开发主线为 `main`，所有 PR 以 `main` 为目标。
- `archive/patent-branches-2026-10-12` 为历史归档分支，仅用于保全旧分支历史，
  不接受 PR，也请勿删除。
- 提交前本地跑：`make lint`（ruff + 前端 lint）、`make typecheck`、
  `make test`（后端 pytest）、`make test-frontend`（Vitest）。
  目前存在少量既有 lint/测试基线问题，改动应保持不新增告警。

## 专利内容契约

- Markdown 为唯一真源：AI 一律输出 Proposal/CriticMarkup 建议由人审阅采纳，
  不得静默覆盖作者的 `content.md`。
- 三书（权利要求/说明书/摘要）、附图、标记号、术语之间的一致性由体检与
  preflight 校验，新增生成逻辑请同时补充对应校验与测试。

## 安全与隐私

- 不得提交任何密钥、令牌或真实客户案件材料。
- 涉及鉴权、公网部署、对外数据外发的改动请在 PR 中显式说明影响面。

## 许可证

贡献一经合入即按 Apache-2.0 发布；引入新依赖请确认许可证兼容（不接受
GPL/AGPL 等 copyleft 依赖进入运行时）。
