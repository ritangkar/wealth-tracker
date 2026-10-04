import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const buildId = process.env.BUILD_ID ?? createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 8);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

/** Generates dist/sw.js from src/sw.template.js with a precache list (relative URLs) + build id. */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'wealth-os-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files = walk(outDir).map((f) => relative(outDir, f).split('\\').join('/')).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const precache = files.map((f) => (f === 'index.html' ? './' : `./${f}`));
      precache.push('./index.html');
      const tpl = readFileSync('src/sw.template.js', 'utf8');
      const revision = createHash('sha1').update(files.map((f) => readFileSync(join(outDir, f))).join('')).digest('hex').slice(0, 10);
      writeFileSync(join(outDir, 'sw.js'), tpl
        .replace('__BUILD_ID__', `${pkg.version}-${buildId}`)
        .replace('__CONTENT_REV__', revision)
        .replace('__PRECACHE__', JSON.stringify([...new Set(precache)])));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version}+${buildId}`) },
  build: { target: 'es2022', sourcemap: false },
});
