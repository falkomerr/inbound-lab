import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('standalone sample configuration never defaults to a public load target', () => {
  const env = { ...process.env };
  delete env.BASE_URL;
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {config} from './config/config.js'; console.log(config.BASE_URL)",
    ],
    { env, encoding: 'utf8' }
  );
  assert.equal(result.trim(), 'http://127.0.0.1:18081');
});
