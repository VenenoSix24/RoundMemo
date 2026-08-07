#!/usr/bin/env bash
# RoundMemo 系统层备份脚本
#
# 与后台「备份恢复」（.rmbackup 应用内存档）互补：
#   - 本脚本 = 系统层全量备份：整包原图 + 缩略图 + 数据库一致快照 + 签名密钥
#   - 后台 .rmbackup = 应用内可下载/恢复的 DB 存档
#
# 一致性策略：DB 用 sqlite3 .backup 取 WAL 安全的一致快照，
# 静态文件（photos/thumbs/secret.key）直接 tar——这些文件不随写并发变化，
# 文件层打包无一致性问题。
#
# 用法：
#   bash deploy/backup.sh                        # 默认 data-dir + /var/backups/roundmemo
#   bash deploy/backup.sh --data-dir /opt/roundmemo/data --dest /mnt/backups --keep 14
#   bash deploy/backup.sh --dry-run              # 只打印将要执行的操作

set -euo pipefail

DATA_DIR="/opt/roundmemo/data"
DEST="/var/backups/roundmemo"
KEEP=7
DRY_RUN=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\033[1;34m[roundmemo-backup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[roundmemo-backup]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[roundmemo-backup]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
用法: bash deploy/backup.sh [选项]

选项:
  --data-dir <路径>   RoundMemo 数据目录（默认 ${DATA_DIR}）
  --dest <路径>       备份输出目录（默认 ${DEST}）
  --keep <N>          保留最近 N 份备份，更早的删除（默认 7）
  --dry-run           只打印将执行的操作，不写任何文件
  -h, --help          显示帮助
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) DATA_DIR="${2:?--data-dir 需要参数}"; shift 2 ;;
    --dest) DEST="${2:?--dest 需要参数}"; shift 2 ;;
    --keep) KEEP="${2:?--keep 需要参数}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) die "未知参数: $1（--help 查看用法）" ;;
  esac
done

do_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  \033[2m[dry-run]\033[0m %s\n' "$*"
    return 0
  fi
  printf '  \$ %s\n' "$*"
  "$@"
}

# 转绝对路径：目标目录在 dry-run 时可能尚不存在，不能直接 cd 自身；
# 改用父目录解析（父目录必然存在），结果不依赖目标是否已创建。
resolve_abs() {
  case "$1" in
    /*) echo "$1" ;;
    *) echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" ;;
  esac
}

[[ -d "$DATA_DIR" ]] || die "数据目录不存在: $DATA_DIR"
[[ -f "$DATA_DIR/roundmemo.db" ]] || die "未找到数据库 ${DATA_DIR}/roundmemo.db（确定 data-dir 正确？）"
# GNU tar 的第二个 -C 相对第一个 -C 解析，路径必须为绝对，否则 chdir 失败
DATA_DIR="$(resolve_abs "$DATA_DIR")"

ts="$(date +%Y%m%d-%H%M%S)"
STAGED="$(mktemp -d /tmp/roundmemo-backup.XXXXXX)"
trap 'rm -rf "$STAGED"' EXIT

log "数据目录: $DATA_DIR"
log "备份目标: $DEST"
log "保留份数: $KEEP"
log "时间戳:   $ts"

# —— 1. 数据库一致快照（sqlite3 .backup 在线取，WAL-safe） ——
if command -v sqlite3 >/dev/null 2>&1; then
  log "取数据库一致快照（sqlite3 .backup）…"
  do_cmd sqlite3 "$DATA_DIR/roundmemo.db" ".backup '${STAGED}/roundmemo.db'"
else
  warn "未找到 sqlite3，无法取一致快照，退化为直接打包数据库文件"
  warn "（WAL 模式下可能有未 checkpoint 的尾段；建议安装 sqlite3: apt install sqlite3）"
  do_cmd cp "$DATA_DIR/roundmemo.db" "$STAGED/roundmemo.db"
fi

# —— 2. 打包静态文件 + 快照 ——
log "打包数据…"
DEST="$(resolve_abs "$DEST")"
do_cmd mkdir -p "$DEST"
# photos/thumbs/secret.key 原样打包；.rmbackup 应用内存档不重复携带（有独立生命周期）
# 用 -C 进入目录打包相对路径，避免 tar 报「member name contains '..'」
archive="${DEST}/roundmemo-${ts}.tar.gz"
if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '  \033[2m[dry-run]\033[0m 生成 %s（tar -czf）\n' "$archive"
else
  tar -czf "$archive" \
    --exclude='.DS_Store' \
    -C "$STAGED" roundmemo.db \
    -C "$DATA_DIR" photos thumbs secret.key
fi

# —— 3. 滚动清理超量备份 ——
log "清理旧备份（保留最近 $KEEP 份）…"
if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '  \033[2m[dry-run]\033[0m 删除 %s 以外的旧归档\n' "$KEEP"
else
  ls -1t "$DEST"/roundmemo-*.tar.gz 2>/dev/null \
    | tail -n "+$((KEEP + 1))" \
    | xargs -r rm -f
fi

log "完成。最新备份: ${archive}"
log "异地建议: 将 ${DEST} 下的归档 rsync 到另一台机器（示例: rsync -av ${DEST}/ user@offsite:/backups/roundmemo/）"
