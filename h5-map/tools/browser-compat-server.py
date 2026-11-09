"""Isolated browser QA: serve the built client and local copies of native audio.

Production audio remains in Builda's assets package. This server only supplies
the existing non-host audio preview, and has no payment/authentication mock.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote
import sys

root = Path(__file__).resolve().parent.parent
build = root / 'build' / 'builda-draft'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(build), **kwargs)

    def translate_path(self, request):
        relative = unquote(urlparse(request).path).lstrip('/')
        if relative.startswith('audio/'):
            candidate = (root / 'assets' / relative).resolve()
            if candidate.is_relative_to((root / 'assets' / 'audio').resolve()):
                return str(candidate)
        if relative == 'gameplay/settings-ui/9045766377.mp3':
            return str(root / 'public' / relative)
        return super().translate_path(request)

    def log_message(self, *args):
        pass

ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
