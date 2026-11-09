"""Isolated static QA server with the official SDK mock and local asset fallback."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlsplit
import os

root = Path(__file__).resolve().parents[1]
os.chdir(root)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, url):
        name = unquote(urlsplit(url).path)
        if name == '/build/builda-draft/builda-sdk.js':
            return str(root / '.builda-agent/sdk/web/builda-sdk.js')
        prefix = '/build/builda-draft/audio/'
        if name.startswith(prefix):
            target = (root / 'assets/audio' / name[len(prefix):]).resolve()
            if target.is_relative_to((root / 'assets/audio').resolve()):
                return str(target)
        if name.startswith('/gameplay/'):
            # The real app mounts the bundle at origin root; nested QA URLs need
            # the same root-relative CSS/image paths without changing game code.
            build = (root / 'build/builda-draft').resolve()
            target = (build / name.lstrip('/')).resolve()
            if target.is_relative_to(build):
                return str(target)
        return super().translate_path(url)

    def log_message(self, *_):
        pass


ThreadingHTTPServer(('127.0.0.1', 8772), Handler).serve_forever()
