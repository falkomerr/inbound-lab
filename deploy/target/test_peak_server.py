import asyncio
import json
import unittest
from peak_server import PeakStats, create_servers


class PeakStatsTest(unittest.TestCase):
    def test_sliding_second_crosses_wall_clock_boundary(self):
        stats = PeakStats()
        for _ in range(100):
            stats.accept('run', .95)
            stats.accept('run', 1.05)
        for _ in range(50):
            stats.accept('run', 2.2)
        run = stats.snapshot()['runs']['run']
        self.assertEqual(run['accepted'], 250)
        self.assertEqual(run['peak1s'], 200)
        self.assertEqual(run['peak100ms'], 100)

    def test_acceptance_response_and_rejection_are_separate(self):
        stats = PeakStats()
        stats.accept('run', 1)
        stats.response('run', 200)
        stats.rejected += 1
        value = stats.snapshot()
        self.assertEqual(value['runs']['run']['accepted'], 1)
        self.assertEqual(value['runs']['run']['responses'], {'200': 1})
        self.assertEqual(value['rejectedConnections'], 1)


class PeakHttpTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_request_is_traced_without_sensitive_headers(self):
        public, admin, stats = await create_servers(0, 0, 4096)
        try:
            reader, writer = await asyncio.open_connection('127.0.0.1', public.sockets[0].getsockname()[1])
            run = '11111111-1111-4111-8111-111111111111'
            writer.write(f'GET /load HTTP/1.1\r\nHost: localhost\r\nX-Inbound-Lab-Run: {run}\r\nCookie: secret-cookie\r\nConnection: close\r\n\r\n'.encode())
            await writer.drain()
            response = await reader.read()
            self.assertTrue(response.startswith(b'HTTP/1.1 200'))
            writer.close()
            await writer.wait_closed()
            snapshot = stats.snapshot()
            self.assertEqual(snapshot['runs'][run]['accepted'], 1)
            self.assertEqual(snapshot['runs'][run]['responses']['200'], 1)
            self.assertNotIn('secret-cookie', json.dumps(snapshot))
        finally:
            public.close()
            admin.close()
            await public.wait_closed()
            await admin.wait_closed()


if __name__ == '__main__':
    unittest.main()
