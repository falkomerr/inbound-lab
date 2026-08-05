/**
 * UI smoke tests — catch frontend regressions unit/API tests miss
 * @module tests/integration/uiSmoke
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const INDEX_HTML = join(ROOT, 'public/index.html');

/** Prettier must not split Vue mustache JS across lines (breaks compile → blank page). */
const BROKEN_MUSTACHE_RE = /\{\{[^}]*\n[^}]*\}\}/s;

function extractAppTemplate(html) {
  const start = html.indexOf('<div id="app" v-cloak>');
  assert.ok(start >= 0, 'index.html must contain #app template');
  const contentStart = start + '<div id="app" v-cloak>'.length;
  const end = html.indexOf('<!-- UI_SCRIPTS_START -->', contentStart);
  assert.ok(end > contentStart, 'index.html must contain UI_SCRIPTS_START marker');
  return html.slice(contentStart, end);
}

describe('UI smoke', () => {
  describe('index.html template', () => {
    it('has no mustache expressions broken across lines', () => {
      const html = readFileSync(INDEX_HTML, 'utf8');
      assert.doesNotMatch(
        html,
        BROKEN_MUSTACHE_RE,
        'Vue {{ }} blocks must stay on one line — Prettier breaks JS like `new\\nDate()`'
      );
    });

    it('includes a non-empty Vue mount template', () => {
      const html = readFileSync(INDEX_HTML, 'utf8');
      const template = extractAppTemplate(html);
      assert.ok(template.includes('app-nav'), 'dashboard shell should be in #app template');
      assert.ok(template.length > 1000);
    });

    it('loads vendor globals and app scripts in dev order', () => {
      const html = readFileSync(INDEX_HTML, 'utf8');
      const vueIdx = html.indexOf('/vendor/vue/vue.global.prod.js');
      const chartIdx = html.indexOf('/vendor/chart.js/chart.umd.js');
      const moduleIdx = html.indexOf('./curlParser.js');
      const apiClientIdx = html.indexOf('modules/apiClient.js');
      const iconIdx = html.indexOf('modules/icon.js');
      const appIdx = html.indexOf('src="app.js"');
      assert.ok(vueIdx > 0 && chartIdx > vueIdx);
      assert.ok(moduleIdx > 0, 'curlParser module script is required');
      assert.ok(apiClientIdx > moduleIdx);
      assert.ok(iconIdx > apiClientIdx);
      assert.ok(appIdx > iconIdx, 'app.js must come after shared modules');
      assert.match(html, /defer[^>]*src="app\.js"|src="app\.js"[^>]*defer/);
    });

    it('build:ui markers allow generating index.bundled.html', () => {
      const html = readFileSync(INDEX_HTML, 'utf8');
      assert.match(html, /<!-- UI_SCRIPTS_START -->[\s\S]*<!-- UI_SCRIPTS_END -->/);
      assert.match(html, /<!-- UI_VENDOR_START -->[\s\S]*<!-- UI_VENDOR_END -->/);
    });
  });

  describe('static assets via HTTP', () => {
    /** @type {import('node:http').Server} */
    let server;
    let baseUrl;

    before(async () => {
      const app = express();
      const vueDist = join(ROOT, 'node_modules/vue/dist');
      const chartDist = join(ROOT, 'node_modules/chart.js/dist');
      const publicRoot = join(ROOT, 'public');
      app.use('/vendor/vue', express.static(vueDist));
      app.use('/vendor/chart.js', express.static(chartDist));
      app.use(express.static(publicRoot));
      app.get('/', (_req, res) => {
        res.sendFile(INDEX_HTML);
      });

      server = http.createServer(app);
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
      if (server) {
        await new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });

    it('serves dashboard HTML and required scripts', async () => {
      const paths = [
        '/',
        '/login.html',
        '/invite.html',
        '/reset.html',
        '/app.js',
        '/modules/apiClient.js',
        '/modules/icon.js',
        '/curlParser.js',
        '/vendor/vue/vue.global.prod.js',
        '/vendor/chart.js/chart.umd.js',
      ];
      const results = await Promise.all(
        paths.map(async (path) => {
          const res = await fetch(`${baseUrl}${path}`);
          return { path, status: res.status };
        })
      );
      for (const { path, status } of results) {
        assert.equal(status, 200, `${path} should return 200`);
      }
    });
  });
});
