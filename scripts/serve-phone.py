#!/usr/bin/env python3
"""Server for viewing the world on the phone — serves static/ directly and proxies backend paths to 3456.

Why a proxy is needed: the world calls diary, chat and KV all via **relative paths `/api/*`**. With only a
static server those calls all 404 and the diary shows up empty on the phone (chat only looks like it works
because the localStorage scrollback remains). The app backend (3456) binds only to 127.0.0.1 when the
`networkVisible` setting is off, so the phone can't hit it directly either → this server relays.

⚠️ ThreadingHTTPServer is required. Single-threaded, one dropped keep-alive connection blocks everything,
   giving a 'frozen' state where the Mac works but only the phone won't connect (measured).
"""
import http.server
import os
import sys
import urllib.error
import urllib.request

PORT = int(os.environ.get("PHONE_PORT", "8765"))
BACKEND = os.environ.get("PHONE_BACKEND", "http://127.0.0.1:3456")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
# Paths mounted by the backend (kept in sync with the app.mount list in server.py)
PROXY = ("/api/", "/vrm/", "/uploaded_files/", "/screenshots/", "/tool_temp/", "/ext/", "/ws")
HOP = {"host", "connection", "content-length", "transfer-encoding", "accept-encoding", "keep-alive"}


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        import datetime
        ts = datetime.datetime.now().strftime("%m-%d %H:%M:%S")   # During the 10/28 diary-loss investigation, missing timestamps meant the time of the cause couldn't be narrowed down
        sys.stderr.write("%s %s %s\n" % (ts, self.address_string(), fmt % args))

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
            # Cache-Control is owned by end_headers() below (single source on the relay)
            if k.lower() not in HOP and k.lower() != "cache-control":
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # No heuristic caching for JS/HTML — ETag revalidation every time (prevents the measured bug of stale modules lingering on the phone for days)
        if getattr(self, "path", "").split("?")[0].endswith((".js", ".html")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

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
