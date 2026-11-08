import http.client
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TargetTest(unittest.TestCase):
    def test_keepalive_and_private_log(self):
        with tempfile.TemporaryDirectory() as directory:
            process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')), '--port', '0', '--log-dir', directory], stdout=subprocess.PIPE, text=True)
            try:
                port = json.loads(process.stdout.readline())['port']
                client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
                for _ in range(2):
                    client.request('GET', '/load?private=query', headers={'Cookie': 'private=cookie', 'Authorization': 'private-token'})
                    response = client.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertTrue(json.loads(response.read())['ok'])
                client.request('POST', '/load', body='private-body')
                response = client.getresponse()
                self.assertEqual(response.status, 413)
                response.read()
                client.close()
                text = (Path(directory) / 'requests.jsonl').read_text()
                self.assertNotIn('private', text)
                self.assertEqual(len(text.splitlines()), 3)
            finally:
                process.terminate()
                process.wait(timeout=3)
                process.stdout.close()


if __name__ == '__main__':
    unittest.main()
