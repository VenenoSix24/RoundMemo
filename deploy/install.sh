#!/usr/bin/env bash
# RoundMemo 一键安装脚本
#
# 用法（在仓库根目录运行）：
#   sudo bash deploy/install.sh
#   sudo bash deploy/install.sh --domain pano.example.com --data-dir /opt/roundmemo/data
#   sudo bash deploy/install.sh --no-caddy --dry-run --yes
#
# 行为：
#   - 交互式：缺省参数会逐项提示；--yes 跳过全部交互
#   - 幂等：重跑走「升级」分支，只更新二进制 / dist / systemd unit，
#     已存在的 config.toml 不进行覆盖
#   - 旧文件滚动备份：升级前二进制与 dist 各留 1 份 .bak.<ts>
#   - 不在服务器自动安装 Go/Node/Caddy，缺依赖时只打印安装方法并退出
#   - --dry-run：只打印将要执行的写操作

set -euo pipefail

INSTALL_DIR="/opt/roundmemo"
DATA_DIR="${INSTALL_DIR}/data"
LISTEN="127.0.0.1:8787"
DOMAIN=""
NO_CADDY=0
DRY_RUN=0
YES=0
KEEP_BAK=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() { printf '\033[1;34m[roundmemo]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[roundmemo]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[roundmemo]\033[0m %s\n' "$*" >&2; exit 1; }

# 暂存目录为全局（EXIT trap 在 main 返回/退出后读取；main 里声明的 local 会随函数结束失效）
DONE=0
STAGED=""

# 成功清理暂存目录；失败保留供排查
cleanup() {
  if [[ "$DONE" -eq 1 && -n "$STAGED" && -d "$STAGED" ]]; then
    rm -rf "$STAGED"
    printf '  \$ 清理暂存目录 %s\n' "$STAGED"
  fi
}
trap cleanup EXIT
# 失败时打印出错位置与保留的暂存目录（die/exit 不触发，只有真实命令失败才触发）
trap 'printf "\033[1;31m[roundmemo]\033[0m 安装失败（第 %s 行）; 暂存目录保留: %s\n" "$LINENO" "${STAGED:-未创建}" >&2' ERR

usage() {
  cat <<EOF
用法: sudo bash deploy/install.sh [选项]

选项:
  --domain <域>        对外域名（public_base_url 用它；缺省交互提示）
  --data-dir <路径>    数据目录（默认 ${INSTALL_DIR}/data）
  --listen <地址>      监听地址（默认 127.0.0.1:8787，由 Caddy 反代）
  --no-caddy           跳过 Caddy 配置（仅装二进制 + systemd）
  --dry-run            只打印将执行的操作，不写任何系统
  --yes                跳过所有交互确认（配合参数使用）
  -h, --help           显示帮助
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain 需要参数}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:?--data-dir 需要参数}"; shift 2 ;;
    --listen) LISTEN="${2:?--listen 需要参数}"; shift 2 ;;
    --no-caddy) NO_CADDY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) usage ;;
    *) die "未知参数: $1（--help 查看用法）" ;;
  esac
done

