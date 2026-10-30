import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import path from 'node:path';
import fs from 'node:fs';
import { zipSync } from 'fflate';

export default defineConfig({
  base: '/vendor/folia/',
  plugins: [react(), {
    name: 'openmusic-folia-manifest',
    writeBundle(options, bundle) {
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry && item.facadeModuleId?.endsWith('/stage.tsx'));
      const css = Object.values(bundle).filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.fileName);
      if (!entry || !css.length || !entry.exports.includes('mountFolia')) throw new Error('Folia stage entry is incomplete');
      const preload = new Set();
      const collectImports = chunk => {
        for (const imported of chunk.imports) {
          if (preload.has(imported)) continue;
          preload.add(imported);
          if (bundle[imported]?.type === 'chunk') collectImports(bundle[imported]);
        }
      };
      collectImports(entry);
      fs.writeFileSync(path.join(options.dir, 'stage.json'), JSON.stringify({ script: entry.fileName, css, preload: [...preload] }));
      fs.copyFileSync(path.resolve(import.meta.dirname, 'upstream/LICENSE'), path.join(options.dir, 'LICENSE.txt'));
      const sources = {};
      const collect = directory => {
        for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
          if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
          const file = path.join(directory, item.name);
          if (item.isDirectory()) collect(file);
          else sources[path.relative(import.meta.dirname, file).replaceAll('\\', '/')] = new Uint8Array(fs.readFileSync(file));
        }
      };
      collect(import.meta.dirname);
      sources['OPENMUSIC_INTEGRATION.md'] = new Uint8Array(fs.readFileSync(path.resolve(import.meta.dirname, '../../docs/FOLIA_IMMERSIVE.md')));
      fs.writeFileSync(path.join(options.dir, 'source.zip'), zipSync(sources));
    },
  }],
  resolve: { alias: {
    '@': path.resolve(import.meta.dirname, 'upstream/src'),
    'virtual:folia-locale-zh-TW': path.resolve(import.meta.dirname, 'upstream/src/i18n/locales/zh-CN.ts'),
  } },
  css: { postcss: { plugins: [tailwind()] } },
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify('openmusic-folia'),
    __BUILD_COMMIT__: JSON.stringify('77640a4c'),
    __BUILD_REPO__: JSON.stringify('chthollyphile/folia-major'),
  },
  build: { outDir: '../../client/public/vendor/folia', emptyOutDir: true, cssCodeSplit: false, rollupOptions: { input: { index: path.resolve(import.meta.dirname, 'index.html'), stage: path.resolve(import.meta.dirname, 'stage.tsx') }, preserveEntrySignatures: 'strict' } },
});
