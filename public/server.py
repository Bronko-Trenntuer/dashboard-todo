#!/usr/bin/env python3
"""Zentraler Dashboard-Server: liefert die statische App aus und
speichert die Projektdaten zentral in dashboard-daten.json auf dem Server."""

import http.server
import json
import os
import socketserver
import threading

PORT = int(os.environ.get("PORT", "8123"))
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard-daten.json")
data_lock = threading.Lock()


def read_data():
    with data_lock:
        if not os.path.exists(DATA_FILE):
            return {"projects": []}
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            content = f.read().strip()
            return json.loads(content) if content else {"projects": []}


def write_data(payload):
    tmp_path = DATA_FILE + ".tmp"
    with data_lock:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, DATA_FILE)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        if self.path == "/api/data":
            data = read_data()
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/data":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, dict) or "projects" not in payload:
                    raise ValueError("Ungueltiges Format")
            except (json.JSONDecodeError, ValueError) as err:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(err)}).encode("utf-8"))
                return
            write_data(payload)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        pass


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    with ThreadingHTTPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Dashboard laeuft auf http://0.0.0.0:{PORT}/  (Datenbank: {DATA_FILE})")
        httpd.serve_forever()
