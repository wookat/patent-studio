.PHONY: help install fonts dev dev-backend dev-frontend build serve lint typecheck test test-frontend check zero-drift roundtrip shots axe agent-eval docker-up docker-down clean

help:
	@echo "make install     安装后端(uv)与前端(pnpm)依赖，并安装字体别名到 ~/.config/fontconfig"
	@echo "make fonts       安装 fontconfig 别名（宋体/黑体→OFL 替身）；需授权真字体请自装到 ~/.fonts"
	@echo "make dev         同时启动后端 :8000 与前端 :5173（Ctrl+C 停止）"
	@echo "make build       前端生产构建 → frontend/dist（后端自动托管）"
	@echo "make serve       以生产方式单进程启动（后端托管 frontend/dist）"
	@echo "make lint        ruff + oxlint + lint-tokens（设计 token 禁令）"
	@echo "make typecheck   tsc -b"
	@echo "make test        pytest（含零漂移 md5 回归 + CNIPA 资产 md5）"
	@echo "make test-frontend  vitest 全量（含 components/ui 冒烟 + axe + 对比度）"
	@echo "make zero-drift  打印两案 word/document.xml md5 并与基准比对"
	@echo "make roundtrip   三书拆合往返：assemble(split(md)) == md（两案 examples）"
	@echo "make check       lint + typecheck + test + test-frontend + build（本地验收全绿）"
	@echo "make shots       路由 × 视口 × 主题 截图 → frontend/shots/（需 make dev 已起，Chrome CDP :29229 或 CHROME_BIN）"
	@echo "make axe         同参数 axe-core 扫描 → JSON；serious/critical > 0 退出 1"
	@echo "make agent-eval  真模型智能体评估（需 PATENT_STUDIO_AI_API_KEY；不进 check）"
	@echo "make docker-up   docker compose up --build -d"

install: fonts
	cd backend && uv sync
	cd frontend && pnpm install

fonts:
	mkdir -p ~/.config/fontconfig/conf.d && cp docker/fonts-cjk-alias.conf ~/.config/fontconfig/conf.d/64-patent-studio-cjk-alias.conf && (fc-cache -f >/dev/null 2>&1 || true)
	@echo "已装字体别名。如需 Word 同字形预览，请把已获授权的 SimSun/SimHei 等字体自行放入 ~/.fonts 后 fc-cache -f"
	@fc-match 宋体; fc-match 黑体

dev:
	@trap 'kill 0' INT TERM; \
	(cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --ws-ping-interval 15 --ws-ping-timeout 20) & \
	(cd frontend && pnpm dev) & \
	wait

dev-backend:
	cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --ws-ping-interval 15 --ws-ping-timeout 20

dev-frontend:
	cd frontend && pnpm dev

build:
	cd frontend && pnpm build

serve: build
	cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --ws-ping-interval 15 --ws-ping-timeout 20

lint:
	cd backend && uv run ruff check .
	cd frontend && pnpm lint

typecheck:
	cd frontend && pnpm exec tsc -b

test:
	cd backend && uv run pytest -q

test-frontend:
	cd frontend && pnpm vitest run

zero-drift:
	cd backend && uv run python scripts/zero_drift.py

roundtrip:
	cd backend && uv run python -m patent_docx.docset --check ../examples/method ../examples/system

check: lint typecheck test test-frontend build
	@echo "✅ 本地验收全绿"

shots:
	cd frontend && node scripts/shot-cdp.mjs $(SHOTS_ARGS)

axe:
	cd frontend && node scripts/axe-cdp.mjs $(AXE_ARGS)

agent-eval:
	cd backend && uv run python scripts/agent_eval.py --provider real $(AGENT_EVAL_ARGS)

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

clean:
	rm -rf frontend/dist examples/*/.studio .lo_profile
