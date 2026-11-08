/**
 * cURL chain debug logging + variable placeholder substitution
 * @module tests/unit/curlChainDebugLog
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TestManager } from '../../server/testManager.js';

describe('generateK6ChainScript debugLog', () => {
  const manager = new TestManager();

  const steps = [
    {
      label: 'login',
      method: 'POST',
      url: 'https://example.com/login',
      headers: { 'Content-Type': 'application/json' },
      body: '{"phone":"15550000002"}',
    },
  ];

  it('omits debug console.log when debugLog is false', () => {
    const script = manager.generateK6ChainScript('demo', steps, { debugLog: false });
    assert.equal(script.includes('[debug]'), false);
    assert.equal(script.includes('__VU === 1'), false);
  });

  it('emits VU1/ITER0-gated debug logs when debugLog is true', () => {
    const script = manager.generateK6ChainScript('demo', steps, { debugLog: true });
    assert.match(script, /if \(__VU === 1 && __ITER === 0\)/);
    assert.match(script, /\[debug\]/);
    assert.match(script, /request body=/);
    assert.match(script, /RES status=/);
    assert.match(script, /\.slice\(0, 2000\)/);
  });
});

describe('_buildStringExpr placeholders', () => {
  const manager = new TestManager();

  it('substitutes {{var}} without spaces', () => {
    const expr = manager._buildStringExpr('{"success": {{success}}}');
    assert.equal(expr, '`{"success": ${vars[\'success\']}}`');
  });

  it('substitutes {{ var }} with spaces (UI hint style)', () => {
    const expr = manager._buildStringExpr('{\n  "success": {{ success }}\n}');
    assert.equal(expr, '`{\n  "success": ${vars[\'success\']}\n}`');
  });

  it('substitutes placeholders in URLs and headers', () => {
    assert.equal(
      manager._buildStringExpr('https://api.example.com/items/{{ id }}'),
      "`https://api.example.com/items/${vars['id']}`"
    );
    assert.equal(manager._buildStringExpr('Bearer {{ token }}'), "`Bearer ${vars['token']}`");
  });

  it('leaves plain strings as JSON literals', () => {
    assert.equal(manager._buildStringExpr('hello'), '"hello"');
  });
});
