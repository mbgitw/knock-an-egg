from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
project = Path(__file__).resolve().parent
os.chdir(project / 'public')
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Serve the platform-owned mock SDK only from this loopback preview server.
        if self.path.split('?', 1)[0] == '/builda-sdk.js':
            sdk = project / '.builda-agent' / 'sdk' / 'web' / 'builda-sdk.js'
            if not sdk.is_file():
                self.send_error(404, 'Builda mock SDK is not installed')
                return
            data = sdk.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
print('Local: http://localhost:8765',flush=True)
ThreadingHTTPServer(('127.0.0.1',8765),Handler).serve_forever()
