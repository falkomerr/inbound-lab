from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import time

requests = 0

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        global requests
        if self.path == '/subscription':
            body = '\n'.join(f'vless://11111111-1111-4111-8111-111111111111@fixture-xray:{port}?security=none&type=tcp#Inbound-{index}' for index, port in enumerate([10001, 10002, 10003, 10001], 1)).encode()
        elif self.path == '/ip':
            body = json.dumps({'ip': '203.0.113.1'}).encode()
        elif self.path == '/stats':
            body = json.dumps({'requests': requests}).encode()
        else:
            requests += 1
            time.sleep(0.005)
            body = b'{"ok":true}'
        self.send_response(500 if self.path == '/failure' else 200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.do_GET()

    def log_message(self, *args):
        pass

ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
