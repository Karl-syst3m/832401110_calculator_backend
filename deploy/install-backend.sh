#!/usr/bin/env bash
# =============================================================================
# 计算器后端 —— 一键部署脚本
#
# -----------------------------------------------------------------------------
# 为什么需要这个脚本（而不是只给一份文档）
#
# 最初提供的是带 <APP_DIR> / <NODE_BIN> 占位符的 systemd 单元模板，
# 让使用者自己替换。部署前用 `systemd-analyze verify` 校验模板时发现：
#
#     WorkingDirectory= path is not absolute: <APP_DIR>
#     Unit configuration has fatal error, unit will not be started.
#
# 也就是说，只要漏替换一个占位符，systemd 会直接拒绝启动，
# 而它的报错信息**不会**提示「你忘了替换占位符」，
# 排查者很容易误以为是服务本身有问题。
#
# 本脚本的应对方式是消除占位符这个失败模式本身：
#   - 安装目录从脚本自身位置推导，不再需要手工填写；
#   - node 路径自动探测；
#   - 安装前先跑一次 `systemd-analyze verify`，校验不通过就中止。
#
# -----------------------------------------------------------------------------
# 用法
#
#   sudo ./deploy/install-backend.sh                  # 正式安装
#   sudo ./deploy/install-backend.sh --dry-run        # 只校验，不修改系统
#   sudo APP_DIR=/opt/calc ./deploy/install-backend.sh  # 自定义安装目录
#
# 假设：本脚本位于后端仓库的 deploy/ 目录下（即 calculator_backend/deploy/）。
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
SERVICE_NAME="calculator-backend"
SERVICE_USER="calculator"
SERVICE_GROUP="calculator"
PORT="${PORT:-5000}"
HOST="${HOST:-127.0.0.1}"
LOG_LEVEL="${LOG_LEVEL:-info}"

DRY_RUN=0
ASSUME_YES=0

# ---------------------------------------------------------------------------
# 输出辅助
# ---------------------------------------------------------------------------
info()  { printf '  \033[36m·\033[0m %s\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
step()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -y|--yes)  ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "未知参数：$arg（用 --help 查看用法）" ;;
  esac
done

# ---------------------------------------------------------------------------
# 路径推导：从脚本自身位置得到仓库根目录，避免手工填写路径
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="${APP_DIR:-$REPO_DIR}"
UNIT_SOURCE="$SCRIPT_DIR/${SERVICE_NAME}.service"
UNIT_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

printf '\n\033[1m计算器后端部署%s\033[0m\n' "$([ "$DRY_RUN" -eq 1 ] && echo '（试运行，不会修改系统）' || echo '')"
echo "  仓库目录: $REPO_DIR"
echo "  安装目录: $APP_DIR"
echo "  服务名  : $SERVICE_NAME"

# ---------------------------------------------------------------------------
# 1. 前置检查
# ---------------------------------------------------------------------------
step "1/7 前置检查"

[ "$(id -u)" -eq 0 ] || fail "需要 root 权限运行（用 sudo）"
ok "以 root 运行"

command -v systemctl >/dev/null 2>&1 || fail "未找到 systemctl，本脚本要求 systemd 环境"
ok "systemd 可用：$(systemctl --version | head -1)"

command -v systemd-analyze >/dev/null 2>&1 || fail "未找到 systemd-analyze（用于安装前校验单元文件）"
ok "systemd-analyze 可用"

[ -f "$UNIT_SOURCE" ] || fail "找不到单元文件模板：$UNIT_SOURCE"
ok "单元文件模板存在"

[ -f "$APP_DIR/package.json" ] || fail "在 $APP_DIR 下找不到 package.json，请确认这是后端仓库根目录"
[ -f "$APP_DIR/src/server.js" ] || fail "在 $APP_DIR 下找不到 src/server.js"
ok "后端项目文件完整"

# ---- node 探测与版本校验 ----
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[ -n "$NODE_BIN" ] || fail "未找到 node，请先安装 Node.js >= 22.5.0"
[ -x "$NODE_BIN" ] || fail "node 不可执行：$NODE_BIN"

NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"

# 必须是绝对的、可解析的路径：systemd 不接受相对路径或命令名
NODE_BIN="$(readlink -f "$NODE_BIN")"

# node:sqlite 从 22.5.0 起可用；低于该版本服务会在启动时抛
# "Cannot find module 'node:sqlite'"，这里提前拦截并说明原因。
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  fail "Node 版本过低：$NODE_VERSION（本项目需要 >= 22.5.0，因为使用了内置模块 node:sqlite）"
fi
ok "node $NODE_VERSION（$NODE_BIN）"

# ---- 端口占用检查 ----
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  fail "端口 ${PORT} 已被占用，请先释放，或用 PORT=其他端口 重新运行"
fi
ok "端口 ${PORT} 空闲"

# ---------------------------------------------------------------------------
# 2. 创建运行用户（低权限，不用 root）
# ---------------------------------------------------------------------------
step "2/7 运行用户"

if id "$SERVICE_USER" >/dev/null 2>&1; then
  ok "用户 $SERVICE_USER 已存在，跳过创建"
elif [ "$DRY_RUN" -eq 1 ]; then
  info "将创建系统用户 $SERVICE_USER（试运行，跳过）"
else
  useradd --system --shell /usr/sbin/nologin --home "$(dirname "$APP_DIR")" "$SERVICE_USER"
  ok "已创建系统用户 $SERVICE_USER（不可登录）"
fi

# ---------------------------------------------------------------------------
# 3. 目录与权限
# ---------------------------------------------------------------------------
step "3/7 目录与权限"

if [ "$DRY_RUN" -eq 1 ]; then
  info "将创建数据目录 $APP_DIR/data 并授权给 $SERVICE_USER（试运行，跳过）"
else
  mkdir -p "$APP_DIR/data"
  # 整个目录交给服务用户，避免 npm install 与 SQLite 写入时权限不足。
  # 注意这里用递归授权是为了让脚本在"目录属主是 root"的常见情形下也能一次成功；
  # 若你不希望脚本改动既有属主，请先自行 chown 后再运行。
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_DIR"
  chmod 750 "$APP_DIR/data"
  ok "数据目录就绪：$APP_DIR/data"
fi

# ---------------------------------------------------------------------------
# 4. 安装依赖
# ---------------------------------------------------------------------------
step "4/7 安装依赖"

if [ "$DRY_RUN" -eq 1 ]; then
  info "将执行 npm install --omit=dev（试运行，跳过）"
else
  if ! command -v npm >/dev/null 2>&1; then
    fail "未找到 npm；本项目只有一个运行依赖（express），也可手工安装后再运行本脚本"
  fi
  ( cd "$APP_DIR" && sudo -u "$SERVICE_USER" npm install --omit=dev --no-audit --no-fund ) \
    || fail "npm install 失败"
  ok "依赖安装完成"
fi

# ---------------------------------------------------------------------------
# 5. 生成并校验 systemd 单元文件
# ---------------------------------------------------------------------------
step "5/7 生成并校验单元文件"

TEMP_UNIT="$(mktemp /tmp/${SERVICE_NAME}.XXXXXX.service)"

# 用这里推导出的真实路径替换模板中的占位符。
# 用户无需手工替换，也就不会出现"漏替换导致 systemd 拒绝启动"的情况。
sed \
  -e "s|<APP_DIR>|$APP_DIR|g" \
  -e "s|<NODE_BIN>|$NODE_BIN|g" \
  -e "s|<PORT>|$PORT|g" \
  -e "s|<HOST>|$HOST|g" \
  -e "s|<LOG_LEVEL>|$LOG_LEVEL|g" \
  "$UNIT_SOURCE" > "$TEMP_UNIT"

