import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const BUILD_ID = Date.now().toString(36);

// ملفات الـ PWA اللي بتتولّد وقت البناء (كانت ناقصة: الـ Service Worker والواجهة بيطلبوها):
//  - version.json: رقم البناء — الواجهة بتقارنه بنسختها عشان تعرض «تحديث متاح» (src/pwa/version.ts)
//  - precache-manifest.json: كل ملفات التطبيق — الـ SW بيخزّنها وقت التثبيت، فأي شاشة تفتح بدون إنترنت حتى لو ما اتزارتش قبل كده
//  - sw.js: بيتختم برقم البناء ← أي نشر جديد = SW جديد بيخزّن الملفات الجديدة (من غير ما يمسح بيانات IndexedDB)
function pwaBuildFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'ortho-pwa-build-files',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(relative(outDir, p).replace(/\\/g, '/')); } };
      walk(outDir);
      // الصور الكبيرة بتاعة صفحة الهبوط مش لازمة للشغل بدون إنترنت — بتتخزّن لو اتفتحت
      const precache = files.filter((f) => f !== 'sw.js' && f !== 'index.html' && !f.startsWith('landing/') && !f.endsWith('.map') && f !== '_headers');
      writeFileSync(join(outDir, 'precache-manifest.json'), JSON.stringify({ id: BUILD_ID, files: precache }));
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ id: BUILD_ID }));
      const sw = join(outDir, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace("const BUILD = 'dev';", `const BUILD = '${BUILD_ID}';`));
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaBuildFiles()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: '127.0.0.1', port: 4660, strictPort: true },
  preview: { host: '127.0.0.1', port: 4660, strictPort: true },
});
