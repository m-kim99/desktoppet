#!/usr/bin/env python3
"""폰에서 월드 보기용 서버 — static/은 직접 서빙하고, 백엔드 경로는 3456으로 프록시한다.

왜 프록시가 필요한가: 월드는 일기·채팅·KV를 전부 **상대경로 `/api/*`**로 부른다. 정적 서버만
띄우면 그 호출이 전부 404가 되어 폰에서 일기가 빈 채로 뜬다(채팅은 localStorage 스크롤백이
남아 있어 되는 것처럼 보일 뿐이다). 앱 백엔드(3456)는 `networkVisible` 설정이 꺼져 있으면
127.0.0.1에만 바인딩되므로 폰이 직접 칠 수도 없다 → 이 서버가 중계한다.

⚠️ ThreadingHTTPServer 필수. 단일스레드면 끊긴 keep-alive 연결 하나에 전체가 막혀서,
   맥에선 되는데 폰만 안 붙는 '먹통'이 된다(실측).
"""
import http.server
import os
import sys
import urllib.error
import urllib.request

PORT = int(os.environ.get("PHONE_PORT", "8765"))
BACKEND = os.environ.get("PHONE_BACKEND", "http://127.0.0.1:3456")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
# 백엔드가 mount한 경로들 (server.py의 app.mount 목록과 동기)
PROXY = ("/api/", "/vrm/", "/uploaded_files/", "/screenshots/", "/tool_temp/", "/ext/", "/ws")
HOP = {"host", "connection", "content-length", "transfer-encoding", "accept-encoding", "keep-alive"}


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _proxied(self):
        return self.path.startswith(PROXY)

    def _relay(self, body=None):
        req = urllib.request.Request(BACKEND + self.path, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in HOP:
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data, status, headers = r.read(), r.status, r.headers
        except urllib.error.HTTPError as e:
            data, status, headers = e.read(), e.code, e.headers
        except Exception as e:
            self.send_error(502, f"backend unreachable: {e}")
            return
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        self._relay() if self._proxied() else super().do_GET()

    def do_HEAD(self):
        self._relay() if self._proxied() else super().do_HEAD()

    def do_POST(self):
        self._relay(self._body())

    def do_PUT(self):
        self._relay(self._body())

    def do_DELETE(self):
        self._relay(self._body())


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print(f"serving {os.path.realpath(ROOT)} on 0.0.0.0:{PORT} · /api → {BACKEND}", flush=True)
    srv.serve_forever()
