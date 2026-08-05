import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'public/build-entry.js'),
      name: 'LoadTestDashboard',
      formats: ['iife'],
      fileName: () => 'dashboard.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2020',
  },
});
