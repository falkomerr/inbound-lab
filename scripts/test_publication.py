import importlib.util
import pathlib
import subprocess
import tarfile
import tempfile
import unittest


class PublicationTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('publication', pathlib.Path(__file__).with_name('publication.py'))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name) / 'source'
        self.root.mkdir()

    def write(self, name, content='public'):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def test_export_excludes_private_runtime_history_and_generated_files(self):
        for name in ['README.md', 'platform/server/index.js', 'platform/bun.lock', 'platform/data/.gitkeep']:
            self.write(name)
        for name in ['secrets/key', '.git/config', '.beads/interactions.jsonl', 'evidence/result.json',
                     'platform/.env', 'platform/data/users.json', 'platform/node_modules/a/index.js',
                     'platform/public/vpn/app.js', 'platform/public/index.bundled.html',
                     'platform/package-lock.json', 'platform/docs/images/session.jpg']:
            self.write(name, 'PRIVATE_SENTINEL')
        destination = pathlib.Path(self.temp.name) / 'release'
        archive = self.module.export(self.root, destination)
        self.assertTrue((destination / 'platform/server/index.js').exists())
        self.assertTrue((destination / 'platform/data/.gitkeep').exists())
        self.assertFalse(any('PRIVATE_SENTINEL' in p.read_text() for p in destination.rglob('*') if p.is_file()))
        with tarfile.open(archive) as package:
            self.assertTrue(all(v.uid == 0 and v.gid == 0 and not v.uname and not v.gname and v.mtime == 0 for v in package.getmembers()))

    def test_publication_excludes_report_documents_but_keeps_reporting_code(self):
        for name in ['VALIDATION.md', 'platform/docs/SECURITY_BETA_AUDIT_PHASE0.md',
                     'platform/docs/FRAMEWORK_ASSESSMENT.md', 'docs/benchmark-results.json',
                     'docs/report.html']:
            self.write(name, 'PRIVATE_REPORT_SENTINEL')
        for name in ['platform/server/reportRetention.js', 'platform/public/reportHtmlTheme.js']:
            self.write(name, 'reporting feature')
        destination = pathlib.Path(self.temp.name) / 'release'
        archive = self.module.export(self.root, destination)
        with tarfile.open(archive) as package:
            self.assertFalse(any(b'PRIVATE_REPORT_SENTINEL' in package.extractfile(v).read() for v in package.getmembers() if v.isfile()))
        self.assertTrue((destination / 'platform/server/reportRetention.js').exists())
        self.assertTrue((destination / 'platform/public/reportHtmlTheme.js').exists())

    def test_symlink_cannot_copy_a_secret_from_outside_the_tree(self):
        secret = pathlib.Path(self.temp.name) / 'secret'
        secret.write_text('PRIVATE_SENTINEL')
        (self.root / 'platform').mkdir()
        (self.root / 'platform/index.js').symlink_to(secret)
        with self.assertRaises(ValueError):
            self.module.collect(self.root)

    def test_gate_blocks_private_paths_keys_and_connection_credentials(self):
        samples = [
            '/' + 'Users/private-person/project/file',
            '-----BEGIN ' + 'PRIVATE KEY-----',
            'vless:' + '//12345678-1234-4234-8234-123456789abc@host.example:443',
            'https://subscription.example/' + 'randomAccessToken123456789',
            'ssh ' + 'operator@203.0.113.9',
        ]
        for sample in samples:
            with self.subTest(sample=sample):
                self.write('README.md', sample)
                self.assertTrue(self.module.scan(self.root))

    def test_synthetic_fixture_is_allowed_only_in_test_sources(self):
        uri = 'vless:' + '//11111111-1111-4111-8111-111111111111@fixture-xray:10001'
        self.write('platform/tests/docker/fixture.txt', uri)
        self.assertFalse(self.module.scan(self.root))
        self.write('README.md', uri)
        self.assertTrue(self.module.scan(self.root))

    def test_existing_destination_is_never_overwritten(self):
        self.write('README.md')
        destination = pathlib.Path(self.temp.name) / 'release'
        destination.mkdir()
        (destination / 'keep').write_text('keep')
        with self.assertRaises(FileExistsError):
            self.module.export(self.root, destination)
        self.assertEqual((destination / 'keep').read_text(), 'keep')

    def test_failed_scan_creates_no_public_artifact(self):
        self.write('README.md', '/' + 'Users/private-person/project')
        destination = pathlib.Path(self.temp.name) / 'release'
        with self.assertRaises(ValueError):
            self.module.export(self.root, destination)
        self.assertFalse(destination.exists())

    def test_ci_rejects_tracked_files_outside_the_publication_allowlist(self):
        self.write('README.md')
        self.write('private-notes.txt', 'PRIVATE_SENTINEL')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        issues = self.module.tracked_issues(self.root)
        self.assertEqual([value['file'] for value in issues], ['private-notes.txt'])


if __name__ == '__main__':
    unittest.main()
