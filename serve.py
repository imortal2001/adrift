#!/usr/bin/env python3
"""Static server for development, with caching turned off.

Browsers cache ES modules aggressively; without no-store you keep testing the
previous version of a file you just edited.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        line = fmt % args                   # quiet on success, loud on anything else
        if " 200 " not in line:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    root = Path(__file__).resolve().parent
    handler = partial(NoCacheHandler, directory=str(root))
    print(f"Adrift → http://localhost:{port}  (serving {root})")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
