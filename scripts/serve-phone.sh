#!/bin/sh
# 폰에서 월드 보기용 정적 서버 — 0.0.0.0:8765 (루프백 금지: 폰이 못 붙는다)
#   sh scripts/serve-phone.sh          시작(이미 떠 있으면 그대로 둠)
#   sh scripts/serve-phone.sh restart  재시작
#   sh scripts/serve-phone.sh stop     정지
#
# ⚠️ 이 서버를 세션 안에서 `python3 -m http.server 8765 &`로 띄우면 **세션이 끝날 때 같이 죽는다**.
#    폰이 "어제까진 됐는데 안 된다"의 실제 원인이 그것이었다(코드 변경 아님) → nohup으로 떼어 놓는다.
PORT=8765
ROOT="$(cd "$(dirname "$0")/../static" && pwd)"
LOG="${TMPDIR:-/tmp}/world-phone-8765.log"

alive() { lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1; }

case "$1" in
    stop|restart)
        PID=$(alive)
        [ -n "$PID" ] && kill "$PID" 2>/dev/null && echo "정지: pid $PID"
        [ "$1" = stop ] && exit 0
        sleep 1
        ;;
esac

if [ -n "$(alive)" ]; then
    echo "이미 떠 있음: pid $(alive)"
else
    cd "$ROOT" || exit 1
    nohup python3 -m http.server "$PORT" --bind 0.0.0.0 >"$LOG" 2>&1 &
    sleep 1
    echo "시작: pid $(alive) · root $ROOT · log $LOG"
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "폰에서 → http://$IP:$PORT/world.html"
