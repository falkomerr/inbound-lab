/**
 * P0 open-source compliance checks (repo artifacts).
 * Does not claim legal risk-free status; verifies required evidence files exist and stay consistent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('License compliance (P0 artifacts)', () => {
  it('ships full k6 AGPL-3.0 text and FasterTest ISC text', () => {
    const agplPath = join(root, 'licenses/k6/AGPL-3.0.txt');
    const iscPath = join(root, 'licenses/fastertest/ISC.txt');
    assert.ok(existsSync(agplPath), 'licenses/k6/AGPL-3.0.txt missing');
    assert.ok(existsSync(iscPath), 'licenses/fastertest/ISC.txt missing');
    const agpl = read('licenses/k6/AGPL-3.0.txt');
    assert.match(agpl, /GNU AFFERO GENERAL PUBLIC LICENSE/i);
    assert.ok(agpl.length > 10000, 'AGPL text looks truncated');
    const isc = read('licenses/fastertest/ISC.txt');
    assert.match(isc, /ISC License/);
    assert.equal(isc.trim(), read('LICENSE').trim());
  });

  it('pins k6 version with checksums in Dockerfile', () => {
    const df = read('Dockerfile');
    const versionMatch = df.match(/ARG K6_VERSION=([0-9]+\.[0-9]+\.[0-9]+)/);
    assert.ok(versionMatch, 'K6_VERSION pin missing');
    const version = versionMatch[1];
    assert.match(df, /ARG K6_SHA256_AMD64=[a-f0-9]{64}/);
    assert.match(df, /ARG K6_SHA256_ARM64=[a-f0-9]{64}/);
    assert.match(df, /sha256sum -c/);
    assert.match(df, /Unsupported architecture/);
    assert.doesNotMatch(df, /apt-get install[^\n]*\bk6\b/);

    const notices = read('THIRD_PARTY_NOTICES.md');
    assert.match(notices, new RegExp(`v${version.replace(/\./g, '\\.')}`));
    assert.match(notices, new RegExp(`grafana/k6/tree/v${version.replace(/\./g, '\\.')}`));
    assert.match(
      notices,
      new RegExp(`grafana/k6/archive/refs/tags/v${version.replace(/\./g, '\\.')}\\.tar\\.gz`)
    );
    assert.match(notices, /licenses\/k6\/AGPL-3\.0\.txt/);
    assert.match(notices, /unmodified/i);
    assert.match(notices, /corresponding source/i);
  });

  it('does not label the image as ISC-only when k6 is bundled', () => {
    const df = read('Dockerfile');
    assert.match(df, /org\.opencontainers\.image\.licenses=/);
    assert.doesNotMatch(
      df,
      /org\.opencontainers\.image\.licenses="ISC"/,
      'OCI licenses must not be ISC-only when k6 is bundled'
    );
    assert.match(df, /ISC AND AGPL-3\.0/);
    assert.match(df, /io\.fastertest\.k6\.version=/);
    assert.match(df, /io\.fastertest\.k6\.license="AGPL-3\.0"/);
    assert.match(df, /io\.fastertest\.k6\.source=/);
    assert.match(df, /\/usr\/share\/licenses\/k6\/AGPL-3\.0\.txt/);
    assert.match(df, /\/usr\/share\/licenses\/fastertest\/ISC\.txt/);
  });

  it('README contains independence / trademark disclaimer', () => {
    const readme = read('README.md');
    assert.match(readme, /not affiliated with, endorsed by, or sponsored by Grafana Labs/i);
    assert.match(readme, /not an\s+official Grafana or k6 product/i);
    assert.match(readme, /powered by the k6 engine/i);
    assert.match(readme, /THIRD_PARTY_NOTICES\.md/);
  });

  it('does not use Grafana/k6 official logo paths as FasterTest brand assets', () => {
    const assetsDir = join(root, 'public/assets');
    assert.ok(existsSync(join(assetsDir, 'logo.jpg')));
    assert.ok(existsSync(join(assetsDir, 'mark.svg')));
    const mark = read('public/assets/mark.svg');
    assert.match(mark, /FasterTest/);
    assert.doesNotMatch(mark, /grafana/i);
    // No vendored upstream brand filenames
    assert.equal(existsSync(join(assetsDir, 'grafana.svg')), false);
    assert.equal(existsSync(join(assetsDir, 'k6-logo.svg')), false);
  });

  it('documents legal / release compliance paths', () => {
    assert.ok(existsSync(join(root, 'docs/LEGAL.md')));
    assert.ok(existsSync(join(root, 'docs/TRADEMARKS.md')));
    assert.ok(existsSync(join(root, 'docs/RELEASE_COMPLIANCE.md')));
  });
});
