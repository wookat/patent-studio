#!/bin/sh
set -e
PROJECTS="${PATENT_PROJECTS_DIR:-/data/projects}"
LO_PROFILE="${LO_PROFILE_DIR:-/data/.lo_profile}"
mkdir -p "$PROJECTS" "$LO_PROFILE"
# 空卷 → 用示例案子初始化（method / system + check_all.py）
if [ -z "$(ls -A "$PROJECTS" 2>/dev/null)" ]; then
  echo "[patent-studio] 初始化示例案子 → $PROJECTS"
  cp -r /app/examples/method /app/examples/system /app/examples/check_all.py "$PROJECTS"/
fi
# check_all.py / build_docx.py 需要能 import patent_docx
[ -e "$PROJECTS/patent_docx" ] || ln -s /app/backend/patent_docx "$PROJECTS/patent_docx"

# 常驻 LibreOffice（unoserver）。用独立 profile，避免与 CLI 回退路径的 soffice 抢同一 UserInstallation。
# unoserver 在 LibreOffice 崩溃/超时后会退出，这里循环拉起；期间后端自动回退 soffice CLI。
if [ -n "${UNOSERVER_URL:-}" ] && [ -d /opt/unoserver ]; then
  UNO_PORT="${UNOSERVER_URL##*:}"
  (
    while true; do
      PYTHONPATH=/opt/unoserver /usr/bin/python3 -m unoserver.server \
        --interface 127.0.0.1 --port "$UNO_PORT" --uno-port 2002 \
        --user-installation "$LO_PROFILE-uno" \
        --conversion-timeout "${SOFFICE_TIMEOUT:-120}" || true
      echo "[patent-studio] unoserver 退出，2 s 后重启"
      sleep 2
    done
  ) &
fi
exec "$@"
