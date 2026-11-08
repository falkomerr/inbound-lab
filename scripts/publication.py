import argparse
import gzip
import hashlib
import io
import json
import pathlib
import re
import shutil
import subprocess
import tarfile


ROOT_FILES = frozenset({
    'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'SECURITY.md', 'CONTRIBUTING.md', '.gitignore', '.gitattributes', '.env.example',
    'compose.yaml', 'compose.test.yaml',
})
ROOT_DIRS = ('.github', 'platform', 'deploy', 'scripts', 'docs')
EXCLUDED_PARTS = frozenset({
    '.git', '.beads', '.serena', '.codegraph', '.playwright-cli', 'node_modules',
    '__pycache__', '.pytest_cache', '.cache', 'coverage', 'test-results',
    'secrets', 'evidence', 'output', 'work', 'release', 'reports', 'logs',
})
EXCLUDED_PREFIXES = ('platform/public/dist/', 'platform/public/vpn/',
                     'platform/docs/images/', 'platform/.github/')
EXCLUDED_FILES = frozenset({'platform/public/index.bundled.html', 'platform/package-lock.json'})
SYNTHETIC_UUID = '11111111-1111-4111-8111-111111111111'


def eligible(path):
    name = path.as_posix()
    if path.suffix.lower() in {'.md', '.html', '.json', '.jsonl', '.csv', '.xml'} and re.search(
        r'(?:^|[-_.])(reports?|audit|assessment|benchmarks?|validation|results?)(?:[-_.]|$)',
        path.name, re.IGNORECASE
    ):
        return False
    if any(part in EXCLUDED_PARTS for part in path.parts):
        return False
    if name in EXCLUDED_FILES or name.startswith(EXCLUDED_PREFIXES):
        return False
    if name.startswith('platform/data/') and name != 'platform/data/.gitkeep':
        return False
    if path.name.startswith('.env') and path.name != '.env.example':
        return False
    return path.suffix.lower() not in {'.log', '.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.pyc', '.tar', '.gz', '.zip'} and path.name != '.DS_Store'


def collect(root):
    root = pathlib.Path(root).resolve()
    files = []
    candidates = [root / name for name in ROOT_FILES]
    for name in ROOT_DIRS:
        base = root / name
        if base.is_symlink():
            raise ValueError('Символьные ссылки в экспортируемом дереве запрещены')
        if base.is_dir():
            candidates.extend(base.rglob('*'))
    for path in candidates:
        relative = path.relative_to(root)
        if not eligible(relative):
            continue
        if path.is_symlink():
            raise ValueError('Символьная ссылка: ' + relative.as_posix())
        if path.is_file():
            files.append(relative)
    return sorted(set(files))


def scan(root):
    root = pathlib.Path(root).resolve()
    issues = []
    patterns = {
        'private-key': re.compile(r'-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----'),
        'personal-home': re.compile(r'/(?:Users|home)/[A-Za-z0-9_.-]+/(?!\.\.)'),
        'ssh-account': re.compile(r'\bssh\s+(?:-[^\s]+\s+)*[\w.-]+@[\w.-]+'),
        'access-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16})\b'),
        'subscription-token-url': re.compile(r'https?://[^\s\'"<>]+/[A-Za-z0-9_-]{20,}(?=[\s\'"<>]|$)'),
    }
    connection = re.compile(r'(?:vless|vmess|trojan|hysteria2|hy2)://([^@\s\'"`]+)@')
    for relative in collect(root):
        raw = (root / relative).read_bytes()
        try:
            content = raw.decode('utf-8')
        except UnicodeDecodeError:
            if relative.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.ico'}:
                issues.append({'file': relative.as_posix(), 'line': 0, 'rule': 'unexpected-binary'})
            if b'Exif\x00\x00' in raw or b'iTXt' in raw or b'tEXt' in raw:
                issues.append({'file': relative.as_posix(), 'line': 0, 'rule': 'image-metadata'})
            continue
        for number, line in enumerate(content.splitlines(), 1):
            for rule, pattern in patterns.items():
                if pattern.search(line):
                    issues.append({'file': relative.as_posix(), 'line': number, 'rule': rule})
            for found in connection.finditer(line):
                if relative.as_posix().startswith('platform/tests/') and found[1] == SYNTHETIC_UUID:
                    continue
                issues.append({'file': relative.as_posix(), 'line': number, 'rule': 'connection-credential'})
    return issues


def tracked_issues(root):
    root = pathlib.Path(root).resolve()
    result = subprocess.run(['git', '-C', str(root), 'ls-files', '-z'], check=True, capture_output=True)
    allowed = {p.as_posix() for p in collect(root)} | {'PUBLICATION_MANIFEST.json'}
    return [{'file': name, 'line': 0, 'rule': 'tracked-outside-publication'}
            for name in result.stdout.decode().split('\0') if name and name not in allowed]


def export(root, destination):
    root = pathlib.Path(root).resolve()
    destination = pathlib.Path(destination).absolute()
    archive = destination.with_suffix('.tar.gz')
    if destination.exists() or destination.is_symlink() or archive.exists():
        raise FileExistsError('Каталог или архив уже существует; выберите новый путь')
    if root == destination or destination.is_relative_to(root / 'platform'):
        raise ValueError('Экспорт не может находиться внутри публикуемых исходников')
    findings = scan(root)
    if findings:
        raise ValueError(json.dumps(findings, ensure_ascii=False))
    files = collect(root)
    destination.mkdir(parents=True)
    hashes = {}
    for relative in files:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / relative, target)
        target.chmod(0o755 if relative.suffix == '.sh' else 0o644)
        hashes[relative.as_posix()] = hashlib.sha256(target.read_bytes()).hexdigest()
    (destination / 'PUBLICATION_MANIFEST.json').write_text(json.dumps({'schema': 1, 'files': hashes}, indent=2) + '\n')
    with archive.open('wb') as output, gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as package:
            for target in sorted(p for p in destination.rglob('*') if p.is_file()):
                data = target.read_bytes()
                info = tarfile.TarInfo(destination.name + '/' + target.relative_to(destination).as_posix())
                info.size = len(data)
                info.mode = 0o755 if target.suffix == '.sh' else 0o644
                package.addfile(info, io.BytesIO(data))
    return archive


def main():
    parser = argparse.ArgumentParser(description='Обезличенная поставка исходников без Git-истории и runtime-данных')
    parser.add_argument('action', choices=['check', 'export'])
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent.parent)
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('release/inbound-lab'))
    parser.add_argument('--tracked', action='store_true', help='В CI также проверять все файлы Git-индекса')
    args = parser.parse_args()
    if args.action == 'check':
        issues = scan(args.root)
        if args.tracked:
            issues.extend(tracked_issues(args.root))
        print(json.dumps({'files': len(collect(args.root)), 'findings': issues}, ensure_ascii=False, indent=2))
        raise SystemExit(bool(issues))
    print(export(args.root, args.output))


if __name__ == '__main__':
    main()
