#!/bin/zsh
# 🗄️ 병아리 월드 일일 백업 — 개인 데이터 전부를 iCloud Drive로 (기기 유실 대비 오프머신 사본)
# 대상: ① ~/Library/Application Support/super-agent-party (일기·채팅 원문·KV·책·캡슐·메일 전부)
#       ② 리포 config/world_*.json (레거시 개인 데이터)
# launchd(com.byeongari.world-backup)가 매일 11:30 + 로그인 시 실행. 보관 60개(약 두 달).
set -u
DEST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/병아리월드-백업"
SRC_APP="$HOME/Library/Application Support/super-agent-party"
SRC_CFG="$HOME/dev/super-agent-party-main/config"
LOG=/tmp/byeongari-backup.log
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
OUT="$DEST/world-backup-$STAMP.tar.gz"
# 오늘자 백업이 이미 있으면(재로그인 등) 건너뜀 — 하루 1개
if [ -n "$(find "$DEST" -name "world-backup-$(date +%Y%m%d)-*.tar.gz" 2>/dev/null | head -1)" ]; then
  echo "$(date '+%m-%d %H:%M') skip (오늘자 있음)" >> "$LOG"
  exit 0
fi
TMP=$(mktemp -d)
mkdir -p "$TMP/config"
cp "$SRC_CFG"/world_*.json "$TMP/config/" 2>/dev/null
tar -czf "$OUT" -C "$HOME/Library/Application Support" "super-agent-party" -C "$TMP" "config" 2>>"$LOG"
RC=$?
rm -rf "$TMP"
# 보관 60개 초과분 정리 (오래된 것부터)
ls -1t "$DEST"/world-backup-*.tar.gz 2>/dev/null | tail -n +61 | while read -r f; do rm -f "$f"; done
echo "$(date '+%m-%d %H:%M') rc=$RC $(du -h "$OUT" 2>/dev/null | cut -f1) $OUT" >> "$LOG"
