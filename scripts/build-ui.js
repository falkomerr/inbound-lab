#!/usr/bin/env node
/**
 * Build minified dashboard bundle and generate index.bundled.html for production.
 */

import { build } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const indexPath = resolve(root, 'public/index.html');
const bundledIndexPath = resolve(root, 'public/index.bundled.html');

const BUNDLE_SCRIPT = '  <script type="module" src="/dist/dashboard.js"></script>\n';

async function main() {
  await build({
    configFile: resolve(root, 'vite.config.js'),
    logLevel: 'info',
  });

  const html = readFileSync(indexPath, 'utf8');
  const withoutVendor = html.replace(
    /<!-- UI_VENDOR_START -->[\s\S]*?<!-- UI_VENDOR_END -->\n?/,
    ''
  );
  const bundled = withoutVendor.replace(
    /<!-- UI_SCRIPTS_START -->[\s\S]*?<!-- UI_SCRIPTS_END -->/,
    `<!-- UI_SCRIPTS_START -->\n${BUNDLE_SCRIPT}<!-- UI_SCRIPTS_END -->`
  );

  writeFileSync(bundledIndexPath, bundled, 'utf8');
  console.log('Wrote public/dist/dashboard.js and public/index.bundled.html');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