# —— 写操作统一出口：dry-run 时只打印 ——
do_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  \033[2m[dry-run]\033[0m %s\n' "$*"
    return 0
  fi
  printf '  \$ %s\n' "$*"
  "$@"
}
# 文件写入的 dry-run 版本：传目标路径，实际内容不写
do_write() {
  local target="$1"; shift
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  \033[2m[dry-run]\033[0m 写入 %s\n' "$target"
    return 0
  fi
  printf '  \$ 写入 %s\n' "$target"
  cat > "$target"
}

confirm() { # $1=提示；--yes 时直接返回 0
  if [[ "$YES" -eq 1 ]]; then return 0; fi
  read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

main() {
  # —— 0. 校验仓库结构（避免从非 RoundMemo 目录运行时报一堆无意义错误） ——
  [[ -f "$REPO_ROOT/server/go.mod" ]] || die "未找到 server/go.mod：请在 RoundMemo 仓库根目录运行 deploy/install.sh"
  [[ -f "$REPO_ROOT/web/package.json" ]] || die "未找到 web/package.json：请在 RoundMemo 仓库根目录运行 deploy/install.sh"

  # —— 1. 权限与工具检查 ——
  if [[ "$DRY_RUN" -eq 0 && "$(id -u)" -ne 0 ]]; then
    die "需要 root 权限：请用 sudo 运行"
  fi
  [[ "$DRY_RUN" -eq 1 && "$(id -u)" -ne 0 ]] && warn "dry-run 模式不写系统，未以 root 运行也可（仅提示）"

  command -v go >/dev/null || die "未找到 go。安装方法: https://go.dev/dl/（需 ≥ 1.26，见 server/go.mod）"
  local gover; gover="$(go env GOVERSION 2>/dev/null | sed 's/^go//' || echo 0)"
  log "检测 Go: $gover"

  command -v npm >/dev/null || die "未找到 npm。请先安装 Node.js ≥ 20（建议 22/24 LTS）"
  local nodever; nodever="$(node --version 2>/dev/null | tr -d 'v' || echo 0)"
  log "检测 Node: $nodever"
  if [[ "$(printf '%s\n%s\n' 20 "$nodever" | sort -V | head -1)" != "20" ]]; then
    die "Node 版本过低（$nodever），需要 ≥ 20"
  fi

  # —— 2. 域名交互 ——
  if [[ -z "$DOMAIN" ]]; then
    if [[ "$YES" -eq 1 ]]; then
      die "未提供域名：请加 --domain <域>（或去掉 --yes 交互输入）"
    fi
    read -r -p "对外域名（如 pano.example.com）: " DOMAIN
    [[ -z "$DOMAIN" ]] && die "域名不能为空"
  fi

  log "配置概览:"
  log "  安装目录: $INSTALL_DIR"
  log "  数据目录: $DATA_DIR"
  log "  监听地址: $LISTEN (Caddy 反代到此)"
  log "  对外域名: $DOMAIN (public_base_url=https://${DOMAIN})"
  log "  Caddy:    $([[ "$NO_CADDY" -eq 1 ]] && echo 跳过 || echo 配置)"
  [[ "$DRY_RUN" -eq 1 ]] && log "  dry-run:  开启（只打印不执行）"
  if ! confirm "确认以上配置继续？"; then die "已取消"; fi

  # —— 3. 暂存目录（成功清理，失败保留供排查） ——
  local ts
  ts="$(date +%s)"
  STAGED="$(mktemp -d /tmp/roundmemo-install.XXXXXX)"

  # —— 4. 编译后端 ——
  log "编译后端二进制…"
  local version="dev"
  if command -v git >/dev/null && git -C "$REPO_ROOT" describe --tags --always >/dev/null 2>&1; then
    version="$(git -C "$REPO_ROOT" describe --tags --always)"
  fi
  log "注入版本号: $version"
  ( cd "$REPO_ROOT/server" && do_cmd env CGO_ENABLED=0 go build \
    -ldflags "-X roundmemo/internal/version.Version=${version}" \
    -o "${STAGED}/roundmemo" \
    ./cmd/roundmemo )

  # —— 5. 构建前端 ——
  log "构建前端（npm ci + vite build）…"
  ( cd "$REPO_ROOT/web" && do_cmd npm ci --no-audit --no-fund && do_cmd npm run build )
  do_cmd cp -r "$REPO_ROOT/web/dist" "${STAGED}/web-dist"

  # —— 6. 组装 config.toml（仅首次生成） ——
  do_cmd mkdir -p "$INSTALL_DIR"
  if [[ -f "$INSTALL_DIR/config.toml" ]]; then
    log "config.toml 已存在，保留不动"
  else
    log "生成 config.toml（从 config.example.toml 模板）…"
    do_write "$INSTALL_DIR/config.toml" <<EOF
# 由 deploy/install.sh 生成；参数见 server/config.example.toml
[server]
listen = "$LISTEN"
public_base_url = "https://${DOMAIN}"
secure_cookies = true

[storage]
kind = "fs"
data_dir = "$DATA_DIR"

[database]
path = ""

[security]
code_rate_per_hour = 10
session_ttl_days = 30
admin_session_ttl_days = 7
img_sig_ttl_seconds = 300
EOF
  fi

  # —— 7. 系统用户（已存在则跳过） ——
  if ! id -u roundmemo >/dev/null 2>&1; then
    log "创建系统用户 roundmemo（nologin）…"
    do_cmd useradd --system --no-create-home --home-dir "$INSTALL_DIR" \
      --shell /usr/sbin/nologin roundmemo
  else
    log "系统用户 roundmemo 已存在，跳过"
  fi

  # —— 8. 分发：旧文件滚动备份 → 放新文件 ——
  log "分发二进制与前端 dist…"
  do_cmd mkdir -p "$INSTALL_DIR"
  # 旧二进制备份（滚动保留 KEEP_BAK=1 份）
  if [[ -f "$INSTALL_DIR/roundmemo" ]]; then
    local bak="${INSTALL_DIR}/roundmemo.bak.${ts}"
    log "备份旧二进制 → $bak"
    do_cmd mv "$INSTALL_DIR/roundmemo" "$bak"
    # 滚动删除超额的 .bak（仅当已有备份时才执行，否则 ls glob 无匹配会触发 ERR trap）
    local olds
    if olds="$(ls -1t "$INSTALL_DIR"/roundmemo.bak.* 2>/dev/null)"; then
      echo "$olds" | tail -n "+$((KEEP_BAK + 1))" | xargs -r do_cmd rm -f
    fi
  fi
  do_cmd cp "$STAGED/roundmemo" "$INSTALL_DIR/roundmemo"
  # dist：删旧的放新的（.bak 滚动 1 份）
  if [[ -d "$INSTALL_DIR/web/dist" ]]; then
    local distbak="${INSTALL_DIR}/web/dist.bak.${ts}"
    log "备份旧前端 → $distbak"
    do_cmd mv "$INSTALL_DIR/web/dist" "$distbak"
    for old in $(ls -1dt "$INSTALL_DIR"/web/dist.bak.* 2>/dev/null | tail -n "+$((KEEP_BAK + 1))"); do
      do_cmd rm -rf "$old"
    done
  fi
  do_cmd mkdir -p "$INSTALL_DIR/web"
  do_cmd cp -r "$STAGED/web-dist" "$INSTALL_DIR/web/dist"
  do_cmd chmod 0755 "$INSTALL_DIR/roundmemo"
  do_cmd mkdir -p "$DATA_DIR"
  do_cmd chown -R roundmemo:roundmemo "$INSTALL_DIR"
  do_cmd chmod 0750 "$DATA_DIR"

  # —— 9. systemd ——
  log "安装 systemd unit…"
  do_cmd cp "$SCRIPT_DIR/roundmemo.service" /etc/systemd/system/roundmemo.service
  do_cmd systemctl daemon-reload
  do_cmd systemctl enable roundmemo.service
  if [[ "$DRY_RUN" -eq 0 ]]; then
    if systemctl is-active --quiet roundmemo.service; then
      do_cmd systemctl restart roundmemo.service
    else
      do_cmd systemctl start roundmemo.service
    fi
  fi
  log "服务状态: $(systemctl is-active roundmemo.service 2>/dev/null || echo '（dry-run 未查询）')"

  # —— 10. Caddy（可跳过） ——
  if [[ "$NO_CADDY" -eq 1 ]]; then
    log "已跳过 Caddy 配置"
  else
    log "配置 Caddy…"
    local caddyfile_src="$SCRIPT_DIR/Caddyfile.example"
    local caddyfile_dst="/etc/caddy/Caddyfile.d/roundmemo"
    if ! command -v caddy >/dev/null 2>&1; then
      warn "未找到 caddy 二进制。安装后重跑本脚本，或手动配置:"
      warn "  sudo apt install caddy   # Debian/Ubuntu"
      warn "  # 或官方安装: https://caddyserver.com/docs/install"
    else
      log "写入 ${caddyfile_dst}（<DOMAIN> → ${DOMAIN}）…"
      if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  \033[2m[dry-run]\033[0m 写入 %s（替换 <DOMAIN> 为 %s）\n' "$caddyfile_dst" "$DOMAIN"
      else
        sed "s/<DOMAIN>/${DOMAIN}/g" "$caddyfile_src" > "$caddyfile_dst"
      fi
      if ! grep -q "import /etc/caddy/Caddyfile.d/\*" /etc/caddy/Caddyfile 2>/dev/null; then
        warn "主 Caddyfile（/etc/caddy/Caddyfile）似乎未 import /etc/caddy/Caddyfile.d/*，"
        warn "请在其中加入一行:  import /etc/caddy/Caddyfile.d/*  再 systemctl reload caddy"
      fi
      # 区分「配置校验失败」（配置有错，必须中止）与「reload 失败」（可能服务未运行，软警告）
      if do_cmd caddy validate --config /etc/caddy/Caddyfile 2>/dev/null; then
        do_cmd systemctl reload caddy || warn "Caddy 未以 systemd 运行或 reload 失败，请手动执行: systemctl reload caddy"
      else
        die "Caddy 配置校验失败（${caddyfile_dst}），roundmemo 服务已运行；请手动检查 Caddyfile 后重跑本脚本"
      fi
    fi
  fi

  # —— 11. 收尾 ——
  DONE=1
  log "安装完成。"
  log "下一步：创建 Owner 账号（交互式输密，密码不回显）:"
  log "  sudo -u roundmemo $INSTALL_DIR/roundmemo owner create <username>"
  log "然后浏览器访问 https://${DOMAIN}"
}

main
