// Static server that mimics GitHub Pages project hosting: app served under /<prefix>/, no SPA fallback
// (unknown paths 404 like Pages), directory index, short-lived caching headers.
// Usage: node scripts/serve-pages.mjs [dir=dist] [port=4173] [prefix=/wealth-tracker]
// If a file named .e2e-active exists its content (a dir name) overrides `dir` per request (lets e2e simulate a new deploy).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';

const [dirArg = 'dist', portArg = '4173', prefixArg = '/wealth-tracker'] = process.argv.slice(2);
const prefix = '/' + prefixArg.replace(/^\/+|\/+$/g, '');
const port = Number(portArg);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json' };

function currentDir() { return existsSync('.e2e-active') ? readFileSync('.e2e-active', 'utf8').trim() : dirArg; }

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  const notFound = () => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1><p>File not found (GitHub Pages style).</p>'); };
  if (path === prefix) { res.writeHead(301, { location: prefix + '/' }); return res.end(); }
  if (!path.startsWith(prefix + '/')) return notFound();
  path = path.slice(prefix.length);
  if (path.endsWith('/')) path += 'index.html';
  const root = resolve(currentDir());
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return notFound();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=600' }); // Pages default ≈ 10 min
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Serving ${dirArg} at http://localhost:${port}${prefix}/`));
