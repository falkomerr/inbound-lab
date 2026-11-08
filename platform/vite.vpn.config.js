import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'ui',
  base: '/vpn/',
  plugins: [vue()],
  build: {
    outDir: '../public/vpn',
    emptyOutDir: true,
    rollupOptions: {
      input: 'ui/index.html',
      output: { entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' },
    },
  },
});
