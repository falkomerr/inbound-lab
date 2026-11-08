import argparse
import asyncio
import json
import re
import time
from collections import Counter
from pathlib import Path


class PeakStats:
    def __init__(self):
        self.runs = {}
        self.active = 0
        self.max_active = 0
        self.rejected = 0

    def accept(self, run, now):
        value = self.runs.setdefault(run, {'accepted': 0, 'bins': Counter(), 'responses': Counter()})
        value['accepted'] += 1
        value['bins'][int(now * 10)] += 1

    def response(self, run, status):
        self.runs[run]['responses'][str(status)] += 1

    def snapshot(self):
        values = {}
        for name, value in self.runs.items():
            bins = value['bins']
            values[name] = {
                'accepted': value['accepted'],
                'responses': dict(value['responses']),
                'peak1s': max((sum(bins.get(i, 0) for i in range(end - 9, end + 1)) for end in bins), default=0),
                'peak100ms': max(bins.values(), default=0),
                'bins': sorted(bins.items()),
            }
        return {'time': time.time(), 'activeConnections': self.active,
                'maxActiveConnections': self.max_active, 'rejectedConnections': self.rejected, 'runs': values}


async def create_servers(port, admin_port, limit):
    stats = PeakStats()

    async def handle(reader, writer):
        if stats.active >= limit:
            stats.rejected += 1
            writer.close()
            return
        stats.active += 1
        stats.max_active = max(stats.max_active, stats.active)
        peer = writer.get_extra_info('peername')
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 8)
                except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
                    break
                first, *lines = raw.split(b'\r\n')
                parts = first.split(b' ')
                if len(parts) != 3:
                    break
                method, path, protocol = parts
                path = path.split(b'?', 1)[0]
                headers = {}
                for line in lines:
                    if b':' in line:
                        key, value = line.split(b':', 1)
                        headers[key.lower().strip()] = value.strip()
                invalid_body = headers.get(b'content-length', b'0') != b'0' or b'transfer-encoding' in headers
                status = 413 if invalid_body else 405 if method != b'GET' else 200 if path in [b'/load', b'/ip', b'/healthz'] else 404
                run = headers.get(b'x-inbound-lab-run', b'').decode('ascii', errors='ignore')
                run = run if re.fullmatch(r'[a-fA-F0-9-]{36}', run) else 'unknown'
                if path == b'/load':
                    stats.accept(run, time.time())
                body = json.dumps({'ip': peer[0]}).encode() if path == b'/ip' and status == 200 else b'{"ok":true}\n'
                close = invalid_body or protocol != b'HTTP/1.1' or headers.get(b'connection', b'').lower() == b'close'
                writer.write(f'HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: {"close" if close else "keep-alive"}\r\n\r\n'.encode() + body)
                await writer.drain()
                if path == b'/load':
                    stats.response(run, status)
                if close:
                    break
        except (ConnectionError, BrokenPipeError):
            pass
        finally:
            stats.active -= 1
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass

    async def admin(reader, writer):
        try:
            await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 2)
            body = json.dumps(stats.snapshot(), separators=(',', ':')).encode()
            writer.write(f'HTTP/1.1 200 OK\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n'.encode() + body)
            await writer.drain()
        except (ConnectionError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()

    public = await asyncio.start_server(handle, '0.0.0.0', port, limit=8192, backlog=2048)
    private = await asyncio.start_server(admin, '127.0.0.1', admin_port, limit=1024)
    return public, private, stats


async def main(args):
    public, private, stats = await create_servers(args.port, args.admin_port, args.connections)
    args.log.parent.mkdir(parents=True, exist_ok=True)
    async def telemetry():
        with args.log.open('a') as output:
            while True:
                output.write(json.dumps(stats.snapshot(), separators=(',', ':')) + '\n')
                output.flush()
                await asyncio.sleep(.1)
    async with public, private:
        await asyncio.gather(public.serve_forever(), private.serve_forever(), telemetry())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18082)
    parser.add_argument('--admin-port', type=int, default=18083)
    parser.add_argument('--connections', type=int, default=4096)
    parser.add_argument('--log', type=Path, required=True)
    asyncio.run(main(parser.parse_args()))
