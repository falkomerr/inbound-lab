import argparse
import asyncio
import json
import logging
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path


async def serve(port, log_dir):
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger('inbound-lab-target')
    logger.setLevel(logging.INFO)
    logger.addHandler(RotatingFileHandler(log_dir / 'requests.jsonl', maxBytes=10 * 1024 * 1024, backupCount=2))
    active = 0

    async def handle(reader, writer):
        nonlocal active
        if active >= 512:
            writer.close()
            return
        active += 1
        peer = writer.get_extra_info('peername')
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
                except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
                    break
                if len(raw) > 8192:
                    break
                lines = raw.split(b'\r\n')
                request = lines[0].split(b' ')
                if len(request) != 3:
                    break
                method, raw_path, protocol = request
                path = raw_path.split(b'?', 1)[0]
                headers = {}
                for line in lines[1:]:
                    if b':' in line:
                        key, value = line.split(b':', 1)
                        headers[key.lower().strip()] = value.strip()
                invalid_body = headers.get(b'content-length', b'0') != b'0' or b'transfer-encoding' in headers
                status = 413 if invalid_body else 405 if method != b'GET' else 200 if path in [b'/load', b'/healthz', b'/ip'] else 404
                body = json.dumps({'ip': peer[0]}).encode() if status == 200 and path == b'/ip' and peer else b'{"ok":true}\n' if status == 200 else b'{"ok":false}\n'
                close = invalid_body or protocol != b'HTTP/1.1' or headers.get(b'connection', b'').lower() == b'close'
                response = f'HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: {"close" if close else "keep-alive"}\r\n\r\n'.encode() + body
                writer.write(response)
                await writer.drain()
                if path != b'/healthz':
                    logger.info(json.dumps({'time': datetime.now(timezone.utc).isoformat(), 'remote_ip': peer[0] if peer else None, 'endpoint': path.decode() if path in [b'/load', b'/ip'] else 'other', 'status': status}, separators=(',', ':')))
                if close:
                    break
        except (ConnectionError, BrokenPipeError):
            pass
        finally:
            active -= 1
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass

    server = await asyncio.start_server(handle, '0.0.0.0', port, limit=8192, backlog=256)
    print(json.dumps({'port': server.sockets[0].getsockname()[1]}), flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18081)
    parser.add_argument('--log-dir', type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(serve(args.port, args.log_dir))
