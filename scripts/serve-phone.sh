#!/bin/sh
# 폰에서 월드 보기용 정적 서버 — 0.0.0.0:8765 (루프백 금지: 폰이 못 붙는다)
#   sh scripts/serve-phone.sh          시작(이미 떠 있으면 그대로 둠)
#   sh scripts/serve-phone.sh restart  재시작
#   sh scripts/serve-phone.sh stop     정지
#
# ⚠️ **정적 서버만으로는 안 된다.** 월드는 일기·채팅·KV를 상대경로 `/api/*`로 부르는데,
#    `python3 -m http.server`는 그걸 전부 404로 준다 → 폰에서 일기가 빈 채로 뜬다(채팅은
#    localStorage 스크롤백이 남아 되는 것처럼 보일 뿐). serve-phone.py가 3456으로 중계한다.
# ⚠️ nohup으로 떼어 놓는다 — 세션 안에서 `... &`로 띄우면 세션 종료 때 같이 죽는다.
PORT=8765
ROOT="$(cd "$(dirname "$0")/../static" && pwd)"
SERVER="$(cd "$(dirname "$0")" && pwd)/serve-phone.py"   # cd 전에 절대경로로 굳힌다(아래에서 static/으로 이동한다)
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
    nohup python3 "$SERVER" >"$LOG" 2>&1 &
    sleep 1
    echo "시작: pid $(alive) · root $ROOT · /api → 127.0.0.1:3456 · log $LOG"
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "폰에서 → http://$IP:$PORT/world.html"
