# 安全政策

## 报告漏洞

请通过 GitHub Security Advisories（仓库 Security 标签页 → Report a vulnerability）
私下报告，不要在公开 Issue 中披露细节。我们会在 7 天内回应。

## 部署须知

- `PATENT_STUDIO_AUTH` 默认为 `off`（无鉴权）。**任何对外暴露的部署必须显式开启鉴权**
  并配置会话密钥；HTTPS 反代下还需设置安全 cookie。
- 案例材料默认只存本机；配置远端 AI provider 后材料会发送到对应网关，
  请按单位数据政策选择 provider 与脱敏策略。
- 历史部署记录不代表当前线上权限状态，部署后以实际鉴权配置为准。

## 支持版本

仅以 `main` 最新提交为准；不维护历史版本的安全更新。