# 还必须把 Environment= 里的端口等替换掉（模板里是硬编码的，这里统一覆盖）
if grep -q '^Environment=PORT=' "$TEMP_UNIT"; then
  sed -i "s|^Environment=PORT=.*|Environment=PORT=$PORT|" "$TEMP_UNIT"
  sed -i "s|^Environment=HOST=.*|Environment=HOST=$HOST|" "$TEMP_UNIT"
  sed -i "s|^Environment=LOG_LEVEL=.*|Environment=LOG_LEVEL=$LOG_LEVEL|" "$TEMP_UNIT"
fi

info "校验单元文件语法…"
# systemd-analyze verify 会把未知指令、非绝对路径、权限错误等直接报出来。
# 若此处失败，脚本立即中止，不会把一个坏单元装进系统。
VERIFY_OUTPUT="$(systemd-analyze verify "$TEMP_UNIT" 2>&1 || true)"
if echo "$VERIFY_OUTPUT" | grep -qiE "fatal|bad unit file|not absolute"; then
  echo "$VERIFY_OUTPUT" | sed 's/^/      /' >&2
  rm -f "$TEMP_UNIT"
  fail "单元文件校验失败，已中止（未修改系统）"
fi
# 用户尚未创建等无害告警在这里忽略：第 2 步已确保用户存在
if [ -n "$VERIFY_OUTPUT" ]; then
  echo "$VERIFY_OUTPUT" | sed 's/^/      /'
  warn "校验有告警（通常无害，已继续）"
fi
ok "单元文件校验通过"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  info "试运行结束。生成的单元文件内容如下（未安装）："
  echo "  ────────────────────────────────────────────"
  sed 's/^/  │ /' "$TEMP_UNIT"
  echo "  ────────────────────────────────────────────"
  rm -f "$TEMP_UNIT"
  printf '\n\033[33m试运行完成，未对系统做任何修改。\033[0m\n'
  printf '去掉 --dry-run 即可正式安装。\n\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# 6. 安装并启动服务
# ---------------------------------------------------------------------------
step "6/7 安装并启动服务"

install -m 644 "$TEMP_UNIT" "$UNIT_TARGET"
rm -f "$TEMP_UNIT"
ok "已安装：$UNIT_TARGET"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"

# 给进程一点启动时间
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "服务已启动"
else
  echo
  systemctl status "$SERVICE_NAME" --no-pager -l | head -20 | sed 's/^/      /'
  fail "服务启动失败，请查看上方状态或 journalctl -u $SERVICE_NAME -n 50"
fi

# ---------------------------------------------------------------------------
# 7. 健康检查
# ---------------------------------------------------------------------------
step "7/7 健康检查"

HEALTH_URL="http://${HOST}:${PORT}/api/health"
HEALTH_OK=0
for attempt in 1 2 3 4 5; do
  RESPONSE="$(curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null || true)"
  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    HEALTH_OK=1
    break
  fi
  info "第 $attempt 次探测未成功，1 秒后重试…"
  sleep 1
done

if [ "$HEALTH_OK" -eq 1 ]; then
  ok "后端响应正常：$HEALTH_URL"
  echo "$RESPONSE" | sed 's/^/      /'
else
  warn "接口暂未响应，可能是防火墙或绑定地址问题"
  echo "      服务状态：$(systemctl is-active "$SERVICE_NAME")"
  echo "      查看日志：journalctl -u $SERVICE_NAME -n 50 --no-pager"
  exit 1
fi

# ---------------------------------------------------------------------------
# 完成
# ---------------------------------------------------------------------------
cat <<EOF

  ────────────────────────────────────────────────────────
  后端部署完成

    安装目录   : $APP_DIR
    数据文件   : $APP_DIR/data/calculator.sqlite
    服务名     : $SERVICE_NAME
    监听       : $HOST:$PORT
    健康检查   : $HEALTH_URL

  常用命令

    systemctl status  $SERVICE_NAME
    systemctl restart $SERVICE_NAME
    journalctl -u $SERVICE_NAME -f
    systemctl show $SERVICE_NAME -p MemoryCurrent -p MemoryMax

  下一步

    配置 nginx 站点（见 deploy/nginx-bt-panel.conf.example），
    使前端静态文件与 /api 处于同一源下。

  ────────────────────────────────────────────────────────

EOF
