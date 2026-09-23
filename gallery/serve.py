#!/usr/bin/env python3
"""Adrift asset gallery — a separate app from the game, on its own port.

    python3 gallery/serve.py [PORT]        # default 8125

Serves gallery/web/ as its root, plus three read-only mounts from the game:

    /src/      the game's modules — the gallery builds every asset with the
               game's own code, so what you see is what the game draws
    /vendor/   three.js, the same copy the game uses
    /assets/   the models (.glb) and their manifest

Nothing else of the repository is reachable. It listens on 127.0.0.1 only:
the gallery is a development tool and is never exposed to the network.

One API route: GET /api/assets lists every file in assets/models/ with its
size, and the manifest, so the gallery can flag a model that is on disk but
not registered anywhere.
"""
import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WEB = HERE / "web"
MOUNTS = {"/src/": REPO / "src", "/vendor/": REPO / "vendor", "/assets/": REPO / "assets"}
MODELS = REPO / "assets" / "models"


class GalleryHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # No caching: edit a builder in src/ or rebuild a .glb and a reload
        # shows it, rather than yesterday's module.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def translate_path(self, path):
        path = unquote(urlsplit(path).path)
        for prefix, root in MOUNTS.items():
            if path.startswith(prefix):
                return str(self._inside(root, path[len(prefix):]))
        return str(self._inside(WEB, path.lstrip("/")))

    @staticmethod
    def _inside(root, rel):
        # Resolve and refuse anything that climbs out of its mount.
        p = (root / rel).resolve()
        return p if p == root or root in p.parents else root / "__outside__"

    def do_GET(self):
        if urlsplit(self.path).path == "/api/assets":
            return self.send_json(list_assets())
        return super().do_GET()

    def send_json(self, data):
        body = json.dumps(data, indent=1).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        line = fmt % args                  # quiet on success, loud on anything else
        if " 200 " not in line:
            super().log_message(fmt, *args)


def list_assets():
    files = []
    for f in sorted(MODELS.iterdir()) if MODELS.is_dir() else []:
        if f.is_file() and not f.name.startswith("."):
            files.append({"name": f.name, "bytes": f.stat().st_size})
    try:
        manifest = json.loads((MODELS / "manifest.json").read_text())
    except (OSError, ValueError):
        manifest = None
    return {"files": files, "manifest": manifest}


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8125
    handler = partial(GalleryHandler, directory=str(WEB))
    print(f"Adrift asset gallery → http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
