# Patent Studio MCP Server

让 Codex / Claude Code 等智能体通过 [MCP](https://modelcontextprotocol.io) 操作专利工作台：读三书、拿块 AST、以 **CriticMarkup 建议**方式改块、lint / 体检 / 构建 / 导出 XML。设计定稿：`docs/plan/10-r7-r9-mcp-word-design.md` §3。

> 状态（2026-09-05，单元 F1）：13 个 v1 工具 + 资源 `patent://{pid}/docs/{book}` 已实现并有测试（`backend/tests/test_mcp.py`，15 例）；两种传输、PAT 生成/撤销、ACL 角色门、审计均落地。实测记录见文末「验证状态」。

## 两种传输

| 方式 | 用途 | 启动 |
|------|------|------|
| stdio | 本机 Codex / Claude Code 直连，无需后端进程 | `cd backend && uv run python -m app.mcp` |
| Streamable HTTP | 远程 / 多客户端；与 FastAPI 同进程 | `make dev` 后 `http://127.0.0.1:8000/mcp`（精确路径，无 `/mcp/`） |

案卷目录同后端：环境变量 `PATENT_PROJECTS_DIR`（默认 `examples/`）。

## 鉴权

| `PATENT_STUDIO_AUTH` | stdio | HTTP `/mcp` |
|---|---|---|
| `off`（默认） | 身份 `local`，不设限 | 只允许 `127.0.0.1` / `::1` 连接（其他 → 403）；`Host` 只接受 `127.0.0.1` / `localhost` / `[::1]`（SDK DNS 重绑定保护，其他 → 421） |
| `on` | env `PATENT_STUDIO_PAT=pat_…`；缺失 / 无效 / 已撤销 → stderr 提示并以退出码 2 结束 | `Authorization: Bearer pat_…`；无 / 无效 / 已撤销 → 401 |

AUTH=on 时 PAT 绑定创建它的用户，工具按案卷 ACL（`projects_acl`）判角色：

| 操作 | 需要 |
|---|---|
| `list_projects` | 只列该用户有角色的案卷（superuser 全部） |
| 读 / lint / preflight / build / export_xml / list_figures / get_history / 资源 | viewer+ |
| `patch_block` / `insert_block`（默认建议模式）、`add_comment` | viewer+ |
| `patch_block` / `insert_block` **`direct=true`** | editor+，否则 `forbidden`（也进审计） |

### PAT 管理路由（AUTH=on；off 时 501）

| 路由 | 说明 |
|---|---|
| `POST /api/pat` `{"name": "codex 本机"}` | 201 → `{id, name, prefix, created_at, last_used_at, token}`；**`token` 只在这一次响应里出现**，库中只存 sha256 |
| `GET /api/pat` | 当前用户未撤销的令牌（无 token 字段） |
| `DELETE /api/pat/{id}` | 204 撤销（幂等）；之后 `/mcp` 用它 → 401 |

令牌格式 `pat_` + 32 位十六进制；`last_used_at` 在每次成功鉴权时更新。

## 工具集 v1（schema：`backend/app/mcp/schemas.py`）

| 工具 | 参数 | 返回 |
|------|------|------|
| `list_projects` | — | `[{id, title, mtime}]`（AUTH=on 按 ACL 过滤） |
| `read_book` | `pid, book, mode=final` | `{pid, book, text}`；`mode`：`final` 接受全部建议后、`original` 拒绝后、`markup` 含标记原文 |
| `get_ast` | `pid` | 同 `GET /api/projects/{pid}/ast`：块 id（`claims/1`、`abstract/p1`、`description/...`）用于下面三类写操作 |
| `get_docs` | `pid` | `{pid, title, abstract, claims, description}`（源码原文，含标记） |
| `patch_block` | `pid, block_id, markdown, direct=false` | `{ok, mode: suggest\|direct, sha, block_id}`。**默认建议模式**：服务端对块做行 diff，同行改动写 `前缀{~~旧~>新~~}后缀`（结构前缀 `1.` / `### ` 保留在标记外），整行增删写 `{++ ++}` / `{-- --}`；`direct=true` 才直改源码 |
| `insert_block` | `pid, kind, after_block_id=None, book=None, markdown=None, direct=false` | 同上；`kind` ∈ paragraph / claim / section / subsection / equation / table / figure-ref；`markdown` 缺省用该类型模板；默认整块包成 `{++ ++}` |
| `lint` | `pid` | `{diagnostics, counts}`，含 CriticMarkup 标记 lint（`critic.nested` / `critic.unclosed`） |
| `preflight` | `pid` | 递交前体检报告（同 `GET /api/projects/{pid}/preflight`） |
| `build` | `pid, mode=final, pdf=true` | `{status, build_id, pdf_url, docx_url, diagnostics, summary, error}`；URL 相对后端根 |
| `export_xml` | `pid, mode=final` | CNIPA 五书 XML：各书 `xml_url` / `preview_url` 与 `zip_url` |
| `list_figures` | `pid` | `{figures: [{name, ext, size, num, width, is_abstract, preview, companions}], settings}` |
| `add_comment` | `pid, anchor={block_id, line, quote}, body` | 新建批注线程（作者 = PAT 用户或 `本机`） |
| `get_history` | `pid, limit=20` | `[{sha, at, message, author, added, deleted}]` 新→旧 |

资源：`patent://{pid}/docs/{book}` → `text/markdown`，一书源码原文（含标记）。

所有工具都复用 REST 同一套 app 层函数（`ProjectStore` / `routes_ast._parse` / `lint` / `run_build` / `run_xml_export` / `figures` / `comments` / `history` / `patent_studio.kernel.patch`），写操作走 `save_content`（.bak + 三书镜像 + git commit）。

错误：工具返回 `isError=true`，文本为 `Error executing tool <name>: {"kind": "...", "message": "...", "line": null, "detail": null}`，`kind` 与 REST 的 `error_detail` 一致：`not_found`（案子不存在）、`stale`（块 id 不在当前结构里）、`kind` / `content`（补丁不合法）、`forbidden`、`bad_request`、`figures`、`history`。

## 审计

每次案卷级工具调用（含业务错误与 `forbidden`）追加一行到案卷 `.studio/audit.jsonl`；`args` 只记标量与文本长度，不记正文：

```json
{"ts":"2026-09-05T02:06:34Z","who":"local","tool":"patch_block","args":{"block_id":"claims/1","direct":false,"markdown_len":120},"result":"ok"}
```

`result`：`ok` / `error:<kind>`。读取：`GET /api/projects/{pid}/audit?limit=50`（最新在前）；前端「设置 › 集成」页展示。

## 客户端配置

### Codex（`~/.codex/config.toml`）

```toml
[mcp_servers.patent-studio]
command = "uv"
args = ["run", "--project", "/ABS/PATH/patent-studio/backend", "python", "-m", "app.mcp"]
env = { PATENT_PROJECTS_DIR = "/ABS/PATH/patent-studio/examples" }
# AUTH=on 时再加：PATENT_STUDIO_AUTH = "on", PATENT_STUDIO_PAT = "pat_…"
```

### Claude Code

```bash
# stdio
claude mcp add patent-studio -e PATENT_PROJECTS_DIR=/ABS/PATH/patent-studio/examples \
  -- uv run --project /ABS/PATH/patent-studio/backend python -m app.mcp
# HTTP（需 make dev；AUTH=on 时加 PAT）
claude mcp add --transport http patent-studio http://127.0.0.1:8000/mcp \
  --header "Authorization: Bearer pat_…"
```

### 官方 Python 客户端（`mcp` 2.x）

```python
from mcp.client.client import Client
from mcp.client.stdio import StdioServerParameters
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

# stdio
async with Client(StdioServerParameters(command="uv", args=["run", "python", "-m", "app.mcp"], cwd="backend")) as c:
    print([t.name for t in (await c.list_tools()).tools])

# Streamable HTTP（AUTH=on 时 headers={"Authorization": "Bearer pat_…"}）
hc = create_mcp_http_client(headers=None)
async with Client(streamable_http_client("http://127.0.0.1:8000/mcp", http_client=hc)) as c:
    r = await c.call_tool("read_book", {"pid": "method", "book": "claims"})
    print(r.structured_content["text"][:80])   # HTTP JSON 里字段名是 structuredContent
```

## 验证状态

### verified（2026-09-05，本机实跑）

`uv run pytest tests/test_mcp.py` → 15 passed：官方 `Client` 分别经 stdio 子进程（`python -m app.mcp`）与 uvicorn 真端口 `/mcp` 跑 `list_tools → read_book → patch_block(建议) → lint → build`；13 工具逐个调用 + 资源读取 + 错误形状；AUTH=off 远程 403；AUTH=on 无 PAT 401、PAT 创建/列表/撤销、撤销后 401、viewer `direct=true` → forbidden、owner/superuser 直改成功、stdio 缺 PAT 退出码 2；审计 who/tool/result。

官方客户端脚本（`mcp` 2.1.1，AUTH=off，临时案卷目录）对两种传输各跑一遍，输出：

```
[stdio] list_tools → ['list_projects', 'read_book', 'get_ast', 'get_docs', 'patch_block', 'insert_block', 'lint', 'preflight', 'build', 'export_xml', 'list_figures', 'add_comment', 'get_history']
[stdio] read_book → '\n1.一种时间序列预测模型部署期可信自适应控制方法，其特征在于，所述方法包括以下步骤：\n步骤一，冻结基础预测模型：将离线'…
[stdio] patch_block → {'ok': True, 'mode': 'suggest', 'sha': 'b28b6654e2d698d5eaffec4df8fc66806814bc8c', 'block_id': 'claims/1'}
[stdio] markup → ['1.一种时间序列预测模型部署期可信自适应控制方法{++及系统++}，其特征在于，所述方法包括以下步骤：']
[stdio] lint → counts={'error': 0, 'warning': 2, 'info': 0}
[stdio] build → status=ok docx_url=/api/projects/method/builds/20260905-020632-d10680/out.docx
[http] list_tools → [同上 13 个]
[http] read_book → '\n1.一种时间序列预测模型部署期可信自适应控制方法，其特征在于，所述方法包括以下步骤：\n步骤一，冻结基础预测模型：将离线'…
[http] patch_block → {'ok': True, 'mode': 'suggest', 'sha': 'cff2b6c98182648cc642e9f5f53635a34f1dff2c', 'block_id': 'claims/1'}
[http] markup → ['1.一种时间序列预测模型部署期可信自适应控制方法{++及系统++}，其特征在于，所述方法包括以下步骤：']
[http] lint → counts={'error': 0, 'warning': 2, 'info': 0}
[http] build → status=ok docx_url=/api/projects/method/builds/20260905-020633-abacb9/out.docx
audit tail: {"ts": "2026-09-05T02:06:34Z", "who": "local", "tool": "build", "args": {"mode": "final", "pdf": false}, "result": "ok"}
```

`npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:8765/mcp`（uvicorn `app.main:app`，AUTH=off，临时案卷目录）实跑：

```
## tools/list
['list_projects', 'read_book', 'get_ast', 'get_docs', 'patch_block', 'insert_block', 'lint', 'preflight', 'build', 'export_xml', 'list_figures', 'add_comment', 'get_history']
## read_book  --tool-arg pid=method book=claims
'\n1.一种时间序列预测模型部署期可信自适应控制方法，其特征在于，所述方法包括以下步骤：\n步骤一，冻结基础预测模型：将离线'
## patch_block  --tool-arg pid=method block_id=claims/1 "markdown=<整块，仅第一行加「及系统」>"
{'ok': True, 'mode': 'suggest', 'sha': 'b18933d90dd8275efff00d34848a1a62ea5bad16', 'block_id': 'claims/1'}
## read_book mode=markup（含标记行）
['1.一种时间序列预测模型部署期可信自适应控制方法{++及系统++}，其特征在于，所述方法包括以下步骤：']
## lint
{'error': 0, 'warning': 2, 'info': 0}
## build  --tool-arg pid=method pdf=false
status= ok docx_url= /api/projects/method/builds/20260905-021228-382fca/out.docx
## resources/read --uri patent://method/docs/abstract
text/markdown '\n本发明公开了一种时间序列预测模型部署期可信自适应控制方法及装置。方法包括：冻结'
## audit tail
{"ts": "2026-09-05T02:12:28Z", "who": "local", "tool": "build", "args": {"mode": "final", "pdf": false}, "result": "ok"}
```

注：inspector `--cli` 的 stdio 目标参数解析在本机多种写法下都报 `Target is required` / `No servers found`，stdio 传输的实测以上面官方 Python 客户端（`StdioServerParameters` 起 `python -m app.mcp` 子进程）为准。

`make check`（ruff + 278 pytest + oxlint + tsc + vite build）、`make zero-drift`、`make roundtrip` 全绿。

### unverified

- Codex CLI、Claude Code 真实客户端连接（本机未安装；上面的配置按两者公开文档格式书写）。
- inspector Web UI（只跑了 `--cli`）。
- `build(pdf=true)` 经 LibreOffice 出 PDF 的 MCP 路径（测试用 `pdf=false`；PDF 转换本身由 `tests/test_build*.py` 覆盖）。
